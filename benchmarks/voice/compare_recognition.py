"""Compare local speech recognition setups on the same audio. Local only: whisper-server on 127.0.0.1.

Usage:
  mlx-venv/bin/python compare_recognition.py                 # macOS voices in several English accents
  mlx-venv/bin/python compare_recognition.py --recordings DIR  # your own: DIR/name.wav + DIR/name.txt

Recordings must be 16 kHz mono 16-bit WAV (for example `sox -d -r 16000 -c 1 -b 16 one.wav`). Synthetic
voices are not a person's accent: they compare models, not how well Edi hears you.
"""
import argparse
import json
import re
import subprocess
import tempfile
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent / "cache/transcription"
SOURCE = ROOT / "whisper.cpp-927cfce34f31707e17f2bff35c349632fb9e2c3a"
APP_PROMPT = "Edi. Fewer Labs. OpenRouter. MCP. OAuth. Lagos. Abuja. Naira."
VOCABULARY = "Skaletek. Glown."

SENTENCES = [
    "Hey Edi, can you check my calendar and see what I have in store today?",
    "Do I have any emails concerning Skaletek?",
    "Remind me about the Glown update at nine.",
    "What's my day like?",
    "Can you look up ways to improve you?",
    "Actually, only check emails from Sarah.",
    "Can you help me study for my exam tomorrow?",
    "Open Apple Music and play something calm.",
]
VOICES = ["Rishi", "Tessa", "Moira", "Daniel", "Samantha"]
NAMES = ["edi", "skaletek", "glown"]

SETUPS = [
    ("small.en CPU", SOURCE / "build/bin/whisper-server", "ggml-small.en.bin", ["-ng"], APP_PROMPT),
    ("small.en CPU + words", SOURCE / "build/bin/whisper-server", "ggml-small.en.bin", ["-ng"],
     f"{APP_PROMPT} {VOCABULARY}"),
    ("turbo Metal", SOURCE / "build-metal/bin/whisper-server", "ggml-large-v3-turbo-q5_0.bin", [], APP_PROMPT),
    ("turbo Metal + words", SOURCE / "build-metal/bin/whisper-server", "ggml-large-v3-turbo-q5_0.bin", [],
     f"{APP_PROMPT} {VOCABULARY}"),
]


def words(text):
    return re.findall(r"[a-z0-9']+", text.lower().replace("’", "'"))


def wer(reference, hypothesis):
    ref, hyp = words(reference), words(hypothesis)
    row = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        previous, row[0] = row[0], i
        for j, h in enumerate(hyp, 1):
            previous, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, previous + (r != h))
    return row[-1], len(ref)


def synthesize(folder):
    samples = []
    for voice in VOICES:
        for index, sentence in enumerate(SENTENCES):
            path = folder / f"{voice}-{index}.wav"
            subprocess.run(["say", "-v", voice, "-o", str(path), "--data-format=LEI16@16000", sentence],
                           check=True)
            samples.append((f"{voice}-{index}", path, sentence))
    return samples


def recordings(folder):
    samples = []
    for wav in sorted(Path(folder).glob("*.wav")):
        reference = wav.with_suffix(".txt")
        if reference.exists():
            samples.append((wav.stem, wav, reference.read_text().strip()))
    return samples


def run(setup, samples, port):
    name, server, model, extra, prompt = setup
    process = subprocess.Popen(
        [str(server), "-m", str(ROOT / model), "--vad", "-vm", str(ROOT / "ggml-silero-v6.2.0.bin"),
         "-l", "en", "-t", "4", "--host", "127.0.0.1", "--port", str(port), *extra],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(900):
            try:
                if requests.get(f"http://127.0.0.1:{port}/", timeout=1).ok:
                    break
            except requests.RequestException:
                time.sleep(0.1)
        errors = total = 0
        names_right = names_seen = 0
        seconds = []
        results = []
        for label, path, reference in samples:
            started = time.perf_counter()
            with path.open("rb") as audio:
                reply = requests.post(f"http://127.0.0.1:{port}/inference", timeout=120,
                                      files={"file": audio}, data={"response_format": "json", "prompt": prompt})
            seconds.append(time.perf_counter() - started)
            heard = " ".join(reply.json().get("text", "").split())
            wrong, count = wer(reference, heard)
            errors += wrong
            total += count
            for term in NAMES:
                if term in words(reference):
                    names_seen += 1
                    names_right += term in words(heard)
            results.append({"sample": label, "said": reference, "heard": heard, "errors": wrong})
        seconds.sort()
        return {
            "setup": name,
            "wer": round(errors / max(total, 1), 3),
            "names": f"{names_right}/{names_seen}",
            "median_s": round(seconds[len(seconds) // 2], 2),
            "results": results,
        }
    finally:
        process.terminate()
        process.wait(timeout=10)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--recordings")
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent / "results/recognition.json"))
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as temporary:
        samples = recordings(args.recordings) if args.recordings else synthesize(Path(temporary))
        report = [run(setup, samples, 18900 + index) for index, setup in enumerate(SETUPS)]
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(report, indent=2))
    for entry in report:
        print(f"{entry['setup']:24} WER {entry['wer']:.3f}  names {entry['names']:6}  median {entry['median_s']} s")
    print(f"Details: {args.out}")
