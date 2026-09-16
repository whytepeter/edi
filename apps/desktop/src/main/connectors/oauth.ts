import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { ConnectorSecrets, SecretStore } from './secrets';

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px -apple-system,system-ui;margin:0;display:grid;place-items:center;height:100vh;background:#f5f3ef;color:#2b2320"><div style="text-align:center;max-width:360px"><h1 style="font-size:20px">${title}</h1><p>${body}</p></div>`;

const escape = (text: string) => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

/**
 * The browser returns here after sign-in: a one-shot listener on 127.0.0.1 that accepts only
 * the expected path and state, per the loopback redirect for native apps (RFC 8252).
 */
export class LoopbackCallback {
  private server?: Server;
  port = 0;
  private settle?: { resolve(code: string): void; reject(error: Error): void };
  readonly state = randomBytes(24).toString('base64url');

  /** Listens on `preferred` when it is free, else any port. */
  async listen(preferred?: number) {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        response.writeHead(404).end();
        return;
      }
      const done = (status: number, title: string, body: string) => {
        response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
        response.end(page(title, body));
      };
      if (url.searchParams.get('state') !== this.state) {
        done(400, 'That sign-in link has expired', 'Start again from Connectors in Edi.');
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (error || !code) {
        done(
          400,
          'Sign-in didn’t finish',
          escape(
            url.searchParams.get('error_description') ??
              'You can try again from Connectors in Edi.',
          ),
        );
        this.settle?.reject(
          new Error(
            error === 'access_denied' ? 'Sign-in was cancelled.' : 'Sign-in didn’t finish.',
          ),
        );
        return;
      }
      done(200, 'You’re signed in', 'You can close this tab and go back to Edi.');
      this.settle?.resolve(code);
    });
    const bind = (port: number) =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve((server.address() as { port: number }).port);
        });
      });
    try {
      this.port = await bind(preferred ?? 0);
    } catch {
      this.port = await bind(0);
    }
    this.server = server;
    return this.port;
  }

  get redirectUrl() {
    return `http://127.0.0.1:${this.port}/callback`;
  }

  /** Resolves with the authorization code, or rejects on cancel, timeout or `signal`. */
  code(timeoutMs: number, signal?: AbortSignal) {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sign-in timed out.')), timeoutMs);
      const finish = () => {
        clearTimeout(timer);
        this.close();
      };
      signal?.addEventListener('abort', () => {
        finish();
        reject(new Error('Sign-in was cancelled.'));
      });
      this.settle = {
        resolve: code => {
          finish();
          resolve(code);
        },
        reject: error => {
          finish();
          reject(error);
        },
      };
    });
  }

  close() {
    this.server?.close();
    this.server = undefined;
  }
}

/**
 * The MCP SDK's sign-in hooks for one connector: client registration, PKCE verifier and tokens
 * go to the encrypted store; the authorization page opens in the person's browser only when
 * they started the sign-in themselves.
 */
export class ConnectorAuth implements OAuthClientProvider {
  private cache?: ConnectorSecrets;
  /** Set when the server needs a fresh sign-in the person didn't ask for. */
  needsSignIn = false;

  constructor(
    private readonly id: string,
    private readonly store: SecretStore,
    private readonly callback: LoopbackCallback | null,
    private readonly openBrowser: (url: string) => Promise<void>,
    private readonly registeredPort?: number,
  ) {}

  private async secrets() {
    this.cache ??= await this.store.read(this.id);
    return this.cache;
  }

  private async save(patch: Partial<ConnectorSecrets>) {
    const next = { ...(await this.secrets()), ...patch };
    this.cache = next;
    await this.store.write(this.id, next);
  }

  /**
   * Always an address: without one the SDK would try a machine-to-machine sign-in. When nobody
   * started a sign-in, registering or opening the browser only marks the app as needing one.
   */
  get redirectUrl() {
    const port = this.callback?.port ?? this.registeredPort;
    return port ? `http://127.0.0.1:${port}/callback` : 'http://127.0.0.1/callback';
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Edi',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  state() {
    return this.callback?.state ?? randomBytes(24).toString('base64url');
  }

  async clientInformation() {
    const secrets = await this.secrets();
    // A client registered for another loopback port can't receive this sign-in.
    if (this.callback && secrets.port !== this.callback.port) return undefined;
    return secrets.client;
  }

  async saveClientInformation(client: OAuthClientInformationMixed) {
    if (!this.callback) {
      this.needsSignIn = true;
      throw new UnauthorizedError('Sign in first.');
    }
    await this.save({ client, port: this.callback.port });
  }

  async tokens() {
    return (await this.secrets()).tokens;
  }

  async saveTokens(tokens: OAuthTokens) {
    await this.save({ tokens });
  }

  async redirectToAuthorization(url: URL) {
    if (!this.callback) {
      this.needsSignIn = true;
      return;
    }
    const local = url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !local) throw new Error('The sign-in page must use https.');
    await this.openBrowser(url.href);
  }

  async saveCodeVerifier(codeVerifier: string) {
    await this.save({ codeVerifier });
  }

  async codeVerifier() {
    const verifier = (await this.secrets()).codeVerifier;
    if (!verifier) throw new Error('Sign-in didn’t finish. Try again.');
    return verifier;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    const secrets = { ...(await this.secrets()) };
    if (scope === 'all' || scope === 'client') delete secrets.client;
    if (scope === 'all' || scope === 'tokens') delete secrets.tokens;
    if (scope === 'all' || scope === 'verifier') delete secrets.codeVerifier;
    this.cache = secrets;
    await this.store.write(this.id, secrets);
  }
}
