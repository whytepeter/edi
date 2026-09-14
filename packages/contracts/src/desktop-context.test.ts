import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeDesktopContext, normalizeDesktopContext, safePageUrl } from './index';

const home = '/Users/me';

test('desktop context is bounded, cleans addresses and turns documents into ~ paths', () => {
  const context = normalizeDesktopContext(
    {
      app: 'Visual Studio Code',
      bundleId: 'com.microsoft.VSCode',
      windowTitle: 'renderer.ts — edi',
      document: 'file:///Users/me/code/edi/src/renderer%20copy.ts',
      selectedText: `TypeError: x is undefined${' '.repeat(10)}${'y'.repeat(5000)}`,
      accessibility: true,
    },
    { home },
  );
  assert.equal(context?.document, '~/code/edi/src/renderer copy.ts');
  assert.equal(context?.selectedText?.length, 4000);
  assert.match(
    describeDesktopContext(context),
    /^App: Visual Studio Code\nWindow: renderer\.ts — edi/,
  );

  assert.equal(safePageUrl('https://example.com/a?q=rain#top'), 'https://example.com/a?q=rain');
  assert.equal(safePageUrl('https://example.com/reset?token=abc'), 'https://example.com/reset');
  for (const bad of ['chrome://settings', 'file:///etc/hosts', 'https://me:pw@example.com', 'x'])
    assert.equal(safePageUrl(bad), null, bad);
});

test('password managers keep only their name; empty reports give nothing', () => {
  assert.deepEqual(
    normalizeDesktopContext(
      {
        app: '1Password',
        bundleId: 'com.1password.1password',
        windowTitle: 'Bank',
        selectedText: 'pw',
      },
      { home },
    ),
    {
      app: '1Password',
      bundleId: 'com.1password.1password',
      windowTitle: null,
      url: null,
      document: null,
      selectedText: null,
    },
  );
  // Browsers report the tab as a web document; private windows share nothing but the app.
  const chrome = normalizeDesktopContext(
    {
      app: 'Google Chrome',
      windowTitle: 'Docs - Google Chrome',
      document: 'https://docs.example/a#b',
    },
    { home },
  );
  assert.deepEqual([chrome?.url, chrome?.document], ['https://docs.example/a', null]);
  const incognito = normalizeDesktopContext(
    {
      app: 'Google Chrome',
      windowTitle: 'Secret - Google Chrome (Incognito)',
      document: 'https://secret.example',
      selectedText: 'x',
    },
    { home },
  );
  assert.deepEqual(
    [incognito?.url, incognito?.windowTitle, incognito?.selectedText],
    [null, null, null],
  );
  assert.equal(normalizeDesktopContext({ app: '  ' }, { home }), null);
  assert.equal(normalizeDesktopContext('nope', { home }), null);
  assert.equal(describeDesktopContext(null), '');
});
