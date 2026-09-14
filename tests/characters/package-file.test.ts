import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';
import {
  PackageError,
  readCharacterPackage,
  writeCharacterPackage,
} from '../../apps/desktop/src/main/characters/package-file';
import { CharacterMoodController } from '../../apps/desktop/src/main/character/character-mood';
import { checkCharacter, presentationText, replyMood } from '../../packages/contracts/src/index';

const template = {
  manifest: readFileSync('docs/characters/template/character.json', 'utf8'),
  art: readFileSync('docs/characters/template/art.svg', 'utf8'),
};

/** A zip with arbitrary entries, for shapes the writer never produces. */
function zip(entries: { name: string; data: Buffer; method?: 0 | 8; size?: number }[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data, method = 8, size } of entries) {
    const body = method === 8 ? deflateRawSync(data) : data;
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size ?? data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size ?? data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test('packed characters read back exactly and pass the check', () => {
  const packed = writeCharacterPackage(template);
  const files = readCharacterPackage(packed);
  assert.deepEqual(files, template);
  assert.ok(checkCharacter(files).descriptor);
});

test('archives from Finder (one folder, __MACOSX, extra files) are accepted', () => {
  const files = readCharacterPackage(
    zip([
      { name: 'Pip/', data: Buffer.alloc(0), method: 0 },
      { name: 'Pip/character.json', data: Buffer.from(template.manifest) },
      { name: '__MACOSX/Pip/._art.svg', data: Buffer.from('junk'), method: 0 },
      { name: 'Pip/art.svg', data: Buffer.from(template.art) },
      { name: 'Pip/README.md', data: Buffer.from('# Pip') },
    ]),
  );
  assert.equal(files.art, template.art);
});

test('damaged, oversized, incomplete or tricky archives are refused', () => {
  const refuse = (bytes: Uint8Array, pattern: RegExp) =>
    assert.throws(
      () => readCharacterPackage(bytes),
      (error: unknown) => {
        assert.ok(error instanceof PackageError);
        assert.match(error.message, pattern);
        return true;
      },
    );
  refuse(Buffer.from('not a zip at all'), /not a character package/);
  refuse(new Uint8Array(2_000_001), /larger than/);
  refuse(
    zip([{ name: 'character.json', data: Buffer.from(template.manifest) }]),
    /needs character.json and art.svg/,
  );
  refuse(
    zip([
      { name: 'character.json', data: Buffer.from(template.manifest) },
      { name: 'art.svg', data: Buffer.from(template.art) },
      { name: 'other/art.svg', data: Buffer.from(template.art) },
    ]),
    /more than once/,
  );
  // A size that lies about the content is caught before the file is trusted.
  refuse(
    zip([
      { name: 'character.json', data: Buffer.from(template.manifest), size: 10 },
      { name: 'art.svg', data: Buffer.from(template.art) },
    ]),
    /could not be unpacked|damaged/,
  );
  // A zip bomb: tiny compressed, huge expanded.
  refuse(
    zip([
      { name: 'character.json', data: Buffer.from(template.manifest) },
      { name: 'art.svg', data: Buffer.alloc(5_000_000, 32), size: 999 },
    ]),
    /could not be unpacked|damaged/,
  );
  // Path tricks are just names: only the two files are ever read, and nothing is written.
  const traversal = zip([
    { name: '../../character.json', data: Buffer.from(template.manifest) },
    { name: '../../art.svg', data: Buffer.from(template.art) },
  ]);
  refuse(traversal, /needs character.json and art.svg/);
});

test('replies declare a mood that the face shows and the text hides', () => {
  assert.equal(replyMood('[MOOD:sad] Oh no, that sounds hard.'), 'sad');
  assert.equal(replyMood('[mood: Surprised ] Wow!'), 'surprised');
  assert.equal(replyMood('[MOOD:furious] Hmm.'), null);
  assert.equal(replyMood('No tag here.'), null);
  assert.equal(presentationText('[MOOD:happy] Great news!'), 'Great news!');
  // A tag still streaming in is hidden too.
  assert.equal(presentationText('[MOO'), '');
});

test('moods hold, return to neutral, and turn sleepy after a long quiet spell', async () => {
  const shown: string[] = [];
  const mood = new CharacterMoodController(value => shown.push(value), 40);
  mood.set('happy', 20);
  assert.equal(mood.current, 'happy');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(mood.current, 'neutral');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(mood.current, 'sleepy');
  mood.noteActivity();
  assert.equal(mood.current, 'neutral');
  mood.dispose();
  assert.deepEqual(shown, ['happy', 'neutral', 'sleepy', 'neutral']);
});
