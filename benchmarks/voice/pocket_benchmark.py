"""Offline-by-default Pocket TTS audition. No microphone access or audio playback.

Run --dry-run without model dependencies. Provision the model separately with
explicit approval; normal measurement must not include download latency.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import resource
import time
import wave


def load_corpus(path):
    rows = json.loads(Path(path).read_text())
    if not isinstance(rows, list) or not 1 <= len(rows) <= 20:
        raise ValueError("Expected 1–20 benchmark lines")
    ids = set()
    for row in rows:
        name = row.get("id", "")
        text = row.get("text", "")
        if not name or not all(c.isascii() and (c.isalnum() or c == "-") for c in name) or name in ids:
            raise ValueError("Line IDs must be unique, safe filenames")
        if not isinstance(text, str) or not text.strip() or len(text) > 2000:
            raise ValueError("Expected nonempty text under 2,001 characters")
        ids.add(name)
    return rows


def metrics(samples, sample_rate, first_chunk_ms, generation_ms):
    if samples <= 0 or sample_rate <= 0 or generation_ms <= 0:
        raise ValueError("No measurable audio generated")
    duration = samples / sample_rate
    return {
        "first_chunk_ms": first_chunk_ms,
        "generation_ms": generation_ms,
        "audio_seconds": duration,
        # Lower is better. 0.5 means generation took half the audio duration.
        "real_time_factor": generation_ms / 1000 / duration,
    }


def peak_rss_bytes():
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return rss if platform.system() == "Darwin" else rss * 1024


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--corpus", type=Path, default=Path(__file__).with_name("corpus.json"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--voice", default="alba")
    parser.add_argument("--repeats", type=int, choices=range(1, 6), default=3)
    args = parser.parse_args()
    corpus = load_corpus(args.corpus)
    if args.dry_run:
        print(json.dumps({"status": "plan-only", "lines": len(corpus), "repeats": args.repeats,
                          "requests": len(corpus) * args.repeats, "voice": args.voice,
                          "network": "disabled", "measurements": None}, indent=2))
        return
    if args.output is None:
        parser.error("--output must name a new results directory")

    # Set before importing Hugging Face clients. Missing assets must fail, not download.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["HF_HOME"] = str(Path(__file__).resolve().parent / "cache/huggingface")
    start = time.perf_counter()
    print("Loading PyTorch and Pocket TTS (offline)…", flush=True)
    import torch
    from pocket_tts import TTSModel
    imported = time.perf_counter()
    print("Loading cached model…", flush=True)
    torch.set_num_threads(2)
    torch.manual_seed(0)
    model = TTSModel.load_model()
    loaded = time.perf_counter()
    print("Loading cached voice…", flush=True)
    voice = model.get_state_for_audio_prompt(args.voice)
    ready = time.perf_counter()
    # Never overwrite an earlier run or its listening samples.
    args.output.mkdir(parents=True, exist_ok=False)
    report = {
        "schema_version": 1, "provider": "pocket-tts", "voice": args.voice,
        "package_version": importlib.metadata.version("pocket-tts"),
        "torch_version": torch.__version__, "python": platform.python_version(),
        "os": platform.system(), "os_version": platform.release(), "machine": platform.machine(),
        "threads": torch.get_num_threads(), "sample_rate": model.sample_rate,
        "corpus_sha256": hashlib.sha256(args.corpus.read_bytes()).hexdigest(),
        "import_ms": (imported - start) * 1000, "model_load_ms": (loaded - imported) * 1000,
        "voice_load_ms": (ready - loaded) * 1000, "load_to_ready_ms": (ready - start) * 1000,
        "first_chunk_is_audible_latency": False,
        "model_revision": "d29db7978e464fb90cb3359ee0c69a273b9142cc",
        "voice_revision": "e81d79e8194ad4c7ce879c87a4258ef20cbf2487",
        "checkpoint": "kyutai/pocket-tts-without-voice-cloning (english)",
        "runs": [],
    }
    for repeat in range(args.repeats):
        for row in corpus:
            torch.manual_seed(repeat)
            chunks = []
            begin = time.perf_counter()
            cpu_begin = time.process_time()
            first = None
            arrival_ms = []
            for chunk in model.generate_audio_stream(voice, row["text"], copy_state=True):
                if chunk.numel() == 0:
                    continue
                now = time.perf_counter()
                first = now if first is None else first
                arrival_ms.append((now - begin) * 1000)
                chunks.append(chunk.detach().cpu().flatten())
            end = time.perf_counter()
            cpu_ms = (time.process_time() - cpu_begin) * 1000
            if first is None:
                raise RuntimeError("Model returned no audio")
            audio = torch.cat(chunks).clamp(-1, 1)
            record = {"id": row["id"], "repeat": repeat,
                      "phase": "first-generation" if not report["runs"] else "warm",
                      **metrics(audio.numel(), model.sample_rate, (first - begin) * 1000, (end - begin) * 1000),
                      "chunk_arrival_ms": arrival_ms, "cpu_ms": cpu_ms,
                      "process_peak_rss_bytes": peak_rss_bytes()}
            filename = f"{row['id']}-{repeat}.wav"
            with wave.open(str(args.output / filename), "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(model.sample_rate)
                output.writeframes((audio.numpy() * 32767).astype("<i2").tobytes())
            record["audio_file"] = filename
            report["runs"].append(record)
            (args.output / "results.json").write_text(json.dumps(report, indent=2))
            print(json.dumps(record), flush=True)
    print(f"Results: {args.output / 'results.json'}", flush=True)


if __name__ == "__main__":
    main()
