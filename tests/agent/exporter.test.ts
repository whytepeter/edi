import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Artifact, ArtifactRef } from '@edi/contracts';
import { Exporter } from '../../apps/desktop/src/main/exports/exporter';

const table: Artifact = {
  kind: 'table',
  title: 'Plan: Q3',
  columns: ['A', 'B', 'C', 'D', 'E', 'F'],
  rows: [['1', '2', '3', '4', '5', '6']],
};
const diagram: Artifact = { kind: 'diagram', title: 'Flow', mermaid: 'flowchart LR\n  a --> b' };
const ref: ArtifactRef = { callId: '00000000-0000-4000-8000-000000000001' };

/** A stand-in for the hidden export window: records what main asks of it. */
function fakeWindow() {
  const calls = { printed: [] as unknown[], destroyed: false };
  const webContents = {
    once: () => webContents,
    off: () => webContents,
    printToPDF: async (options: unknown) => {
      calls.printed.push(options);
      return Buffer.from('%PDF-1.7');
    },
  };
  const win = {
    webContents,
    isDestroyed: () => calls.destroyed,
    destroy: () => {
      calls.destroyed = true;
    },
  } as unknown as BrowserWindow;
  return { win, calls };
}

async function setup(content: Artifact, timeoutMs?: number) {
  const folder = join(await mkdtemp(join(tmpdir(), 'edi-exports-')), 'Exports');
  const windows: ReturnType<typeof fakeWindow>[] = [];
  const exporter = new Exporter({
    folder: () => folder,
    resolve: async () => content,
    draw: () => {
      const made = fakeWindow();
      windows.push(made);
      return made.win;
    },
    pageSize: () => 'A4',
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  return { folder, exporter, windows };
}

test('text exports go to Exports under a free name and never replace an earlier one', async () => {
  const { folder, exporter, windows } = await setup(table);
  const first = await exporter.export(ref, 'csv');
  const second = await exporter.export(ref, 'csv');
  assert.equal(first.name, 'Plan- Q3.csv');
  assert.equal(second.name, 'Plan- Q3 2.csv');
  assert.equal(await readFile(first.path, 'utf8'), 'A,B,C,D,E,F\n1,2,3,4,5,6\n');
  assert.deepEqual((await readdir(folder)).sort(), ['Plan- Q3 2.csv', 'Plan- Q3.csv']);
  assert.equal(exporter.lastPath, second.path);
  assert.equal(windows.length, 0, 'text needs no drawing');
  await assert.rejects(exporter.export(ref, 'png'), /can't be exported as PNG image/);
});

test('a PDF is printed from the hidden page once it has drawn, then the page closes', async () => {
  const { exporter, windows } = await setup(table);
  const pending = exporter.export(ref, 'pdf');
  await new Promise(resolve => setImmediate(resolve));
  const [{ win, calls }] = windows as [ReturnType<typeof fakeWindow>];
  assert.equal(exporter.owns(win.webContents), true);
  exporter.ready({});
  const file = await pending;
  assert.equal(await readFile(file.path, 'utf8'), '%PDF-1.7');
  // Six columns read better across the page.
  assert.equal((calls.printed[0] as { landscape: boolean }).landscape, true);
  assert.equal(calls.destroyed, true);
  assert.equal(exporter.owns(win.webContents), false);
});

test('diagram pictures come back from the page; failures and timeouts are reported', async () => {
  const { exporter, windows } = await setup(diagram, 50);
  const png = exporter.export(ref, 'png');
  await new Promise(resolve => setImmediate(resolve));
  exporter.ready({ png: `data:image/png;base64,${Buffer.from('PNG!').toString('base64')}` });
  assert.equal(await readFile((await png).path, 'utf8'), 'PNG!');

  const svg = exporter.export(ref, 'svg');
  await new Promise(resolve => setImmediate(resolve));
  exporter.ready({ svg: '<svg viewBox="0 0 10 10"></svg>' });
  assert.match(await readFile((await svg).path, 'utf8'), /^<\?xml[^>]*>\n<svg/);

  const failed = exporter.export(ref, 'svg');
  await new Promise(resolve => setImmediate(resolve));
  exporter.ready({ failed: true });
  await assert.rejects(failed, /couldn’t draw/);

  // A page that never reports times out, closes, and the next export still runs.
  await assert.rejects(exporter.export(ref, 'png'), /took too long/);
  assert.equal(windows.at(-1)!.calls.destroyed, true);
  assert.equal((await exporter.export(ref, 'mmd')).name, 'Flow.mmd');
});
