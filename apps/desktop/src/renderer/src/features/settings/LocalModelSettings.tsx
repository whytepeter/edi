import { useEffect, useState } from 'react';
import {
  localRuntimeNames,
  type LocalModelOption,
  type LocalModelsState,
  type LocalModelUse,
} from '@edi/contracts';
import { GroupedList, GroupedRow, Switch } from '../../components/ui';

/** What the model can do for Edi, in the words the row shows. */
function abilities(model: LocalModelOption) {
  if (model.vision && model.tools) return 'Sees your screen · Uses tools';
  const missing = [!model.vision && 'can’t see your screen', !model.tools && 'can’t use tools']
    .filter(Boolean)
    .join(', ');
  return `Limited: ${missing}`;
}

/**
 * Settings → AI › On this Mac: models Ollama or LM Studio serve locally. One can be the backup
 * when OpenRouter can't answer (offline, out of credits, no key), or answer every question.
 */
export function LocalModelSettings({
  model,
  use,
  onChange,
}: {
  model: string | null;
  use: LocalModelUse;
  onChange: (model: string | null, use: LocalModelUse) => void;
}) {
  const [state, setState] = useState<LocalModelsState | null>(null);
  const [checking, setChecking] = useState(false);

  async function look(fresh: boolean) {
    if (!window.edi) return;
    setChecking(true);
    try {
      setState(await window.edi.localModels(fresh));
    } catch {
      setState({ runtimes: [], models: [] });
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    window.edi.localModels(false).then(
      next => alive && setState(next),
      () => alive && setState({ runtimes: [], models: [] }),
    );
    return () => {
      alive = false;
    };
  }, []);

  const running = (state?.runtimes ?? [])
    .filter(runtime => runtime.running)
    .map(runtime => localRuntimeNames[runtime.id]);
  const chosenMissing = state !== null && model && !state.models.some(entry => entry.id === model);

  return (
    <>
      <GroupedList
        title="On this Mac"
        footer="Free, and works offline. Edi needs a model that sees images and uses tools; a limited one answers in words only."
      >
        {state === null ? (
          <GroupedRow title="Looking for Ollama and LM Studio…" />
        ) : state.models.length === 0 ? (
          <GroupedRow
            icon="info"
            title={
              running.length ? `${running.join(' and ')} has no models yet` : 'No models found'
            }
            detail={
              running.length
                ? 'Download a model that sees images and uses tools, such as qwen2.5vl in Ollama.'
                : 'Install Ollama or LM Studio and download a model, then check again.'
            }
          />
        ) : (
          state.models.map(option => (
            <GroupedRow
              key={option.id}
              title={option.name}
              detail={`${localRuntimeNames[option.runtime]} · ${abilities(option)}`}
              value={option.id === model ? 'Chosen' : undefined}
              onOpen={() => onChange(option.id === model ? null : option.id, use)}
            />
          ))
        )}
        {chosenMissing && (
          <GroupedRow
            icon="info"
            title="Your chosen model isn’t available right now"
            detail="Open Ollama or LM Studio, or choose another model."
          />
        )}
        <GroupedRow title={checking ? 'Checking…' : 'Check again'} onOpen={() => void look(true)} />
      </GroupedList>

      {model && (
        <GroupedList
          footer={
            use === 'main'
              ? 'Every question goes to the model on this Mac. OpenRouter isn’t used.'
              : 'Edi uses it when OpenRouter can’t answer: offline, out of credits, or no key.'
          }
        >
          <GroupedRow
            title="Use for every question"
            control={
              <Switch
                label="Use the model on this Mac for every question"
                checked={use === 'main'}
                onChange={on => onChange(model, on ? 'main' : 'backup')}
              />
            }
          />
        </GroupedList>
      )}
    </>
  );
}
