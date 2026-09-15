import { GroupedList, GroupedRow } from '../../components/ui';
import './settings.css';
import type { SystemInfo } from '@edi/contracts';

/** Settings → Keyboard. One everyday shortcut; rebinding is not built yet. */
export function KeyboardSettings({ system }: { system: SystemInfo | null }) {
  const status = system?.pushToTalk.status;
  return (
    <div className="settings-page">
      <GroupedList title="Shortcuts" footer="You can’t change this shortcut yet.">
        <GroupedRow
          icon="mic"
          title="Hold to talk"
          detail={
            status === 'unavailable'
              ? 'Not working on this Mac right now.'
              : 'Hold, ask, then let go to send.'
          }
          value={<kbd>{system?.pushToTalk.label ?? '⌥ Space'}</kbd>}
        />
        {status !== 'unavailable' && (
          <GroupedRow
            icon="mic"
            title="Talk hands-free"
            detail="Tap once, then just talk. Speak over replies to interrupt. Tap again to stop."
            value={<kbd>{system?.pushToTalk.label ?? '⌥ Space'}</kbd>}
          />
        )}
      </GroupedList>
    </div>
  );
}
