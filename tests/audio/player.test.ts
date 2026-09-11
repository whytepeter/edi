import assert from 'node:assert/strict';
import test from 'node:test';
import { PcmPlayer } from '../../apps/desktop/src/renderer/src/audio/PcmPlayer';

function setup() {
  const nodes: any[] = [];
  const context = {
    state: 'running', currentTime: 1, destination: {},
    resume: async () => {}, close: async () => { context.state = 'closed'; },
    createBuffer: (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => {
      const node = { buffer: null, onended: null, startTime: 0, stopped: false, disconnected: false,
        connect() {}, start(time: number) { this.startTime = time; },
        stop() { this.stopped = true; }, disconnect() { this.disconnected = true; } };
      nodes.push(node);
      return node;
    },
  };
  return { context, nodes, player: new PcmPlayer(context as unknown as AudioContext) };
}
const pcm = () => new Float32Array(2400).fill(0.25);

test('chunks are contiguous and copied; finish drains without accepting more', async () => {
  const { player, nodes } = setup();
  const token = (await player.begin())!;
  assert.equal(player.push(token, pcm(), 24000), 'accepted');
  assert.equal(player.push(token, pcm(), 24000), 'accepted');
  assert.equal(nodes[0].startTime, 1.04);
  assert.ok(Math.abs(nodes[1].startTime - 1.14) < 1e-9);
  player.finish(token);
  assert.equal(player.push(token, pcm(), 24000), 'stale');
  nodes.forEach(node => node.onended());
  assert.equal(player.snapshot().pendingNodes, 0);
});

test('Stop clears current and future sources and rejects old producers', async () => {
  const { player, nodes } = setup();
  const old = (await player.begin())!;
  player.push(old, pcm(), 24000);
  player.push(old, pcm(), 24000);
  player.stop();
  assert.ok(nodes.every(node => node.stopped && node.disconnected));
  assert.equal(player.snapshot().pendingNodes, 0);
  const next = (await player.begin())!;
  assert.equal(player.push(old, pcm(), 24000), 'stale');
  player.finish(old);
  assert.equal(player.push(next, pcm(), 24000), 'accepted');
});

test('Stop during device resume cannot revive playback', async () => {
  const { player, context } = setup();
  let resume!: () => void;
  context.resume = () => new Promise<void>(resolve => { resume = resolve; });
  const starting = player.begin();
  player.stop();
  resume();
  assert.equal(await starting, null);
  assert.equal(player.snapshot().accepting, false);
});

test('queue is bounded and late delivery reports a scheduling gap', async () => {
  const { player, context } = setup();
  const token = (await player.begin())!;
  assert.equal(player.push(token, new Float32Array(24000), 24000), 'accepted');
  assert.equal(player.push(token, new Float32Array(24000), 24000), 'accepted');
  assert.equal(player.push(token, new Float32Array(24000), 24000), 'backpressure');
  context.currentTime = 5;
  assert.equal(player.push(token, pcm(), 24000), 'accepted');
  assert.equal(player.snapshot().schedulingGaps, 1);
});

test('invalid PCM, suspended device and disposal fail safely', async () => {
  const { player, context } = setup();
  const token = (await player.begin())!;
  for (const value of [NaN, Infinity, 1.1]) {
    assert.throws(() => player.push(token, new Float32Array([value]), 24000));
  }
  assert.throws(() => player.push(token, pcm(), 0));
  assert.throws(() => player.push(token, new Float32Array(0), 24000));
  assert.throws(() => player.push(token, new Float32Array(24001), 24000));
  context.state = 'suspended';
  assert.throws(() => player.push(token, pcm(), 24000));
  assert.equal(player.push(token, pcm(), 24000), 'stale');
  await player.dispose();
  await player.dispose();
  assert.equal(context.state, 'closed');
  await assert.rejects(player.begin());
});
