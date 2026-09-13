import { EmptyState } from '../../components/ui';

/** Connected apps and MCP servers. Nothing can be connected in this build, so say that plainly. */
export function ConnectorsView() {
  return (
    <section>
      <EmptyState icon="plug" title="No apps connected.">
        <p className="ds-body ds-secondary">
          Connectors will let Edi work with apps like your calendar or GitHub, and with MCP servers
          you add. Edi will still ask before doing anything you’d want to review.
        </p>
        <p className="ds-footnote ds-tertiary">You can’t connect apps in this version of Edi.</p>
      </EmptyState>
    </section>
  );
}
