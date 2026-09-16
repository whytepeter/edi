"""Approved sources for the model runner Edi ships: llama.cpp and the cmake used to build it.

Nothing here is installed system-wide and nothing runs from the downloads: the tarball is
extracted by native/llama/build.sh, which builds `llama-server` (one static binary). Models
themselves are never bundled; the app downloads them into its own folder, pinned and checked.

Run once: uv run benchmarks/models/provision_llama.py
"""

from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import zipfile

import requests

ROOT = Path(__file__).resolve().parent / "cache"
# llama.cpp v0.4.1 (2026-09-14).
COMMIT = "391fac16460f15233a7740550d858ac96df3419d"
CMAKE_WHEEL = "cmake-4.4.3-py3-none-macosx_10_10_universal2.whl"
ASSETS = [
    # (name, url, max bytes, expected sha256 or None to record on the first run)
    ("llama-source.tar.gz", f"https://codeload.github.com/ggml-org/llama.cpp/tar.gz/{COMMIT}",
     40_000_000, None),
    (CMAKE_WHEEL,
     "https://files.pythonhosted.org/packages/da/2e/78cc0dab93ad407e4b126ab6a3c8a6fc3df89011b49e910c5a5e9bda78a6/cmake-4.4.3-py3-none-macosx_10_10_universal2.whl",
     54_406_608, "6c95b37116bb5c714656e4f76931ebdcb739209a1aee91cf51408ccfe137694e"),
]


def fetch(asset):
    name, url, limit, expected = asset
    target = ROOT / name
    if target.exists():
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if expected is not None and digest != expected:
            raise RuntimeError(f"Review existing file before reuse: {name}")
        return {"name": name, "url": url, "bytes": target.stat().st_size, "sha256": digest}
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
    if expected is not None and checksum != expected:
        partial.unlink()
        raise RuntimeError(f"Verification failed: {name}")
    partial.rename(target)
    print(f"Verified {name}: {received} bytes, sha256 {checksum}", flush=True)
    return {"name": name, "url": url, "bytes": received, "sha256": checksum}


def unpack_cmake():
    """The wheel holds a self-contained cmake; the build script runs it from here."""
    tools = ROOT / "tools"
    if (tools / "cmake/data/bin/cmake").exists():
        return
    with zipfile.ZipFile(ROOT / CMAKE_WHEEL) as wheel:
        wheel.extractall(tools)
    (tools / "cmake/data/bin/cmake").chmod(0o755)


if __name__ == "__main__":
    ROOT.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        records = list(pool.map(fetch, ASSETS))
    unpack_cmake()
    (ROOT / "downloads.json").write_text(
        json.dumps({"source_commit": COMMIT, "assets": records}, indent=2)
    )
    print("Pin these in benchmarks/models/downloads.json and native/llama/build.sh.")
