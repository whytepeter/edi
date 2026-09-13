import type { SystemInfo, VoiceModelId } from '@edi/contracts';
import { Icon, Switch, GroupedList, GroupedRow } from '../../components/ui';
import './settings.css';

interface VoiceSettingsProps {
  system: SystemInfo | null;
  voiceModel: VoiceModelId;
  speakReplies: boolean;
  onVoiceModel(model: VoiceModelId): void;
  onSpeakReplies(enabled: boolean): void;
}

/** Settings → Voice. Selection changes only the local speech engine, never personality. */
export function VoiceSettings({
  system,
  voiceModel,
  speakReplies,
  onVoiceModel,
  onSpeakReplies,
}: VoiceSettingsProps) {
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
