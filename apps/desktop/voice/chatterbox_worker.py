"""Offline Chatterbox Turbo worker. stdout is a bounded JSON-line audio protocol."""
import argparse
import base64
import contextlib
import json
import os
import re
import sys


def emit(message):
    print(json.dumps(message), file=sys.__stdout__, flush=True)


def clips(text, limit=400):
    """The host already chooses clip boundaries (a short first clip, then the rest together).
    Every clip pays a fixed ~1.5 s vocoder cost on this class of Mac, so only split text that
    is too long for one generation, and only at sentence ends."""
    clips, current = [], ""
    for sentence in (s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s):
        if current and len(current) + 1 + len(sentence) > limit:
            clips.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    return clips + ([current] if current else [])


def speak(model, torch, text):
    """Returns False when the host cancels; the model stays loaded either way."""
    with contextlib.redirect_stdout(sys.stderr), torch.inference_mode():
        audio = model.generate(text).detach().cpu().flatten().clamp(-1, 1)
    for part in audio.split(model.sr):
        if not part.numel():
            continue
        data = base64.b64encode(part.numpy().astype("<f4").tobytes()).decode("ascii")
        emit({"type": "pcm", "rate": model.sr, "data": data})
        credit = sys.stdin.readline(16)
        if credit == "cancel\n":
            return False
        if credit != "ack\n":
            sys.exit(3)
    return True


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--model", required=True)
    args = parser.parse_args()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

    # Resemble's implicit watermarker is optional and often missing (no pkg_resources).
    # Installing it would add a second neural pass after every utterance. A no-op
    # keeps local speech on the spoken reply instead of waiting, then falling back.
    import perth
    from perth.dummy_watermarker import DummyWatermarker

    perth.PerthImplicitWatermarker = DummyWatermarker

    with contextlib.redirect_stdout(sys.stderr):
        import torch
        from chatterbox.tts_turbo import ChatterboxTurboTTS

        torch.set_num_threads(4)
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        model = ChatterboxTurboTTS.from_local(args.model, device=device)
        # The first generate compiles and fills backend caches. Do it while Settings still says
        # Loading and Jane is available, instead of charging an extra several seconds to the
        # first real reply after Chatterbox reports Ready.
        model.generate("Ready.")
    emit({"type": "ready", "rate": model.sr, "model": "turbo"})

    while True:
        request = sys.stdin.readline(16000)
        if not request:
            return
        if request in ("cancel\n", "ack\n"):
            continue  # a late credit for an utterance that already finished
        text = json.loads(request)["text"]
        if not isinstance(text, str) or not text.strip() or len(text) > 2000:
            raise ValueError("Invalid speech text")
        cancelled = False
        for clip in clips(text):
            if not speak(model, torch, clip):
                cancelled = True
                break
        emit({"type": "done", "cancelled": cancelled})


if __name__ == "__main__":
    main()
