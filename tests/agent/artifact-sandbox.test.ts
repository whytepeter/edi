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

test('a page is taken whichever field it arrives in, and says which field it wants', () => {
  const page = '<!doctype html><html lang="en"><body><canvas id="board"></canvas></body></html>';
  // The model sent an interactive page in `markdown`; the content is the page either way.
  assert.deepEqual(toArtifactContent({ kind: 'html', title: 'Chess', markdown: page }), {
    kind: 'html',
    title: 'Chess',
    html: page,
  });
  assert.deepEqual(
    toArtifactContent({ kind: 'diagram', title: 'Flow', markdown: 'flowchart LR\n  a --> b' }),
    { kind: 'diagram', title: 'Flow', mermaid: 'flowchart LR\n  a --> b' },
  );
  // With no content at all, the message names the field to use.
  assert.throws(() => toArtifactContent({ kind: 'html', title: 'Empty' }), /in `html`/);
  assert.throws(() => toArtifactContent({ kind: 'diagram', title: 'Empty' }), /in `mermaid`/);
});

test('a page that needs the web is refused, because the sandbox would leave it empty', () => {
  // What Edi actually wrote for the 3D chess game: the board never appeared.
  const chess =
    '<!doctype html><html><head>' +
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>' +
    '<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>' +
    '</head><body><script>const s = new THREE.Scene();</script></body></html>';
  assert.throws(() => toArtifactContent({ kind: 'html', title: '3D Chess', html: chess }), {
    message: /no network.*never loads/s,
  });
  for (const bad of [
    '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">',
    '<script type="module">import * as THREE from \'https://unpkg.com/three\';</script>',
    "<script>fetch('https://example.com/scores')</script>",
    '<img src="http://example.com/piece.png">',
  ])
    assert.throws(
      () => toArtifactContent({ kind: 'html', title: 'Page', html: `<!doctype html>${bad}` }),
      /no network/,
      bad,
    );
  // A link the person can read is not a load, and stays allowed.
  const linked =
    '<!doctype html><html><body><a href="https://example.com">Example</a><script>1;</script></body></html>';
  assert.equal(toArtifactContent({ kind: 'html', title: 'Links', html: linked }).kind, 'html');
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
  assert.throws(() => toArtifactContent({ kind: 'html', title: 'Empty' }), /needs the whole page, in `html`/);
});
