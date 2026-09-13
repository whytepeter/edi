import { useEffect, useState } from 'react';
import {
  isCloudVoiceModel,
  voiceCatalog,
  voiceSelectionSchema,
  type CloudProviderId,
  type SystemInfo,
  type VoiceChoices,
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

interface VoiceSettingsProps {
  system: SystemInfo | null;
  voiceModel: VoiceModelId;
  voices: VoiceChoices;
  speakReplies: boolean;
  onVoiceModel(model: VoiceModelId): void;
  onVoice(selection: VoiceSelection): void;
  onPreview(selection: VoiceSelection): Promise<void>;
  onSpeakReplies(enabled: boolean): void;
}

const modelHelp: Record<VoiceModelId, string> = {
  kokoro: 'Choose who Edi sounds like. Play a sample before you pick.',
  pocket: 'Pocket offers Jane, a clear American voice.',
  'chatterbox-turbo':
    'Calm is steadier and softer; Expressive is livelier. Both can laugh or sigh when Edi means to.',
  cartesia: 'Voices from your Cartesia account, including ones you created there.',
  elevenlabs: 'Voices from your ElevenLabs account, including ones you added there.',
};
const providerName: Record<CloudProviderId, string> = {
  cartesia: 'Cartesia',
  elevenlabs: 'ElevenLabs',
};

/** What each cloud voice is, what it costs and what it sees, with where to get a key. */
const providerInfo: Record<
  CloudProviderId,
  { about: string; model: string; keyUrl: string; steps: string }
> = {
  cartesia: {
    about:
      'Cartesia makes very fast, natural voices, and you can design or clone your own voice there.',
    model: 'Edi uses Sonic 3.6, streamed as Edi speaks.',
    keyUrl: 'https://play.cartesia.ai/keys',
    steps: 'Sign in to Cartesia, open API Keys, create a key, then paste it here.',
  },
  elevenlabs: {
    about:
      'ElevenLabs has a large library of expressive voices, and voices you add to your account appear here too.',
    model: 'Edi uses Flash v2.5, their lowest-latency model.',
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    steps: 'Sign in to ElevenLabs, open Developers → API Keys, create a key, then paste it here.',
  },
};

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
  onVoiceModel,
  onVoice,
  onPreview,
  onSpeakReplies,
}: VoiceSettingsProps) {
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
  const [apiKey, setApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);

  const models = system?.voice.models ?? [];
  const model = models.find(entry => entry.id === viewing);
  const provider = isCloudVoiceModel(viewing) ? viewing : null;
  const hasKey = Boolean(provider && model?.available);

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
            detail:
              [voice.mine ? 'Your voice' : null, voice.accent, voice.description]
                .filter(Boolean)
                .join(' · ') || 'Voice',
            gender: voice.gender,
          })),
        });
      })
      .catch(() => alive && setCloudError(`Couldn’t load your ${providerName[provider]} voices.`));
    return () => {
      alive = false;
    };
  }, [provider, hasKey]);

  const local: ListedVoice[] = provider
    ? []
    : voiceCatalog[viewing].map(voice => ({
        id: voice.id,
        name: voice.name,
        detail: voice.accent,
        gender: voice.gender,
      }));
  const all = provider ? (cloud?.provider === provider ? cloud.voices : []) : local;
  const splitByType =
    all.some(voice => voice.gender === 'Female') && all.some(voice => voice.gender === 'Male');
  const shown = all
    .filter(voice => !splitByType || voice.gender === voiceType || voice.gender === null)
    .filter(voice => !query || voice.name.toLowerCase().includes(query.trim().toLowerCase()));
  const chosen = voiceModel === viewing ? voices[viewing] : null;
  const select = (voice: string) => voiceSelectionSchema.parse({ model: viewing, voice });

  function chooseModel(next: VoiceModelId) {
    setViewing(next);
    setQuery('');
    setMessage('');
    setApiKey('');
    const entry = models.find(item => item.id === next);
    // Local models and cloud models with a saved voice switch right away.
    if (entry?.available && (!isCloudVoiceModel(next) || voices[next])) onVoiceModel(next);
  }

  async function preview(voice: string) {
    setPreviewing(voice);
    setMessage('');
    try {
      await onPreview(select(voice));
    } catch {
      setMessage('Couldn’t play that sample. Try again when Edi isn’t speaking.');
    } finally {
      setPreviewing(null);
    }
  }

  async function saveKey() {
    if (!provider || !window.edi) return;
    setSavingKey(true);
    setMessage('');
    try {
      await window.edi.command({ type: 'set-voice-key', provider, apiKey: apiKey.trim() });
      setApiKey('');
    } catch {
      setMessage(`${providerName[provider]} didn’t accept that key. Check it and try again.`);
    } finally {
      setSavingKey(false);
    }
  }

  return (
    <div className="settings-page">
      <GroupedList
        title="Speech model"
        footer="Local models run on this Mac. Cloud voices send only the words Edi speaks to that provider, using your account."
      >
        <div className="voice-model-list" role="radiogroup" aria-label="Speech model">
          {models.map(entry => {
            const cloudModel = isCloudVoiceModel(entry.id);
            return (
              <button
                key={entry.id}
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
                  <span>
                    {entry.available || cloudModel
                      ? entry.detail
                      : `${entry.detail} Not installed.`}
                  </span>
                </span>
                {voiceModel === entry.id && <Icon name="check" size={16} />}
              </button>
            );
          })}
          {system === null && <p className="settings-prose">Checking voices…</p>}
        </div>
      </GroupedList>

      {provider && (
        <GroupedList title={`About ${providerName[provider]}`}>
          <div className="voice-provider-info">
            <p>{providerInfo[provider].about}</p>
            <ul>
              <li>{providerInfo[provider].model}</li>
              <li>
                Only the words Edi speaks are sent to {providerName[provider]}. Your recordings,
                screen and conversation stay on this Mac.
              </li>
              <li>Speech uses credits on your {providerName[provider]} account.</li>
            </ul>
            {!hasKey && <p className="voice-provider-steps">{providerInfo[provider].steps}</p>}
            <Button
              size="small"
              trailingIcon="arrow-up-right"
              onClick={() =>
                void window.edi?.command({ type: 'open-link', url: providerInfo[provider].keyUrl })
              }
            >
              {hasKey
                ? `Manage ${providerName[provider]} keys`
                : `Get a ${providerName[provider]} API key`}
            </Button>
          </div>
        </GroupedList>
      )}

      {provider && !hasKey && (
        <GroupedList
          title={`${providerName[provider]} key`}
          footer={
            message ||
            `Stored encrypted on this Mac and only sent to ${providerName[provider]}. Speech uses your account’s credits.`
          }
        >
          <div className="settings-form voice-key-form">
            <TextField
              label="API key"
              aria-label={`${providerName[provider]} API key`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              maxLength={256}
              onChange={event => setApiKey(event.target.value)}
            />
            <Button
              variant="prominent"
              size="small"
              disabled={apiKey.trim().length < 20 || savingKey}
              onClick={() => void saveKey()}
            >
              {savingKey ? 'Checking…' : 'Save key'}
            </Button>
          </div>
        </GroupedList>
      )}

      {provider && hasKey && (
        <GroupedList title={`${providerName[provider]} key`}>
          <GroupedRow
            icon="shield"
            title="Key saved"
            detail="Saved securely on this Mac"
            control={
              <Button
                size="small"
                onClick={() => void window.edi?.command({ type: 'forget-voice-key', provider })}
              >
                Remove
              </Button>
            }
          />
        </GroupedList>
      )}

      {model && (model.available || provider) && (!provider || hasKey) && (
        <GroupedList
          title={`${model.name} voice`}
          footer={message || cloudError || modelHelp[viewing]}
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
                <IconButton
                  icon="play"
                  label={
                    previewing === option.id ? `Playing ${option.name}` : `Preview ${option.name}`
                  }
                  className="voice-preview"
                  data-playing={previewing === option.id || undefined}
                  disabled={previewing !== null}
                  onClick={() => void preview(option.id)}
                />
              </div>
            ))}
          </div>
        </GroupedList>
      )}

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
