"""Offline MLX speech worker for Kokoro and Chatterbox. stdout is the protocol channel.

Protocol (one JSON object per line), the same credits as the earlier Pocket worker:
  worker -> host  {"type": "ready", "rate": 24000, "engine": "kokoro"|"chatterbox-turbo"}
  host -> worker  {"text": "...", "voice": "af_heart", "delivery": "calm"|"expressive"}
                  a Kokoro voice, or Chatterbox's built-in voice / one made from a recording
  worker -> host  {"type": "pcm", "rate": 24000, "data": b64 float32le}   at most 1 s each
  host -> worker  "ack" (next frame) or "cancel" (stop this utterance)
  worker -> host  {"type": "done", "cancelled": bool}
Closing stdin ends the worker. Any other credit is a protocol violation.

Measured on an M2 Pro (mlx-audio 0.5.3): Kokoro 82M starts in ~0.15 s at ~10x real time;
Chatterbox 4-bit streams its first audio in ~2.6 s and runs at about real time. Chatterbox has
no voice of its own: it speaks only in voices prepared from the person's recordings.
"""
import argparse
import base64
import contextlib
import json
import os
from pathlib import Path
import re
import sys

ENGINES = ("kokoro", "chatterbox")
RATE = 24000
VOICE_ID = re.compile(r"^[ab][fm]_[a-z]+$")
# A Chatterbox voice: "built-in" is the recording of Edi's own voice that ships with the app,
# anything else is one made from a recording on this Mac, e.g. "edi".
BUILT_IN = "built-in"
PERSONAL_ID = re.compile(r"^[a-z]{2,20}$")


def emit(message):
    print(json.dumps(message), file=sys.__stdout__, flush=True)


def send_audio(audio):
    """Frames of at most one second, each waiting for a credit. Returns False on cancel."""
    import numpy as np

    samples = np.clip(np.asarray(audio, dtype=np.float32).reshape(-1), -1.0, 1.0)
    for start in range(0, samples.size, RATE):
        part = samples[start : start + RATE]
        if not part.size:
            continue
        emit({"type": "pcm", "rate": RATE, "data": base64.b64encode(part.astype("<f4").tobytes()).decode("ascii")})
        credit = sys.stdin.readline(16)
        if credit == "cancel\n":
            return False
        if credit != "ack\n":
            sys.exit(3)
    return True


def load_kokoro(model_dir):
    # Words missing from Kokoro's dictionary (names like "Edi") go through eSpeak. Use the
    # library bundled with espeakng-loader instead of looking for a Homebrew install.
    import espeakng_loader
    from phonemizer.backend.espeak.wrapper import EspeakWrapper

    EspeakWrapper.set_library(espeakng_loader.get_library_path())
    EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
    from mlx_audio.tts.utils import load_model

    model = load_model(Path(model_dir))
    voices = Path(model_dir) / "voices"

    def speak(text, voice, deliver):
        if not VOICE_ID.match(voice or "") or not (voices / f"{voice}.safetensors").is_file():
            raise ValueError("Unknown Kokoro voice")
        # A path keeps loading local; a voice name would look it up on Hugging Face.
        options = {"voice": str(voices / f"{voice}.safetensors"), "lang_code": voice[0]}
        for result in model.generate(text, **options):
            if not deliver(result.audio):
                return False
        return True

    return speak


def check_reference(path):
    """A recording for a personal voice: 24 kHz mono 16-bit WAV, 5 to 60 seconds, kept on this Mac.

    The model reads the file itself; this only refuses anything it should not be given.
    """
    import wave

    with wave.open(path, "rb") as clip:
        if clip.getnchannels() != 1 or clip.getsampwidth() != 2 or clip.getframerate() != RATE:
            raise ValueError("Voice recording must be 24 kHz mono 16-bit WAV")
        frames = clip.getnframes()
        if not 5 * RATE < frames <= 60 * RATE:
            raise ValueError("Voice recording must be 5 to 60 seconds")


# How Chatterbox reads, whichever voice it speaks in. `exaggeration` is how much feeling it puts
# in and `cfg_weight` how closely it follows the reference's pacing; the model leaves both at 0
# by default, which is what made every reply sound flat.
DELIVERIES = {
    "calm": {"exaggeration": 0.4, "cfg_weight": 0.6, "temperature": 0.6, "top_p": 0.85},
    "expressive": {"exaggeration": 0.7, "cfg_weight": 0.3, "temperature": 0.8},
}


def load_chatterbox(model_dir, references=()):
    from mlx_audio.tts.utils import load_model

    model = load_model(Path(model_dir))

    # Who speaks: a voice prepared once from its recording, then reused. The model has no voice
    # of its own, so without a recording there is nothing for it to say anything in.
    speakers = {}
    for voice, path in references:
        check_reference(path)
        # This build conditions from the recording on disk, rather than from samples in memory.
        speakers[voice] = model.prepare_conditionals(path, RATE, exaggeration=0.5)
    if not speakers:
        raise ValueError("Chatterbox needs a voice recording")

    def speak(text, voice, deliver, delivery="calm"):
        if voice not in speakers:
            raise ValueError("Unknown Chatterbox voice")
        model._conds = speakers[voice]
        # Streaming emits audio every ~25 speech tokens (about one second), so the first sound
        # arrives in about half a second instead of after the whole clip is generated.
        settings = DELIVERIES.get(delivery, DELIVERIES["calm"])
        for result in model.generate(text, stream=True, streaming_interval=1.0, **settings):
            if not deliver(result.audio):
                return False
        return True

    return speak


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--engine", choices=ENGINES, required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--voice", default="af_heart")
    # Chatterbox personal voices: id=path to a recording. Ids are short names, never paths.
    parser.add_argument("--reference", action="append", default=[])
    args = parser.parse_args()
    references = []
    for item in args.reference:
        voice, _, path = item.partition("=")
        if (voice != BUILT_IN and not PERSONAL_ID.match(voice)) or not Path(path).is_file():
            raise ValueError("Invalid voice recording")
        references.append((voice, path))
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

    # Library progress and warnings must never corrupt the protocol.
    with contextlib.redirect_stdout(sys.stderr):
        speak = (
            load_kokoro(args.model)
            if args.engine == "kokoro"
            else load_chatterbox(args.model, references)
        )
        # The first generation compiles kernels and fills caches; do it before reporting ready.
        warm_voice = args.voice if args.engine == "kokoro" else references[0][0]
        speak("Ready.", warm_voice, lambda _audio: True)
        if args.engine == "kokoro":
            # American and British voices use separate pipelines; warm the other one too so a
            # voice change in Settings does not pay ~2.5 s on its first reply.
            speak("Ready.", "bf_emma" if args.voice.startswith("a") else "af_heart", lambda _audio: True)
    emit({"type": "ready", "rate": RATE, "engine": args.engine})

    while True:
        request = sys.stdin.readline(16000)
        if not request:
            return
        if request in ("cancel\n", "ack\n"):
            continue  # a late credit for an utterance that already finished
        message = json.loads(request)
        text = message.get("text")
        voice = message.get("voice") or args.voice
        delivery = message.get("delivery") or "calm"
        if not isinstance(text, str) or not text.strip() or len(text) > 2000:
            raise ValueError("Invalid speech text")
        if not isinstance(voice, str) or len(voice) > 40:
            raise ValueError("Invalid voice")
        if delivery not in ("calm", "expressive"):
            raise ValueError("Invalid delivery")
        with contextlib.redirect_stdout(sys.stderr):
            finished = (
                speak(text, voice, send_audio)
                if args.engine == "kokoro"
                else speak(text, voice, send_audio, delivery)
            )
        emit({"type": "done", "cancelled": not finished})


if __name__ == "__main__":
    main()
