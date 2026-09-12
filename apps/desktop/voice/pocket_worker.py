"""Offline, long-lived speech worker. stdout is reserved for bounded protocol lines.

Protocol (one JSON object per line):
  worker -> host  {"type": "ready", "rate": 24000}          once the model is loaded
  host -> worker  {"text": "..."}                           one utterance at a time
  worker -> host  {"type": "pcm", "rate": 24000, "data": b64 float32le}
  host -> worker  "ack" (send the next frame) or "cancel" (stop this utterance)
  worker -> host  {"type": "done", "cancelled": bool}
Closing stdin ends the worker. Any other credit is a protocol violation.
"""
import base64
import contextlib
import json
import os
import sys

# Pocket's published "alba" embedding is male-pitched (~130 Hz). Fantine is female.
DEFAULT_VOICE = "fantine"


def emit(message):
    print(json.dumps(message), file=sys.__stdout__, flush=True)


def speak(model, voice, text):
    """Stream one utterance. A credit is required per frame, so the producer never runs ahead."""
    with contextlib.redirect_stdout(sys.stderr):
        stream = model.generate_audio_stream(voice, text, copy_state=True)
        for chunk in stream:
            chunk = chunk.detach().cpu().flatten().clamp(-1, 1)
            for part in chunk.split(24000):
                if not part.numel():
                    continue
                data = base64.b64encode(part.numpy().astype("<f4").tobytes()).decode("ascii")
                emit({"type": "pcm", "rate": model.sample_rate, "data": data})
                credit = sys.stdin.readline(16)
                if credit == "cancel\n":
                    return True
                if credit != "ack\n":
                    sys.exit(3)
    return False


def main():
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    # Library progress must never corrupt the protocol or reach the renderer.
    with contextlib.redirect_stdout(sys.stderr):
        import torch
        from pocket_tts import TTSModel
        torch.set_num_threads(2)
        model = TTSModel.load_model()
        voice = model.get_state_for_audio_prompt(DEFAULT_VOICE)
    emit({"type": "ready", "rate": model.sample_rate})

    while True:
        request = sys.stdin.readline(16000)
        if not request:
            return  # host closed stdin: unload quietly
        text = json.loads(request)["text"]
        if not isinstance(text, str) or not text.strip() or len(text) > 2000:
            raise ValueError("Invalid speech text")
        emit({"type": "done", "cancelled": speak(model, voice, text)})


if __name__ == "__main__":
    main()
