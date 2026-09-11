"""Explicit Pocket-only asset download; pinned sizes/hashes, no automatic retries.

Run only with approved download scope. The caller installs the pinned wheels
separately. This script provisions the public, non-voice-cloning checkpoint.
"""
import hashlib
from pathlib import Path
import requests

REVISION = "d29db7978e464fb90cb3359ee0c69a273b9142cc"
VOICE_REVISION = "e81d79e8194ad4c7ce879c87a4258ef20cbf2487"
REPOSITORY = "kyutai/pocket-tts-without-voice-cloning"
ASSETS = [
    ("languages/english/model.safetensors", 219029196, "be9c6b4876d3f30740a8225dfcaa2e43dc4aeb753c15272735bee16bbb4abb0a"),
    ("languages/english/tokenizer.model", 59339, "d461765ae179566678c93091c5fa6f2984c31bbe990bf1aa62d92c64d91bc3f6"),
    ("languages/english/embeddings/alba.safetensors", 6194424, "69c32db63ca56843d994f81f343f62e0bf2d73f7e4c9bc73e44bb1110b1d8845"),
]


def main():
    root = Path(__file__).resolve().parent / "cache/huggingface/hub" / ("models--" + REPOSITORY.replace("/", "--")) / "snapshots"
    print(f"Pinned asset budget: {sum(size for _, size, _ in ASSETS)} bytes", flush=True)
    for name, size, checksum in ASSETS:
        revision = VOICE_REVISION if "/embeddings/" in name else REVISION
        destination = root / revision / name
        if destination.exists():
            if destination.stat().st_size == size and hashlib.file_digest(destination.open("rb"), "sha256").hexdigest() == checksum:
                print(f"Already verified: {name}", flush=True)
                continue
            raise RuntimeError(f"Existing asset failed verification: {name}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".partial")
        if temporary.exists():
            raise RuntimeError(f"Partial download exists; review budget before retrying: {temporary}")
        url = f"https://huggingface.co/{REPOSITORY}/resolve/{revision}/{name}"
        received = 0
        digest = hashlib.sha256()
        with requests.get(url, stream=True, timeout=(30, 90)) as response:
            response.raise_for_status()
            if response.headers.get("Content-Length") and int(response.headers["Content-Length"]) != size:
                raise RuntimeError("Published download size changed")
            with temporary.open("xb") as output:
                for chunk in response.iter_content(1024 * 1024):
                    received += len(chunk)
                    if received > size:
                        raise RuntimeError("Asset exceeded approved size")
                    output.write(chunk)
                    digest.update(chunk)
        if received != size or digest.hexdigest() != checksum:
            raise RuntimeError(f"Asset failed size/hash verification: {name}")
        temporary.rename(destination)
        print(f"Verified: {name} ({received} bytes)", flush=True)


if __name__ == "__main__":
    main()
