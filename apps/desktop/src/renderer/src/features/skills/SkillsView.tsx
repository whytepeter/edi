import { EmptyState } from '../../components/ui';

/**
 * Skills are add-ons. Edi's own abilities (showing content, notes, knowing its setup) work under
 * the hood and are not listed here, the same way Claude does not list its built-in tools.
 */
export function SkillsView() {
  return (
    <EmptyState icon="sparkles" title="No skills yet.">
      <p className="ds-callout ds-secondary">Skills you add to Edi will show up here.</p>
    </EmptyState>
  );
}
