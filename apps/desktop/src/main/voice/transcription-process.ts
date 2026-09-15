import { spawn } from 'node:child_process';

export interface TranscriptionRuntime {
  executable: string;
  model: string;
  vadModel: string;
}

/** Fixed-format boundary: 16 kHz mono signed PCM16 little-endian, at most 61 s. */
export function pcmWave(pcm: Uint8Array): Buffer {
  if (
    !(pcm instanceof Uint8Array) ||
    !pcm.byteLength ||
    pcm.byteLength % 2 ||
    pcm.byteLength > 16000 * 2 * 61
  ) {
    throw new Error('Invalid transcription audio');
  }
  const wav = Buffer.alloc(44 + pcm.byteLength);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + pcm.byteLength, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcm.byteLength, 40);
  wav.set(pcm, 44);
  return wav;
}

/**
 * Built-in words whisper should expect: Edi's own terms only. Every primed word pulls unclear
 * speech toward itself, so place names and jargon from the benchmark samples (Lagos, OAuth…)
 * made "That's just it" come out as "Lagos, please." Anything else is the person's to add in
 * Settings → Voice.
 */
const PRODUCT_WORDS = ['Edi', 'Fewer Labs', 'OpenRouter'];
/** Whisper reads at most 224 prompt tokens; this keeps well inside that. */
const MAX_PROMPT_CHARS = 700;

/** The words whisper is told to expect: the companion's name, product terms, the person's own. */
export function glossaryWords(options: { name?: string; words?: readonly string[] } = {}) {
  return [options.name ?? 'Edi', ...PRODUCT_WORDS, ...(options.words ?? [])].filter(
    (word, index, all) =>
      all.findIndex(other => other.toLowerCase() === word.toLowerCase()) === index,
  );
}

const plainWords = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Stock lines whisper writes over noise (from its subtitle training data), as a whole utterance. */
const STOCK_NOISE =
  /^(?:you|thanks for watching|thank you for watching|please subscribe|subtitles by .*)$/;

/**
 * What whisper heard, with its two ways of hearing noise as speech taken out. Over background
 * sound it writes words it was primed with: a turn that is nothing but glossary words ("Edi.",
 * "OpenRouter.") is noise, and so are its stock subtitle lines. It also loops, writing one short phrase
 * again and again ("Not soon. Not soon. Not soon."); a phrase said three or more times in a row
 * is kept once. Returns '' when nothing real was said.
 */
export function settleTranscript(transcript: string, glossary: readonly string[]) {
  const text = transcript.trim();
  const words = plainWords(text);
  if (!words.length) return '';
  const primed = new Set(glossary.flatMap(plainWords));
  if (words.every(word => primed.has(word))) return '';
  if (STOCK_NOISE.test(words.join(' '))) return '';

  const sentences = text.match(/[^.!?]+[.!?]*/g)?.map(sentence => sentence.trim()) ?? [text];
  const kept: string[] = [];
  for (let i = 0; i < sentences.length;) {
    const same = (sentence: string | undefined) =>
      sentence !== undefined &&
      plainWords(sentence).join(' ') === plainWords(sentences[i]!).join(' ');
    let run = 1;
    while (same(sentences[i + run])) run++;
    // Twice can be emphasis ("No. No."); three or more times is whisper looping.
    kept.push(...sentences.slice(i, i + (run >= 3 ? 1 : run)));
    i += run;
  }
  return kept.join(' ');
}

/**
 * What whisper hears before the audio: the companion's name, the person's own words
 * (Settings → Voice) and the end of Edi's last reply, so a follow-up spells the names she just
 * said. Measured on accented voices: word errors fell from 6.2% to 3.4% with the words and to
 * 2.8% with the reply too, with nothing invented on silence (benchmarks/voice/TRANSCRIPTION.md).
 */
export function transcriptionPrompt(
  options: { name?: string; words?: readonly string[]; context?: string } = {},
) {
  const glossary = `${glossaryWords(options).join('. ')}.`;
  const room = MAX_PROMPT_CHARS - glossary.length - 1;
  const context = (options.context ?? '').replace(/\s+/g, ' ').trim();
  // The end of the reply is what the person answers; cut at a word boundary.
  const tail = context.length > room ? context.slice(-room).replace(/^\S*\s/, '') : context;
  return (tail && room > 40 ? `${glossary} ${tail}` : glossary).slice(0, MAX_PROMPT_CHARS);
}

/** A single offline utterance. Paths belong to native configuration, never renderer input. */
export async function transcribePcm(
  runtime: TranscriptionRuntime,
  pcm: Uint8Array,
  signal: AbortSignal,
  timeoutMs = 30_000,
  /** Words and context whisper should expect (`transcriptionPrompt`). */
  prompt = transcriptionPrompt(),
): Promise<string> {
  signal.throwIfAborted();
  const wav = pcmWave(pcm);
  return new Promise((resolve, reject) => {
    const child = spawn(
      runtime.executable,
      [
        '-m',
        runtime.model,
        '--vad',
        '-vm',
        runtime.vadModel,
        '-f',
        '-',
        '-l',
        'en',
        '--prompt',
        prompt,
        '-t',
        '4',
        '-ng',
        '-np',
        '-nt',
        '-otxt',
        '-of',
        '-',
      ],
      {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { PATH: '/usr/bin:/bin' },
      },
    );
    let failure: Error | undefined;
    const output: Buffer[] = [];
    let size = 0;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const fail = (message: string) => {
      failure ??= new Error(message);
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 1000);
    };
    const abort = () => fail('Transcription cancelled');
    signal.addEventListener('abort', abort, { once: true });
    const deadline = setTimeout(() => fail('Transcription timed out'), timeoutMs);
    child.on('error', () => fail('Transcription process could not start'));
    child.stdin.on('error', () => fail('Transcription input failed'));
    child.stdout.on('data', (data: Buffer) => {
      size += data.length;
      if (size > 32000) {
        fail('Transcription output limit exceeded');
        return;
      }
      output.push(data);
    });
    child.on('close', code => {
      clearTimeout(deadline);
      clearTimeout(killTimer);
      signal.removeEventListener('abort', abort);
      wav.fill(0);
      if (failure || code !== 0) {
        reject(failure ?? new Error('Transcription failed'));
        return;
      }
      const text = Buffer.concat(output).toString('utf8').trim();
      if (text.length > 8000) {
        reject(new Error('Transcript too long'));
        return;
      }
      // Empty VAD output is a no-speech result, never a prompt or an error.
      resolve(text);
    });
    if (signal.aborted) abort();
    else child.stdin.end(wav);
  });
}
