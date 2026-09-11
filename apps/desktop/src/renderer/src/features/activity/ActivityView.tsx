import { Icon } from '../../components/ui';

export function ActivityView() {
  return (
    <section>
      <header className="view-header">
        <p className="ds-eyebrow">Activity</p>
      </header>
      <div className="empty-state">
        <span className="empty-state-icon">
          <Icon name="clock" size={26} />
        </span>
        <h1 className="ds-title">A quiet beginning.</h1>
        <p className="ds-body ds-secondary">
          When Edi starts helping, actions and approvals will appear here.
        </p>
      </div>
    </section>
  );
}
