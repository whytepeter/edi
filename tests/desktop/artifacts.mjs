import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRepositories, openDatabase } from '../../packages/storage/src/index.ts';

/*
 * Shown content end to end: a stored `workspace.show` call opens in the artifact window beside
 * the card (from the conversation command and from Library), and an interactive page runs its
 * script while the sandbox blocks network, storage and any reach into Edi.
 * Do not run while `pnpm dev` Edi is open: both share a bundle id and the test app is killed.
 */
const profile = await mkdtemp(join(tmpdir(), 'edi-artifacts-'));
const runId = '00000000-0000-4000-8000-000000000001';
const callId = '00000000-0000-4000-8000-000000000002';
const diagramId = '00000000-0000-4000-8000-000000000003';

const page = `<!doctype html><html lang="en"><head><title>Probe</title></head><body>
<button id="count">Count 0</button><pre id="result">running</pre>
<script>
  const out = { script: true };
  try { out.parent = window.parent.edi ? 'open' : 'none'; } catch { out.parent = 'blocked'; }
  try { localStorage.setItem('edi', '1'); out.storage = 'open'; } catch { out.storage = 'blocked'; }
  let clicks = 0;
  document.getElementById('count').onclick = () => {
    document.getElementById('count').textContent = 'Count ' + ++clicks;
  };
  fetch('https://example.com/edi-probe')
    .then(() => (out.fetch = 'open'), () => (out.fetch = 'blocked'))
    .finally(() => {
      const image = new Image();
      image.onload = () => finish('open');
      image.onerror = () => finish('blocked');
      image.src = 'https://example.com/edi-probe.png';
    });
  function finish(image) {
    out.image = image;
    document.getElementById('result').textContent = JSON.stringify(out);
  }
</script></body></html>`;

{
  const database = openDatabase(join(profile, 'edi.sqlite'));
  const repositories = createRepositories(database);
  repositories.runs.start({
    id: runId,
    prompt: 'Make a probe',
    model: 'test/model',
    screens: 0,
    startedAt: 1,
  });
  repositories.toolCalls.create({
    id: callId,
    runId,
    capability: 'workspace.show',
    title: 'Show content',
    effect: 'read',
    input: { kind: 'html', title: 'Sandbox probe', html: page },
    status: 'running',
    at: 2,
  });
  repositories.toolCalls.finish(
    callId,
    'succeeded',
    'Showed “Sandbox probe”.',
    {
      shown: true,
      kind: 'html',
      title: 'Sandbox probe',
      path: 'Artifacts/Interactive/sandbox-probe.html',
      bytes: page.length,
    },
    3,
  );
  repositories.artifacts.add({
    id: callId,
    kind: 'html',
    title: 'Sandbox probe',
    content: { kind: 'html', title: 'Sandbox probe', html: page },
    // Never written in this test, so Delete finds no file and trashes nothing on this Mac.
    path: 'Artifacts/Interactive/edi-test-sandbox-probe-missing.html',
    bytes: page.length,
    createdAt: 3,
    updatedAt: 3,
  });
  // A diagram, drawn by the bundled Mermaid inside the artifact window.
  const mermaid = 'flowchart LR\n  app[Edi] --> api[API]\n  api --> db[(Database)]';
  repositories.toolCalls.create({
    id: diagramId,
    runId,
    capability: 'workspace.show',
    title: 'Show content',
    effect: 'read',
    input: { kind: 'diagram', title: 'Architecture', mermaid },
    status: 'running',
    at: 4,
  });
  repositories.toolCalls.finish(
    diagramId,
    'succeeded',
    'Showed “Architecture”.',
    {
      shown: true,
      kind: 'diagram',
      title: 'Architecture',
      path: 'Artifacts/Diagrams/x.mmd',
      bytes: 60,
    },
    5,
  );
  repositories.artifacts.add({
    id: diagramId,
    kind: 'diagram',
    title: 'Architecture',
    content: { kind: 'diagram', title: 'Architecture', mermaid },
    path: 'Artifacts/Diagrams/edi-test-architecture-missing.mmd',
    bytes: 60,
    createdAt: 5,
    updatedAt: 5,
  });
  database.close();
}

let app;
try {
  app = await electron.launch({
    env: { ...process.env, EDI_VOICE: 'off', EDI_MODEL_CATALOG: 'off' },
    executablePath: resolve(
      'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    ),
    args: [resolve('apps/desktop'), `--user-data-dir=${profile}`],
  });
  await expect
    .poll(() => app.windows().filter(page => page.url().includes('surface=')).length)
    .toBe(2);
  const workspace = app.windows().find(page => page.url().includes('surface=workspace'));
  // A closed artifact window can linger in the list for a moment; only an open one counts.
  const openArtifactPage = () =>
    app.windows().find(page => page.url().includes('surface=artifact') && !page.isClosed());
  const artifactWindow = async () => {
    await expect.poll(() => Boolean(openArtifactPage())).toBe(true);
    return openArtifactPage();
  };
  const artifactOpen = () => Boolean(openArtifactPage());

  // 1. From the conversation: the page stays put and the artifact opens beside the card.
  await workspace.evaluate(() =>
    window.edi.command({ type: 'show-workspace', view: 'conversations' }),
  );
  await workspace.evaluate(ref => window.edi.command({ type: 'open-artifact', ref }), { callId });
  let artifact = await artifactWindow();
  await expect(artifact.getByRole('heading', { name: 'Sandbox probe' })).toBeVisible();
  await expect(artifact.getByText('Interactive', { exact: true })).toBeVisible();
  for (const name of ['Copy', 'Download', 'Show in Finder', 'Close'])
    await expect(artifact.getByRole('button', { name })).toBeVisible();
  await expect(artifact.getByRole('button', { name: /Back/ })).toHaveCount(0);
  // Copy uses the real system clipboard; put the person's clipboard back afterwards.
  const savedClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await artifact.getByRole('button', { name: 'Copy' }).click();
    await expect(artifact.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain('<');
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), savedClipboard);
  }
  // Navigation lands a moment after launch; wait for it rather than reading once.
  await expect
    .poll(() => workspace.evaluate(() => document.querySelector('.workspace-card').dataset.view))
    .toBe('conversations');
  const [card, shown] = await app.evaluate(({ BrowserWindow }) =>
    ['surface=workspace', 'surface=artifact'].map(surface =>
      BrowserWindow.getAllWindows()
        .find(win => win.webContents.getURL().includes(surface))
        .getBounds(),
    ),
  );
  expect(shown.x >= card.x + card.width || shown.x + shown.width <= card.x).toBe(true);

  // 2. The sandbox: script runs and responds; network, storage and Edi's window are out of reach.
  const frame = artifact.frameLocator('iframe.artifact-html');
  await expect(frame.locator('#result')).toContainText('"image"', { timeout: 10_000 });
  const result = JSON.parse(await frame.locator('#result').textContent());
  expect(result).toEqual({
    script: true,
    parent: 'blocked',
    storage: 'blocked',
    fetch: 'blocked',
    image: 'blocked',
  });
  await frame.getByRole('button', { name: 'Count 0' }).click();
  await expect(frame.getByRole('button', { name: 'Count 1' })).toBeVisible();
  const iframe = artifact.locator('iframe.artifact-html');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  // Main serves pages only from history, always with the sandboxing CSP.
  const served = await app.evaluate(async ({ session }, id) => {
    const sandbox = session.fromPartition('edi-artifact');
    const known = await sandbox.fetch(`edi-artifact://content/${id}`);
    const unknown = await sandbox.fetch(
      'edi-artifact://content/00000000-0000-4000-8000-00000000dead',
    );
    return {
      status: known.status,
      csp: known.headers.get('content-security-policy'),
      unknown: unknown.status,
    };
  }, callId);
  expect(served.status).toBe(200);
  expect(served.csp).toContain('sandbox allow-scripts');
  expect(served.csp).toContain("default-src 'none'");
  expect(served.unknown).toBe(404);

  // 3. Close dismisses the window.
  await artifact.getByRole('button', { name: 'Close' }).click();
  await expect.poll(artifactOpen).toBe(false);

  // 4. From Library: the same artifact is listed and opens in the window.
  await workspace.evaluate(() => window.edi.command({ type: 'show-workspace', view: 'library' }));
  const row = workspace.getByRole('button', { name: /^Sandbox probe/ });
  await expect(row).toBeVisible();
  await row.click();
  artifact = await artifactWindow();
  await expect(artifact.getByRole('heading', { name: 'Sandbox probe' })).toBeVisible();
  expect(
    await workspace.evaluate(() => document.querySelector('.workspace-card').dataset.view),
  ).toBe('library');
  // Escape closes the window mid-keypress, so the press itself may report the page closed.
  await artifact.keyboard.press('Escape').catch(() => {});
  await expect.poll(artifactOpen).toBe(false);

  // 5. Library Delete asks first; Cancel keeps the item, Move to Trash removes it everywhere.
  await workspace.getByRole('button', { name: 'Delete “Sandbox probe”' }).click();
  await expect(workspace.getByText(/Move “Sandbox probe” to the Trash\?/)).toBeVisible();
  await workspace.getByRole('button', { name: 'Cancel' }).click();
  await expect(row).toBeVisible();
  await workspace.getByRole('button', { name: 'Delete “Sandbox probe”' }).click();
  await workspace.getByRole('button', { name: 'Move to Trash' }).click();
  await expect(row).toHaveCount(0);
  expect((await workspace.evaluate(() => window.edi.library())).map(item => item.id)).not.toContain(
    callId,
  );

  // 6. A diagram opens drawn: Mermaid renders its SVG in the window, offline and sandboxed.
  await workspace.evaluate(ref => window.edi.command({ type: 'open-artifact', ref }), {
    callId: diagramId,
  });
  artifact = await artifactWindow();
  await expect(artifact.getByRole('heading', { name: 'Architecture' })).toBeVisible();
  await expect(artifact.getByText('Diagram', { exact: true })).toBeVisible();
  await expect(artifact.locator('.artifact-diagram svg')).toBeVisible({ timeout: 15_000 });
  await expect(artifact.locator('.artifact-diagram')).toContainText('Database');
  for (const name of ['Copy', 'Download'])
    await expect(artifact.getByRole('button', { name })).toBeVisible();
  await artifact.keyboard.press('Escape').catch(() => {});

  console.log(
    'PASS: diagrams draw; artifact window from conversation and Library; sandboxed page runs with no network, storage or bridge; Library delete confirms first.',
  );
} finally {
  await app?.close();
}
