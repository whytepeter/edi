import type { PermissionId, PermissionSnapshot, PermissionStatus } from '@edi/contracts';

export interface PermissionAdapter {
  status(): PermissionStatus;
  request(): Promise<PermissionStatus>;
  openSettings(): Promise<void>;
}

/**
 * Main-owned permission policy. Features enqueue an ask; only an explicit button
 * invokes the OS prompt or opens Settings. Renderers receive state, never adapters.
 */
export class PermissionManager {
  private readonly queue: PermissionId[] = [];
  private readonly requested = new Set<PermissionId>();
  private readonly listeners = new Set<(snapshot: PermissionSnapshot) => void>();

  constructor(
    private readonly adapters: Record<PermissionId, PermissionAdapter>,
    private readonly present: () => void,
  ) {}

  snapshot(): PermissionSnapshot {
    return {
      permissions: (Object.keys(this.adapters) as PermissionId[]).map(id => ({
        id,
        status: this.adapters[id].status(),
        requested: this.requested.has(id),
      })),
      active: this.queue[0] ?? null,
    };
  }

  onChange(listener: (snapshot: PermissionSnapshot) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Returns true now, or queues a just-in-time card and returns false. */
  require(id: PermissionId): boolean {
    if (this.adapters[id].status() === 'granted') return true;
    if (!this.queue.includes(id)) this.queue.push(id);
    this.publish();
    this.present();
    return false;
  }

  async request(id: PermissionId) {
    this.requested.add(id);
    await this.adapters[id].request();
    if (this.adapters[id].status() === 'granted') this.remove(id);
    this.publish();
  }

  async openSettings(id: PermissionId) {
    await this.adapters[id].openSettings();
    this.publish();
  }

  dismiss(id: PermissionId) {
    this.remove(id);
    this.publish();
  }

  refresh() {
    for (const id of [...this.queue]) {
      if (this.adapters[id].status() === 'granted') this.remove(id);
    }
    this.publish();
  }

  private remove(id: PermissionId) {
    const index = this.queue.indexOf(id);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private publish() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
