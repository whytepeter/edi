// Resource budget for the packaged app: cold launch, idle, card open, and pet drags.
// Plain Node. Uses a temporary profile, no API keys and no network. Takes about six minutes.
//
//   pnpm package
//   node tests/perf/resources.mjs            # full run
//   node tests/perf/resources.mjs --quick    # short phases, for checking the script itself
//
// Memory: Electron's per-process working set (KiB) and `ps` RSS. Both count shared pages in
// every process, so their totals overstate unique memory; the macOS `footprint` total taken
// after each phase is the closer figure.
// CPU is always per core (100 = one core, as in Activity Monitor): Electron's percentCPUUsage
// per sampling interval, which Electron reports as a share of all cores and we rescale, and
// `ps` cumulative CPU time per phase.
import { _electron as electron } from '@playwright/test';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const quick = process.argv.includes('--quick');
const config = {
  coldRuns: quick ? 2 : 5,
  settleMs: quick ? 2_000 : 10_000,
  idleHiddenMs: quick ? 20_000 : 180_000,
  cardPinnedMs: quick ? 10_000 : 60_000,
  sampleMs: 2_000,
  dragSampleMs: 1_000,
  // Frame capture copies every presented frame, so it runs after the CPU samples, not during.
  frameProbeMs: 10_000,
  drags: 20,
  dragSteps: 30,
  dragStepMs: 16,
};
const executablePath = resolve(
  process.env.EDI_TEST_EXECUTABLE || 'apps/desktop/release/mac-arm64/Edi.app/Contents/MacOS/Edi',
);
if (!existsSync(executablePath)) {
  console.error(`Packaged app not found at ${executablePath}. Run \`pnpm package\` first.`);
  process.exit(1);
}

const cores = cpus().length;
const sleep = ms => new Promise(done => setTimeout(done, ms));
const mib = kib => kib / 1024;
const round = (value, places = 1) =>
  value === null || value === undefined ? null : Number(value.toFixed(places));

function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
}
function stats(values) {
  return {
    n: values.length,
    median: round(quantile(values, 0.5), 2),
    p95: round(quantile(values, 0.95), 2),
    max: round(values.length ? Math.max(...values) : null, 2),
  };
}

/** `ps` time is [[dd-]hh:]mm:ss.ss of user + system CPU. */
function cpuSeconds(time) {
  const [days, clock] = time.includes('-') ? time.split('-') : ['0', time];
  return Number(days) * 86_400 + clock.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
}
async function ps(pids) {
  if (pids.length === 0) return new Map();
  try {
    const { stdout } = await run('ps', ['-o', 'pid=,rss=,time=', '-p', pids.join(',')]);
    return new Map(
      stdout
        .trim()
        .split('\n')
        .map(line => line.trim().split(/\s+/))
        .map(([pid, rss, time]) => [Number(pid), { rssKiB: Number(rss), cpuS: cpuSeconds(time) }]),
    );
  } catch {
    return new Map(); // A process exited between the two reads.
  }
}

function label(metric) {
  if (metric.type === 'Browser') return 'main';
  if (metric.type === 'GPU') return 'gpu';
  if (metric.type === 'Tab') return `renderer:${metric.surface ?? 'other'}`;
  if (metric.type === 'Utility') return `utility:${metric.name || metric.serviceName}`;
  return metric.type.toLowerCase();
}

/** One reading of every app process. CPU is the share since the previous reading. */
async function sample(app) {
  const processes = await app.evaluate(({ app, BrowserWindow }) => {
    const surfaces = new Map();
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      const surface = new URL(win.webContents.getURL()).searchParams.get('surface');
      surfaces.set(win.webContents.getOSProcessId(), surface);
    }
    return app.getAppMetrics().map(metric => ({
      pid: metric.pid,
      type: metric.type,
      name: metric.name,
      serviceName: metric.serviceName,
      surface: surfaces.get(metric.pid),
      cpuPercent: metric.cpu.percentCPUUsage,
      idleWakeups: metric.cpu.idleWakeupsPerSecond,
      workingSetKiB: metric.memory.workingSetSize,
    }));
  });
  const system = await ps(processes.map(metric => metric.pid));
  return {
    at: performance.now(),
    processes: processes.map(metric => ({
      ...metric,
      cpuPercent: metric.cpuPercent * cores,
      label: label(metric),
      rssKiB: system.get(metric.pid)?.rssKiB ?? null,
      cpuS: system.get(metric.pid)?.cpuS ?? null,
    })),
  };
}

/** Samples on a fixed interval until stopped. The first reading only resets CPU counters. */
function startSampler(app, intervalMs) {
  const samples = [];
  let running = true;
  const loop = (async () => {
    samples.push(await sample(app));
    while (running) {
      const next = samples.at(-1).at + intervalMs;
      while (running && performance.now() < next)
        await sleep(Math.min(100, next - performance.now()));
      if (running) samples.push(await sample(app));
    }
  })();
  return {
    stop: async () => {
      running = false;
      await loop;
      samples.push(await sample(app));
      return samples;
    },
  };
}

function summarise(samples) {
  const [first, ...rest] = samples;
  const wallS = (samples.at(-1).at - first.at) / 1000;
  const totals = {
    workingSetMiB: stats(rest.map(s => mib(s.processes.reduce((n, p) => n + p.workingSetKiB, 0)))),
    rssMiB: stats(rest.map(s => mib(s.processes.reduce((n, p) => n + (p.rssKiB ?? 0), 0)))),
    cpuPercent: stats(rest.map(s => s.processes.reduce((n, p) => n + p.cpuPercent, 0))),
    idleWakeupsPerS: stats(rest.map(s => s.processes.reduce((n, p) => n + p.idleWakeups, 0))),
  };
  const labels = [...new Set(samples.flatMap(s => s.processes.map(p => p.label)))].sort();
  const perProcess = {};
  let totalCpuS = 0;
  for (const name of labels) {
    const present = rest
      .map(s => s.processes.filter(p => p.label === name))
      .filter(group => group.length > 0);
    const sum = (group, key) => group.reduce((n, p) => n + (p[key] ?? 0), 0);
    // Average over the whole phase from cumulative CPU time; immune to sampling jitter.
    const pids = new Set(
      samples.flatMap(s => s.processes.filter(p => p.label === name).map(p => p.pid)),
    );
    let usedS = 0;
    for (const pid of pids) {
      const seen = samples
        .map(s => s.processes.find(p => p.pid === pid)?.cpuS)
        .filter(value => value !== undefined && value !== null);
      if (seen.length > 1) usedS += seen.at(-1) - seen[0];
    }
    totalCpuS += usedS;
    perProcess[name] = {
      present: present.length,
      workingSetMiB: stats(present.map(group => mib(sum(group, 'workingSetKiB')))),
      rssMiB: stats(present.map(group => mib(sum(group, 'rssKiB')))),
      cpuPercent: stats(present.map(group => sum(group, 'cpuPercent'))),
      idleWakeupsPerS: stats(present.map(group => sum(group, 'idleWakeups'))),
      averageCpuPercentFromPs: round((usedS / wallS) * 100, 2),
    };
  }
  totals.averageCpuPercentFromPs = round((totalCpuS / wallS) * 100, 2);
  return { wallS: round(wallS, 1), samples: rest.length, totals, perProcess };
}

async function launch(profiles) {
  const profile = await mkdtemp(join(tmpdir(), 'edi-perf-'));
  profiles.push(profile);
  const started = performance.now();
  const app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`] });
  const launchedMs = performance.now() - started;
  const errors = [];
  const external = [];
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  app.context().on('request', request => {
    if (!/^(file|data|blob|devtools|chrome-extension):/.test(request.url())) {
      external.push(request.url());
    }
  });
  const page = surface => app.windows().find(win => win.url().includes(`surface=${surface}`));
  // Ready: both renderers mounted and the pet window shown (after its first paint).
  const deadline = started + 30_000;
  for (;;) {
    if (performance.now() > deadline) throw new Error('Edi windows were not ready in 30 s');
    const pet = page('pet');
    const workspace = page('workspace');
    if (pet && workspace) {
      const mounted = await Promise.all([
        pet.evaluate(() => document.querySelector('.pet-art') !== null).catch(() => false),
        workspace
          .evaluate(() => (document.getElementById('root')?.childElementCount ?? 0) > 0)
          .catch(() => false),
      ]);
      const shown = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          win => win.webContents.getURL().includes('surface=pet') && win.isVisible(),
        ),
      );
      if (mounted.every(Boolean) && shown) break;
    }
    await sleep(20);
  }
  const readyMs = performance.now() - started;
  return {
    app,
    errors,
    external,
    pet: page('pet'),
    workspace: page('workspace'),
    timing: { launchedMs: round(launchedMs, 0), readyMs: round(readyMs, 0) },
  };
}

/** Evidence for or against a repaint loop in the currently visible windows. */
async function renderActivity(app, pages) {
  const animations = {};
  for (const [surface, page] of Object.entries(pages)) {
    animations[surface] = await page.evaluate(() =>
      document
        .getAnimations()
        .filter(animation => animation.playState === 'running')
        .map(animation => ({
          name: animation.animationName ?? animation.transitionProperty ?? 'script',
          iterations: animation.effect?.getTiming().iterations ?? null,
        })),
    );
  }
  const frames = await app.evaluate(async ({ BrowserWindow }, ms) => {
    const counts = {};
    const visible = BrowserWindow.getAllWindows().filter(win => win.isVisible());
    for (const win of visible) {
      const surface = new URL(win.webContents.getURL()).searchParams.get('surface');
      counts[surface] = 0;
      win.webContents.beginFrameSubscription(false, () => counts[surface]++);
    }
    await new Promise(done => setTimeout(done, ms));
    for (const win of visible) if (!win.isDestroyed()) win.webContents.endFrameSubscription();
    return counts;
  }, config.frameProbeMs);
  return { runningAnimations: animations, framesPresented: frames, probeMs: config.frameProbeMs };
}

/**
 * Chromium's layout/style/task counters per renderer. One DevTools session stays open for the
 * whole phase because re-enabling the Performance domain can restart its counters.
 */
async function openRendererCounters(app, pages) {
  const sessions = {};
  for (const [surface, page] of Object.entries(pages)) {
    sessions[surface] = await app.context().newCDPSession(page);
    await sessions[surface].send('Performance.enable');
  }
  const read = async () => {
    const counters = {};
    for (const [surface, session] of Object.entries(sessions)) {
      const { metrics } = await session.send('Performance.getMetrics');
      const pick = name => metrics.find(metric => metric.name === name)?.value ?? null;
      counters[surface] = {
        layoutCount: pick('LayoutCount'),
        recalcStyleCount: pick('RecalcStyleCount'),
        taskDurationS: pick('TaskDuration'),
        scriptDurationS: pick('ScriptDuration'),
      };
    }
    return counters;
  };
  const close = () => Promise.all(Object.values(sessions).map(session => session.detach()));
  return { read, close };
}
function counterDelta(before, after) {
  return Object.fromEntries(
    Object.keys(after).map(surface => [
      surface,
      Object.fromEntries(
        Object.entries(after[surface]).map(([key, value]) => [
          key,
          round(value - before[surface][key], 3),
        ]),
      ),
    ]),
  );
}

/**
 * macOS physical footprint, the figure Activity Monitor shows as Memory. Unlike summed RSS,
 * the total counts pages shared between Edi's processes once.
 */
async function footprint(app) {
  const { processes } = await sample(app);
  const directory = await mkdtemp(join(tmpdir(), 'edi-footprint-'));
  const file = join(directory, 'footprint.json');
  try {
    const pids = processes.flatMap(({ pid }) => ['-p', String(pid)]);
    await run('footprint', ['-j', file, ...pids]);
    const report = JSON.parse(await readFile(file, 'utf8'));
    const labels = new Map(processes.map(metric => [metric.pid, metric.label]));
    return {
      totalMiB: round(report['total footprint'] / 2 ** 20),
      perProcessMiB: Object.fromEntries(
        report.processes.map(({ pid, footprint }) => [
          labels.get(pid) === 'renderer:other' ? `renderer:${pid}` : labels.get(pid),
          round(footprint / 2 ** 20),
        ]),
      ),
    };
  } catch (error) {
    return { error: String(error.message ?? error) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function idlePhase(app, pages, durationMs) {
  const counters = await openRendererCounters(app, pages);
  const before = await counters.read();
  const sampler = startSampler(app, config.sampleMs);
  await sleep(durationMs);
  const samples = await sampler.stop();
  const after = await counters.read();
  await counters.close();
  // Both probes run after the CPU samples so they cannot inflate them.
  const memory = await footprint(app);
  const render = await renderActivity(app, pages);
  const delta = counterDelta(before, after);
  const frames = Object.values(render.framesPresented);
  const animations = Object.values(render.runningAnimations).flat();
  return {
    summary: summarise(samples),
    // Subscribing to frames yields one initial frame; even a 1 fps loop would give ~10.
    repaintLoop: {
      detected: frames.some(count => count > 2) || animations.length > 0,
      maxFramesInProbe: Math.max(0, ...frames),
      runningAnimations: animations.length,
      layoutsAndStyleRecalcs: Object.values(delta).reduce(
        (sum, counts) => sum + counts.layoutCount + counts.recalcStyleCount,
        0,
      ),
    },
    rendererWork: { atStart: before, delta },
    render,
    footprint: memory,
    samples,
  };
}

async function windowState(app) {
  return app.evaluate(({ BrowserWindow }) =>
    Object.fromEntries(
      BrowserWindow.getAllWindows().map(win => [
        new URL(win.webContents.getURL()).searchParams.get('surface'),
        { visible: win.isVisible(), bounds: win.getBounds() },
      ]),
    ),
  );
}

async function dragPhase(app, pet, workspace) {
  const command = value => pet.evaluate(value => window.edi.command(value), value);
  const petBounds = async () => (await windowState(app)).pet.bounds;
  const sampler = startSampler(app, config.dragSampleMs);
  const drags = [];
  const moveLatencies = [];
  for (let index = 0; index < config.drags; index++) {
    // First half with the card pinned (it stays), second half unpinned (it follows the pet).
    const pinned = index < config.drags / 2;
    if (index === 0 || index === config.drags / 2) {
      await workspace.evaluate(value => window.edi.command(value), {
        type: 'set-pinned',
        pinned,
      });
    }
    const start = await petBounds();
    const origin = { x: start.x + 56, y: start.y + 65 };
    // Alternate up-left and back so the pet stays on screen; the pet starts bottom-right.
    const direction = index % 2 === 0 ? -1 : 1;
    const offset = { x: direction * 160, y: direction * 60 };
    const began = performance.now();
    await command({ type: 'pet-drag', phase: 'start', point: origin, pointerId: 1 });
    for (let step = 1; step <= config.dragSteps; step++) {
      const t = step / config.dragSteps;
      const point = {
        x: Math.round(origin.x + offset.x * t),
        y: Math.round(origin.y + offset.y * t),
      };
      const sent = performance.now();
      await command({
        type: 'pet-drag',
        phase: step === config.dragSteps ? 'end' : 'move',
        point,
        pointerId: 1,
      });
      moveLatencies.push(performance.now() - sent);
      await sleep(config.dragStepMs);
    }
    const end = await petBounds();
    drags.push({
      pinned,
      durationMs: round(performance.now() - began, 0),
      moved: { x: end.x - start.x, y: end.y - start.y },
    });
    await sleep(250);
  }
  const samples = await sampler.stop();
  return {
    summary: summarise(samples),
    drags,
    dragsThatMoved: drags.filter(drag => drag.moved.x !== 0 || drag.moved.y !== 0).length,
    commandRoundTripMs: stats(moveLatencies),
    samples,
  };
}

async function environment(app) {
  const inApp = await app.evaluate(({ app, screen }) => ({
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    packaged: app.isPackaged,
    displays: screen.getAllDisplays().map(display => ({
      size: display.size,
      scaleFactor: display.scaleFactor,
      refreshRate: display.displayFrequency,
    })),
  }));
  const text = async (command, args) => (await run(command, args)).stdout.trim();
  return {
    ...inApp,
    executablePath,
    // Identifies which package was measured; the checkout may have moved on since.
    packageBuiltAt: (await stat(join(executablePath, '../../Resources/app.asar'))).mtime,
    host: {
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      memoryGiB: round(totalmem() / 2 ** 30, 0),
      macOS: await text('sw_vers', ['-productVersion']).catch(() => null),
      model: await text('sysctl', ['-n', 'hw.model']).catch(() => null),
    },
  };
}

const profiles = [];
const result = { measuredAt: new Date().toISOString(), quick, config };
let current;
try {
  // (a) Cold launches: fresh process and profile each time; OS file caches are not flushed.
  result.coldLaunch = { runs: [] };
  for (let index = 0; index < config.coldRuns; index++) {
    current = await launch(profiles);
    const atReady = await sample(current.app);
    result.coldLaunch.runs.push({
      ...current.timing,
      workingSetMiB: round(mib(atReady.processes.reduce((n, p) => n + p.workingSetKiB, 0))),
      rssMiB: round(mib(atReady.processes.reduce((n, p) => n + (p.rssKiB ?? 0), 0))),
      processes: atReady.processes.map(({ label, workingSetKiB, rssKiB }) => ({
        label,
        workingSetMiB: round(mib(workingSetKiB)),
        rssMiB: round(mib(rssKiB ?? 0)),
      })),
    });
    if (index === 0) result.environment = await environment(current.app);
    await current.app.close();
    current = undefined;
  }
  result.coldLaunch.readyMs = stats(result.coldLaunch.runs.map(run => run.readyMs));
  result.coldLaunch.workingSetMiB = stats(result.coldLaunch.runs.map(run => run.workingSetMiB));

  current = await launch(profiles);
  const { app, pet, workspace } = current;
  await sleep(config.settleMs);

  // (b) Idle with the card hidden: only the pet window is on screen.
  result.idleHidden = {
    windows: await windowState(app),
    ...(await idlePhase(app, { pet }, config.idleHiddenMs)),
  };

  // (c) Card shown and pinned (so losing focus cannot hide it), then idle.
  await workspace.evaluate(() => window.edi.command({ type: 'show-workspace' }));
  await workspace.evaluate(() => window.edi.command({ type: 'set-pinned', pinned: true }));
  await sleep(config.settleMs);
  result.cardPinned = {
    windows: await windowState(app),
    ...(await idlePhase(app, { pet, workspace }, config.cardPinnedMs)),
  };

  // (d) Simulated pet drags through the pet's own drag commands, card visible.
  result.drags = {
    ...(await dragPhase(app, pet, workspace)),
    windows: await windowState(app),
    footprint: await footprint(app),
  };

  result.rendererErrors = current.errors;
  result.externalRequests = current.external;
} finally {
  await current?.app.close().catch(() => {});
  for (const profile of profiles) await rm(profile, { recursive: true, force: true });
}

const directory = resolve('tests/perf/results');
await mkdir(directory, { recursive: true });
const file = join(directory, `resources-${result.measuredAt.replace(/[:.]/g, '-')}.json`);
await writeFile(file, `${JSON.stringify(result, null, 2)}\n`);

const line = (name, summary) => {
  const { totals } = summary;
  return `${name.padEnd(14)} working set ${totals.workingSetMiB.median} MiB (p95 ${totals.workingSetMiB.p95}), RSS ${totals.rssMiB.median} MiB, CPU median ${totals.cpuPercent.median}% p95 ${totals.cpuPercent.p95}%, phase avg ${totals.averageCpuPercentFromPs}%`;
};
console.log(
  `Cold launch to ready: median ${result.coldLaunch.readyMs.median} ms (max ${result.coldLaunch.readyMs.max} ms), working set ${result.coldLaunch.workingSetMiB.median} MiB`,
);
console.log(line('Idle, hidden', result.idleHidden.summary));
console.log(line('Card pinned', result.cardPinned.summary));
console.log(line('Drags', result.drags.summary));
console.log(
  `Drags that moved: ${result.drags.dragsThatMoved}/${config.drags}; command round trip median ${result.drags.commandRoundTripMs.median} ms`,
);
for (const phase of ['idleHidden', 'cardPinned']) {
  console.log(`Idle repaint loop (${phase}): ${JSON.stringify(result[phase].repaintLoop)}`);
}
console.log(
  `Footprint (Activity Monitor memory) after each phase: ${['idleHidden', 'cardPinned', 'drags']
    .map(
      phase => `${phase} ${result[phase].footprint.totalMiB ?? result[phase].footprint.error} MiB`,
    )
    .join(', ')}`,
);
console.log(
  `Renderer errors: ${result.rendererErrors.length}; external renderer requests: ${result.externalRequests.length}`,
);
console.log(`Raw results: ${file}`);
