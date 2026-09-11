# Local audio runtime

Local transcription provisioning and screening are now complete: whisper.cpp base.en with Silero VAD, CPU-only baseline, 14 runs over six Pocket samples and silence. Median speech-file process time with VAD was 0.732 seconds including model load; peak RSS was 298 MiB. Plain Whisper hallucinated “You” on digital silence; VAD returned empty text. See [transcription evidence](../benchmarks/voice/TRANSCRIPTION.md). This is not yet a production capture-to-transcript path or real-time VAD integration.

## Capture adapter

`renderer/src/features/voice/MicrophoneCapture.ts` owns one in-memory WebM/Opus recording. It requests audio only, resolves readiness after the recorder's start event, and releases all tracks on finish, cancellation, failure or device loss. Finishing waits for the encoder's final chunk; cancellation discards buffered audio. No files, object URLs, uploads, or provider calls are made.

Limits: 30 seconds to resolve permission, five seconds to start recording, 60 seconds per recording, 8 MiB or 512 delivered chunks, and two seconds to flush after finish. Chunk delivery intervals are not treated as a precise clock. A permission grant arriving after cancellation is immediately closed. These renderer timers are a first safeguard; the native session supervisor must still enforce wall-clock limits and handle renderer failure/suspend.

Five mocked capture tests cover final chunk retention, immediate track cleanup, discard, late permission, denied permission, unsupported encoders, size overflow and device loss. All 19 audio tests and typecheck pass. A real Electron MediaRecorder check with a synthetic oscillator produces a decodable WebM clip and confirms track release; cancellation returns null and releases its stream. No physical microphone was accessed. Run `pnpm test:capture:native` with a built desktop app and desktop access.

This adapter is not connected to Edi's gestures or production permission handler yet. The app still denies microphone requests and displays the unavailable pill. VAD, transcription, session effect execution and global key-up capture remain separate integration work. Proposed next audition: whisper.cpp English base plus Silero VAD, subject to a new 1 GB download approval; the existing authorization covers Pocket only. [Runtime/model documentation](https://github.com/ggml-org/whisper.cpp/blob/master/README.md).

## Session policy

`packages/contracts/src/voice-session.ts` defines the pure turn lifecycle. It emits effects for a future native session driver; it does not itself open a microphone or call a provider. `opening` becomes `listening` only after capture readiness. Push-to-talk submits a nonempty turn once on release; VAD silence does not submit it. Conversation mode submits after speech followed by VAD silence, closes capture while processing/speaking, and opens a fresh turn after the reply. Barge-in is not part of this first policy.

Each new session/turn has a generation token. Stop, failure, early release and replacement invalidate old events. Empty held turns do not submit. An old permission result or reply cannot reactivate a stopped conversation. The effect executor must also stop any late-acquired media tracks; ignoring an event alone does not release the device. Add capture/turn-duration watchdogs and bounded audio storage when wiring real services.

Five session-policy tests join the existing nine playback/process tests; all 14 pass, along with typecheck. These are simulated events, not a microphone/VAD integration test. Next: a native session driver with microphone permission handling, device cleanup, local transcription/VAD and a real hold/release shortcut adapter. The requested default is Option + Space, configurable in Settings → Keyboard Shortcut; that setting and native binding are not implemented yet.

Milestone 0, updated 2026-09-11. Playback is implemented as an isolated renderer module; it is not yet connected to live Edi responses or exposed in Settings.

## Ownership and lifecycle

`PcmPlayer` owns one audio context and accepts decoded mono Float32 PCM. It has no provider credentials, filesystem access, download logic, or model dependencies. Pocket, ElevenLabs, and Cartesia adapters must eventually normalize their output at this boundary; encoded MP3 bytes are not PCM.

Call `begin()` from a user gesture and retain its returned token. Send ordered chunks using `push(token, samples, sampleRate)`. `finish(token)` closes input while allowing queued audio to drain. Stop invalidates the token, stops and disconnects queued sources, and clears the queue. Late chunks and late completion messages cannot affect a newer run. `dispose()` also closes the device; create a new player after disposal.

Input limits: 8–48 kHz, finite samples between -1 and 1, at most one second per chunk. Playback queues at most three seconds and 128 nodes. A `backpressure` result means the producer must pause and retry the same chunk; it must not drop it or build an unbounded upstream queue. These are initial validation limits, not final tuning.

Each chunk uses a one-shot Web Audio source, scheduled contiguously on the audio clock. Initial playback and recovery from starvation use a 40 ms lead. The gap counter tracks late scheduling, not measured speaker dropouts. Long-running/background stress tests will determine whether to replace this initial scheduler with an AudioWorklet ring buffer. See [Web Audio source behavior](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode).

The future native supervisor must cancel model generation separately from stopping playback. It must bound process output, enforce run IDs and timeouts, detect worker crashes, and release or retain the model under an explicit idle policy. Renderer Stop alone does not stop inference. Sleep must cancel both layers before hiding Edi; a hidden window must not own the only cancellation path.

## Verification

Run `pnpm test:audio` for deterministic lifecycle and validation tests. Run `pnpm test:audio:native` after provisioning the Pocket benchmark samples for the real Electron check. Native execution needs desktop access. It uses a temporary app profile, no keys or provider calls, and a muted output graph. No product test screen or runtime test endpoint is added.

Native result on M2 Pro / 16 GB:

- Pocket's saved 3.76-second greeting completed in 3.804 seconds, with zero scheduling gaps and no pending sources after drain.
- First nonzero signal observed in the graph after 46.5 ms. This excludes synthesis and does not measure sound at the speaker.
- After Stop, graph silence was observed after 10.4 ms and remained silent through the follow-up check. The old run's chunk was rejected.
- Disposal closed the audio context.

Evidence: [local raw report](../benchmarks/voice/results/playback-DPiRxO/results.json). The test rechunks a WAV into 80 ms pieces with 20 ms delivery spacing; it does not reproduce Pocket's original streaming timing. Silence is polled at 10 ms intervals. One short test cannot establish sustained playback reliability, acoustic stop latency, or resource budgets.

## Supervised Pocket process

`main/voice/pocket-process.ts` now supervises `voice/pocket_worker.py`. It accepts trusted native runtime paths, sends text through stdin rather than command-line arguments, and starts Python with an explicit environment that excludes provider keys and Python injection variables. Hugging Face offline mode uses only the provisioned cache. Library logs are excluded from the PCM protocol and not sent to the renderer.

The worker sends mono 24 kHz Float32 little-endian frames encoded as bounded JSON/base64 lines. Each frame requires an acknowledgement after the consumer accepts it. The supervisor validates sample values, frame size, sample rate, frame count, and total duration. Requests are limited to 2,000 characters and 120 seconds. Abort and timeout terminate the worker, escalating to a forced exit after one second if necessary. The caller must also stop its PCM player when cancelling.

This first lifecycle uses one process per utterance and unloads the model after completion or cancellation. It does not yet keep Pocket warm, download models, wire production IPC, or add Settings. Alba remains the installed audition asset; the female default's final listening approval is still pending.

`pnpm test:audio` covers playback plus worker protocol, crash, invalid output, timeout, and cancellation during a blocked consumer. `pnpm test:audio:live` uses the installed offline Pocket model and a muted Electron graph, with an isolated profile and a developer-only transport. It tests actual generation rather than saved WAV delivery. Build the desktop app first with `pnpm build`.

Live result on the same M2 Pro: 44 frames, zero scheduling gaps, no pending sources after drain. First PCM arrived after 7.460 seconds including process/model startup. In a second utterance, cancelling after the first frame cleared playback and the worker exited in 45.6 ms from abort. This checks cancellation near the start, not all possible interruption points. Output was muted; no acoustic latency or subjective quality was measured. [Local raw result](../benchmarks/voice/results/live-Qag5PM/results.json). Nine audio tests and TypeScript checks pass.

Next: warm idle resource measurements and an explicit retain/unload policy; production IPC/session integration; listening assessment and physical speaker tests. Then integrate the approved provider setup in Settings. Cloud calls still require credentials and paid-use approval.
