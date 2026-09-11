"""Stdlib-only protocol fixture; never loaded by production."""
import base64
import json
import struct
import sys
import time

mode = json.loads(sys.stdin.readline())["text"]
if mode == "crash":
    sys.exit(2)
if mode == "hang":
    time.sleep(30)
if mode == "invalid":
    print('{"type":"pcm","rate":0}', flush=True)
else:
    for _ in range(2):
        print(json.dumps({"type": "pcm", "rate": 24000,
                          "data": base64.b64encode(struct.pack("<f", 0.25)).decode()}), flush=True)
        if sys.stdin.readline() != "ack\n":
            sys.exit(3)
    print('{"type":"done"}', flush=True)
