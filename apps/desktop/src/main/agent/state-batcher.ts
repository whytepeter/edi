import type { AgentState } from '@edi/contracts';

/** Text-only changes reach the card at most this often: about two frames. */
export const TEXT_BATCH_MS = 33;

/**
 * A streamed reply changes the agent state many times a second, and each change used to cross to
 * the card whole: every message, validated again and rendered again. Changes to the reply text
 * alone now go at most once per `delayMs`, always as the newest state. Anything else (status,
 * steps, an approval, an error) goes at once, carrying any text that was still waiting.
 */
export function batchTextUpdates(send: (state: AgentState) => void, delayMs = TEXT_BATCH_MS) {
  let previous: AgentState | undefined;
  let pending: AgentState | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const state = pending;
    pending = undefined;
    if (state) send(state);
  };

  const push = (state: AgentState) => {
    const textOnly = previous !== undefined && onlyTextChanged(previous, state);
    previous = state;
    pending = state;
    if (!textOnly) return flush();
    timer ??= setTimeout(flush, delayMs);
  };

  return Object.assign(push, { flush });
}

/** Messages are rebuilt on every update, so they follow the text; every other field is compared. */
function onlyTextChanged(previous: AgentState, next: AgentState) {
  if (previous.text === next.text) return false;
  for (const key of Object.keys(next) as (keyof AgentState)[])
    if (key !== 'text' && key !== 'messages' && !Object.is(previous[key], next[key])) return false;
  return true;
}
