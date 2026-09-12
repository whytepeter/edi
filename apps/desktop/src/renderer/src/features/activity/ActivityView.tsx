import { useEffect, useState } from 'react';
import type { Activity, ActivityRun } from '@edi/contracts';
import { Icon } from '../../components/ui';
import { StepList } from '../../components/StepList';
import './activity.css';

const runLabel: Record<ActivityRun['status'], string> = {
  running: 'In progress',
  done: 'Answered',
  stopped: 'Stopped',
  error: 'Didn’t finish',
  interrupted: 'Interrupted when Edi closed',
};

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function when(timestamp: number) {
  const minutes = Math.round((timestamp - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour');
  return relative.format(Math.round(hours / 24), 'day');
}

/** Recent runs and every action Edi took or was refused, from local history. */
export function ActivityView({ refreshKey }: { refreshKey: string }) {
  // Outside Electron there is no history to load.
  const [activity, setActivity] = useState<Activity | null>(() => (window.edi ? null : []));
  const [error, setError] = useState('');
  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    window.edi
      .activity()
      .then(value => alive && setActivity(value))
      .catch(() => alive && setError('Could not load activity.'));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  return (
    <section>
      <header className="view-header">
        <p className="ds-eyebrow">Activity</p>
        {activity && activity.length > 0 && <h1 className="ds-large-title">What Edi has done.</h1>}
      </header>
      {error && (
        <p role="alert" className="workspace-error">
          {error}
        </p>
      )}
      {activity?.length === 0 && (
        <div className="empty-state">
          <span className="empty-state-icon">
            <Icon name="clock" size={26} />
          </span>
          <h1 className="ds-title">A quiet beginning.</h1>
          <p className="ds-body ds-secondary">
            When Edi starts helping, actions and approvals will appear here.
          </p>
        </div>
      )}
      {activity && activity.length > 0 && (
        <ol className="activity-list" aria-label="Recent requests">
          {activity.map(run => (
            <li key={run.id} className="activity-run" data-status={run.status}>
              <p className="activity-prompt">{run.prompt}</p>
              <p className="activity-meta">
                {runLabel[run.status]} · {when(run.startedAt)}
                {run.screens > 0 && ` · saw ${run.screens} screen${run.screens === 1 ? '' : 's'}`}
              </p>
              {run.error && <p className="activity-error">{run.error}</p>}
              <StepList steps={run.steps} label={`Actions for “${run.prompt.slice(0, 40)}”`} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
