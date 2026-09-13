"""Stdlib-only stand-in for pocket_worker.py's protocol; never loaded by production.

Frame values encode which utterance this process is serving (0.25, 0.5, ...), so tests
can tell a reused warm process from a fresh one.
"""
import argparse
import base64
import json
import struct
import sys
import time

parser = argparse.ArgumentParser(add_help=False)
parser.add_argument("--voice")
parser.add_argument("--model")
parser.add_argument("--engine")
args = parser.parse_args()
if not args.voice and not args.model:
    parser.error("--voice or --model is required")
ready = {"type": "ready", "rate": 24000}
if args.engine:
    # mlx_worker.py; the "wrong-engine" model simulates a worker running another engine.
    ready["engine"] = "pocket" if args.model == "wrong-engine" else args.engine
else:
    ready["voice"] = args.voice  # pocket_worker.py
print(json.dumps(ready), flush=True)
served = 0
while True:
    line = sys.stdin.readline()
    if not line:
        sys.exit(0)
    if line in ("ack\n", "cancel\n"):
        continue
    request = json.loads(line)
    mode = request["text"]
    if request.get("voice") == "bad-voice":
        sys.exit(4)
    served += 1
    if mode == "crash":
        sys.exit(2)
    if mode == "hang":
        time.sleep(30)
    if mode == "invalid":
        print('{"type":"pcm","rate":0}', flush=True)
        continue
    frames = 4 if mode == "long" else 2
    cancelled = False
    for _ in range(frames):
        value = struct.pack("<f", 0.25 * served)
        print(json.dumps({"type": "pcm", "rate": 24000, "data": base64.b64encode(value).decode()}),
              flush=True)
        credit = sys.stdin.readline()
        if credit == "cancel\n":
            cancelled = True
            break
        if credit != "ack\n":
            sys.exit(3)
    print(json.dumps({"type": "done", "cancelled": cancelled}), flush=True)
