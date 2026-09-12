export interface ScreenContextState {
  /**
   * True when the immediately previous conversation turn
   * was treated as needing screen context.
   */
  visualContextActive: boolean;
}

export const initialScreenContextState: ScreenContextState = {
  visualContextActive: false,
};

/**
 * Visible things a person might ask Edi to inspect.
 * Kept as a noun class, not a list of prompts.
 */
const VISIBLE_NOUN =
  'window|dialog|popup|modal|menu|button|field|form|tab|browser|webpage|website|page|image|photo|chart|graph|error|document|app|email|message|notification';

const DEMONSTRATIVE = 'this|that|these|those|current|open|visible|my';

/**
 * Decide locally whether this prompt needs a fresh screenshot.
 *
 * No model call.
 * No screenshot is taken here.
 */
export function needsScreenContext(
  prompt: string,
  state: ScreenContextState = initialScreenContextState,
): boolean {
  const text = normalizePrompt(prompt);

  if (!text) return false;

  if (explicitlyReferencesScreen(text)) {
    return true;
  }

  if (!state.visualContextActive) {
    return false;
  }

  return looksLikeVisualContinuation(text);
}

export interface ScreenContextSession {
  readonly state: ScreenContextState;
  /** Classify this turn and update whether the next one may still be visual. */
  decide(prompt: string): boolean;
}

/**
 * One conversation's visual-context bit. Call `decide` once per user
 * turn; a non-visual turn clears the bit so later "send it" stays text-only.
 */
export function createScreenContextSession(
  initial: ScreenContextState = initialScreenContextState,
): ScreenContextSession {
  let state = initial;
  return {
    get state(): ScreenContextState {
      return state;
    },
    decide(prompt: string): boolean {
      const needed = needsScreenContext(prompt, state);
      state = updateScreenContextState(needed);
      return needed;
    },
  };
}

function normalizePrompt(prompt: string): string {
  return prompt.toLowerCase().replace(/\s+/g, ' ').trim();
}

function explicitlyReferencesScreen(text: string): boolean {
  if (/\b(screen|screenshot|on[- ]screen)\b/.test(text)) {
    return true;
  }

  if (
    /\b(?:my|the|current|visible) desktop\b/.test(text) ||
    /\bon (?:my|the) desktop\b/.test(text)
  ) {
    return true;
  }

  if (new RegExp(`\\b(?:${DEMONSTRATIVE})\\s+(?:${VISIBLE_NOUN})\\b`).test(text)) {
    return true;
  }

  if (
    new RegExp(
      `\\b(?:point to|circle|underline|highlight|click(?: on)?|show me)\\s+(?:the|${DEMONSTRATIVE})\\s+(?:[\\w-]+\\s+){0,2}(?:${VISIBLE_NOUN})\\b`,
    ).test(text)
  ) {
    return true;
  }

  if (/\bwhich button\b/.test(text)) {
    return true;
  }

  if (/\bwhere (?:do|should|can) i click\b/.test(text)) {
    return true;
  }

  if (/\bwhat (?:am i|are we) looking at\b/.test(text)) {
    return true;
  }

  if (/\bwhat(?:'s| is) (?:on|showing on) (?:my|the) screen\b/.test(text)) {
    return true;
  }

  return false;
}

/**
 * Follow-ups during an already-visual conversation.
 *
 * Looks for short, contextual language rather than exact sentences.
 */
function looksLikeVisualContinuation(text: string): boolean {
  if (looksLikeNewTask(text)) {
    return false;
  }

  const words = text.split(/\s+/);
  const isShort = words.length <= 8;

  if (!isShort) {
    return false;
  }

  const hasReference = /\b(it|this|that|these|those|here|there)\b/.test(text);
  const hasTemporalReference = /\b(now|still|again|yet)\b/.test(text);
  const hasStateLanguage =
    /\b(fixed|working|work|broken|wrong|better|worse|changed|change|different|same|error|issue|problem)\b/.test(
      text,
    );
  const hasVisualLanguage = /\b(see|look|looks|looking|show|showing|visible)\b/.test(text);

  if (hasReference && (hasStateLanguage || hasVisualLanguage || hasTemporalReference)) {
    return true;
  }

  if (/\b(?:what|how) about\b/.test(text) && (hasReference || hasTemporalReference)) {
    return true;
  }

  if (hasStateLanguage && (words.length <= 4 || hasTemporalReference)) {
    return true;
  }

  if (hasTemporalReference && words.length <= 4) {
    return true;
  }

  if (hasReference && words.length <= 6 && /\b(?:what|which|where|why|how)\b/.test(text)) {
    return true;
  }

  if (/\b(?:looks|looking|showing|visible)\b/.test(text)) {
    return true;
  }

  if (/\b(?:can|do|did) you see\b/.test(text)) {
    return true;
  }

  if (/^(?:it|this|that|these|those|here|there)(?:\s+one)?[?.!]*$/.test(text)) {
    return true;
  }

  return false;
}

/**
 * A self-contained request that does not depend on the current display.
 * Ends visual context even when the line is short or contains "it".
 */
function looksLikeNewTask(text: string): boolean {
  return /\b(?:write|draft|compose|search(?: for)?|look up|calculate|translate|brainstorm)\b/.test(
    text,
  );
}

/**
 * Update visual conversation state after a turn is classified.
 *
 * A visual turn lets the next short follow-up capture again.
 * Any other turn ends the visual context immediately.
 */
export function updateScreenContextState(usedScreen: boolean): ScreenContextState {
  return {
    visualContextActive: usedScreen,
  };
}
