import { join } from 'node:path';
import type { EdiSetupSnapshot } from '@edi/capabilities';
import {
  isCloudVoiceModel,
  memoriesForPrompt,
  privacyReason,
  voiceCatalog,
  type CharacterManifest,
  type CloudProviderId,
  type CloudVoiceOption,
  type LibraryItem,
  type Memory,
  type PrivacyPause,
  type PrivacyState,
  type Settings,
  type SystemInfo,
  type VoiceSelection,
} from '@edi/contracts';

/**
 * Everything the snapshot is read from, each asked for at the moment a snapshot is built, so it
 * always describes Edi as it is now. Nothing here is a secret.
 */
export interface SetupSources {
  version: string;
  /** Documents › Edi. */
  workspaceFolder: string;
  settings(): Settings;
  /** The selected character. */
  character(): CharacterManifest;
  /** What the person calls their companion. */
  companion(): string;
  voiceModels(): SystemInfo['voice']['models'];
  selectedVoice(): VoiceSelection;
  spokenVoiceName(selection: VoiceSelection): string;
  /** Whether a local voice is loaded, loading or off; undefined when it is not set up. */
  voiceStatus(model: 'kokoro' | 'chatterbox'): string | undefined;
  /** The person's own voices on a cloud provider, once listed. */
  cloudVoices(provider: CloudProviderId): readonly CloudVoiceOption[];
  /** Where the person is in Edi right now. */
  location(): { page: string; cardOpen: boolean };
  libraryItems(): LibraryItem[];
  /** Names of connected apps, for the abilities list; '' when none. */
  connectedApps(): string;
  connectorSummary(): Pick<EdiSetupSnapshot, 'connectors' | 'appsToConnect'>;
  ai(): { connected: boolean; model: string | null; hardTaskModel: string | null };
  /** Whether Edi may look at the screen with the app that is in front, and the wider state. */
  privacy(): { paused: PrivacyPause | null; state: PrivacyState };
  memories(): Memory[];
  pushToTalk(): EdiSetupSnapshot['current']['pushToTalk'];
  skills(): { name: string; title: string; enabled: boolean }[];
  permissions(): { id: string; status: string }[];
  characters(): { manifest: { id: string; name: string } }[];
}

/**
 * Edi as it is right now, for the model: who it is, where the person is in the app, what is
 * selected, what it can and cannot do, and what it remembers. Built from authoritative services
 * at the start of a turn so Edi describes and changes only what exists. `question` puts the
 * memories about what was asked first when they do not all fit.
 */
export function buildSetupSnapshot(from: SetupSources, question?: string): EdiSetupSnapshot {
  const settings = from.settings();
  const character = from.character();
  const selectedModel =
    from.voiceModels().find(item => item.id === settings.voiceModel) ?? from.voiceModels()[0]!;
  const speaking = from.selectedVoice();
  const items = from.libraryItems();
  const notes = items.filter(item => item.kind === 'note');
  return {
    identity: {
      name: from.companion(),
      customName: settings.name !== null,
      app: 'Edi',
      version: from.version,
    },
    location: { ...from.location(), pinned: settings.pinned },
    workspace: {
      root: from.workspaceFolder,
      generatedContent: join(from.workspaceFolder, 'Artifacts'),
      behavior:
        'Generated content is saved automatically and opens in its own window beside the card.',
    },
    library: {
      items: items.length,
      notes: notes.length,
      artifacts: items.length - notes.length,
      recent: items.slice(0, 8).map(({ id, title }) => ({ id, title })),
    },
    abilities: [
      { name: 'Answer questions, including about what is on screen', asksFirst: false },
      {
        name: 'Know the app, window, page address, open document and selected text in front when asked (Settings → Privacy & Permissions)',
        asksFirst: false,
      },
      {
        name: 'Search the public web for current information and link the sources it used',
        asksFirst: false,
      },
      {
        name: 'Create documents, checklists, tables and sandboxed interactive pages, save them to the workspace and show them in their own window',
        asksFirst: false,
      },
      { name: 'Search and read everything in the workspace', asksFirst: false },
      {
        name: 'Move: hop a little way along the screen when asked (edi_window hop), and wander now and then when nothing is happening if the wander preference is on',
        asksFirst: false,
      },
      { name: 'Save or edit notes, and update generated content', asksFirst: true },
      { name: 'Move workspace items to the Trash', asksFirst: true },
      {
        name: 'Search, list and read files in allowed folders (Desktop, Documents, Downloads, added folders)',
        asksFirst: false,
      },
      {
        name: 'Rename, move, create folders and move files to the Trash in allowed folders',
        asksFirst: true,
      },
      {
        name: 'Open apps, links in the browser and files in allowed folders; show files in Finder',
        asksFirst: true,
      },
      {
        name: 'Read and add Reminders and Calendar events (Settings → Privacy & Permissions)',
        asksFirst: true,
      },
      {
        name: `Use connected apps (Connectors)${from.connectedApps() ? `: ${from.connectedApps()}` : ', none connected yet'}`,
        asksFirst: true,
      },
      {
        name: 'Use skills (ways of working, listed in Skills) and make new ones with Skill Creator',
        asksFirst: true,
      },
      { name: 'Open any page in Edi, including Settings', asksFirst: false },
      {
        name: 'Change its name, character, size, pin, voice, spoken replies, speech recognition and its words, sharing what is in front, the task budget, and skills on or off',
        asksFirst: false,
      },
      { name: 'Switch the AI model it answers with', asksFirst: true },
      { name: 'Run the shortcuts you made in the Shortcuts app, by name', asksFirst: true },
      {
        name: 'Tell you what it did, and undo its own moves, renames, new folders and added events',
        asksFirst: true,
      },
      { name: 'Close its card or go to sleep', asksFirst: false },
      {
        name: 'Run longer work as background tasks with a spending cap, and report how they are going',
        asksFirst: true,
      },
      {
        name: 'Schedule tasks for later or on repeat, and watch things, telling you only when they change',
        asksFirst: true,
      },
      { name: 'Point at and draw on the screen', asksFirst: false },
    ],
    notYetAvailable: [
      'Installing skills from a community catalog',
      'Clicking or typing in other apps',
      'Opening, reading or using logged-in websites in a browser',
      'Changing the keyboard shortcut',
    ],
    current: {
      size: settings.petScale,
      character: { id: character.id, name: character.name },
      voice: {
        id: selectedModel.id,
        name: selectedModel.name,
        speakingVoice: { id: speaking.voice, name: from.spokenVoiceName(speaking) },
        available: selectedModel.available,
        expressions: selectedModel.expressions,
        detail: selectedModel.detail,
        status:
          selectedModel.id === 'chatterbox'
            ? (from.voiceStatus('chatterbox') ?? 'off')
            : selectedModel.id === 'kokoro'
              ? (from.voiceStatus('kokoro') ?? 'off')
              : selectedModel.available
                ? 'ready'
                : 'unavailable',
      },
      speakReplies: settings.speakReplies,
      wander: settings.wander,
      shareDesktopContext: settings.shareDesktopContext,
      taskBudgetUsd: settings.taskBudgetUsd,
      voiceInput: settings.voiceInput,
      voiceWords: settings.voiceWords,
      ai: {
        connected: from.ai().connected,
        model: from.ai().model,
        hardTaskModel: from.ai().hardTaskModel,
      },
      // As of the app that was in front when this was asked: with one the person keeps
      // private there, Edi is not looking, and must be able to say so rather than guess.
      privacy: (() => {
        const paused = from.privacy().paused;
        return {
          lookingAtScreen: !paused,
          reason: privacyReason({ ...from.privacy().state, paused }),
        };
      })(),
      memory: (() => {
        const kept = from.memories();
        const items = memoriesForPrompt(kept, question ? { question } : {});
        return {
          remembering: settings.remember,
          items,
          // The list is not everything when it did not all fit: never read it as complete.
          ...(kept.length > items.length ? { notShown: kept.length - items.length } : {}),
        };
      })(),
      pushToTalk: from.pushToTalk(),
    },
    // Built-in abilities are listed above; skills are add-ons, and none exist yet.
    skills: from.skills().map(skill => ({
      id: skill.name,
      name: skill.title,
      active: skill.enabled,
    })),
    ...from.connectorSummary(),
    permissions: from.permissions().map(({ id, status }) => ({
      id,
      status,
    })),
    availableCharacters: from.characters().map(({ manifest }) => ({
      id: manifest.id,
      name: manifest.name,
    })),
    availableVoices: from.voiceModels().map(({ id, name, available, expressions, detail }) => ({
      id,
      name,
      available,
      expressions,
      detail,
      voices: isCloudVoiceModel(id)
        ? from.cloudVoices(id).map(({ id: voice, name: voiceLabel, gender, accent }) => ({
            id: voice,
            name: voiceLabel,
            gender,
            accent,
          }))
        : voiceCatalog[id].map(voice => ({ ...voice })),
    })),
  };
}
