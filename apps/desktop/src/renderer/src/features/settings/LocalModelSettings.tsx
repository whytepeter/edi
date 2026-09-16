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

  /** A pack row: what it costs to download, how far it got, and the one thing to do next. */
  const packRow = (pack: LocalPackStatus) => {
    const action =
      pack.state === 'downloading'
        ? { label: 'Pause', act: 'pause' as const }
        : pack.state === 'installed'
          ? { label: 'Remove', act: 'remove' as const }
          : { label: pack.state === 'paused' ? 'Resume' : 'Download', act: 'download' as const };
    const detail =
      pack.state === 'installed'
        ? 'On this Mac'
        : pack.state === 'failed'
          ? (pack.error ?? 'The download stopped.')
          : pack.state === 'paused'
            ? `Paused at ${size(pack.received)} of ${size(pack.bytes)}`
            : pack.state === 'downloading'
              ? undefined
              : `${size(pack.bytes)} to download`;
    return (
      <GroupedRow
        key={pack.id}
        title={pack.name}
        detail={
          pack.state === 'downloading' ? (
            <span className="pack-progress">
              <progress max={pack.bytes} value={pack.received} aria-label="Download progress" />
              <span>{`${size(pack.received)} of ${size(pack.bytes)}`}</span>
            </span>
          ) : (
            detail
          )
        }
        control={
          <Button size="small" onClick={() => send(action.act, pack.id)}>
            {action.label}
          </Button>
        }
      />
    );
  };

  const models = state?.models ?? [];
  const running = (state?.runtimes ?? [])
    .filter(runtime => runtime.running)
    .map(runtime => localRuntimeNames[runtime.id]);
  const chosenMissing = state !== null && model && !models.some(entry => entry.id === model);
  const modelRow = (option: LocalModelOption) => (
    <GroupedRow
      key={option.id}
      title={option.name}
      detail={`${localRuntimeNames[option.runtime]} · ${abilities(option)}`}
      value={option.id === model ? 'Chosen' : undefined}
      onOpen={() => onChange(option.id === model ? null : option.id, use)}
    />
  );
  const checkRow = (
    <GroupedRow title={checking ? 'Checking…' : 'Check again'} onOpen={() => void look(true)} />
  );

  // Nothing here yet: one section that offers a model, rather than an empty list above a list.
  if (state !== null && models.length === 0)
    return (
      <GroupedList
        title="On this Mac"
        footer={
          running.length
            ? `Edi runs these itself, free and offline. A model added in ${running.join(' or ')} shows up here too.`
            : 'Edi runs these itself, with nothing else to install. Free, offline, and nothing you ask them goes online.'
        }
      >
        {state.packs.map(packRow)}
        {checkRow}
      </GroupedList>
    );

  return (
    <>
      <GroupedList
        title="On this Mac"
        footer="Free, and works offline. Edi needs a model that sees images and uses tools; a limited one answers in words only."
      >
        {state === null ? <GroupedRow title="Looking for models on this Mac…" /> : null}
        {models.map(modelRow)}
        {chosenMissing && (
          <GroupedRow
            icon="info"
            title="Your chosen model isn’t available right now"
            detail="Download it again, or choose another."
          />
        )}
        {checkRow}
      </GroupedList>

      {state !== null && state.packs.some(pack => pack.state !== 'installed') && (
        <GroupedList
          title="Download a model"
          footer="Edi runs these itself, with nothing else to install. They stay on this Mac, and nothing you ask them goes online."
        >
          {state.packs.filter(pack => pack.state !== 'installed').map(packRow)}
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
