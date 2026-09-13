import { GroupedList, GroupedRow } from '../../components/ui';
import './settings.css';
import type { SystemInfo } from '@edi/contracts';

/** Settings → About Edi. */
export function AboutSettings({ system }: { system: SystemInfo | null }) {
  return (
    <div className="settings-page">
      <GroupedList>
        <GroupedRow title="Version" value={system?.version ?? '—'} />
        <GroupedRow
          title="Workspace folder"
          detail={system?.notesFolder ?? 'Documents › Edi › Notes'}
        />
      </GroupedList>
    </div>
  );
}
