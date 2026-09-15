import { execFile } from 'node:child_process';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import {
  privateAppSchema,
  privateContextApps,
  screenSharingApp,
  type OnScreenWindow,
  type PrivacyPause,
  type PrivacyState,
  type PrivateApp,
} from '@edi/contracts';

/** What the guard needs from an Electron window: enough to keep it out of a screen share. */
interface OwnWindow {
  isDestroyed(): boolean;
  setContentProtection(enabled: boolean): void;
}

/**
 * Privacy mode. Edi doesn't look at the screen or at what's in front while the person has paused
 * it, while a call app shares the screen (and then keeps its own windows out of the share), or
 * when an app they keep private is in front. Nothing is captured to find out: the check reads
 * the window list only, every few seconds, and only while pausing for shares is on.
 */
export class PrivacyGuard {
  private sharing: string | null = null;
  private hidden = false;
  private timer?: ReturnType<typeof setInterval>;
  private readonly listeners = new Set<(state: PrivacyState) => void>();

  constructor(
    private readonly options: {
      settings: () => {
        privacyPaused: boolean;
        pauseWhenSharing: boolean;
        privateApps: readonly PrivateApp[];
      };
      /** Raw JSON of the windows on screen (native helper); null when unavailable. */
      windowList: () => Promise<string | null>;
      /** Edi's own windows, kept out of a screen share while one is noticed. */
      ownWindows: () => OwnWindow[];
      intervalMs?: number;
    },
  ) {}

  get state(): PrivacyState {
    const settings = this.options.settings();
    const paused: PrivacyPause | null = settings.privacyPaused
      ? 'you'
      : settings.pauseWhenSharing && this.sharing
        ? 'sharing'
        : null;
    return { paused, sharingApp: this.sharing };
  }

  /** Why Edi mustn't look now with this app in front; null when it may. */
  pauseFor(frontBundleId: string | null | undefined): PrivacyPause | null {
    return this.state.paused ?? (frontBundleId && this.isPrivate(frontBundleId) ? 'private-app' : null);
  }

  isPrivate(bundleId: string) {
    return (
      privateContextApps.has(bundleId) ||
      this.options.settings().privateApps.some(app => app.bundleId === bundleId)
    );
  }

  start() {
    void this.check();
    this.timer = setInterval(() => void this.check(), this.options.intervalMs ?? 3000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }

  /** Settings changed: pausing, or pausing for shares, may have too. */
  refresh() {
    if (!this.options.settings().pauseWhenSharing) this.sharing = null;
    this.protect();
    this.publish();
  }

  async check() {
    const before = this.sharing;
    if (!this.options.settings().pauseWhenSharing) this.sharing = null;
    else {
      let windows: OnScreenWindow[] = [];
      try {
        const parsed: unknown = JSON.parse((await this.options.windowList()) ?? '[]');
        if (Array.isArray(parsed)) windows = parsed as OnScreenWindow[];
      } catch {
        // An unreadable list notices nothing.
      }
      this.sharing = screenSharingApp(windows);
    }
    this.protect();
    if (before !== this.sharing) this.publish();
  }

  onChange(listener: (state: PrivacyState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * While shared, Edi's windows stay out of the share (the person still sees them). Windows opened
   * during a share are covered on the next check; protection is lifted once, when the share ends,
   * so it never undoes the brief protection a screenshot sets on its own.
   */
  private protect() {
    const hide = this.state.paused === 'sharing';
    if (!hide && !this.hidden) return;
    for (const window of this.options.ownWindows())
      if (!window.isDestroyed()) window.setContentProtection(hide);
    this.hidden = hide;
  }

  private publish() {
    const state = this.state;
    for (const listener of this.listeners) listener(state);
  }
}

const run = promisify(execFile);

/** The app a person chose in the picker, by its bundle's own id and name. */
export async function readPrivateApp(path: string): Promise<PrivateApp> {
  if (!path.endsWith('.app')) throw new Error('Choose an app.');
  const plist = join(path, 'Contents/Info.plist');
  const read = async (key: string) =>
    (await run('plutil', ['-extract', key, 'raw', '-expect', 'string', plist]).catch(() => null))
      ?.stdout.trim() ?? '';
  const bundleId = await read('CFBundleIdentifier');
  const name = (await read('CFBundleDisplayName')) || (await read('CFBundleName'));
  const parsed = privateAppSchema.safeParse({
    bundleId,
    name: name || basename(path, '.app'),
  });
  if (!parsed.success) throw new Error('That app doesn’t say who it is, so Edi can’t recognise it.');
  return parsed.data;
}
