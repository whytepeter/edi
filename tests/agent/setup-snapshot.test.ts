import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, type Memory } from '../../packages/contracts/src/index';
import { buildSetupSnapshot, type SetupSources } from '../../apps/desktop/src/main/setup-snapshot';

const memory = (id: number, text: string): Memory => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  kind: 'fact',
  text,
  createdAt: id,
  updatedAt: id,
});

/** Edi with nothing unusual about it; each test changes the one thing it is about. */
function sources(overrides: Partial<SetupSources> = {}): SetupSources {
  return {
    version: '0.1.0',
    workspaceFolder: '/Users/me/Documents/Edi',
    settings: () => ({ ...defaultSettings, voiceModel: 'kokoro' }),
    character: () => ({ id: 'mochi', name: 'Mochi' }) as ReturnType<SetupSources['character']>,
    companion: () => 'Mochi',
    voiceModels: () =>
      [
        {
          id: 'kokoro',
          name: 'Kokoro',
          available: true,
          expressions: false,
          detail: 'On this Mac',
        },
        {
          id: 'chatterbox',
          name: 'Chatterbox',
          available: false,
          expressions: true,
          detail: 'Not downloaded',
        },
      ] as ReturnType<SetupSources['voiceModels']>,
    selectedVoice: () => ({ model: 'kokoro', voice: 'af_heart' }),
    spokenVoiceName: () => 'Heart',
    voiceStatus: () => undefined,
    cloudVoices: () => [],
    location: () => ({ page: 'home', cardOpen: false }),
    libraryItems: () => [],
    connectedApps: () => '',
    connectorSummary: () => ({ connectors: [], appsToConnect: [] }),
    ai: () => ({ connected: true, model: 'test/model' }),
    privacy: () => ({ paused: null, state: { paused: null, sharingApp: null } }),
    memories: () => [],
    pushToTalk: () => ({ status: 'ready', shortcut: '⌥ Space' }),
    skills: () => [],
    permissions: () => [],
    characters: () => [{ manifest: { id: 'mochi', name: 'Mochi' } }],
    ...overrides,
  };
}

test('the snapshot says who Edi is and what is selected right now', () => {
  const snapshot = buildSetupSnapshot(sources({ voiceStatus: () => 'ready' }));
  assert.deepEqual(snapshot.identity, {
    name: 'Mochi',
    customName: false,
    app: 'Edi',
    version: '0.1.0',
  });
  assert.deepEqual(snapshot.location, { page: 'home', cardOpen: false, pinned: false });
  assert.deepEqual(snapshot.current.character, { id: 'mochi', name: 'Mochi' });
  assert.equal(snapshot.current.voice.speakingVoice.name, 'Heart');
  assert.equal(snapshot.current.voice.status, 'ready');
  assert.equal(snapshot.workspace.generatedContent, '/Users/me/Documents/Edi/Artifacts');
  // A local voice that is not set up reads as off, never as ready.
  assert.equal(buildSetupSnapshot(sources()).current.voice.status, 'off');
  // No secret ever belongs in what the model is told about Edi.
  assert.doesNotMatch(JSON.stringify(snapshot), /apiKey|sk-or-|token/i);
});

test('with a private app in front Edi is told it is not looking, and why', () => {
  const open = buildSetupSnapshot(sources());
  assert.deepEqual(open.current.privacy, { lookingAtScreen: true, reason: null });

  const hidden = buildSetupSnapshot(
    sources({
      privacy: () => ({ paused: 'private-app', state: { paused: null, sharingApp: null } }),
    }),
  );
  assert.deepEqual(hidden.current.privacy, {
    lookingAtScreen: false,
    reason: 'An app the user keeps private is in front.',
  });
});

test('memories about the question come first, and Edi is told when some are not shown', () => {
  const few = buildSetupSnapshot(sources({ memories: () => [memory(1, 'Prefers short answers')] }));
  assert.deepEqual(few.current.memory, {
    remembering: true,
    items: ['- Prefers short answers'],
  });

  // More than fit: the count says the list is not everything.
  const many = Array.from({ length: 60 }, (_, index) =>
    memory(index + 1, `Fact number ${index + 1} is a fairly long line about something else`),
  );
  many.push(memory(99, 'Their sister Priya lives in Lisbon'));
  const asked = buildSetupSnapshot(sources({ memories: () => many }), 'Where does my sister live?');
  assert.ok(asked.current.memory.items.includes('- Their sister Priya lives in Lisbon'));
  assert.equal(asked.current.memory.notShown, many.length - asked.current.memory.items.length);
  assert.ok((asked.current.memory.notShown ?? 0) > 0);
});

test('connected apps appear among the abilities; none connected says so', () => {
  const ability = (connected: string) =>
    buildSetupSnapshot(sources({ connectedApps: () => connected })).abilities.find(entry =>
      entry.name.startsWith('Use connected apps'),
    )?.name;
  assert.equal(ability(''), 'Use connected apps (Connectors), none connected yet');
  assert.equal(ability('Gmail, Notion'), 'Use connected apps (Connectors): Gmail, Notion');
});
