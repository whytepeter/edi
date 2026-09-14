# Local audio runtime

Local transcription provisioning and screening are complete: whisper.cpp base.en with Silero VAD, CPU-only baseline, 14 runs over six Pocket samples and silence. Median speech-file process time with VAD was 0.732 seconds including model load; peak RSS was 298 MiB. Plain Whisper hallucinated “You” on digital silence; VAD returned empty text. See [transcription evidence](../benchmarks/voice/TRANSCRIPTION.md). The capture-to-transcript-to-agent-to-speech path is wired in development; subjective listening, physical-device checks, and hands-free silence/follow-up behavior remain open.

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

`PcmPlayer` owns one audio context and accepts decoded mono Float32 PCM. It has no provider credentials, filesystem access, download logic, or model dependencies. Kokoro, Chatterbox Turbo, ElevenLabs, and Cartesia adapters normalize into this boundary; encoded MP3 bytes must be decoded first.

Call `begin()` from a user gesture and retain its returned token. Send ordered chunks using `push(token, samples, sampleRate)`. `finish(token)` closes input while allowing queued audio to drain. Stop invalidates the token, stops and disconnects queued sources, and clears the queue. Late chunks and late completion messages cannot affect a newer run. `dispose()` also closes the device; create a new player after disposal.

Input limits: 8–48 kHz, finite samples between -1 and 1, at most one second per chunk. Playback queues at most three seconds and 128 nodes. A `backpressure` result means the producer must pause and retry the same chunk; it must not drop it or build an unbounded upstream queue. These are initial validation limits, not final tuning.

Each chunk uses a one-shot Web Audio source, scheduled contiguously on the audio clock. Initial playback and recovery from starvation use a 40 ms lead. The gap counter tracks late scheduling, not measured speaker dropouts. Long-running/background stress tests will determine whether to replace this initial scheduler with an AudioWorklet ring buffer. See [Web Audio source behavior](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode).

Main cancels model generation separately from renderer playback. The MLX speech supervisor bounds output, enforces timeouts, detects crashes, and unloads a warm model after it sits idle. Sleep and Stop cancel both layers before hiding Edi; the renderer is not the only cancellation path.

## Verification

Run `pnpm test:audio` for deterministic lifecycle and validation tests. Run `pnpm test:audio:native` for the real Electron check; it plays a saved greeting sample from `benchmarks/voice/results`. Native execution needs desktop access. It uses a temporary app profile, no keys or provider calls, and a muted output graph. No product test screen or runtime test endpoint is added.

Native result on M2 Pro / 16 GB:

- Pocket's saved 3.76-second greeting completed in 3.804 seconds, with zero scheduling gaps and no pending sources after drain.
- First nonzero signal observed in the graph after 46.5 ms. This excludes synthesis and does not measure sound at the speaker.
- After Stop, graph silence was observed after 10.4 ms and remained silent through the follow-up check. The old run's chunk was rejected.
- Disposal closed the audio context.

Evidence: [local raw report](../benchmarks/voice/results/playback-DPiRxO/results.json). The test rechunks a WAV into 80 ms pieces with 20 ms delivery spacing; it does not reproduce Pocket's original streaming timing. Silence is polled at 10 ms intervals. One short test cannot establish sustained playback reliability, acoustic stop latency, or resource budgets.
