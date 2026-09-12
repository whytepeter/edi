import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

export interface Chord {
  /** macOS virtual key code, e.g. 49 for Space. */
  keyCode: number;
  /** Carbon modifier mask, e.g. optionKey = 0x0800. */
  modifiers: number;
  label: string;
}

/** The requested default push-to-talk chord. Rebinding arrives with Settings. */
export const optionSpace: Chord = { keyCode: 49, modifiers: 0x0800, label: '⌥ Space' };

export interface HelperCommand {
  command: string;
  args?: string[];
}

export type HotkeyStatus = 'starting' | 'ready' | 'unavailable';

/** A hold can never outlast the recording cap; release it if the key-up is lost. */
const MAX_HOLD_MS = 65_000;
const MAX_RESTARTS = 3;

/** native/hotkey/build in development; bundled beside the app when packaged. */
export function resolveHotkeyHelper(appPath: string, packaged: boolean, resourcesPath: string) {
  const path = packaged
    ? join(resourcesPath, 'edi-hotkey')
    : resolve(appPath, '../../native/hotkey/build/edi-hotkey');
  return existsSync(path) ? { command: path } : null;
}

/**
 * Supervises the native hotkey helper. It reports only this chord's press and
 * release, never other keystrokes. Key repeat is ignored, a crash mid-hold still
 * releases, and the helper is restarted a bounded number of times.
 */
export class HoldHotkey {
  status: HotkeyStatus = 'starting';
  private child?: ChildProcessByStdio<Writable, Readable, null>;
  private held = false;
  private holdTimer?: ReturnType<typeof setTimeout>;
  private restarts = 0;
  private disposed = false;

  constructor(
    private readonly helper: HelperCommand | null,
    private readonly chord: Chord,
    private readonly handlers: { down(): void; up(): void; status?(status: HotkeyStatus): void },
  ) {}

  start() {
    if (!this.helper) return this.setStatus('unavailable');
    const child = spawn(
      this.helper.command,
      [...(this.helper.args ?? []), String(this.chord.keyCode), String(this.chord.modifiers)],
      // No inherited environment: the helper needs nothing from ours.
      { stdio: ['pipe', 'pipe', 'ignore'], env: { PATH: '/usr/bin:/bin' } },
    );
    this.child = child;
    child.once('error', () => this.setStatus('unavailable'));
    createInterface({ input: child.stdout }).on('line', line => this.onLine(line));
    child.once('close', () => this.onClose(child));
  }

  dispose() {
    this.disposed = true;
    this.release();
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    child.stdin.end(); // the helper exits when its stdin closes
    setTimeout(() => child.kill('SIGKILL'), 500).unref();
  }

  private onLine(line: string) {
    if (line === 'ready') {
      this.restarts = 0;
      this.setStatus('ready');
    } else if (line === 'down') {
      if (this.held) return; // key repeat
      this.held = true;
      this.holdTimer = setTimeout(() => this.release(), MAX_HOLD_MS);
      this.handlers.down();
    } else if (line === 'up') {
      this.release();
    } else if (line.startsWith('error')) {
      this.restarts = MAX_RESTARTS; // registration refused: retrying will not help
      this.setStatus('unavailable');
    }
  }

  private onClose(child: ChildProcessByStdio<Writable, Readable, null>) {
    if (this.child !== child) return;
    this.child = undefined;
    this.release();
    if (this.disposed || this.restarts >= MAX_RESTARTS) return this.setStatus('unavailable');
    const delay = 1000 * 2 ** this.restarts++;
    this.setStatus('starting');
    setTimeout(() => {
      if (!this.disposed) this.start();
    }, delay).unref();
  }

  private release() {
    clearTimeout(this.holdTimer);
    if (!this.held) return;
    this.held = false;
    this.handlers.up();
  }

  private setStatus(status: HotkeyStatus) {
    if (this.status === status) return;
    this.status = status;
    this.handlers.status?.(status);
  }
}
