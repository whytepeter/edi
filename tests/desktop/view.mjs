import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRepositories, openDatabase } from '../../packages/storage/src/index.ts';

/*
 * A view (generated interface) end to end: stored content opens in the artifact window, is drawn
 * by Edi's own components, and a tap on a choice asks Edi for the next step.
 * Do not run while `pnpm dev` Edi is open: both share a bundle id and the test app is killed.
 */
const profile = await mkdtemp(join(tmpdir(), 'edi-view-'));
const documents = await mkdtemp(join(tmpdir(), 'edi-documents-'));
const runId = '00000000-0000-4000-8000-000000000001';
const callId = '00000000-0000-4000-8000-000000000002';
const content = {
  kind: 'view',
  title: 'Trip to Lisbon',
  blocks: [
    { type: 'stat', text: 'Flights', value: '$412', detail: 'return, direct' },
    { type: 'stat', text: 'Hotel', value: '$540', detail: '4 nights' },
    { type: 'stat', text: 'Total', value: '$952' },
    { type: 'progress', text: 'Budget used', values: [0.63] },
    {
      type: 'chart',
      text: 'Cost by day',
      style: 'bar',
      items: ['Thu', 'Fri', 'Sat', 'Sun'],
      values: [310, 180, 240, 222],
    },
    {
      type: 'chart',
      text: 'Where it goes',
      style: 'ring',
      items: ['Flights', 'Hotel', 'Food'],
      values: [412, 540, 180],
    },
    { type: 'list', text: 'Still to do', items: ['Renew travel card', 'Book airport transfer'] },
    { type: 'input', text: 'Anything to add?' },
    {
      type: 'choice',
      text: 'Which hotel?',
      ask: 'Book the hotel:',
      items: ['Alfama Loft', 'Baixa House', 'Keep looking'],
    },
    {
      type: 'button',
      text: 'Add it all to my calendar',
      ask: 'Add the Lisbon trip to my calendar',
    },
  ],
};

{
  const database = openDatabase(join(profile, 'edi.sqlite'));
  const repositories = createRepositories(database);
  repositories.runs.start({
    id: runId,
    prompt: 'Plan Lisbon',
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
    input: content,
    status: 'running',
    at: 2,
  });
  repositories.toolCalls.finish(
    callId,
    'succeeded',
    'Showed “Trip to Lisbon”.',
    {
      shown: true,
      kind: 'view',
      title: content.title,
      path: 'Artifacts/Views/trip.md',
      bytes: 200,
    },
    3,
  );
  repositories.artifacts.add({
    id: callId,
    kind: 'view',
    title: content.title,
    content,
    path: 'Artifacts/Views/edi-test-trip-missing.md',
    bytes: 200,
    createdAt: 3,
    updatedAt: 3,
  });
  database.close();
}

let app;
try {
  app = await electron.launch({
    env: { ...process.env, EDI_VOICE: 'off', EDI_MODEL_CATALOG: 'off', EDI_DOCUMENTS: documents },
    executablePath: resolve(
      'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    ),
    args: [resolve('apps/desktop'), `--user-data-dir=${profile}`],
  });
  await expect
    .poll(() => app.windows().filter(page => page.url().includes('surface=')).length)
    .toBe(2);
  const workspace = app.windows().find(page => page.url().includes('surface=workspace'));
  await workspace.locator('.workspace-card').waitFor({ state: 'attached' });
  await workspace.evaluate(() =>
    window.edi.command({ type: 'show-workspace', view: 'conversations' }),
  );
  await workspace.evaluate(ref => window.edi.command({ type: 'open-artifact', ref }), { callId });
  const openArtifactPage = () =>
    app.windows().find(page => page.url().includes('surface=artifact') && !page.isClosed());
  await expect.poll(() => Boolean(openArtifactPage())).toBe(true);
  const view = openArtifactPage();

  // Drawn by Edi's own components: figures, a progress bar, charts, a list.
  await expect(view.getByRole('heading', { name: 'Trip to Lisbon' })).toBeVisible();
  await expect(view.getByText('$952')).toBeVisible();
  await expect(view.getByRole('progressbar', { name: 'Budget used' })).toHaveAttribute(
    'aria-valuenow',
    '63',
  );
  await expect(view.getByText('Book airport transfer')).toBeVisible();
  await expect(view.locator('.view-bar')).toHaveCount(4);
  await expect(view.locator('.view-ring circle')).toHaveCount(3);
  // Nothing in a view is the model's HTML: no frame, no script of its own.
  await expect(view.locator('.view iframe')).toHaveCount(0);

  const screenshot = join(profile, 'view.png');
  await view.screenshot({ path: screenshot, fullPage: true });

  // A tap is a request to Edi, carrying what was typed. This profile has no AI set up, so the
  // agent answers with exactly that: proof the tap reached it, and that the view says why.
  await view.getByRole('textbox', { name: 'Anything to add?' }).fill('Late checkout');
  await view.getByRole('button', { name: 'Baixa House' }).click();
  await expect(view.getByRole('alert')).toHaveText('Set up OpenRouter first.');
  // Nothing is left half-pressed: the choices can be tapped again.
  await expect(view.getByRole('button', { name: 'Alfama Loft' })).toBeEnabled();
  console.log(`PASS: a view draws from data and a tap reaches Edi. Screenshot: ${screenshot}`);
} finally {
  await app?.close();
}
