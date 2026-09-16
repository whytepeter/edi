"""Provision the pinned MLX speech runtime (Kokoro and Chatterbox) in an isolated env.

MLX runs natively on Apple Silicon. The same Chatterbox Turbo model measured 1.3-1.9x slower
than real time through PyTorch/MPS on an M2 Pro, which is why this runtime exists.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
VENV = ROOT / "mlx-venv"
CACHE = ROOT / "cache/mlx"
MLX_AUDIO = "mlx-audio==0.5.3"
# Kokoro's English text processing. spaCy is pinned because unpinned installs backtrack to an
# unbuildable 4.0 dev release; the English model is installed ahead so nothing downloads at
# runtime; espeakng-loader bundles eSpeak for words missing from Kokoro's dictionary.
KOKORO_TEXT = [
    "misaki==0.7.4",
    "spacy==3.8.16",
    "num2words==0.5.14",
    "phonemizer-fork==3.3.2",
    "espeakng-loader==0.2.4",
    "en_core_web_sm @ https://github.com/explosion/spacy-models/releases/download/"
    "en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl",
]

# English voices only; each is about 0.5 MB.
KOKORO_VOICES = [
    "af_heart", "af_bella", "af_nicole", "af_sarah", "af_nova", "af_sky", "af_kore", "af_aoede",
    "af_alloy", "af_jessica", "af_river", "am_michael", "am_adam", "am_echo", "am_eric",
    "am_fenrir", "am_liam", "am_onyx", "am_puck", "bf_emma", "bf_isabella", "bf_alice",
    "bf_lily", "bm_george", "bm_lewis", "bm_daniel", "bm_fable",
]

MODELS = {
    "kokoro": {
        "repository": "mlx-community/Kokoro-82M-bf16",
        "revision": "a71e4d38b236d968966a2002c4c895dbd12b1c3c",
        "files": ["config.json", "kokoro-v1_0.safetensors"]
        + [f"voices/{voice}.safetensors" for voice in KOKORO_VOICES],
    },
    # Chatterbox (the original, not Turbo): it speaks in a voice made from a recording and
    # clones far better than Turbo, at about 2.6 s to its first sound instead of 0.5 s. It has
    # no voice of its own, so Kokoro is the built-in local voice.
    "chatterbox-4bit": {
        "repository": "mlx-community/Chatterbox-TTS-4bit",
        "revision": "a3c8ded2d711d6395410d645b3a97c79fd563a13",
        "files": [
            "config.json",
            "model.safetensors",
            "tokenizer.json",
        ],
    },
}


def run(*command):
    subprocess.run(command, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--download-models", nargs="*", choices=sorted(MODELS), default=[])
    args = parser.parse_args()
    if not VENV.exists():
        run(sys.executable, "-m", "venv", str(VENV))
    python = VENV / "bin/python"
    run(str(python), "-m", "pip", "install", "--disable-pip-version-check", MLX_AUDIO, *KOKORO_TEXT)
    manifest_path = CACHE / "downloads.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for name in args.download_models:
        model = MODELS[name]
        target = CACHE / name
        script = (
            "from huggingface_hub import snapshot_download; "
            f"snapshot_download({model['repository']!r}, revision={model['revision']!r}, "
            f"local_dir={str(target)!r}, allow_patterns={model['files']!r})"
        )
        run(str(python), "-c", script)
        size = sum((target / file).stat().st_size for file in model["files"])
        manifest[name] = {**model, "bytes": size}
        print(f"Pinned {name}: {size:,} bytes")
    if manifest:
        CACHE.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
