// Settings → AI: a second model for hard tasks is chosen, saved, shown and cleared.
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'edi-hard-'));
const app = await electron.launch({
  env: { ...process.env, EDI_VOICE: 'off', EDI_MODEL_CATALOG: 'off' },
  executablePath: resolve(
    'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
  ),
  args: [resolve('apps/desktop'), `--user-data-dir=${profile}`],
});
try {
  await expect
    .poll(() => app.windows().filter(page => page.url().includes('surface=')).length)
    .toBe(2);
  const card = app.windows().find(page => page.url().includes('surface=workspace'));
  await card.evaluate(() => window.edi.command({ type: 'show-workspace' }));
  // A made-up key: saving does not check it or make a request.
  await card.evaluate(() =>
    window.edi.command({
      type: 'configure-agent',
      apiKey: 'sk-or-v1-' + '0'.repeat(64),
      model: 'google/gemini-flash-test',
    }),
  );
  await card.evaluate(() =>
    window.edi.command({ type: 'open-view', view: 'settings.ai' }).catch(() => {}),
  );
  await card.getByRole('button', { name: /choose a section/ }).click();
  await card.getByRole('menuitem', { name: /Settings/ }).click();
  await card.getByRole('button', { name: /^AI/ }).click();
  await card.getByRole('button', { name: 'Choose a model for hard tasks' }).click();
  await expect(card.getByText('Hard tasks', { exact: true })).toBeVisible();
  const ids = card.getByRole('textbox', { name: 'OpenRouter model ID' });
  await ids.last().fill('anthropic/claude-strong-test');
  await card.getByRole('button', { name: 'Use this model' }).last().click();
  await expect
    .poll(async () => (await card.evaluate(() => window.edi.settings())).hardModel)
    .toBe('anthropic/claude-strong-test');
  await card.screenshot({ path: join(profile, 'hard-model.png') });
  await card.getByRole('button', { name: 'Use one model for everything' }).click();
  await expect
    .poll(async () => (await card.evaluate(() => window.edi.settings())).hardModel)
    .toBe('');
  await expect(card.getByRole('button', { name: 'Choose a model for hard tasks' })).toBeVisible();
  console.log('PASS: a hard-task model is chosen, saved, shown and cleared in Settings → AI.');
} finally {
  await app.close().catch(() => {});
}
