import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  kokoroPhonemes,
  phonemeTokens,
  phonemize,
  spokenText,
} from '../../apps/desktop/src/main/voice/phonemes';
import { readablePieces } from '../../apps/desktop/src/main/voice/kokoro-onnx';

test('what people write becomes what a person would say', () => {
  assert.equal(
    spokenText('The invoice came to $42.50.'),
    'The invoice came to 42 dollars and 50 cents.',
  );
  assert.equal(spokenText('It costs £1 today.'), 'It costs 1 pound today.');
  assert.equal(spokenText('$7 each'), '7 dollars each');
  assert.equal(
    spokenText('Your 3:05 and the 9:00 stand-up'),
    "Your 3 oh 5 and the 9 o'clock stand-up",
  );
  assert.equal(spokenText('Built in 1999, sold in 2005.'), 'Built in 19 99, sold in 20 oh 5.');
  assert.equal(
    spokenText('1,200 files, 3.5 GB, pages 5-7'),
    '1200 files, 3 point 5 GB, pages 5 to 7',
  );
  assert.equal(spokenText('Dr. Cole and Mr. Adeyemi'), 'Doctor Cole and Mister Adeyemi');
  // Ordinary words are left alone.
  assert.equal(spokenText('  Check  my calendar '), 'Check my calendar');
});

test('eSpeak’s symbols become the ones Kokoro was trained on', () => {
  // Tie marks (from --ipa=3) are not in Kokoro's alphabet.
  assert.equal(kokoroPhonemes('hˈe‍ɪ ˈɛdi'), 'hˈeɪ ˈɛdi');
  assert.equal(kokoroPhonemes('rˈɛd x ɬ ʲ'), 'ɹˈɛd k l j');
  // American "ninety".
  assert.equal(kokoroPhonemes('nˈaɪnti'), 'nˈaɪndi');
});

test('only symbols the model knows are sent, between its start and end markers', () => {
  const tokens = phonemeTokens('hˈeɪ');
  assert.equal(tokens.at(0), 0);
  assert.equal(tokens.at(-1), 0);
  assert.ok(tokens.length > 2);
  // An unknown symbol is dropped rather than spoken as noise.
  assert.deepEqual(phonemeTokens('☃'), [0, 0]);
});

test('long replies are spoken sentence by sentence, so the first words come sooner', () => {
  assert.deepEqual(readablePieces('wˈʌn. tˈuː! θɹˈiː?'), ['wˈʌn.', 'tˈuː!', 'θɹˈiː?']);
  // A sentence longer than the model can read is split where a speaker would pause.
  const long = `${'ə '.repeat(200)}, ${'i '.repeat(200)}.`;
  const pieces = readablePieces(long);
  assert.ok(pieces.length > 1);
  assert.ok(pieces.every(piece => piece.length <= 510));
  assert.equal(pieces[0]?.endsWith(','), true);
  assert.deepEqual(readablePieces(''), []);
});

const espeak = resolve('native/espeak/build/espeak-ng');
test(
  'eSpeak NG pronounces American English, as its own program',
  { skip: !existsSync(espeak) },
  async () => {
    const runtime = { executable: espeak, dataPath: resolve('native/espeak/build') };
    const phonemes = await phonemize(runtime, 'Hey Edi, check my calendar for tomorrow.');
    // American English: the flap in "calendar" and its r-coloured ending.
    assert.match(phonemes, /kˈæləndɚ/);
    // Punctuation is kept where it was, since it shapes the delivery.
    assert.match(phonemes, /,/);
    assert.match(phonemes, /\.$/);
    // Everything sent to the model is in its alphabet.
    assert.equal(phonemeTokens(phonemes).length, [...phonemes].length + 2);
    assert.equal(await phonemize(runtime, '   '), '');
  },
);
