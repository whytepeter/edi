"""Provision the pinned Chatterbox Turbo runtime in an isolated local environment."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
VENV = ROOT / "chatterbox-venv"
CACHE = ROOT / "cache/chatterbox"
MODEL = CACHE / "model"
REVISION = "749d1c1a46eb10492095d68fbcf55691ccf137cd"
FILES = [
    "added_tokens.json",
    "conds.pt",
    "merges.txt",
    "s3gen_meanflow.safetensors",
    "special_tokens_map.json",
    "t3_turbo_v1.safetensors",
    "tokenizer_config.json",
    "ve.safetensors",
    "vocab.json",
]


def run(*command):
    subprocess.run(command, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--download-model", action="store_true")
    args = parser.parse_args()
    if not VENV.exists():
        run(sys.executable, "-m", "venv", str(VENV))
    python = VENV / "bin/python"
    run(str(python), "-m", "pip", "install", "--disable-pip-version-check", "chatterbox-tts==0.1.7")
    if args.download_model:
        script = (
            "from huggingface_hub import snapshot_download; "
            f"snapshot_download('ResembleAI/chatterbox-turbo', revision='{REVISION}', "
            f"local_dir={str(MODEL)!r}, allow_patterns={FILES!r})"
        )
        run(str(python), "-c", script)
        manifest = {
            "repository": "ResembleAI/chatterbox-turbo",
            "revision": REVISION,
            "files": FILES,
            "bytes": sum((MODEL / name).stat().st_size for name in FILES),
        }
        (CACHE / "downloads.json").write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"Pinned Chatterbox Turbo: {manifest['bytes']:,} bytes")


if __name__ == "__main__":
    main()
