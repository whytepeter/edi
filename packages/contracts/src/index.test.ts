import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandSchema, settingsSchema, contentCardSchema } from './index';
import { skinGeometrySchema, skinGeometry, mapSkinPoint } from './skin-geometry';
import { placeCard, clampWindow } from './window-placement';

test('card placement flips at left edge and clamps small/negative-origin displays', () => {
  const area = { x: -1000, y: 0, width: 1000, height: 800 };
  assert.deepEqual(placeCard({ x: -50, y: 700 }, { width: 408, height: 480 }, area), {
    x: -470,
    y: 220,
    width: 408,
    height: 480,
  });
  const oldBounds = { x: 123, y: 456, width: 408, height: 480 };
  assert.deepEqual(placeCard({ x: -50, y: 700 }, oldBounds, area), {
    x: -470,
    y: 220,
    width: 408,
    height: 480,
  });
  assert.deepEqual(placeCard({ x: -990, y: 700 }, { width: 408, height: 480 }, area), {
    x: -978,
    y: 220,
    width: 408,
    height: 480,
  });
  assert.deepEqual(
    clampWindow(
      { x: 999, y: 999, width: 740, height: 650 },
      { x: 0, y: 0, width: 320, height: 300 },
    ),
    { x: 0, y: 0, width: 320, height: 300 },
  );
  assert.throws(() => clampWindow({ x: NaN, y: 0, width: 1, height: 1 }, area));
});

test('both bundled skins validate and reject out-of-bounds anchors', () => {
  for (const geometry of Object.values(skinGeometry)) {
    assert.equal(skinGeometrySchema.safeParse(geometry).success, true);
    assert.equal(
      skinGeometrySchema.safeParse({
        ...geometry,
        anchors: { ...geometry.anchors, leftHand: { x: -1, y: 0 } },
      }).success,
      false,
    );
    assert.equal(
      skinGeometrySchema.safeParse({
        ...geometry,
        paintedBounds: { x: 0, y: 0, width: 999, height: 10 },
      }).success,
      false,
    );
  }
});
test('skin coordinates match centered SVG scaling including negative display origins', () => {
  const geometry = skinGeometry.cloud;
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

test('bridge rejects unknown capabilities and invalid skin selections', () => {
  assert.equal(commandSchema.safeParse({ type: 'execute', command: 'anything' }).success, false);
  assert.equal(
    commandSchema.safeParse({ type: 'apply-skin', skin: '../untrusted' }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({ type: 'pet-hit-test', interactive: 'yes' }).success,
    false,
  );
});
test('content accepts bounded presentation blocks without executable content', () => {
  const card = {
    version: 1,
    title: 'Hello',
    blocks: [{ type: 'text', text: '<script>not executed</script>' }],
  };
  assert.equal(contentCardSchema.safeParse(card).success, true);
  assert.equal(
    contentCardSchema.safeParse({ ...card, blocks: [{ type: 'html', html: '<script/>' }] }).success,
    false,
  );
  assert.equal(
    contentCardSchema.safeParse({
      ...card,
      blocks: [{ type: 'local-video', caption: 'Watch', src: 'https://example.com/track' }],
    }).success,
    false,
  );
  assert.equal(
    contentCardSchema.safeParse({ ...card, blocks: Array(21).fill(card.blocks[0]) }).success,
    false,
  );
  assert.equal(
    contentCardSchema.safeParse({ ...card, blocks: [{ type: 'steps', labels: ['Only one'] }] })
      .success,
    false,
  );
});
test('stored settings require a supported avatar and boolean pin state', () => {
  assert.equal(settingsSchema.safeParse({ skin: 'sprout', pinned: true }).success, true);
  assert.equal(settingsSchema.safeParse({ skin: 'cloud' }).success, false);
  assert.equal(settingsSchema.parse({ skin: 'cloud', pinned: false }).petPosition, null);
  assert.equal(
    settingsSchema.safeParse({ skin: 'cloud', pinned: false, petPosition: { x: Infinity, y: 0 } })
      .success,
    false,
  );
});
test('pet drag commands require a valid phase, pointer, and finite screen point', () => {
  const command = { type: 'pet-drag', phase: 'start', pointerId: 1, point: { x: -200, y: 400 } };
  assert.equal(commandSchema.safeParse(command).success, true);
  assert.equal(commandSchema.safeParse({ ...command, phase: 'execute' }).success, false);
  assert.equal(commandSchema.safeParse({ ...command, point: { x: NaN, y: 0 } }).success, false);
  assert.equal(commandSchema.safeParse({ ...command, pointerId: -1 }).success, false);
});
test('agent commands bound prompts, keys, and model IDs', () => {
  assert.equal(commandSchema.safeParse({ type: 'ask-agent', prompt: 'hello' }).success, true);
  assert.equal(commandSchema.safeParse({ type: 'ask-agent', prompt: ' ' }).success, false);
  assert.equal(
    commandSchema.safeParse({ type: 'ask-agent', prompt: 'x'.repeat(8001) }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({
      type: 'configure-agent',
      apiKey: 'test-only-key',
      model: 'vendor/model',
    }).success,
    true,
  );
  assert.equal(
    commandSchema.safeParse({
      type: 'configure-agent',
      apiKey: 'test-only-key',
      model: 'vendor/model',
      endpoint: 'https://other.example',
    }).success,
    false,
  );
});
