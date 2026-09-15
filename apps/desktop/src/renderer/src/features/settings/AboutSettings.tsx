import { GroupedList, GroupedRow } from '../../components/ui';
import './settings.css';
import type { SystemInfo } from '@edi/contracts';

/**
 * Open-source parts Edi ships and where their source is. eSpeak NG is GPL-3.0: anyone who has
 * Edi may have its source, so its exact version is named here and it runs as its own program.
 */
const licences = [
  {
    name: 'eSpeak NG 1.52.0',
    does: 'Says how words are pronounced',
    licence: 'GPL-3.0',
    url: 'https://github.com/espeak-ng/espeak-ng/tree/1.52.0',
  },
  {
    name: 'Kokoro 82M',
    does: 'The voice on this Mac',
    licence: 'Apache-2.0',
    url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX',
  },
  {
    name: 'whisper.cpp',
    does: 'Hears what you say, on this Mac',
    licence: 'MIT',
    url: 'https://github.com/ggml-org/whisper.cpp',
  },
  {
    name: 'Silero VAD',
    does: 'Tells your voice from other sound',
    licence: 'MIT',
    url: 'https://github.com/snakers4/silero-vad',
  },
];

/** Settings → About Edi. */
export function AboutSettings({ system }: { system: SystemInfo | null }) {
  const open = (url: string) => void window.edi?.command({ type: 'open-link', url });
  return (
    <div className="settings-page">
      <GroupedList>
        <GroupedRow title="Version" value={system?.version ?? '—'} />
        <GroupedRow
          title="Workspace folder"
          detail={system?.workspaceFolder ?? 'Documents › Edi'}
        />
      </GroupedList>

      <GroupedList
        title="Open source"
        footer="Edi runs these on your Mac. Each one’s source is at the link, including the exact version Edi ships."
      >
        {licences.map(part => (
          <GroupedRow
            key={part.name}
            title={part.name}
            detail={part.does}
            value={part.licence}
            onOpen={() => open(part.url)}
          />
        ))}
      </GroupedList>
    </div>
  );
}
