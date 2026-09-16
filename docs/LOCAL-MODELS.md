# Models on this Mac

Edi can answer without OpenRouter. Settings → AI lists every model this Mac can run and lets one
be chosen, either as a backup for when OpenRouter can't answer (offline, out of credits, no key)
or as the model for every question.

Three runtimes, in the order someone meets them:

| Runtime | Where it comes from | What Edi does |
| --- | --- | --- |
| **Edi** | A model downloaded in Settings → AI, run by the llama.cpp server Edi ships | Nothing else to install |
| **Ollama** | Already installed by the person | Lists what it serves |
| **LM Studio** | Already installed by the person | Lists what it serves |

## Downloading a model

Two packs, each a GGUF and its vision projector (both Apache-2.0):

| Pack | Model | Size | Context | Can it act? |
| --- | --- | --- | --- | --- |
| Small model (2B) | Qwen3-VL 2B | about 2.3 GB | 8k | Yes: reads the screen and calls tools |
| Bigger model (7B) | Qwen2.5-VL 7B | about 5.5 GB | 16k | No: reads the screen, answers in words |

**What a model can do here depends on its chat template, not its size.** Qwen3-VL declares tools
and parses tool calls while keeping its vision markers; Qwen2.5-VL has no tool support in its
template at all, so Edi lists it as limited rather than pretending it can act. Check a new
model template before pinning it, and set the pack's `vision` and `tools` from what it really does.

Every file is pinned to one Hugging Face revision by address, byte size and SHA-256, downloaded
into Application Support › Edi › models, and renamed into place only once both match. A download
resumes where it stopped (HTTP Range) after Pause, a dropped connection or a restart, and Edi
keeps 200 MB of disk free. A model Edi no longer offers is gigabytes nothing can use, so it is
removed from the models folder at startup. This is the same downloader as the voice models (`main/packs.ts`).

## Running it

`native/llama/build.sh` builds `llama-server` from a pinned, hash-verified llama.cpp source
(v0.4.1, provisioned by `benchmarks/models/provision_llama.py`): one static arm64 binary with
Metal embedded, checked to link nothing but system libraries so it runs inside a signed Edi.app.

`main/agent/local-runner.ts` starts it for the chosen model on a free loopback port, with:

- `-m` and `--mmproj` — the model and its vision projector
- `-c` — the pack's context size
- `-ngl 999` — on the GPU
- `--host 127.0.0.1` — this Mac only
- `--no-webui`, `--no-warmup` — nothing to browse to, no warm-up run

It waits for `/health`, keeps one model loaded at a time, and unloads after 20 minutes idle so
the memory goes back. Tool calling uses the model's own chat template through llama.cpp's jinja
support; images go through the projector.

## What a local turn leaves out

The worker talks to every local runtime through one OpenAI-compatible provider, and a local turn
differs from an OpenRouter one:

- **No web search.** OpenRouter runs that itself; a local model answers from what it knows, and
  the prompt tells it to say so.
- **No screenshots** when the model can't see images, and **no tools** when it can't call them.
  Ollama and LM Studio are asked what each model supports (`/api/show`, `/api/v0/models`); a
  model missing either is listed as limited rather than hidden.
- **No cost.** Tokens are recorded as `local` with no price.

## When OpenRouter fails

If OpenRouter fails before saying or doing anything, the same turn goes to the chosen local model
once. It shows as a step in the conversation, so it is clear who answered and why. Nothing
already said or done is repeated.

## Adding another model

Add a pack to `main/agent/model-packs.ts` with its files' pinned URL, byte size and SHA-256 (the
Hugging Face API returns both: `?blobs=true`, where `lfs.oid` is the SHA-256), then add its id to
`localPackIdSchema` in the contracts. Prefer models that see images and call tools; anything else
limits what Edi can do.
