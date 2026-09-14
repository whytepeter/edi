import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  systemInfoSchema,
  ruleAllows,
  cloudVoiceOptionSchema,
  assistantName,
  agentStateSchema,
  characterExpressionSchema,
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
  needsScreenContext,
  createScreenContextSession,
  permissionSnapshotSchema,
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
  for (const view of ['conversations', 'library', 'settings', 'settings.keyboard'])
    assert.equal(commandSchema.safeParse({ type: 'show-workspace', view }).success, true);
  // Destinations are a closed list: retired views and arbitrary routes are refused.
  for (const view of ['agent', 'extensions', 'settings.computer-use', '/settings'])
    assert.equal(commandSchema.safeParse({ type: 'show-workspace', view }).success, false);
});
test('character expressions stay semantic and bounded', () => {
  for (const expression of ['idle', 'listening', 'thinking', 'speaking', 'happy', 'attention'])
    assert.equal(characterExpressionSchema.safeParse(expression).success, true);
  assert.equal(characterExpressionSchema.safeParse('cartesia-excited').success, false);
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
  assert.equal(settingsSchema.safeParse({ skin: 'mochi', pinned: true }).success, true);
  assert.equal(settingsSchema.safeParse({ skin: 'edi', pinned: false }).success, true);
  // Preferences saved with the retired Mira skin move to Edi instead of resetting.
  assert.equal(settingsSchema.parse({ skin: 'mira', pinned: true }).skin, 'edi');
  assert.equal(settingsSchema.safeParse({ skin: 'edi' }).success, false);
  // Retired bundled characters move to Edi; old size choices become a scale.
  for (const skin of ['cloud', 'sprout', 'mira'])
    assert.equal(settingsSchema.parse({ skin, pinned: false }).skin, 'edi');
  assert.equal(
    settingsSchema.parse({ skin: 'edi', pinned: false, petSize: 'large' }).petScale,
    1.35,
  );
  assert.equal(settingsSchema.parse({ skin: 'cloud', pinned: false }).petPosition, null);
  // Preferences saved before speech could be turned off keep speaking.
  assert.equal(settingsSchema.parse({ skin: 'cloud', pinned: false }).speakReplies, true);
  assert.equal(settingsSchema.parse({ skin: 'cloud', pinned: false }).petScale, 1);
  assert.equal(
    commandSchema.safeParse({ type: 'set-pet-scale', scale: 3, commit: true }).success,
    false,
  );
  // Cloud voices: ids from the account, keys only through their own command.
  assert.equal(
    commandSchema.safeParse({
      type: 'set-voice',
      selection: { model: 'elevenlabs', voice: '21m00Tcm4TlvDq8ikWAM' },
    }).success,
    true,
  );
  assert.equal(
    commandSchema.safeParse({ type: 'set-voice', selection: { model: 'cartesia', voice: '../x' } })
      .success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({ type: 'set-voice-key', provider: 'cartesia', apiKey: 'short' })
      .success,
    false,
  );
  // Replies may link sources; only plain web links can be opened.
  for (const url of ['https://example.com/a?b=1', 'http://example.org'])
    assert.equal(commandSchema.safeParse({ type: 'open-link', url }).success, true, url);
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:pw@example.com',
    'x',
  ])
    assert.equal(commandSchema.safeParse({ type: 'open-link', url }).success, false, url);
  // Kokoro is the default; a saved Pocket choice (removed) moves to Kokoro, Chatterbox stays.
  assert.equal(settingsSchema.parse({ skin: 'cloud', pinned: false }).voiceModel, 'kokoro');
  assert.equal(
    settingsSchema.parse({ skin: 'edi', pinned: false, voiceModel: 'pocket' }).voiceModel,
    'kokoro',
  );
  assert.equal(
    settingsSchema.parse({
      skin: 'edi',
      pinned: false,
      voiceModel: 'pocket',
      voices: { kokoro: 'af_heart', pocket: 'jane', 'chatterbox-turbo': 'calm' },
    }).voiceModel,
    'kokoro',
  );
  assert.equal(
    settingsSchema.parse({ skin: 'edi', pinned: false, voiceModel: 'chatterbox-turbo' }).voiceModel,
    'chatterbox-turbo',
  );
  // Each model keeps its own voice; a retired voice falls back to that model's default.
  assert.deepEqual(
    settingsSchema.parse({
      skin: 'edi',
      pinned: false,
      voices: { kokoro: 'bf_emma', pocket: 'alba' },
    }).voices,
    {
      kokoro: 'bf_emma',
      'chatterbox-turbo': 'calm',
      cartesia: null,
      elevenlabs: null,
    },
  );
  assert.equal(
    commandSchema.safeParse({
      type: 'set-voice',
      selection: { model: 'pocket', voice: 'jane' },
    }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({
      type: 'preview-voice',
      selection: { model: 'kokoro', voice: 'bm_george' },
    }).success,
    true,
  );
  assert.equal(
    settingsSchema.safeParse({ skin: 'cloud', pinned: false, voiceModel: 'chatterbox-turbo' })
      .success,
    true,
  );
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
test('permission commands are generic, bounded and typed', () => {
  assert.equal(commandSchema.safeParse({ type: 'permissions-refresh' }).success, true);
  for (const type of [
    'permission-request',
    'permission-open-settings',
    'permission-dismiss',
  ] as const) {
    assert.equal(commandSchema.safeParse({ type, permission: 'microphone' }).success, true);
    assert.equal(commandSchema.safeParse({ type, permission: 'camera' }).success, false);
    assert.equal(
      commandSchema.safeParse({ type, permission: 'microphone', extra: true }).success,
      false,
    );
  }
  assert.equal(
    permissionSnapshotSchema.safeParse({
      active: 'microphone',
      permissions: [
        { id: 'microphone', status: 'denied', requested: true },
        { id: 'screen-recording', status: 'not-determined', requested: false },
        { id: 'accessibility', status: 'granted', requested: false },
        { id: 'reminders', status: 'not-determined', requested: false },
        { id: 'calendar', status: 'denied', requested: true },
      ],
    }).success,
    true,
  );
  assert.equal(
    permissionSnapshotSchema.safeParse({
      active: null,
      permissions: [
        { id: 'microphone', status: 'granted', requested: false },
        { id: 'microphone', status: 'denied', requested: true },
      ],
    }).success,
    false,
  );
});

test('screen context is attached only for requests about visible content', () => {
  for (const prompt of [
    'Hello',
    "What's my name?",
    'Explain closures in JavaScript',
    'Write a polite follow-up email',
    'What is 37 times 19?',
    'Brainstorm names for my coffee shop',
    'Build a webpage about coffee',
    'Create a chart from these numbers',
    'Explain what a browser is',
    'Write a form validation function',
    'What is this?',
    'Look at this code I pasted',
    'Explain desktop applications',
    'Point to the irony in this story',
    'Reply to this message: see you tomorrow',
    'Rewrite this email to sound warmer',
    'Summarize this document I pasted below',
    'Better?',
    'Is it fixed now?',
    'What changed?',
    'Send it',
  ])
    assert.equal(needsScreenContext(prompt), false, prompt);
  for (const prompt of [
    "What's on my screen?",
    'What does this error mean?',
    "What's wrong with this error?",
    "What's wrong with this page?",
    'Which button should I click?',
    'Summarize this webpage',
    'Point to the settings menu',
    'Read the visible chart',
    'Where should I click?',
    'What is on my desktop?',
    'Look at the current app',
    'What does this dialog say?',
    'Read this image',
  ])
    assert.equal(needsScreenContext(prompt), true, prompt);
});

test('short follow-ups recapture only during an active visual conversation', () => {
  const visual = { visualContextActive: true };
  for (const prompt of [
    'Better?',
    'Better now?',
    'Is it fixed now?',
    'Is it fixed?',
    'What changed?',
    'Still broken?',
    'Same issue?',
    'And now?',
    'Now what?',
    'This?',
    'That one?',
    'Can you see?',
    'Does this look better?',
    'What is this?',
    'Why is this happening?',
    'Why is it doing that?',
  ])
    assert.equal(needsScreenContext(prompt, visual), true, prompt);
  for (const prompt of [
    'Write an email to John',
    'Send it',
    'Explain closures in JavaScript',
    'Hello',
    'What is 37 times 19?',
  ])
    assert.equal(needsScreenContext(prompt, visual), false, prompt);
});

test('a non-visual request ends the visual conversation', () => {
  const session = createScreenContextSession();
  assert.equal(session.decide("What's wrong with this error?"), true);
  assert.equal(session.decide('Better?'), true);
  assert.equal(session.decide('Is it fixed now?'), true);
  assert.equal(session.decide('What changed?'), true);
  assert.equal(session.decide('Write an email to John'), false);
  assert.equal(session.decide('Send it'), false);
  assert.equal(session.state.visualContextActive, false);

  const page = createScreenContextSession();
  assert.equal(page.decide("What's wrong with this page?"), true);
  assert.equal(page.decide('Better now?'), true);
  assert.equal(page.decide('Write an email to John'), false);
  assert.equal(page.decide('Send it'), false);
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
  // Changing only the model keeps the saved key; the key is never sent back to a renderer.
  assert.equal(
    commandSchema.safeParse({ type: 'configure-agent', model: 'vendor/model' }).success,
    true,
  );
  assert.equal(
    commandSchema.safeParse({ type: 'configure-agent', apiKey: 'short', model: 'vendor/model' })
      .success,
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
  assert.deepEqual(second?.display, shots[1]?.display);
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

test('the companion is named by the person, or by its character until then', () => {
  const saved = settingsSchema.parse({ skin: 'mochi', pinned: false });
  assert.equal(saved.name, null);
  assert.equal(assistantName(saved, 'Mochi'), 'Mochi');
  assert.equal(assistantName({ name: 'Luna' }, 'Mochi'), 'Luna');
  assert.equal(settingsSchema.parse({ skin: 'edi', pinned: false, name: '  Zoë ' }).name, 'Zoë');
  // Names are copy, menu labels and prompt text: markup, paths and empty names are refused.
  for (const name of ['', '<b>Edi</b>', '../x', '1Edi', 'A'.repeat(25)]) {
    assert.equal(settingsSchema.parse({ skin: 'edi', pinned: false, name }).name, null);
    assert.equal(commandSchema.safeParse({ type: 'set-name', name }).success, false);
  }
  assert.equal(commandSchema.safeParse({ type: 'set-name', name: 'Mary-Jane' }).success, true);
  assert.equal(commandSchema.safeParse({ type: 'set-name', name: null }).success, true);
});

test('system info accepts the longest cloud voice name with its model', () => {
  const voice = cloudVoiceOptionSchema.parse({
    id: 'D9xwB6HNBJ9h4YvQFWuE',
    name: 'V'.repeat(60),
    description: '',
    gender: null,
    accent: null,
  });
  const model = (id: string) => ({ id, name: id, available: true, expressions: false, detail: '' });
  const info = {
    version: '0.1.0',
    voice: {
      available: true,
      name: `${voice.name} · ElevenLabs`,
      models: ['kokoro', 'chatterbox-turbo', 'cartesia', 'elevenlabs'].map(model),
    },
    pushToTalk: { status: 'ready', label: '⌥ Space' },
    workspaceFolder: '/Users/me/Documents/Edi',
  };
  assert.equal(systemInfoSchema.safeParse(info).success, true);
});

test('a saved rule allows only the same action when it covers everything the action touches', () => {
  const request = (
    capability: string,
    scope?: { kind: 'folder' | 'site' | 'app' | 'any'; covers: string[] },
  ) => ({
    callId: '00000000-0000-4000-8000-000000000001',
    runId: '00000000-0000-4000-8000-000000000002',
    capability: { id: capability, title: 'x' },
    preview: { title: 'x', action: 'x', summary: 'x', fields: [] },
    ...(scope ? { scope: { ...scope, value: '', label: '' } } : {}),
  });
  const rule = (capabilityId: string, kind: 'folder' | 'site' | 'app' | 'any', value: string) => ({
    id: '00000000-0000-4000-8000-000000000003',
    capabilityId,
    capabilityTitle: 'x',
    kind,
    value,
    label: value,
    createdAt: 0,
  });
  const desktop = rule('files.move', 'folder', '/Users/ada/Desktop');
  assert.equal(
    ruleAllows(
      desktop,
      request('files.move', {
        kind: 'folder',
        covers: ['/Users/ada/Desktop', '/Users/ada/Desktop/Shots'],
      }),
    ),
    true,
  );
  // A sibling whose name starts the same, another folder, another action, or no scope: no.
  for (const other of [
    request('files.move', { kind: 'folder', covers: ['/Users/ada/Desktop Old/a'] }),
    request('files.move', {
      kind: 'folder',
      covers: ['/Users/ada/Desktop/a', '/Users/ada/Downloads'],
    }),
    request('files.trash', { kind: 'folder', covers: ['/Users/ada/Desktop/a'] }),
    request('files.move'),
    request('files.move', { kind: 'folder', covers: [] }),
  ])
    assert.equal(ruleAllows(desktop, other), false);
  const github = rule('mac.open_url', 'site', 'github.com');
  assert.equal(
    ruleAllows(github, request('mac.open_url', { kind: 'site', covers: ['gist.github.com'] })),
    true,
  );
  assert.equal(
    ruleAllows(github, request('mac.open_url', { kind: 'site', covers: ['evilgithub.com'] })),
    false,
  );
  assert.equal(
    ruleAllows(
      rule('mac.reminders_create', 'any', ''),
      request('mac.reminders_create', { kind: 'any', covers: [] }),
    ),
    true,
  );
});
