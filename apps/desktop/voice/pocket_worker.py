"""Offline, single-utterance worker. stdout is reserved for bounded PCM frames."""
import base64
import contextlib
import json
import os
import sys


def main():
    request = sys.stdin.readline(16000)
    text = json.loads(request)["text"]
    if not isinstance(text, str) or not text.strip() or len(text) > 2000:
        raise ValueError("Invalid speech text")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    # Library progress must never corrupt the protocol or reach the renderer.
    with contextlib.redirect_stdout(sys.stderr):
        import torch
        from pocket_tts import TTSModel
        torch.set_num_threads(2)
        model = TTSModel.load_model()
        voice = model.get_state_for_audio_prompt("alba")
        stream = model.generate_audio_stream(voice, text, copy_state=True)
        while True:
            try:
                chunk = next(stream).detach().cpu().flatten().clamp(-1, 1)
            except StopIteration:
                break
            # A credit is required for every frame; the producer cannot run ahead.
            for part in chunk.split(24000):
                if not part.numel():
                    continue
                data = base64.b64encode(part.numpy().astype("<f4").tobytes()).decode("ascii")
                print(json.dumps({"type": "pcm", "rate": model.sample_rate, "data": data}),
                      file=sys.__stdout__, flush=True)
                if sys.stdin.readline(16) != "ack\n":
                    return
    print(json.dumps({"type": "done"}), flush=True)


if __name__ == "__main__":
    main()
