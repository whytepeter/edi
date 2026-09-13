import { useState } from 'react';
import {
  voiceCatalog,
  voiceSelectionSchema,
  type SystemInfo,
  type VoiceChoices,
  type VoiceModelId,
  type VoiceOption,
  type VoiceSelection,
} from '@edi/contracts';
import {
  GroupedList,
  GroupedRow,
  Icon,
  IconButton,
  SegmentedControl,
  Switch,
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
};

type VoiceType = 'Female' | 'Male';
const voiceTypes: readonly VoiceType[] = ['Female', 'Male'];

/**
 * Settings → Voice. First the speech model (the engine), then the voice within it. Each model
 * remembers its own voice. Changing the voice never changes Edi's personality.
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
  const [voiceType, setVoiceType] = useState<VoiceType>('Female');
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const selectedModel = system?.voice.models.find(model => model.id === voiceModel);
  const options = voiceCatalog[voiceModel] as readonly VoiceOption[];
  const splitByType = new Set(options.map(option => option.gender)).size > 1;
  const shown = splitByType ? options.filter(option => option.gender === voiceType) : options;
  const chosen = voices[voiceModel];
  const select = (voice: string) => voiceSelectionSchema.parse({ model: voiceModel, voice });

  async function preview(voice: string) {
    setPreviewing(voice);
    setPreviewError('');
    try {
      await onPreview(select(voice));
    } catch {
      setPreviewError('Couldn’t play that sample. Try again when Edi isn’t speaking.');
    } finally {
      setPreviewing(null);
    }
  }

  return (
    <div className="settings-page">
      <GroupedList
        title="Speech model"
        footer="Recording, transcription and speech run on this Mac. The recording itself never leaves it."
      >
        <div className="voice-model-list" role="radiogroup" aria-label="Speech model">
          {(system?.voice.models ?? []).map(model => (
            <button
              key={model.id}
              type="button"
              className="voice-model-option"
              role="radio"
              aria-checked={voiceModel === model.id}
              disabled={!model.available}
              onClick={() => onVoiceModel(model.id)}
            >
              <Icon name={model.expressions ? 'sparkles' : 'waveform'} size={18} />
              <span className="voice-model-copy">
                <strong>{model.name}</strong>
                <span>{model.available ? model.detail : `${model.detail} Not installed.`}</span>
              </span>
              {voiceModel === model.id && <Icon name="check" size={16} />}
            </button>
          ))}
          {system === null && <p className="settings-prose">Checking local voices…</p>}
        </div>
      </GroupedList>

      {selectedModel?.available && (
        <GroupedList
          title={`${selectedModel.name} voice`}
          footer={previewError || modelHelp[voiceModel]}
        >
          {splitByType && (
            <div className="voice-filter">
              <SegmentedControl<VoiceType>
                label="Voice type"
                options={voiceTypes}
                value={voiceType}
                onChange={setVoiceType}
              />
            </div>
          )}
          <div className="voice-list" role="radiogroup" aria-label={`${selectedModel.name} voice`}>
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
                    <span>{option.accent}</span>
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
