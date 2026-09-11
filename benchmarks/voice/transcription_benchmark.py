"""Offline screening on existing Pocket samples; not a human-microphone accuracy test."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import time
import wave
import numpy as np
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "cache/transcription"
SOURCE = CACHE / "whisper.cpp-927cfce34f31707e17f2bff35c349632fb9e2c3a"


def prepare(source, destination):
    with wave.open(str(source), "rb") as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2:
            raise ValueError("Expected mono PCM16 fixture")
        rate = audio.getframerate()
        pcm = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float32) / 32768
    pcm = resample_poly(pcm, 16000, rate)
    write_wav(destination, pcm)
    return len(pcm) / 16000


def write_wav(path, pcm):
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes((np.clip(pcm, -1, 1) * 32767).astype("<i2").tobytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    corpus = json.loads((ROOT / "corpus.json").read_text())
    corpus.append({"id": "silence", "text": ""})
    records = []
    for row in corpus:
        wav = args.output / f"{row['id']}.wav"
        if row["id"] == "silence":
            write_wav(wav, np.zeros(48000))
            seconds = 3
        else:
            seconds = prepare(ROOT / "results/pocket-run-02" / f"{row['id']}-0.wav", wav)
        for vad in (False, True):
            prefix = args.output / f"{row['id']}-{'vad' if vad else 'plain'}"
            command = [str(SOURCE / "build/bin/whisper-cli"), "-m", str(CACHE / "ggml-base.en.bin"),
                       "-f", str(wav), "-l", "en", "-t", "4", "-ng", "-oj", "-of", str(prefix)]
            if vad:
                command += ["--vad", "-vm", str(CACHE / "ggml-silero-v6.2.0.bin")]
            start = time.perf_counter()
            result = subprocess.run(["/usr/bin/time", "-l", *command], capture_output=True, text=True, timeout=120)
            elapsed = time.perf_counter() - start
            prefix.with_suffix(".log").write_text(result.stderr)
            if result.returncode != 0:
                raise RuntimeError(f"Transcription failed; inspect {prefix}.log")
            output = json.loads(prefix.with_suffix(".json").read_text())
            transcript = " ".join(part["text"].strip() for part in output["transcription"]).strip()
            memory = re.search(r"(\d+)\s+maximum resident set size", result.stderr)
            record = {"id": row["id"], "vad": vad, "reference": row["text"], "transcript": transcript,
                      "audio_seconds": seconds, "process_seconds": elapsed, "real_time_factor": elapsed / seconds,
                      "peak_rss_bytes": int(memory[1]) if memory else None}
            records.append(record)
            (args.output / "summary.json").write_text(json.dumps({"version": "whisper.cpp v1.9.4",
                "backend": "CPU / Accelerate; 4 threads", "model": "base.en", "vad_model": "silero-v6.2.0",
                "each_request_loads_model": True, "source": "synthetic Pocket Alba samples plus digital silence",
                "runs": records}, indent=2))
            print(json.dumps(record), flush=True)


if __name__ == "__main__":
    main()
