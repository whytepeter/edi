import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  checkCharacter,
  mapSkinPoint,
  resolveVariant,
  sanitizeCharacterArt,
  skinGeometrySchema,
  variantPreference,
  type CharacterState,
} from './index';

const builtIn = (id: string) => {
  const base = fileURLToPath(new URL(`../../characters/${id}/`, import.meta.url));
  return {
    manifest: readFileSync(`${base}character.json`, 'utf8'),
    art: readFileSync(`${base}art.svg`, 'utf8'),
  };
};

const minimalArt = (extra = '') =>
  `<svg viewBox="0 0 160 170"><g data-part="eyes"><g data-variant="default"><g data-part="pupils"><circle cx="60" cy="90" r="5"/></g></g></g><g data-part="mouth"><g data-variant="default"><path d="M70 110Q80 118 90 110" stroke="#000"/></g></g>${extra}</svg>`;
const minimalManifest = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 1,
    id: 'com.example.pip',
    name: 'Pip',
    author: { name: 'Example' },
    license: 'CC-BY-4.0',
    colors: { accent: '#335577', outline: '#223344', skin: '#ffeecc' },
    geometry: {
      version: 1,
      viewBox: { x: 0, y: 0, width: 160, height: 170 },
      paintedBounds: { x: 10, y: 10, width: 140, height: 150 },
      bodyPath:
        'M80 20C120 20 140 60 140 100C140 140 110 150 80 150C50 150 20 140 20 100C20 60 40 20 80 20Z',
      anchors: {
        workspace: { x: 31, y: 40 },
        leftHand: { x: 30, y: 99 },
        rightHand: { x: 132, y: 112 },
        speechRight: { x: 122, y: 54 },
        speechLeft: { x: 40, y: 54 },
      },
    },
    ...overrides,
  });

test('built-in characters pass the same gate as installed packages', () => {
  for (const id of ['edi', 'mochi']) {
    const result = checkCharacter(builtIn(id), { builtIn: true });
    assert.deepEqual(result.problems, [], id);
    assert.ok(result.descriptor);
    assert.equal(result.descriptor.manifest.id, id);
    for (const part of ['eyes', 'mouth'])
      assert.ok(result.descriptor.variants[part]?.includes('default'));
    const geometry = result.descriptor.manifest.geometry;
    assert.equal(skinGeometrySchema.safeParse(geometry).success, true);
    assert.equal(
      skinGeometrySchema.safeParse({
        ...geometry,
        anchors: { ...geometry.anchors, leftHand: { x: -1, y: 0 } },
      }).success,
      false,
    );
  }
  // Built-in ids cannot be claimed by a package.
  const imposter = checkCharacter({ manifest: minimalManifest({ id: 'edi' }), art: minimalArt() });
  assert.equal(imposter.descriptor, null);
  assert.match(imposter.problems[0]!.message, /ships with Edi/);
});

test('skin coordinates match centered SVG scaling including negative display origins', () => {
  const geometry = checkCharacter(builtIn('mochi'), { builtIn: true }).descriptor!.manifest
    .geometry;
  assert.deepEqual(
    mapSkinPoint(geometry, { x: 80, y: 85 }, { x: -500, y: 10, width: 320, height: 170 }),
    { x: -340, y: 95 },
  );
  assert.deepEqual(
    mapSkinPoint(geometry, geometry.anchors.leftHand, { x: 0, y: 0, width: 160, height: 170 }),
    { x: 30, y: 99 },
  );
  assert.throws(() =>
    mapSkinPoint(geometry, { x: 0, y: 0 }, { x: 0, y: 0, width: 0, height: 170 }),
  );
});

test('a minimal package validates, scopes ids, and keeps colors intact', () => {
  const art = minimalArt(
    '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="4" height="4" fill="url(#g)" stroke="#fff"/>',
  );
  const result = checkCharacter({ manifest: minimalManifest(), art });
  assert.deepEqual(result.problems, []);
  const markup = result.descriptor!.art;
  assert.match(markup, /id="\{\{scope\}\}-g"/);
  assert.match(markup, /fill="url\(#\{\{scope\}\}-g\)"/);
  assert.match(markup, /stroke="#fff"/);
  assert.equal(result.descriptor!.manifest.motion.intensity, 1);
});

test('hostile SVG never survives sanitizing', () => {
  const hostile = minimalArt(
    [
      '<script>alert(1)</script>',
      '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>',
      '<style>@import url(https://evil.example/x.css)</style>',
      '<image href="https://evil.example/track.png" width="10" height="10"/>',
      '<a href="javascript:alert(1)"><rect width="5" height="5"/></a>',
      '<rect width="5" height="5" onclick="alert(1)" onload="x()"/>',
      '<rect width="5" height="5" fill="url(https://evil.example/p#x)"/>',
      '<rect width="5" height="5" style="fill:url(javascript:alert(1));stroke:#000"/>',
      '<use href="https://evil.example/sprite.svg#a"/>',
      '<use xlink:href="data:image/svg+xml;base64,PHN2Zz4="/>',
      '<animate attributeName="fill" to="red"/>',
      '<set attributeName="href" to="javascript:alert(1)"/>',
      '<path d="M0 0L10 10" transform="translate(1,1) expression(alert(1))"/>',
      '<g data-part="eyes-evil"/>',
    ].join(''),
  );
  const { markup, problems } = sanitizeCharacterArt(hostile);
  assert.ok(markup.length > 0);
  for (const banned of [
    'script',
    'foreignObject',
    'style=',
    '<style',
    'image',
    'javascript',
    'onclick',
    'onload',
    'evil',
    'data:',
    'animate',
    '<set',
    'expression',
    '<a ',
    'eyes-evil',
  ])
    assert.ok(!markup.includes(banned), `kept ${banned}`);
  assert.match(markup, /stroke="#000"/); // the safe half of a style attribute is kept
  assert.ok(problems.every(problem => problem.level === 'warning'));
  assert.ok(problems.some(problem => /scripts never run/.test(problem.message)));
});

test('malformed or oversized art is refused with a readable reason', () => {
  const refuse = (art: string, pattern: RegExp) => {
    const result = sanitizeCharacterArt(art);
    assert.equal(result.markup, '');
    assert.ok(
      result.problems.some(problem => problem.level === 'error' && pattern.test(problem.message)),
      art.slice(0, 60),
    );
  };
  refuse('<svg viewBox="0 0 160 170"><g></svg>', /does not match/);
  refuse('<!DOCTYPE svg [<!ENTITY x "boom">]><svg viewBox="0 0 1 1"/>', /DOCTYPE/);
  refuse('<svg viewBox="0 0 1 1"><![CDATA[x]]></svg>', /CDATA/);
  refuse('<html><body/></html>', /root element/);
  refuse(`<svg viewBox="0 0 1 1">${'<g>'.repeat(50)}${'</g>'.repeat(50)}</svg>`, /deeper/);
  refuse(`<svg viewBox="0 0 1 1"><path d="${'M0 0'.repeat(130_000)}"/></svg>`, /larger than/);
  refuse(minimalArt().replace('data-part="mouth"', 'data-part="cheeks"'), /data-part="mouth"/);
  refuse(
    minimalArt().replace('<g data-variant="default"><path', '<g data-variant="talk"><path'),
    /data-variant="default"/,
  );
  refuse('<svg viewBox="0 0 1 1" a="&unknown;"/>', /Unknown entity/);
  // The artboard must match the manifest.
  const mismatch = checkCharacter({
    manifest: minimalManifest(),
    art: minimalArt().replace('0 0 160 170', '0 0 100 100'),
  });
  assert.ok(mismatch.problems.some(problem => /must match/.test(problem.message)));
  const badJson = checkCharacter({ manifest: '{ nope', art: minimalArt() });
  assert.ok(badJson.problems.some(problem => /not valid JSON/.test(problem.message)));
  const badManifest = checkCharacter({
    manifest: minimalManifest({ colors: { accent: 'red' } }),
    art: minimalArt(),
  });
  assert.ok(
    badManifest.problems.some(problem => problem.message.startsWith('character.json colors')),
  );
});

test('variants resolve from the most specific state down to default', () => {
  const state = (overrides: Partial<CharacterState>): CharacterState => ({
    expression: 'idle',
    mood: 'neutral',
    cue: null,
    ...overrides,
  });
  const mouth = ['default', 'talk', 'happy', 'sad'];
  const eyes = ['default', 'happy', 'sad'];
  assert.equal(resolveVariant(mouth, state({})), 'default');
  // Speaking shows the talking mouth even when sad, but the eyes stay sad.
  assert.equal(resolveVariant(mouth, state({ expression: 'speaking', mood: 'sad' })), 'talk');
  assert.equal(resolveVariant(eyes, state({ expression: 'speaking', mood: 'sad' })), 'sad');
  // A laugh wins over talking and falls back to happy when there is no laugh face.
  assert.equal(resolveVariant(mouth, state({ expression: 'speaking', cue: 'laugh' })), 'happy');
  // Love borrows happy; an unknown mood variant falls back to default.
  assert.equal(resolveVariant(eyes, state({ mood: 'love' })), 'happy');
  assert.equal(resolveVariant(eyes, state({ mood: 'confused' })), 'default');
  // A part with no default (a thinking hand) hides unless its state is on.
  assert.equal(resolveVariant(['thinking'], state({})), null);
  assert.equal(
    resolveVariant(['thinking'], state({ expression: 'thinking', mood: 'sad' })),
    'thinking',
  );
  assert.deepEqual(variantPreference(state({ cue: 'chuckle' })), [
    'chuckle',
    'laugh',
    'happy',
    'default',
  ]);
});
