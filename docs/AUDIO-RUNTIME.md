# Local audio runtime

Local transcription provisioning and screening are complete: whisper.cpp base.en with Silero VAD, CPU-only baseline, 14 runs over six Pocket samples and silence. Median speech-file process time with VAD was 0.732 seconds including model load; peak RSS was 298 MiB. Plain Whisper hallucinated “You” on digital silence; VAD returned empty text. See [transcription evidence](../benchmarks/voice/TRANSCRIPTION.md). The capture-to-transcript-to-agent-to-Pocket path is wired in development; subjective listening, physical-device checks, and hands-free silence/follow-up behavior remain open.

## Capture adapter

`renderer/src/features/voice/MicrophoneCapture.ts` owns one in-memory WebM/Opus recording. It requests audio only, resolves readiness after the recorder's start event, and releases all tracks on finish, cancellation, failure or device loss. Finishing waits for the encoder's final chunk; cancellation discards buffered audio. No files, object URLs, uploads, or provider calls are made.

Limits: 30 seconds to resolve permission, five seconds to start recording, 60 seconds per recording, 8 MiB or 512 delivered chunks, and two seconds to flush after finish. Chunk delivery intervals are not treated as a precise clock. A permission grant arriving after cancellation is immediately closed. These renderer timers are a first safeguard; the native session supervisor must still enforce wall-clock limits and handle renderer failure/suspend.

Mocked capture tests cover final chunk retention, immediate track cleanup, discard, late permission, denied permission, unsupported encoders, size overflow and device loss. A real Electron MediaRecorder check with a synthetic oscillator produces a decodable WebM clip and confirms track release; cancellation returns null and releases its stream. No physical microphone was accessed. Run `pnpm test:capture:native` with a built desktop app and desktop access.

The pet renderer now owns this adapter and opens it only after main grants a just-in-time microphone request. Hold/release and ⌥ Space drive push-to-talk. A lightweight input meter prevents empty holds from submitting; whisper/Silero makes the final speech decision. The production client does not yet emit a silence event, so single-click hands-free mode still needs automatic turn ending and follow-up verification. [Runtime/model documentation](https://github.com/ggml-org/whisper.cpp/blob/master/README.md).

## Session policy

`packages/contracts/src/voice-session.ts` defines the pure turn lifecycle; `main/voice/voice-controller.ts` executes its effects through injected services. `opening` becomes `listening` only after capture readiness. Push-to-talk submits a nonempty turn once on release; VAD silence does not submit it. Conversation mode is designed to submit after speech followed by silence, close capture while processing/speaking, and open a fresh turn after the reply. Barge-in is not part of this first policy.

Each new session/turn has a generation token. Stop, failure, early release and replacement invalidate old events. Empty held turns do not submit. An old permission result or reply cannot reactivate a stopped conversation. The renderer also stops late-acquired media tracks; ignoring an event alone would not release the device. Capture duration, bytes, chunk count, worker output, playback acknowledgement, and provider time are bounded.

`pnpm test:audio` currently runs 36 deterministic capture, playback, process, transcription, session, and controller tests. The native ⌥ Space helper supplies real key-down/key-up behavior and wakes Edi from Sleep when the local runtime is available. Rebinding under Settings → Keyboard Shortcut remains unimplemented.

Milestone 0 is closed. The development voice path is connected; packaged runtime distribution, provider selection in Settings, physical audio checks, and hands-free VAD completion remain later gates.

## Ownership and lifecycle

`PcmPlayer` owns one audio context and accepts decoded mono Float32 PCM. It has no provider credentials, filesystem access, download logic, or model dependencies. Pocket, Chatterbox Turbo, ElevenLabs, and Cartesia adapters normalize into this boundary; encoded MP3 bytes must be decoded first.

Call `begin()` from a user gesture and retain its returned token. Send ordered chunks using `push(token, samples, sampleRate)`. `finish(token)` closes input while allowing queued audio to drain. Stop invalidates the token, stops and disconnects queued sources, and clears the queue. Late chunks and late completion messages cannot affect a newer run. `dispose()` also closes the device; create a new player after disposal.

Input limits: 8–48 kHz, finite samples between -1 and 1, at most one second per chunk. Playback queues at most three seconds and 128 nodes. A `backpressure` result means the producer must pause and retry the same chunk; it must not drop it or build an unbounded upstream queue. These are initial validation limits, not final tuning.

Each chunk uses a one-shot Web Audio source, scheduled contiguously on the audio clock. Initial playback and recovery from starvation use a 40 ms lead. The gap counter tracks late scheduling, not measured speaker dropouts. Long-running/background stress tests will determine whether to replace this initial scheduler with an AudioWorklet ring buffer. See [Web Audio source behavior](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode).

Main cancels model generation separately from renderer playback. The Pocket supervisor bounds output, enforces timeouts, detects crashes, and unloads the warm model after five idle minutes. Sleep and Stop cancel both layers before hiding Edi; the renderer is not the only cancellation path.

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

The worker selects Pocket’s `jane` voice as Edi’s local female default. Fantine replaced Alba during the first fix,
but the user still heard a male voice; Jane replaces it. The TypeScript host now passes the provider-specific voice
ID explicitly and rejects the worker's ready message if it reports another voice. Provider and voice selection belong
in Settings later.

The worker sends mono 24 kHz Float32 little-endian frames encoded as bounded JSON/base64 lines. Each frame requires an acknowledgement after the consumer accepts it. The supervisor validates sample values, frame size, sample rate, frame count, and total duration. Requests are limited to 2,000 characters and 120 seconds. Abort and timeout terminate the worker, escalating to a forced exit after one second if necessary. The caller must also stop its PCM player when cancelling.

The worker is now long-lived: it loads the model once, reports `ready`, then serves one utterance at a time. After each frame the host replies `ack` to continue or `cancel` to stop that utterance; the model stays loaded. The host sends exactly one credit per frame (a spare credit would be read as the next request, which the tests caught). A worker that does not acknowledge a cancel within two seconds, crashes, times out or breaks the protocol is killed and replaced on the next reply. `PocketVoice` unloads the process after five idle minutes, and hold-to-talk calls `warm()` the moment a hold starts so the model loads while the person is still speaking.

Measured on the M2 Pro with the real model, offline, no audio output (2026-09-11): cold load plus first reply 5,791 ms to first PCM; warm replies 52 ms and 71 ms to first PCM; a warm reply stopped after its first frame settled in 78 ms and the next reply still came from the loaded model. `speakPocket()` remains as a one-shot wrapper for the live harness.

`pnpm test:audio` covers playback plus worker protocol, crash, invalid output, timeout, and cancellation during a blocked consumer. `pnpm test:audio:live` uses the installed offline Pocket model and a muted Electron graph, with an isolated profile and a developer-only transport. It tests actual generation rather than saved WAV delivery. Build the desktop app first with `pnpm build`.

Latest live result on the same M2 Pro with Jane: 50 frames, zero scheduling gaps, and no pending sources after drain. First PCM arrived after 4.441 seconds including cold process/model startup; Stop completed in 1.14 ms. Output was muted, so this is not an acoustic latency or subjective quality result. [Local raw result](../benchmarks/voice/results/live-UtAUpF/results.json). The earlier cancellation run remains at [live-Qag5PM](../benchmarks/voice/results/live-Qag5PM/results.json).

Next: complete hands-free silence/follow-up behavior, subjective Jane listening and physical-device checks, then package the local runtimes and expose provider/voice selection in Settings. Chatterbox Turbo needs a separate download/benchmark decision; cloud calls still require credentials and paid-use approval.
