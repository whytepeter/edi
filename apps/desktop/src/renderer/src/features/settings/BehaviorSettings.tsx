import type { SuggestionLevel } from '@edi/contracts';
import { GroupedList, GroupedRow, SegmentedControl } from '../../components/ui';
import './settings.css';

/** The control shows these; each stands for one saved level. */
const choices = ['Off', 'Subtle', 'Helpful'] as const;
type Choice = (typeof choices)[number];
const levelOf: Record<Choice, SuggestionLevel> = { Off: 'off', Subtle: 'subtle', Helpful: 'helpful' };
const choiceOf: Record<SuggestionLevel, Choice> = { off: 'Off', subtle: 'Subtle', helpful: 'Helpful' };
const detail: Record<SuggestionLevel, string> = {
  off: 'Edi says nothing until you ask.',
  subtle: 'Only when an app you’re using could be connected.',
  helpful: 'That, plus a skill made for the app you’re in.',
};

/**
 * Settings → Behavior: how much Edi says on its own. A suggestion comes from the app in front
 * and, in a browser, the site — read on this Mac. No screenshot is taken and no model is asked.
 */
export function BehaviorSettings({
  suggestions,
  onSuggestions,
}: {
  suggestions: SuggestionLevel;
  onSuggestions(level: SuggestionLevel): void;
}) {
  return (
    <div className="settings-page">
      <GroupedList
        title="Suggestions"
        footer="Edi looks at which app is in front, and the site in your browser when Accessibility is on. It never takes a screenshot for this, and asks no AI. Each suggestion waits a week before coming back, and none appear while you're sharing your screen."
      >
        <GroupedRow
          icon="sparkles"
          title="What Edi offers on its own"
          detail={detail[suggestions]}
          control={
            <SegmentedControl<Choice>
              label="What Edi offers on its own"
              options={choices}
              value={choiceOf[suggestions]}
              onChange={choice => onSuggestions(levelOf[choice])}
            />
          }
        />
      </GroupedList>
    </div>
  );
}
