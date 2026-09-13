import { protocol, session, type Session } from 'electron';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARTIFACT_HTML_CSP, withArtifactDefaults } from '@edi/contracts';

/**
 * Interactive pages (the `html` artifact kind) are untrusted: a model wrote them. They load only
 * inside the artifact window, which runs in its own in-memory session:
 *
 * - `edi-artifact://content/<callId>` is served by main from Edi's history, never from renderer
 *   input, with a CSP that sandboxes the page into an opaque origin and blocks every load.
 * - The session refuses any request that is not the app itself or that scheme, so even a page
 *   that slipped past its CSP has no network.
 * - Every permission (camera, microphone, notifications, clipboard, …) is denied.
 */
export const ARTIFACT_SCHEME = 'edi-artifact';
export const ARTIFACT_PARTITION = 'edi-artifact';

/** Must run before `app` is ready. A standard, secure scheme behaves like a normal origin. */
export function registerArtifactScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: ARTIFACT_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether the artifact window's session may load `url`: Edi's renderer, the scheme, inline data. */
export function artifactRequestAllowed(url: string, rendererDir: string, devOrigin?: string) {
  if (url.startsWith(`${ARTIFACT_SCHEME}://`)) return true;
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('devtools://'))
    return true;
  if (devOrigin) {
    const dev = new URL(devOrigin);
    const target = URL.canParse(url) ? new URL(url) : null;
    if (target && target.host === dev.host && ['http:', 'ws:'].includes(target.protocol))
      return true;
  }
  if (url.startsWith('file://')) {
    const inside = relative(rendererDir, fileURLToPath(url));
    return inside !== '' && !inside.startsWith('..') && !inside.startsWith(sep);
  }
  return false;
}

let prepared: Session | null = null;

export function artifactSession(
  loadHtml: (callId: string) => Promise<string | null>,
  rendererDir = join(__dirname, '../renderer'),
): Session {
  if (prepared) return prepared;
  const sandbox = session.fromPartition(ARTIFACT_PARTITION);
  const devOrigin = process.env.ELECTRON_RENDERER_URL;

  sandbox.protocol.handle(ARTIFACT_SCHEME, async request => {
    const url = new URL(request.url);
    const id = url.pathname.replace(/^\//, '');
    const html =
      url.host === 'content' && uuid.test(id) ? await loadHtml(id).catch(() => null) : null;
    if (html === null) return new Response('Not found', { status: 404 });
    return new Response(withArtifactDefaults(html), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': ARTIFACT_HTML_CSP,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'cache-control': 'no-store',
      },
    });
  });

  sandbox.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !artifactRequestAllowed(details.url, rendererDir, devOrigin) });
  });
  sandbox.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  sandbox.setPermissionCheckHandler(() => false);
  sandbox.on('will-download', event => event.preventDefault());

  prepared = sandbox;
  return sandbox;
}
