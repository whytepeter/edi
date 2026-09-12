import type { SkinId } from '@edi/contracts';
import { Button, SpeechBubble } from '../../components/ui';
import { Pet } from '../../components/Pet';
import './content.css';

/** The card's resting state before Edi has anything to show. */
export function IntroView({ skin, onTalk }: { skin: SkinId; onTalk(): void }) {
  return (
    <section className="intro-view">
      <div className="intro-hero">
        <Pet skin={skin} />
        <SpeechBubble side="right">hey, you.</SpeechBubble>
      </div>
      <h1 className="ds-large-title">
        A little space.
        <br />
        Just when you need it.
      </h1>
      <p className="ds-body ds-secondary">
        Edi’s explanations, media, and questions will appear here as you talk.
      </p>
      <Button trailingIcon="arrow-up-right" onClick={onTalk}>
        Talk to Edi
      </Button>
      <p className="ds-eyebrow">Temporary connection test</p>
    </section>
  );
}
