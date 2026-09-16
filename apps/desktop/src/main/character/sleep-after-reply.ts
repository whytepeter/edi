export interface ReplyActivity {
  /** The reply that asked for sleep is still being written. */
  writing(): boolean;
  /** Its words are still being voiced (or about to be). */
  speaking(): boolean;
  /** Something that identifies the current exchange; it changes when a new one starts. */
  exchange(): string;
  /** The person started asking something else (holding to talk). */
  asking(): boolean;
}

/**
 * "Go to sleep" arrives as an action in the middle of Edi's reply. Sleeping at once cut off the
 * "Goodnight" she was about to say, so sleep waits until the reply is written and spoken. A new
 * question in the meantime keeps her awake; speech that never ends is given up on after a while.
 */
export function sleepAfterReply(
  activity: ReplyActivity,
  sleep: () => void,
  options: { pollMs?: number; maxSpeechMs?: number } = {},
) {
  const exchange = activity.exchange();
  const started = Date.now();
  const timer = setInterval(() => {
    if (activity.exchange() !== exchange || activity.asking()) return cancel();
    if (activity.writing()) return;
    if (activity.speaking() && Date.now() - started < (options.maxSpeechMs ?? 60_000)) return;
    cancel();
    sleep();
  }, options.pollMs ?? 150);
  const cancel = () => clearInterval(timer);
  return cancel;
}
