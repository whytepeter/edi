import { useEffect, useState } from 'react';
import {
  localRuntimeNames,
  type LocalModelOption,
  type LocalModelsState,
  type LocalModelUse,
  type LocalPackStatus,
} from '@edi/contracts';
import { Button, GroupedList, GroupedRow, Switch } from '../../components/ui';

/** What the model can do for Edi, in the words the row shows. */
function abilities(model: LocalModelOption) {
  if (model.vision && model.tools) return 'Sees your screen · Uses tools';
  const missing = [!model.vision && 'can’t see your screen', !model.tools && 'can’t use tools']
    .filter(Boolean)
    .join(', ');
  return `Limited: ${missing}`;
}

const size = (bytes: number) => `${(bytes / 1_000_000_000).toFixed(1)} GB`;

/** Where a download has got to, in the words the row shows. */
function packDetail(pack: LocalPackStatus) {
  if (pack.state === 'installed') return 'On this Mac';
  if (pack.state === 'downloading')
    return `${size(pack.received)} of ${size(pack.bytes)} · Downloading`;
  if (pack.state === 'paused') return `${size(pack.received)} of ${size(pack.bytes)} · Paused`;
  if (pack.state === 'failed') return pack.error ?? 'The download stopped.';
  return `${size(pack.bytes)} to download`;
}

/**
 * Settings → AI › On this Mac. Edi can download a model and run it itself, with nothing else to
 * install; models Ollama or LM Studio already serve are offered too. The chosen one backs
 * OpenRouter up when it can't answer, or answers every question.
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
      setState({ runtimes: [], models: [], packs: [] });
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    window.edi.localModels(false).then(
      next => alive && setState(next),
      () => alive && setState({ runtimes: [], models: [], packs: [] }),
    );
    return () => {
      alive = false;
    };
  }, []);

  // While something is downloading, the rows follow it.
  const downloading = state?.packs.some(pack => pack.state === 'downloading') ?? false;
  useEffect(() => {
    if (!downloading || !window.edi) return;
    let alive = true;
    const timer = setInterval(() => {
      void window.edi?.localModels().then(next => alive && setState(next));
    }, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [downloading]);

  const send = (action: 'download' | 'pause' | 'remove', id: LocalPackStatus['id']) => {
    void window.edi?.command({ type: 'local-pack', action, id }).then(
      () => void look(false),
      () => {},
    );
  };

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
          <GroupedRow title="Looking for models on this Mac…" />
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
        {state !== null && state.models.length === 0 && (
          <GroupedRow
            icon="info"
            title="No model on this Mac yet"
            detail={
              running.length
                ? `Download one below, or add a model in ${running.join(' or ')}.`
                : 'Download one below.'
            }
          />
        )}
        {chosenMissing && (
          <GroupedRow
            icon="info"
            title="Your chosen model isn’t available right now"
            detail="Download it again, or choose another."
          />
        )}
        <GroupedRow title={checking ? 'Checking…' : 'Check again'} onOpen={() => void look(true)} />
      </GroupedList>

      {state !== null && state.packs.length > 0 && (
        <GroupedList
          title="Download a model"
          footer="Edi runs these itself, with nothing else to install. They stay on this Mac, and nothing you ask them goes online."
        >
          {state.packs.map(pack => (
            <GroupedRow
              key={pack.id}
              title={pack.name}
              detail={packDetail(pack)}
              control={
                pack.state === 'downloading' ? (
                  <Button size="small" onClick={() => send('pause', pack.id)}>
                    Pause
                  </Button>
                ) : pack.state === 'installed' ? (
                  <Button size="small" onClick={() => send('remove', pack.id)}>
                    Remove
                  </Button>
                ) : (
                  <Button size="small" onClick={() => send('download', pack.id)}>
                    {pack.state === 'paused' ? 'Resume' : 'Download'}
                  </Button>
                )
              }
            />
          ))}
        </GroupedList>
      )}

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
