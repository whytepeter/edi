import { useEffect, useState, type FormEvent } from 'react';
import {
  describeWhen,
  unattendedSummary,
  weekdaySchema,
  type Schedule,
  type ScheduleWhen,
  type Task,
  type Weekday,
} from '@edi/contracts';
import { Button, Icon, IconButton, Switch } from '../../components/ui';
import { lastRun, untilLabel } from '../../lib/schedule-text';

type Send = (command: Parameters<NonNullable<typeof window.edi>['command']>[0]) => Promise<boolean>;

const dayLetters: Record<Weekday, string> = {
  mon: 'M',
  tue: 'T',
  wed: 'W',
  thu: 'T',
  fri: 'F',
  sat: 'S',
  sun: 'S',
};
const dayNames: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};
/** Monday first, as a week is read. */
const week: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const allDays = weekdaySchema.options;

/** The clock, refreshed twice a minute, so "in 12 min" stays true while the card is open. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * One schedule: what it does, when it runs next, how its last run went, and everything that can
 * be done with it without leaving the card: run it now, change it, pause it, let it act on its
 * own, or remove it.
 */
export function ScheduleCard({
  schedule,
  tasks,
  send,
  onOpenRun,
}: {
  schedule: Schedule;
  tasks: readonly Task[];
  send: Send;
  /** Scrolls to the run's result below. */
  onOpenRun(task: Task): void;
}) {
  const now = useNow();
  const [mode, setMode] = useState<'view' | 'edit' | 'remove'>('view');
  const watch = schedule.notify === 'on-change';
  const last = lastRun(schedule, tasks, now);
  const finished = schedule.nextRunAt === null;
  const next = !schedule.enabled
    ? 'Paused'
    : finished
      ? 'Finished'
      : `Next ${untilLabel(schedule.nextRunAt, now)}`;
  const nextAt =
    schedule.nextRunAt === null
      ? undefined
      : new Date(schedule.nextRunAt).toLocaleString([], {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });

  if (mode === 'edit')
    return (
      <li className="schedule-card" data-editing>
        <ScheduleEditor
          schedule={schedule}
          onCancel={() => setMode('view')}
          onSave={async change => {
            if (await send({ type: 'update-schedule', id: schedule.id, ...change }))
              setMode('view');
          }}
        />
      </li>
    );

  return (
    <li className="schedule-card" data-enabled={schedule.enabled || undefined}>
      <div className="schedule-card-top">
        <span className="schedule-card-icon" aria-hidden="true">
          <Icon name={watch ? 'search' : 'clock'} size={16} />
        </span>
        <div className="schedule-text">
          <span className="schedule-title">
            {schedule.title}
            {watch && <span className="schedule-badge">Watch</span>}
          </span>
          <span className="schedule-detail">
            {describeWhen(schedule.when, { short: true })} · <span title={nextAt}>{next}</span>
          </span>
        </div>
        {!finished && (
          <Switch
            label={`${schedule.enabled ? 'Pause' : 'Resume'} ${schedule.title}`}
            checked={schedule.enabled}
            onChange={enabled =>
              void send({ type: 'set-schedule-enabled', id: schedule.id, enabled })
            }
          />
        )}
      </div>

      <button
        type="button"
        className="schedule-last"
        data-tone={last.tone}
        disabled={!last.task}
        title={last.task ? 'Show this run' : undefined}
        onClick={() => last.task && onOpenRun(last.task)}
      >
        <i aria-hidden="true" />
        <span>{last.text}</span>
      </button>

      {mode === 'remove' ? (
        <div className="schedule-actions">
          <span className="schedule-ask">Remove this {watch ? 'watch' : 'schedule'}?</span>
          <Button size="small" onClick={() => setMode('view')}>
            Keep
          </Button>
          <Button
            size="small"
            variant="prominent"
            onClick={() => void send({ type: 'delete-schedule', id: schedule.id })}
          >
            Remove
          </Button>
        </div>
      ) : (
        <div className="schedule-actions">
          <Button
            size="small"
            disabled={last.tone === 'running'}
            onClick={() => void send({ type: 'run-schedule', id: schedule.id })}
          >
            {last.tone === 'running' ? 'Running…' : 'Run now'}
          </Button>
          <Button size="small" onClick={() => setMode('edit')}>
            Edit
          </Button>
          {/* Letting a run finish while nobody is here: small, reversible actions need no review. */}
          <button
            type="button"
            className="schedule-badge schedule-own"
            aria-pressed={schedule.unattended}
            title={unattendedSummary}
            onClick={() =>
              void send({
                type: 'set-schedule-unattended',
                id: schedule.id,
                unattended: !schedule.unattended,
              })
            }
          >
            {schedule.unattended ? 'On its own' : 'Asks first'}
          </button>
          <span className="schedule-spacer" />
          <IconButton
            icon="trash"
            label={`Remove ${schedule.title}`}
            onClick={() => setMode('remove')}
          />
        </div>
      )}
    </li>
  );
}

type Rhythm = 'daily' | 'hours' | 'once';

/** Name, instructions and timing, edited in place. Only what changed is sent. */
function ScheduleEditor({
  schedule,
  onCancel,
  onSave,
}: {
  schedule: Schedule;
  onCancel(): void;
  onSave(change: { title?: string; prompt?: string; when?: ScheduleWhen }): Promise<void>;
}) {
  const { when } = schedule;
  const [title, setTitle] = useState(schedule.title);
  const [prompt, setPrompt] = useState(schedule.prompt);
  const [rhythm, setRhythm] = useState<Rhythm>(
    when.kind === 'every' ? 'hours' : when.kind === 'once' ? 'once' : 'daily',
  );
  const [time, setTime] = useState(when.kind === 'daily' ? when.time : '09:00');
  const [days, setDays] = useState<Weekday[]>(
    when.kind === 'daily' && when.days?.length ? when.days : [...allDays],
  );
  const [hours, setHours] = useState(String(when.kind === 'every' ? when.hours : 4));
  const [onceAt, setOnceAt] = useState(when.kind === 'once' ? when.at : '');
  const [busy, setBusy] = useState(false);

  const picked: ScheduleWhen | null =
    rhythm === 'hours'
      ? { kind: 'every', hours: Math.min(24, Math.max(1, Math.round(Number(hours) || 1))) }
      : rhythm === 'once'
        ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(onceAt)
          ? { kind: 'once', at: onceAt }
          : null
        : days.length === 0
          ? null
          : {
              kind: 'daily',
              time,
              // Every day is written without a list, the way a new schedule is.
              ...(days.length === 7 ? {} : { days: allDays.filter(day => days.includes(day)) }),
            };
  const valid = Boolean(title.trim() && prompt.trim() && picked);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!valid || !picked || busy) return;
    setBusy(true);
    await onSave({
      ...(title.trim() !== schedule.title ? { title: title.trim() } : {}),
      ...(prompt.trim() !== schedule.prompt ? { prompt: prompt.trim() } : {}),
      ...(JSON.stringify(picked) !== JSON.stringify(when) ? { when: picked } : {}),
    });
    setBusy(false);
  }

  return (
    <form className="schedule-editor" onSubmit={event => void save(event)}>
      <label>
        <span className="schedule-label">Name</span>
        <input
          className="ds-input"
          value={title}
          maxLength={120}
          onChange={event => setTitle(event.target.value)}
        />
      </label>
      <label>
        <span className="schedule-label">What it does</span>
        <textarea
          className="ds-input"
          rows={3}
          maxLength={8000}
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
        />
      </label>
      <div>
        <span className="schedule-label">When</span>
        <div className="schedule-rhythm" role="radiogroup" aria-label="How often">
          {(
            [
              ['daily', 'Days'],
              ['hours', 'Hours'],
              ['once', 'Once'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={rhythm === value}
              onClick={() => setRhythm(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="schedule-when">
          {rhythm === 'daily' && (
            <>
              <div className="schedule-days" role="group" aria-label="Days">
                {week.map(day => (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={days.includes(day)}
                    aria-label={dayNames[day]}
                    onClick={() =>
                      setDays(current =>
                        current.includes(day)
                          ? current.filter(entry => entry !== day)
                          : [...current, day],
                      )
                    }
                  >
                    {dayLetters[day]}
                  </button>
                ))}
              </div>
              <span>at</span>
              <input
                type="time"
                aria-label="Time"
                value={time}
                onChange={event => setTime(event.target.value)}
              />
            </>
          )}
          {rhythm === 'hours' && (
            <label className="task-hours">
              every
              <input
                type="number"
                min={1}
                max={24}
                aria-label="Hours between runs"
                value={hours}
                onChange={event => setHours(event.target.value)}
              />
              hours
            </label>
          )}
          {rhythm === 'once' && (
            <input
              type="datetime-local"
              aria-label="Date and time"
              value={onceAt}
              onChange={event => setOnceAt(event.target.value)}
            />
          )}
        </div>
        {picked && <p className="schedule-preview">{describeWhen(picked)}</p>}
      </div>
      <div className="schedule-actions">
        <span className="schedule-spacer" />
        <Button size="small" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="small" variant="prominent" disabled={!valid || busy}>
          Save
        </Button>
      </div>
    </form>
  );
}
