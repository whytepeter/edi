# Local audio runtime

Local transcription provisioning and screening are complete: whisper.cpp base.en with Silero VAD, CPU-only baseline, 14 runs over six Pocket samples and silence. Median speech-file process time with VAD was 0.732 seconds including model load; peak RSS was 298 MiB. Plain Whisper hallucinated “You” on digital silence; VAD returned empty text. See [transcription evidence](../benchmarks/voice/TRANSCRIPTION.md). The capture-to-transcript-to-agent-to-speech path streams end to end in development; subjective listening, physical-microphone echo and barge-in checks, and threshold tuning remain open.

## Capture adapter

`renderer/src/features/voice/PcmCapture.ts` turns the microphone into a live stream of 20 ms, 16 kHz PCM16 frames with their loudness, in memory only. It asks for audio with echo cancellation, noise suppression and automatic gain, so the microphone can stay open while Edi speaks. It uses a muted ScriptProcessor rather than an AudioWorklet because the renderer's script policy is `'self'` only; revisit if main-thread jank shows up as dropouts. Stop, cancellation, device loss and a late permission grant all release the tracks and close the context. Run `pnpm test:capture:native` for the real Electron check with a synthetic oscillator (no physical microphone).

## Streaming pipeline and turn taking

- **Push-to-talk (hold ⌥ Space).** Frames stream to main from the moment the microphone opens. On release the pet sends the rest and `captured`; main already has the audio, so there is no encode or decode step.
- **Hands-free (tap ⌥ Space; tap again to stop).** `SpeechActivity` (`packages/contracts/src/voice-turns.ts`) tracks speech with an adaptive noise floor and reports `speech-detected`, `pause` (600 ms) and `long-pause` (1.8 s). Only speech is sent, starting 400 ms before it was detected. At a pause, main reads the words so far and `soundsUnfinished` decides: "Can you… um" or a trailing "and" waits for the long pause; a finished-sounding request is answered now. Listening ends after 30 s with nobody speaking.
- **Recognition.** Settings → Voice → Listening. Default: whisper on this Mac through `whisper-server`, which keeps the model loaded (about 0.9 s for 11 s of audio with small.en on an M2 Pro, versus 1.3–1.7 s when the CLI starts each turn; a 3 s pause check takes about 0.7 s). Opt-in: Cartesia realtime transcription with the person's key; the audio is also kept locally, so any Cartesia failure falls back to whisper for the same words.
- **Speech.** Sentences are taken from the streaming reply as the model writes them. Cartesia voices use one WebSocket context per reply (`continue: true` per sentence), connected while the question is being sent, so audio starts with the first sentence. Other engines speak clip by clip. A stream that fails before any sound hands its sentences to the clip path.
- **Acknowledgements and progress.** Spoken turns ask the model for a few words of acknowledgement before a tool. If a tool starts and nothing was said, Edi says a short one ("Let me check.", "On it."). If a step stays quiet for 3.5 s she says what it is doing ("Checking your calendar.", "Working in Gmail."), once per step and at most twice per turn, plus one "Still working on it." after 9 s. A pending approval is mentioned once. None of this is shown in the bubble.
- **Interruption.** Holding ⌥ Space at any time stops Edi's audio and the agent at once and starts a new turn. In a hands-free conversation, speech over Edi pauses her audio in the pet window immediately (before main hears about it); main confirms, and when the words are in, noise resumes the reply while real words cancel the audio, the rest of the reply and any running tool, then submit the new request. An interrupted turn stays in the model's history, marked as cut off, so "actually, only emails from Sarah" narrows the earlier request. A reply counts as speaking until its queued audio has played, so it can be interrupted to the last word.

## Session policy

`packages/contracts/src/voice-session.ts` defines the pure lifecycle; `main/voice/voice-controller.ts` executes its effects and is the interruption controller. `generation` belongs to a microphone session (start, stop and failure bump it); `turn` belongs to one request, so playback, cues and acknowledgements from a talked-over reply cannot touch the next one. Push-to-talk submits a nonempty turn once on release. Conversation keeps the microphone open through processing and speaking; `speech-detected` while Edi is working or talking yields `pause-reply`, and `end-of-turn` yields `resume-reply` (no words) or `cancel-reply` plus `submit-turn` (words). Stop, failure, early release and replacement invalidate old events; an old permission result or reply cannot reactivate a stopped conversation.

Limits: 30 s to resolve permission, 60 s of audio per utterance kept in main, chunks of at most one second, 5 s for Cartesia to finalize a transcript before falling back, 15 s from a reply's first sentence to its first Cartesia audio, playback acknowledgement deadlines that wait while a reply is held.

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
