"""Approved local-only STT/VAD assets. No retries or system-wide installation."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent / "cache/transcription"
COMMIT = "927cfce34f31707e17f2bff35c349632fb9e2c3a"
ASSETS = [
    ("ggml-base.en.bin", "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin",
     147964211, "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"),
    # small.en replaces base.en in the app for materially better English recognition;
    # base.en remains available for benchmark comparison and older checkouts.
    ("ggml-small.en.bin", "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.en.bin",
     487614201, "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d"),
    ("ggml-silero-v6.2.0.bin", "https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin",
     885098, "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987"),
    ("cmake-4.4.3-py3-none-macosx_10_10_universal2.whl",
     "https://files.pythonhosted.org/packages/da/2e/78cc0dab93ad407e4b126ab6a3c8a6fc3df89011b49e910c5a5e9bda78a6/cmake-4.4.3-py3-none-macosx_10_10_universal2.whl",
     54406608, "6c95b37116bb5c714656e4f76931ebdcb739209a1aee91cf51408ccfe137694e"),
    ("whisper-source.tar.gz", f"https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/{COMMIT}",
     9357755, "41b664fee09e79176ac277b5237debec34f8d74af3c7d71f333f1ec67989ecde"),
]


def fetch(asset):
    name, url, limit, expected = asset
    target = ROOT / name
    if target.exists():
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if expected is None or digest != expected or target.stat().st_size != limit:
            raise RuntimeError(f"Review existing file before reuse: {name}")
        return {"name": name, "url": url, "bytes": limit, "sha256": digest}
    partial = target.with_suffix(target.suffix + ".partial")
    digest = hashlib.sha256()
    received = 0
    with partial.open("xb") as output, requests.get(url, stream=True, timeout=(30, 90)) as response:
        response.raise_for_status()
        for chunk in response.iter_content(1024 * 1024):
            received += len(chunk)
            if received > limit:
                raise RuntimeError(f"Download exceeded cap: {name}")
            output.write(chunk)
            digest.update(chunk)
    checksum = digest.hexdigest()
    if expected and (received != limit or checksum != expected):
        raise RuntimeError(f"Verification failed: {name}")
    partial.rename(target)
    print(f"Verified {name}: {received} bytes", flush=True)
    return {"name": name, "url": url, "bytes": received, "sha256": checksum}


if __name__ == "__main__":
    ROOT.mkdir(parents=True, exist_ok=True)
    assert sum(asset[2] for asset in ASSETS) < 1_000_000_000
    with ThreadPoolExecutor(max_workers=4) as pool:
        records = list(pool.map(fetch, ASSETS))
    (ROOT / "downloads.json").write_text(json.dumps({"source_commit": COMMIT, "assets": records}, indent=2))
