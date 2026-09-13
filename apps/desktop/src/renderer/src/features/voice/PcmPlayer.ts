/** Bounded mono PCM playback. Provider decoding and process supervision live elsewhere. */
export class PcmPlayer {
  private generation = 0;
  private accepting = false;
  private disposed = false;
  private tail = 0;
  private started = false;
  private sources = new Set<AudioBufferSourceNode>();
  private gaps = 0;

  constructor(
    private readonly context: AudioContext,
    private readonly destination: AudioNode = context.destination,
    /**
     * Audio allowed to wait ahead of the playhead. A synthesizer only starts its next clip once
     * this queue accepts the last one, so a short queue turns slow synthesis into audible gaps.
     */
    private readonly maxQueuedSeconds = 3,
  ) {}

  /** Call from a user gesture. The token invalidates late chunks and pending resumes. */
  async begin(): Promise<number | null> {
    if (this.disposed) throw new Error('Audio player is closed');
    this.stop();
    const token = this.generation;
    await this.context.resume();
    if (token !== this.generation || this.disposed) return null;
    if (this.context.state !== 'running') throw new Error('Audio output is unavailable');
    this.accepting = true;
    this.gaps = 0;
    return token;
  }

  /** False means stale/finished run. Backpressure requires retrying the same chunk later. */
  push(
    token: number,
    pcm: Float32Array,
    sampleRate: number,
  ): 'accepted' | 'stale' | 'backpressure' {
    if (token !== this.generation || !this.accepting || this.disposed) return 'stale';
    if (this.context.state !== 'running') {
      this.stop();
      throw new Error('Audio output was suspended');
    }
    if (
      !Number.isInteger(sampleRate) ||
      sampleRate < 8000 ||
      sampleRate > 48000 ||
      pcm.length === 0 ||
      pcm.length > sampleRate ||
      pcm.some(value => !Number.isFinite(value) || Math.abs(value) > 1)
    ) {
      throw new Error('Expected finite mono PCM, 8–48 kHz, at most one second per chunk');
    }
    const now = this.context.currentTime;
    const duration = pcm.length / sampleRate;
    // Bound both duration and node count; tiny chunks must not exhaust the renderer.
    if (
      Math.max(0, this.tail - now) + duration > this.maxQueuedSeconds ||
      this.sources.size >= 128
    ) {
      return 'backpressure';
    }
    const late = this.started && this.tail < now;
    const when = !this.started || late ? now + 0.04 : this.tail;
    const buffer = this.context.createBuffer(1, pcm.length, sampleRate);
    buffer.getChannelData(0).set(pcm);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.destination);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
    };
    try {
      source.start(when);
    } catch (error) {
      source.disconnect();
      throw error;
    }
    this.sources.add(source);
    this.tail = when + duration;
    this.started = true;
    if (late) this.gaps += 1;
    return 'accepted';
  }

  /** Generation has ended; queued audio may still be playing. */
  finish(token: number): void {
    if (token === this.generation) this.accepting = false;
  }

  /** Synchronously disconnect all scheduled audio, then invalidate producer messages. */
  stop(): void {
    this.generation += 1;
    this.accepting = false;
    for (const source of this.sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.sources.clear();
    this.tail = 0;
    this.started = false;
  }

  snapshot() {
    return {
      accepting: this.accepting,
      pendingNodes: this.sources.size,
      queuedSeconds: Math.max(0, this.tail - this.context.currentTime),
      schedulingGaps: this.gaps,
    };
  }

  /** Own one context per player; disposal releases the device and prevents future runs. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    await this.context.close();
  }
}
