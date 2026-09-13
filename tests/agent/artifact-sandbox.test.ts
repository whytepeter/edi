import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  ARTIFACT_HTML_CSP,
  artifactContentSchema,
  artifactExport,
  artifactPreview,
  withArtifactDefaults,
} from '../../packages/contracts/src/index';
import { artifactRequestAllowed } from '../../apps/desktop/src/main/windows/artifact-sandbox';
import { toArtifactContent } from '../../packages/capabilities/src/builtins/workspace';

const renderer = '/Applications/Edi.app/Contents/Resources/app/out/renderer';

test('the artifact session loads only Edi itself, its private scheme and inline data', () => {
  const allowed = (url: string, dev?: string) => artifactRequestAllowed(url, renderer, dev);
  assert.equal(allowed('edi-artifact://content/00000000-0000-4000-8000-000000000001'), true);
  assert.equal(allowed(pathToFileURL(`${renderer}/index.html`).href), true);
  assert.equal(allowed(pathToFileURL(`${renderer}/assets/index.js`).href), true);
  assert.equal(allowed('data:image/png;base64,AAAA'), true);
  // Anything a generated page might reach for is refused.
  assert.equal(allowed('https://example.com/track.js'), false);
  assert.equal(allowed('http://localhost:8080/'), false);
  assert.equal(allowed('ws://127.0.0.1:9000/'), false);
  assert.equal(allowed(pathToFileURL('/Users/someone/.ssh/id_rsa').href), false);
  assert.equal(allowed(pathToFileURL(`${renderer}/../main/index.js`).href), false);
  // In development, only the dev server's own origin (page and hot reload) is added.
  assert.equal(allowed('http://localhost:5173/src/main.tsx', 'http://localhost:5173'), true);
  assert.equal(allowed('ws://localhost:5173/', 'http://localhost:5173'), true);
  assert.equal(allowed('http://localhost:5174/', 'http://localhost:5173'), false);
});

test('interactive pages are sandboxed, legible by default, and exported as HTML', () => {
  assert.match(ARTIFACT_HTML_CSP, /default-src 'none'/);
  assert.match(ARTIFACT_HTML_CSP, /sandbox allow-scripts(;|$)/);
  assert.doesNotMatch(ARTIFACT_HTML_CSP, /allow-same-origin|connect-src|https?:/);

  const full = withArtifactDefaults(
    '<!doctype html><html lang="en"><head><title>T</title></head><body>x</body></html>',
  );
  assert.match(full, /<head><meta charset="utf-8"><meta name="color-scheme" content="light dark">/);
  assert.equal(full.indexOf('<title>') > full.indexOf('color-scheme'), true);
  assert.match(withArtifactDefaults('<html><body>x</body></html>'), /<html><head><meta charset/);
  const fragment = withArtifactDefaults('<!doctype html><button>Go</button>');
  assert.match(fragment, /^<!doctype html><html><head>.*<\/head><body><button>Go<\/button>/);
  assert.equal(withArtifactDefaults('<header>Hi</header>').startsWith('<!doctype html>'), true);

  const page = {
    kind: 'html' as const,
    title: 'Tip calculator',
    html: '<style>b{}</style><h1>Tip</h1><script>let x = 1</script><p>Split&nbsp;the bill</p>',
  };
  assert.equal(artifactContentSchema.safeParse(page).success, true);
  assert.deepEqual(artifactExport(page), { copy: page.html, extension: 'html', file: page.html });
  assert.equal(artifactPreview(page), 'Tip Split the bill');
  assert.deepEqual(toArtifactContent(page), page);
  assert.throws(() => toArtifactContent({ kind: 'html', title: 'Empty' }), /needs its HTML/);
});
