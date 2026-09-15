import { execFile } from 'node:child_process';
import { kokoroVocabulary } from './kokoro-vocabulary';

/**
 * Turning words into the sounds Kokoro speaks. eSpeak NG does the pronunciation; it is GPL-3.0,
 * so Edi runs it as a separate program and never links it into itself (native/espeak/build.sh).
 */
export interface EspeakRuntime {
  /** The `espeak-ng` program. */
  executable: string;
  /** The folder holding `espeak-ng-data`. */
  dataPath: string;
}

/** Punctuation Kokoro keeps as it is; everything between it is pronounced. */
const PUNCTUATION = /(\s*[;:,.!?¡¿—…"«»“”(){}[\]]+\s*)+/g;

/** "$42.50" is said as "42 dollars and 50 cents". */
function money(sign: string, whole: string, part: string) {
  const unit = sign === '$' ? 'dollar' : 'pound';
  const amount = `${whole} ${unit}${whole === '1' ? '' : 's'}`;
  if (!part) return amount;
  const small = Number(part.padEnd(2, '0'));
  if (!small) return amount;
  const name = sign === '$' ? (small === 1 ? 'cent' : 'cents') : small === 1 ? 'penny' : 'pence';
  return `${amount} and ${small} ${name}`;
}

/**
 * Speech-ready text: the shapes people write but nobody reads out as written. Years, money,
 * decimals, ranges and common titles become the words a person would say, so eSpeak does not
 * read "$42.50" as "dollar forty two point five zero". Follows kokoro-js (Apache-2.0).
 */
export function spokenText(text: string) {
  return (
    text
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[^\S\n]/g, ' ')
      .replace(/ {2,}/g, ' ')
      .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor')
      .replace(/\bMr\.(?= [A-Z])/g, 'Mister')
      .replace(/\bMs\.(?= [A-Z])/g, 'Miss')
      .replace(/\bMrs\.(?= [A-Z])/g, 'Mrs')
      .replace(/\betc\.(?! [A-Z])/gi, 'etc')
      // 1,200 → 1200, so it is read as a number.
      .replace(/(?<=\d),(?=\d{3})/g, '')
      // $42.50 → 42 dollars and 50 cents; £7 → 7 pounds.
      .replace(/([$£])(\d+)(?:\.(\d{1,2}))?/g, (_match, sign: string, whole: string, part = '') =>
        money(sign, whole, part),
      )
      // 3:05 → 3 oh 5, 9:00 → 9 o'clock.
      .replace(
        /(?<!:)\b([1-9]|1[0-2]):([0-5]\d)\b(?!:)/g,
        (_match, hour: string, minute: string) =>
          minute === '00'
            ? `${hour} o'clock`
            : `${hour} ${Number(minute) < 10 ? 'oh ' : ''}${Number(minute)}`,
      )
      // 1999 → 19 99, but not 2005 (read as a number) or a plain count like 1200 people.
      .replace(
        /\b(1[1-9]|2\d)(\d\d)\b(?!\s*(?:people|items|words))/g,
        (match, century: string, rest: string) =>
          Number(rest) === 0
            ? match
            : Number(rest) < 10
              ? `${century} oh ${Number(rest)}`
              : `${century} ${rest}`,
      )
      // 3.5 → 3 point 5; 5-7 → 5 to 7.
      .replace(
        /(\d)\.(\d+)/g,
        (_match, whole: string, part: string) => `${whole} point ${part.split('').join(' ')}`,
      )
      .replace(/(?<=\d)-(?=\d)/g, ' to ')
      .trim()
  );
}

/**
 * eSpeak's American IPA, in the shape Kokoro was trained on: no tie marks, its own r and j,
 * and the American "ninety". Follows kokoro-js (Apache-2.0).
 */
export function kokoroPhonemes(ipa: string) {
  return ipa
    .replace(/‍/g, '')
    .replace(/͡/g, '')
    .replace(/ʲ/g, 'j')
    .replace(/r/g, 'ɹ')
    .replace(/x/g, 'k')
    .replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ')
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z')
    .replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Kokoro reads at most this many symbols at once; longer text is spoken in pieces. */
export const MAX_PHONEMES = 510;

/** The ids Kokoro reads, with the start and end markers it expects. Unknown symbols are dropped. */
export function phonemeTokens(phonemes: string) {
  const ids = [...phonemes].flatMap(symbol => {
    const id = kokoroVocabulary[symbol];
    return id === undefined ? [] : [id];
  });
  return [0, ...ids.slice(0, MAX_PHONEMES), 0];
}

/** One run of eSpeak: American IPA for this text, or '' when it says nothing. */
function espeak(runtime: EspeakRuntime, text: string, signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      runtime.executable,
      ['--path', runtime.dataPath, '-q', '--ipa=3', '-v', 'en-us', '--', text],
      { signal, timeout: 10_000, maxBuffer: 1024 * 1024, env: { PATH: '/usr/bin:/bin' } },
      (error, stdout) => (error ? reject(error) : resolve(stdout.replace(/\s+/g, ' ').trim())),
    );
  });
}

/**
 * What Kokoro should say for this text: punctuation is kept where it was (it shapes the
 * delivery) and everything else is pronounced by eSpeak.
 */
export async function phonemize(runtime: EspeakRuntime, text: string, signal?: AbortSignal) {
  const ready = spokenText(text);
  if (!ready) return '';
  const parts: string[] = [];
  let index = 0;
  for (const match of ready.matchAll(PUNCTUATION)) {
    if (match.index > index)
      parts.push(await espeak(runtime, ready.slice(index, match.index), signal));
    parts.push(match[0]);
    index = match.index + match[0].length;
  }
  if (index < ready.length) parts.push(await espeak(runtime, ready.slice(index), signal));
  return kokoroPhonemes(parts.join(''));
}
