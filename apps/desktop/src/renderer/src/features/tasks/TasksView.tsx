import { useState, type FormEvent } from 'react';
import { isActiveTask, type ArtifactRef, type Task, type TaskStatus } from '@edi/contracts';
import { Button, EmptyState, Icon, IconButton } from '../../components/ui';
import { ReplyText } from '../../components/ReplyText';
import { ActionTrail } from '../../components/ActionTrail';
import { useTasks } from '../../hooks/useTasks';
import './tasks.css';

const statusLabel: Record<TaskStatus, string> = {
  queued: 'Waiting to start',
  running: 'Working',
  waiting: 'Needs your OK',
  limited: 'Paused at its cap',
  done: 'Done',
  failed: 'Didn’t finish',
  cancelled: 'Stopped',
  interrupted: 'Interrupted',
};
const money = (usd: number) => `$${usd < 1 ? usd.toFixed(2) : usd.toFixed(2).replace(/\.00$/, '')}`;

/** Tasks: hand Edi longer work, watch it, and read what it found. */
export function TasksView({
  defaultBudgetUsd,
  onOpenArtifact,
  onOpenUsage,
}: {
  defaultBudgetUsd: number;
  onOpenArtifact(ref: ArtifactRef): void;
  onOpenUsage(): void;
}) {
  const tasks = useTasks();
  const [draft, setDraft] = useState('');
  const [budget, setBudget] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cap = budget === '' ? defaultBudgetUsd : Number(budget);
  const capValid = Number.isFinite(cap) && cap >= 0.05 && cap <= 50;

  async function send(command: Parameters<NonNullable<typeof window.edi>['command']>[0]) {
    setError('');
    try {
      await window.edi?.command(command);
      return true;
    } catch {
      setError('That didn’t work. Check your AI setup and try again.');
      return false;
    }
  }

  async function start(event: FormEvent) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || !capValid || busy) return;
    setBusy(true);
    if (await send({ type: 'start-task', prompt, budgetUsd: cap })) {
      setDraft('');
      setBudget('');
    }
    setBusy(false);
  }

  const active = tasks?.filter(task => isActiveTask(task.status)) ?? [];
  const finished = tasks?.filter(task => !isActiveTask(task.status)) ?? [];

  return (
    <div className="tasks-view">
      <form className="task-composer ds-glass" onSubmit={event => void start(event)}>
        <label htmlFor="task-draft" className="ds-visually-hidden">
          What should Edi work on?
        </label>
        <textarea
          id="task-draft"
          className="ds-input"
          rows={2}
          maxLength={8000}
          placeholder="What should Edi work on in the background?"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void start(event);
          }}
        />
        <div className="task-composer-row">
          <label className="task-cap">
            <span>Up to $</span>
            <input
              type="number"
              inputMode="decimal"
              min={0.05}
              max={50}
              step={0.05}
              aria-label="Spending cap in dollars"
              placeholder={defaultBudgetUsd.toFixed(2)}
              value={budget}
              aria-invalid={!capValid || undefined}
              onChange={event => setBudget(event.target.value)}
            />
          </label>
          <Button
            type="submit"
            variant="prominent"
            size="small"
            disabled={!draft.trim() || !capValid || busy}
          >
            Start task
          </Button>
        </div>
        <p className="task-composer-hint">
          Default cap {money(defaultBudgetUsd)} ·{' '}
          <button type="button" onClick={onOpenUsage}>
            Change
          </button>
        </p>
      </form>

      {error && (
        <p role="alert" className="task-error">
          {error}
        </p>
      )}

      {tasks === null ? (
        <p className="ds-footnote ds-secondary">Loading…</p>
      ) : tasks.length === 0 ? (
        <EmptyState icon="tasks" title="Hand Edi longer work.">
          <p className="ds-body ds-secondary">
            Tasks keep going while you do other things: “find senior frontend roles posted this
            week”, or “sort my Downloads into folders”. Or ask in a conversation to do something in
            the background.
          </p>
        </EmptyState>
      ) : (
        <>
          {active.length > 0 && (
            <section className="task-group" aria-label="Active tasks">
              <h2 className="ds-group-title">Active</h2>
              {active.map(task => (
                <TaskCard key={task.id} task={task} send={send} onOpenArtifact={onOpenArtifact} />
              ))}
            </section>
          )}
          {finished.length > 0 && (
            <section className="task-group" aria-label="Finished tasks">
              <h2 className="ds-group-title">Finished</h2>
              {finished.map(task => (
                <TaskCard key={task.id} task={task} send={send} onOpenArtifact={onOpenArtifact} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function TaskCard({
  task,
  send,
  onOpenArtifact,
}: {
  task: Task;
  send(command: Parameters<NonNullable<typeof window.edi>['command']>[0]): Promise<boolean>;
  onOpenArtifact(ref: ArtifactRef): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const active = isActiveTask(task.status);
  const share = Math.min(1, task.budgetUsd > 0 ? task.spentUsd / task.budgetUsd : 0);
  const approval = task.approval;
  return (
    <article className="task-card" data-status={task.status}>
      <header className="task-card-head">
        <span className="task-card-title">{task.title}</span>
        <span className="task-status" data-status={task.status}>
          {statusLabel[task.status]}
        </span>
      </header>
      {task.progress && task.status !== 'done' && <p className="task-progress">{task.progress}</p>}
      <div className="task-spend" title="Spent of this task's cap">
        <span className="task-spend-bar">
          <i style={{ width: `${Math.max(2, share * 100)}%` }} />
        </span>
        <span>
          {money(task.spentUsd)} of {money(task.budgetUsd)}
        </span>
      </div>

      {approval && (
        <div className="task-approval" role="group" aria-label="Review">
          <p>{approval.preview.summary}</p>
          <div className="task-actions">
            <Button
              size="small"
              onClick={() =>
                void send({ type: 'respond-approval', callId: approval.callId, decision: 'deny' })
              }
            >
              Deny
            </Button>
            <Button
              size="small"
              onClick={() =>
                void send({
                  type: 'respond-approval',
                  callId: approval.callId,
                  decision: 'approve-always',
                })
              }
            >
              Always allow
            </Button>
            <Button
              size="small"
              variant="prominent"
              onClick={() =>
                void send({
                  type: 'respond-approval',
                  callId: approval.callId,
                  decision: 'approve',
                })
              }
            >
              {approval.preview.action}
            </Button>
          </div>
        </div>
      )}

      {task.status === 'limited' && (
        <div className="task-approval" role="group" aria-label="Spending cap reached">
          <p>It has spent its {money(task.budgetUsd)} cap and is waiting before its next step.</p>
          <div className="task-actions">
            <Button size="small" onClick={() => void send({ type: 'stop-task', id: task.id })}>
              Stop
            </Button>
            <Button
              size="small"
              variant="prominent"
              onClick={() =>
                void send({
                  type: 'raise-task-budget',
                  id: task.id,
                  addUsd: Math.max(0.05, Math.min(50, task.budgetUsd)),
                })
              }
            >
              Allow {money(Math.max(0.05, Math.min(50, task.budgetUsd)))} more
            </Button>
          </div>
        </div>
      )}

      {task.error && task.status !== 'cancelled' && <p className="task-error">{task.error}</p>}

      {task.result && (
        <div className="task-result" data-expanded={expanded || undefined}>
          <p className="task-result-text">
            <ReplyText text={task.result} />
          </p>
          {task.result.length > 240 && (
            <button
              type="button"
              className="task-more"
              onClick={() => setExpanded(value => !value)}
            >
              {expanded ? 'Show less' : 'Show all'}
            </button>
          )}
        </div>
      )}
      {task.artifactIds.length > 0 && (
        <div className="task-artifacts">
          {task.artifactIds.map((id, index) => (
            <Button
              key={id}
              size="small"
              trailingIcon="chevron-right"
              onClick={() => onOpenArtifact({ callId: id })}
            >
              {task.artifactIds.length === 1 ? 'Open result' : `Open result ${index + 1}`}
            </Button>
          ))}
        </div>
      )}

      <ActionTrail
        steps={task.steps}
        working={task.status === 'running' || task.status === 'waiting'}
      />

      <footer className="task-card-foot">
        {active && task.status !== 'limited' ? (
          <Button size="small" onClick={() => void send({ type: 'stop-task', id: task.id })}>
            <Icon name="stop" size={12} />
            Stop
          </Button>
        ) : !active && confirming ? (
          <span className="task-confirm">
            Delete this task and its history?
            <Button size="small" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              size="small"
              variant="prominent"
              onClick={() => void send({ type: 'delete-task', id: task.id })}
            >
              Delete
            </Button>
          </span>
        ) : !active ? (
          <IconButton
            icon="trash"
            label={`Delete ${task.title}`}
            onClick={() => setConfirming(true)}
          />
        ) : null}
      </footer>
    </article>
  );
}
