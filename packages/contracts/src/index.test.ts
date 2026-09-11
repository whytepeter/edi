import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentStateSchema,
  commandSchema,
  emptyAgentState,
  settingsSchema,
  contentCardSchema,
  screenLabel,
  screenshotPointToScreen,
  voiceHostEventSchema,
  maxVoicePcmBytes,
  parsePresentation,
  resolvePresentation,
  localizeActions,
  presentationScriptSchema,
  presentationText,
} from './index';

test('agent state carries a bounded chat thread', () => {
  const state = emptyAgentState({
    configured: true,
    model: 'test/model',
    prompt: 'Hi',
    messages: [
      { id: '1-u', role: 'user', text: 'Hi' },
      { id: '1-a', role: 'assistant', text: 'Hello.' },
    ],
  });
  assert.equal(agentStateSchema.safeParse(state).success, true);
  assert.equal(
    agentStateSchema.safeParse({ ...state, messages: [{ id: '', role: 'user', text: 'x' }] })
      .success,
    false,
  );
});

test('streamed presentation tags stay hidden, including partial tokens', () => {
  for (const suffix of ['[P', '[POINT', '[POINT:1,2:Save', '[DRAW:circle:1,2,3']) {
    assert.equal(presentationText('Here. ' + suffix), 'Here.');
  }
  assert.equal(presentationText('Here [POINT:1,2:Save]'), 'Here');
  assert.equal(presentationText('Use [brackets] normally.'), 'Use [brackets] normally.');
  assert.equal(parsePresentation('[POINT:,2:bad][POINT:1e2,2:bad]').actions.length, 0);
  const shots = [{ width: 100, height: 100, display: { x: 0, y: 0, width: 100, height: 100 } }];
  assert.equal(resolvePresentation(parsePresentation('[DRAW:circle:5,5,20:bad]'), shots), null);
});
import { skinGeometrySchema, skinGeometry, mapSkinPoint } from './skin-geometry';
import { placeCard, clampWindow, placeContextMenu, placeSpeechBubble } from './window-placement';

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
test('microphone permission commands have no extra fields', () => {
  for (const type of [
    'open-microphone-settings',
    'open-screen-recording-settings',
    'check-microphone-permission',
    'request-microphone-permission',
    'request-screen-recording',
  ] as const) {
    assert.equal(commandSchema.safeParse({ type }).success, true);
    assert.equal(commandSchema.safeParse({ type, extra: true }).success, false);
  }
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

test('speech bubble tail sits on the head anchor, mirroring left when the right lacks room', () => {
  const area = { x: 0, y: 0, width: 1000, height: 800 };
  const anchors = { right: { x: 500, y: 400 }, left: { x: 440, y: 400 } };
  const size = { width: 88, height: 52 };
  // Tail corner = window origin + margin (left) and height − margin (bottom).
  assert.deepEqual(placeSpeechBubble(anchors, size, 8, area), {
    bounds: { x: 492, y: 356, width: 88, height: 52 },
    side: 'right',
  });
  const nearEdge = { right: { x: 960, y: 400 }, left: { x: 900, y: 400 } };
  assert.deepEqual(placeSpeechBubble(nearEdge, size, 8, area), {
    bounds: { x: 820, y: 356, width: 88, height: 52 },
    side: 'left',
  });
  // An explicit side is kept (the rendered tail cannot flip mid-drag), then clamped.
  assert.equal(placeSpeechBubble(nearEdge, size, 8, area, 'right').side, 'right');
  assert.equal(placeSpeechBubble(nearEdge, size, 8, area, 'right').bounds.x, 912);
});

test('context menu opens at the pointer and flips at display edges', () => {
  const area = { x: -1000, y: 0, width: 1000, height: 800 };
  const size = { width: 200, height: 178 };
  assert.deepEqual(placeContextMenu({ x: -900, y: 100 }, size, 8, area), {
    x: -908,
    y: 92,
    width: 200,
    height: 178,
  });
  // Bottom-right corner: open up and to the left of the pointer.
  assert.deepEqual(placeContextMenu({ x: -10, y: 790 }, size, 8, area), {
    x: -202,
    y: 620,
    width: 200,
    height: 178,
  });
});

test('screenshots are labelled per display and points map back to those displays', () => {
  assert.equal(
    screenLabel(0, 2, true, 1280, 831),
    'screen 1 of 2 — cursor is on this screen (primary focus) (image dimensions: 1280x831 pixels)',
  );
  assert.equal(
    screenLabel(1, 2, false, 1280, 720),
    'screen 2 of 2 (image dimensions: 1280x720 pixels)',
  );
  // A secondary display to the left of the primary, at a negative origin.
  const display = { x: -1920, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(
    screenshotPointToScreen({ x: 640, y: 360 }, { width: 1280, height: 720 }, display),
    {
      x: -960,
      y: 540,
    },
  );
  // Out-of-image points clamp to the display edge instead of leaving it.
  assert.deepEqual(
    screenshotPointToScreen({ x: 9999, y: -5 }, { width: 1280, height: 720 }, display),
    {
      x: 0,
      y: 0,
    },
  );
});

test('voice messages carry typed audio and reject anything else', () => {
  const pcm = { type: 'pcm', generation: 1, rate: 24000 };
  assert.equal(
    voiceHostEventSchema.safeParse({ ...pcm, samples: new Float32Array(10) }).success,
    true,
  );
  assert.equal(voiceHostEventSchema.safeParse({ ...pcm, samples: [0.1, 0.2] }).success, false);
  assert.equal(
    voiceHostEventSchema.safeParse({ ...pcm, samples: new Float32Array(0) }).success,
    false,
  );
  const audio = { type: 'voice-audio', generation: 1 };
  assert.equal(commandSchema.safeParse({ ...audio, pcm: new Uint8Array(3200) }).success, true);
  assert.equal(commandSchema.safeParse({ ...audio, pcm: Buffer.alloc(3200) }).success, true);
  assert.equal(commandSchema.safeParse({ ...audio, pcm: new Uint8Array(3) }).success, false); // odd byte count
  assert.equal(
    commandSchema.safeParse({ ...audio, pcm: new Uint8Array(maxVoicePcmBytes + 2) }).success,
    false,
  );
});

test('presentation tags parse into ordered actions on one screen and leave the text clean', () => {
  const reply =
    'Click Save, then check the name. [POINT:640,120:Save button]' +
    '[DRAW:circle:300,200,40:Name: required][DRAW:box:10,20,100,50:Menu]' +
    '[DRAW:arrow:0,0,50,60:Here][DRAW:underline:5,90,200,90:Title][DRAW:box:1,1,5,5:Other:screen2]';
  const { text, screen, actions } = parsePresentation(reply);
  assert.equal(text, 'Click Save, then check the name.');
  assert.equal(screen, 1);
  assert.deepEqual(actions, [
    { type: 'point', x: 640, y: 120, label: 'Save button' },
    { type: 'circle', x: 300, y: 200, r: 40, label: 'Name: required' },
    { type: 'box', x: 10, y: 20, w: 100, h: 50, label: 'Menu' },
    { type: 'arrow', x1: 0, y1: 0, x2: 50, y2: 60, label: 'Here' },
    { type: 'underline', x1: 5, y1: 90, x2: 200, y2: 90, label: 'Title' },
  ]);
  assert.deepEqual(parsePresentation('Over there [POINT:10,20:Dock:screen2]').screen, 2);
  assert.deepEqual(parsePresentation('Nothing to show. [POINT:none]'), {
    text: 'Nothing to show.',
    screen: 1,
    actions: [],
  });
  // Malformed tags are removed from the text but never performed.
  assert.deepEqual(parsePresentation('Hmm [DRAW:star:1,2] [POINT:x,y]').actions, []);
  assert.equal(presentationScriptSchema.safeParse(actions).success, true);
});

test('presentations resolve onto the right display, and bad targets are rejected', () => {
  const shots = [
    { width: 1280, height: 800, display: { x: 0, y: 0, width: 1512, height: 945 } },
    { width: 1280, height: 720, display: { x: -1920, y: 0, width: 1920, height: 1080 } },
  ];
  const first = resolvePresentation(
    { screen: 1, actions: [{ type: 'circle', x: 640, y: 400, r: 40, label: '' }] },
    shots,
  );
  assert.deepEqual(first?.actions, [{ type: 'circle', x: 756, y: 473, r: 47, label: '' }]);
  const second = resolvePresentation(
    { screen: 2, actions: [{ type: 'point', x: 640, y: 360, label: 'Here' }] },
    shots,
  );
  assert.deepEqual(second?.actions[0], { type: 'point', x: -960, y: 540, label: 'Here' });
  assert.deepEqual(second?.display, shots[1].display);
  assert.equal(
    resolvePresentation({ screen: 3, actions: [{ type: 'point', x: 1, y: 1, label: '' }] }, shots),
    null,
  );
  assert.equal(
    resolvePresentation(
      { screen: 1, actions: [{ type: 'point', x: 5000, y: 1, label: '' }] },
      shots,
    ),
    null,
  );
  assert.deepEqual(
    localizeActions([{ type: 'point', x: -960, y: 540, label: '' }], { x: -1920, y: 0 }),
    [{ type: 'point', x: 960, y: 540, label: '' }],
  );
});
