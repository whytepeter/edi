/** Listening must only be selected after the capture service confirms an active mic. */
export function VoiceStatusBubble({ state }: { state: 'unavailable' | 'listening' }) {
  const listening = state === 'listening';
  return (
    <div className="voice-bubble" role="status" aria-live="polite" data-state={state}>
      {listening && (
        <span className="listening-bars" aria-hidden="true">
          {[0, 1, 2, 3, 4].map(index => (
            <i key={index} style={{ animationDelay: `${index * -0.13}s` }} />
          ))}
        </span>
      )}
      <span title={listening ? undefined : 'No microphone is active'}>
        {listening ? 'I’m listening' : 'voice coming soon'}
      </span>
    </div>
  );
}
