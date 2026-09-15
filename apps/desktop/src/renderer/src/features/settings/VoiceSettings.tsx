import { useEffect, useState } from 'react';
import {
  isCloudVoiceModel,
  voiceCatalog,
  voiceSelectionSchema,
  type CloudProviderId,
  type SystemInfo,
  type VoiceChoices,
  type VoiceInput,
  type VoiceModelId,
  type VoiceSelection,
} from '@edi/contracts';
import {
  Button,
  GroupedList,
  GroupedRow,
  Icon,
  IconButton,
  SegmentedControl,
  Switch,
  TextField,
} from '../../components/ui';
import './settings.css';
import { useAssistantName } from '../../hooks/useAssistantName';

interface VoiceSettingsProps {
  system: SystemInfo | null;
  voiceModel: VoiceModelId;
  voices: VoiceChoices;
  speakReplies: boolean;
  voiceInput: VoiceInput;
  voiceWords: string[];
  onVoiceModel(model: VoiceModelId): void;
  onVoiceInput(input: VoiceInput): void;
  onVoiceWords(words: string[]): void;
  onVoice(selection: VoiceSelection): void;
  onPreview(selection: VoiceSelection): Promise<void>;
  onSpeakReplies(enabled: boolean): void;
  /** A key or an added voice changed, so what Settings → Voice offers changed. */
  onKeysChanged(): void;
}

const modelHelp = (assistant: string): Record<VoiceModelId, string> => ({
  kokoro: `Choose who ${assistant} sounds like. Play a sample before you pick.`,
  'chatterbox-turbo': `Calm is steadier and softer; Expressive is livelier. Both can laugh or sigh when ${assistant} means to.`,
  cartesia: 'Voices on your Cartesia account: ones you created, cloned or saved there.',
  elevenlabs: 'Voices on your ElevenLabs account: ones you created, cloned or saved there.',
});
const providerName: Record<CloudProviderId, string> = {
  cartesia: 'Cartesia',
  elevenlabs: 'ElevenLabs',
};

/** One line on what the provider is, and where to get a key. */
const providerInfo: Record<CloudProviderId, { about: string; keyUrl: string; voicesUrl: string }> =
  {
    cartesia: {
      about: 'Fast, natural voices. Only the voices on your Cartesia account are offered.',
      keyUrl: 'https://play.cartesia.ai/keys',
      voicesUrl: 'https://play.cartesia.ai/voices',
    },
    elevenlabs: {
      about: 'Expressive voices. Only the voices on your ElevenLabs account are offered.',
      keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
      voicesUrl: 'https://elevenlabs.io/app/voice-lab',
    },
  };

const listeningLabels = ['This Mac', 'Cartesia'] as const;
type ListeningLabel = (typeof listeningLabels)[number];

type VoiceType = 'Female' | 'Male';
const voiceTypes: readonly VoiceType[] = ['Female', 'Male'];

interface ListedVoice {
  id: string;
  name: string;
  detail: string;
  gender: VoiceType | null;
}

/**
 * Settings → Voice. First the speech model (local engines, or a cloud provider with the
 * person's own key), then the voice within it. Each model remembers its own voice. Changing
 * the voice never changes Edi's personality.
 */
export function VoiceSettings({
  system,
  voiceModel,
  voices,
  speakReplies,
  voiceInput,
  voiceWords,
  onVoiceModel,
  onVoiceInput,
  onVoiceWords,
  onVoice,
  onPreview,
  onSpeakReplies,
  onKeysChanged,
}: VoiceSettingsProps) {
  const assistant = useAssistantName();
  // The model being looked at; a cloud model is only selected once it has a key and a voice.
  const [viewing, setViewing] = useState<VoiceModelId>(voiceModel);
  const [voiceType, setVoiceType] = useState<VoiceType>('Female');
  const [query, setQuery] = useState('');
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [cloud, setCloud] = useState<{ provider: CloudProviderId; voices: ListedVoice[] } | null>(
    null,
  );
  const [cloudError, setCloudError] = useState('');
  // Adding a voice from a recording (Chatterbox), and the voice waiting for Remove confirmation.
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [consent, setConsent] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [addError, setAddError] = useState('');
  const [addedName, setAddedName] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  // Edited as text; saved as a list when the field is left or Return is pressed.
  const [wordsDraft, setWordsDraft] = useState(voiceWords.join(', '));
  const [shownWords, setShownWords] = useState(voiceWords);
  if (shownWords !== voiceWords) {
    // Saved elsewhere (or just saved): show the stored list.
    setShownWords(voiceWords);
    setWordsDraft(voiceWords.join(', '));
  }
  const saveWords = () => {
    const words = [
      ...new Set(
        wordsDraft
          .split(/[,\n]/)
          .map(word => word.trim().slice(0, 40))
          .filter(Boolean),
      ),
    ].slice(0, 50);
    if (words.join('\n') !== voiceWords.join('\n')) onVoiceWords(words);
    setWordsDraft(words.join(', '));
  };
  // Bumped by "Check again" after the person adds a voice on the provider's site.
  const [cloudReload, setCloudReload] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keyError, setKeyError] = useState('');
  // The cloud row showing its key panel. Opens on tap; a connected provider starts closed.
  const [expanded, setExpanded] = useState<CloudProviderId | null>(null);

  const models = system?.voice.models ?? [];
  const model = models.find(entry => entry.id === viewing);
  const provider = isCloudVoiceModel(viewing) ? viewing : null;
  const hasKey = Boolean(provider && model?.available);
  const cartesiaKey = Boolean(models.find(entry => entry.id === 'cartesia')?.available);

  useEffect(() => {
    if (!provider || !hasKey || !window.edi) return;
    let alive = true;
    window.edi
      .cloudVoices(provider)
      .then(list => {
        if (!alive) return;
        setCloudError('');
        setCloud({
          provider,
          voices: list.map(voice => ({
            id: voice.id,
            name: voice.name,
            detail: [voice.accent, voice.description].filter(Boolean).join(' · ') || 'Voice',
            gender: voice.gender,
          })),
        });
      })
      .catch(() => alive && setCloudError(`Couldn’t load your ${providerName[provider]} voices.`));
    return () => {
      alive = false;
    };
  }, [provider, hasKey, cloudReload]);

  // Voices the person added from recordings on this Mac (Chatterbox only).
  const personal = model?.personalVoices ?? [];
  const local: ListedVoice[] = provider
    ? []
    : [
        ...voiceCatalog[viewing].map(voice => ({
          id: voice.id,
          name: voice.name,
          detail: voice.accent,
          gender: voice.gender,
        })),
        ...(viewing === 'chatterbox-turbo'
          ? personal.map(voice => ({
              id: voice.id,
              name: voice.name,
              detail: 'Your voice · on this Mac',
              gender: null,
            }))
          : []),
      ];
  const chosen = voiceModel === viewing ? voices[viewing] : null;
  // Cloud lists hold only the account's own voices, so all of them are offered.
  const cloudVoices = cloud?.provider === provider ? cloud.voices : [];
  const all = provider ? cloudVoices : local;
  const splitByType =
    !provider &&
    all.some(voice => voice.gender === 'Female') &&
    all.some(voice => voice.gender === 'Male');
  const shown = all
    .filter(voice => !splitByType || voice.gender === voiceType || voice.gender === null)
    .filter(voice => !query || voice.name.toLowerCase().includes(query.trim().toLowerCase()));
  const select = (voice: string) => voiceSelectionSchema.parse({ model: viewing, voice });

  function closeAdd() {
    setAdding(false);
    setNewName('');
    setConsent(false);
    setAddError('');
  }

  async function addVoice() {
    const name = newName.trim();
    if (!name || !consent || choosing || !window.edi) return;
    setChoosing(true);
    setAddError('');
    try {
      const result = await window.edi.addPersonalVoice({ name, consent: true });
      if (!result) return; // the file picker was cancelled
      if (!result.ok) return setAddError(result.error);
      closeAdd();
      setAddedName(result.voice.name);
      onKeysChanged();
    } catch {
      setAddError('That recording couldn’t be used.');
    } finally {
      setChoosing(false);
    }
  }

  function chooseModel(next: VoiceModelId) {
    const cloudModel = isCloudVoiceModel(next);
    if (next !== viewing) {
      setViewing(next);
      setQuery('');
      setMessage('');
      setApiKey('');
      setKeyError('');
    }
    // A cloud row toggles its key panel; picking a local model closes any open one.
    setExpanded(current => (cloudModel && (current !== next || next !== viewing) ? next : null));
    const entry = models.find(item => item.id === next);
    // Local models and cloud models with a saved voice switch right away.
    if (entry?.available && (!cloudModel || voices[next])) onVoiceModel(next);
  }

  async function preview(voice: string) {
    setPreviewing(voice);
    setMessage('');
    try {
      await onPreview(select(voice));
    } catch {
      setMessage(`Couldn’t play that sample. Try again when ${assistant} isn’t speaking.`);
    } finally {
      setPreviewing(null);
    }
  }

  async function saveKey() {
    if (!provider || !window.edi) return;
    setSavingKey(true);
    setKeyError('');
    try {
      await window.edi.command({ type: 'set-voice-key', provider, apiKey: apiKey.trim() });
      setApiKey('');
    } catch {
      setKeyError(`${providerName[provider]} didn’t accept that key. Check it and try again.`);
    } finally {
      setSavingKey(false);
      onKeysChanged();
    }
  }

  async function removeKey(target: CloudProviderId) {
    await window.edi?.command({ type: 'forget-voice-key', provider: target }).catch(() => {});
    setCloud(null);
    onKeysChanged();
  }

  const openKeys = (target: CloudProviderId) =>
    void window.edi?.command({ type: 'open-link', url: providerInfo[target].keyUrl });

  return (
    <div className="settings-page">
      <GroupedList
        title="Speech model"
        footer={`Local models run on this Mac. Cloud voices use your own account and receive only the words ${assistant} speaks.`}
      >
        <div className="voice-model-list" role="radiogroup" aria-label="Speech model">
          {models.map(entry => {
            const cloudModel = isCloudVoiceModel(entry.id) ? entry.id : null;
            const open = cloudModel !== null && expanded === cloudModel;
            const detail = cloudModel
              ? entry.available
                ? 'Connected'
                : 'Add your API key'
              : entry.available
                ? entry.detail
                : `${entry.detail} Not installed.`;
            return (
              <div key={entry.id} className="voice-model-item" data-open={open || undefined}>
                <button
                  type="button"
                  className="voice-model-option"
                  role="radio"
                  aria-checked={viewing === entry.id}
                  data-active={voiceModel === entry.id || undefined}
                  disabled={!entry.available && !cloudModel}
                  onClick={() => chooseModel(entry.id)}
                >
                  <Icon
                    name={cloudModel ? 'plug' : entry.expressions ? 'sparkles' : 'waveform'}
                    size={18}
                  />
                  <span className="voice-model-copy">
                    <strong>{entry.name}</strong>
                    <span data-connected={(cloudModel && entry.available) || undefined}>
                      {detail}
                    </span>
                  </span>
                  <span className="voice-model-trailing" aria-hidden="true">
                    <span className="voice-model-check">
                      {voiceModel === entry.id && <Icon name="check" size={16} />}
                    </span>
                    {cloudModel && (
                      <span className="voice-model-chevron">
                        <Icon name="chevron-down" size={14} />
                      </span>
                    )}
                  </span>
                </button>
                {open && cloudModel && (
                  <div className="voice-cloud-panel">
                    <p>{providerInfo[cloudModel].about}</p>
                    {entry.available ? (
                      <div className="voice-cloud-connected">
                        <span className="voice-cloud-status">
                          <Icon name="check" size={14} />
                          Key saved on this Mac
                        </span>
                        <span className="settings-actions">
                          <Button
                            size="small"
                            trailingIcon="arrow-up-right"
                            onClick={() => openKeys(cloudModel)}
                          >
                            Manage keys
                          </Button>
                          <Button size="small" onClick={() => void removeKey(cloudModel)}>
                            Remove
                          </Button>
                        </span>
                      </div>
                    ) : (
                      <form
                        className="voice-key-form"
                        onSubmit={event => {
                          event.preventDefault();
                          if (apiKey.trim().length >= 20 && !savingKey) void saveKey();
                        }}
                      >
                        <TextField
                          label="API key"
                          hideLabel
                          placeholder={`${providerName[cloudModel]} API key`}
                          aria-label={`${providerName[cloudModel]} API key`}
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          autoFocus
                          value={apiKey}
                          maxLength={256}
                          onChange={event => setApiKey(event.target.value)}
                        />
                        <Button
                          type="submit"
                          variant="prominent"
                          size="small"
                          disabled={apiKey.trim().length < 20 || savingKey}
                        >
                          {savingKey ? 'Checking…' : 'Save'}
                        </Button>
                        <p className="voice-key-hint" role={keyError ? 'alert' : undefined}>
                          {keyError || 'Stored encrypted on this Mac. '}
                          {!keyError && (
                            <button
                              type="button"
                              className="voice-key-link"
                              onClick={() => openKeys(cloudModel)}
                            >
                              Get a key
                              <Icon name="arrow-up-right" size={12} />
                            </button>
                          )}
                        </p>
                      </form>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {system === null && <p className="settings-prose">Checking voices…</p>}
        </div>
      </GroupedList>

      {model && (model.available || provider) && (!provider || hasKey) && (
        <GroupedList
          title={`${model.name} voice`}
          footer={message || cloudError || modelHelp(assistant)[viewing]}
        >
          {(splitByType || all.length > 12) && (
            <div className="voice-filter">
              {splitByType && (
                <SegmentedControl<VoiceType>
                  label="Voice type"
                  options={voiceTypes}
                  value={voiceType}
                  onChange={setVoiceType}
                />
              )}
              {all.length > 12 && (
                <TextField
                  label="Search voices"
                  aria-label="Search voices"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                />
              )}
            </div>
          )}
          {provider && !cloud && !cloudError && (
            <p className="settings-prose">Loading your voices…</p>
          )}
          {provider && cloud?.provider === provider && cloudVoices.length === 0 && (
            <div className="voice-cloud-empty">
              <p className="settings-prose">
                There are no voices on your {providerName[provider]} account yet. Create, clone or
                save one there, then check again.
              </p>
              <span className="settings-actions">
                <Button
                  size="small"
                  trailingIcon="arrow-up-right"
                  onClick={() =>
                    void window.edi?.command({
                      type: 'open-link',
                      url: providerInfo[provider].voicesUrl,
                    })
                  }
                >
                  Open {providerName[provider]}
                </Button>
                <Button size="small" onClick={() => setCloudReload(count => count + 1)}>
                  Check again
                </Button>
              </span>
            </div>
          )}
          <div className="voice-list" role="radiogroup" aria-label={`${model.name} voice`}>
            {shown.map(option => (
              <div
                key={option.id}
                className="voice-option"
                data-selected={chosen === option.id || undefined}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={chosen === option.id}
                  className="voice-option-choose"
                  onClick={() => onVoice(select(option.id))}
                >
                  <span className="voice-option-check" aria-hidden="true">
                    {chosen === option.id && <Icon name="check" size={14} />}
                  </span>
                  <span className="voice-model-copy">
                    <strong>{option.name}</strong>
                    <span>{option.detail}</span>
                  </span>
                </button>
                {removing === option.id ? (
                  <span className="settings-actions voice-remove-confirm">
                    <Button size="small" variant="plain" onClick={() => setRemoving(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="small"
                      variant="prominent"
                      onClick={() => {
                        setRemoving(null);
                        void window.edi
                          ?.command({ type: 'remove-personal-voice', id: option.id })
                          .then(onKeysChanged);
                      }}
                    >
                      Move to Trash
                    </Button>
                  </span>
                ) : (
                  <>
                    <IconButton
                      icon="play"
                      label={
                        previewing === option.id
                          ? `Playing ${option.name}`
                          : `Preview ${option.name}`
                      }
                      className="voice-preview"
                      data-playing={previewing === option.id || undefined}
                      disabled={previewing !== null}
                      onClick={() => void preview(option.id)}
                    />
                    {personal.some(voice => voice.id === option.id) && (
                      <IconButton
                        icon="trash"
                        label={`Remove ${option.name}`}
                        className="voice-preview"
                        onClick={() => setRemoving(option.id)}
                      />
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          {viewing === 'chatterbox-turbo' && model.available && (
            <div className="voice-add">
              {adding ? (
                <form
                  className="voice-add-form"
                  onSubmit={event => {
                    event.preventDefault();
                    void addVoice();
                  }}
                >
                  <TextField
                    label="Voice name"
                    placeholder="Name, like Edi"
                    maxLength={40}
                    autoFocus
                    value={newName}
                    onChange={event => setNewName(event.target.value)}
                  />
                  <label className="voice-consent">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={event => setConsent(event.target.checked)}
                    />
                    This is my voice, or the person speaking agreed to {assistant} using it.
                  </label>
                  <p className="settings-prose">
                    Choose at least 6 seconds of clear speech with no music. The recording stays on
                    this Mac.
                  </p>
                  {addError && (
                    <p className="voice-add-error" role="alert">
                      {addError}
                    </p>
                  )}
                  <span className="settings-actions">
                    <Button size="small" variant="plain" type="button" onClick={closeAdd}>
                      Cancel
                    </Button>
                    <Button
                      size="small"
                      variant="prominent"
                      type="submit"
                      disabled={!newName.trim() || !consent || choosing}
                    >
                      {choosing ? 'Adding…' : 'Choose Recording…'}
                    </Button>
                  </span>
                </form>
              ) : (
                <span className="settings-actions">
                  <Button size="small" onClick={() => setAdding(true)}>
                    Add Voice…
                  </Button>
                  {addedName && (
                    <span className="voice-added">
                      Added {addedName}. {assistant} speaks with it now.
                    </span>
                  )}
                </span>
              )}
            </div>
          )}
        </GroupedList>
      )}

      <GroupedList
        title="Listening"
        footer={
          cartesiaKey
            ? voiceInput === 'cartesia'
              ? 'While you talk, your microphone audio goes to Cartesia to be turned into words, billed to your account. If Cartesia can’t be reached, this Mac takes over.'
              : 'Your voice is turned into words on this Mac and never leaves it.'
            : 'Your voice is turned into words on this Mac. Add a Cartesia key above to use Cartesia’s faster live transcription instead.'
        }
      >
        <GroupedRow
          title="Speech recognition"
          control={
            <SegmentedControl<ListeningLabel>
              label="Speech recognition"
              options={cartesiaKey ? listeningLabels : [listeningLabels[0]]}
              value={cartesiaKey && voiceInput === 'cartesia' ? 'Cartesia' : 'This Mac'}
              onChange={label => onVoiceInput(label === 'Cartesia' ? 'cartesia' : 'local')}
            />
          }
        />
      </GroupedList>

      <GroupedList
        title="Words to recognize"
        footer={`Names of people, companies and projects you mention, separated by commas. ${assistant} listens for them on this Mac${voiceInput === 'cartesia' && cartesiaKey ? ' (Cartesia recognition doesn’t use this list)' : ''}.`}
      >
        <div className="voice-words">
          <TextField
            label="Words to recognize"
            hideLabel
            placeholder="Skaletek, Glown, Sarah"
            value={wordsDraft}
            onChange={event => setWordsDraft(event.target.value)}
            onBlur={saveWords}
            onKeyDown={event => {
              if (event.key === 'Enter') saveWords();
            }}
          />
        </div>
      </GroupedList>

      <GroupedList footer="When this is off, answers to spoken questions show up in Conversations instead of being read aloud.">
        <GroupedRow
          title="Speak replies"
          control={
            <Switch label="Speak replies" checked={speakReplies} onChange={onSpeakReplies} />
          }
        />
      </GroupedList>
    </div>
  );
}
