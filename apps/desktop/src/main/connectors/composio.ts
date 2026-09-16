/**
 * Composio adapter (API v3.1) with the person's own Composio key. Composio holds each app's
 * OAuth client and the resulting sign-in, so Edi needs no per-app OAuth registration; Edi keeps
 * only the key and the connected account id. Tools still run through Edi's broker and approvals.
 * https://backend.composio.dev/api/v3.1/openapi.json
 */

const API_BASE = 'https://backend.composio.dev/api/v3.1';
const REQUEST_TIMEOUT_MS = 60_000;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const POLL_MS = 2_500;
/** Toolkits with more tools than this list only Composio's featured ones (GitHub has hundreds). */
const MAX_TOOLKIT_TOOLS = 60;
/**
 * Composio scopes connected accounts by a user id of the caller's choosing. The key belongs to
 * one person, so every Edi on their Macs shares one id and one set of accounts.
 */
export const COMPOSIO_USER_ID = 'edi';

export type ComposioAccountStatus =
  | 'INITIALIZING'
  | 'INITIATED'
  | 'ACTIVE'
  | 'FAILED'
  | 'EXPIRED'
  | 'INACTIVE'
  | 'REVOKED';

export interface ComposioAccount {
  id: string;
  toolkit: string;
  status: ComposioAccountStatus;
}

export interface ComposioTool {
  slug: string;
  name: string;
  description: string;
  version: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}

export class ComposioError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface Page<T> {
  items?: T[];
  next_cursor?: string | null;
  total_items?: number;
}

interface RawAccount {
  id?: string;
  status?: string;
  toolkit?: { slug?: string };
}

interface RawTool {
  slug?: string;
  name?: string;
  description?: string;
  human_description?: string;
  version?: string;
  input_parameters?: Record<string, unknown>;
  tags?: string[];
  is_deprecated?: boolean;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class ComposioAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: Fetch = (url, init) => fetch(url, init),
  ) {}

  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown; signal?: AbortSignal; keyHeader?: string } = {},
  ): Promise<T> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await this.fetchImpl(`${API_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        [init.keyHeader ?? 'x-api-key']: this.apiKey,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ComposioError(errorMessage(text) || `Composio returned ${response.status}.`, response.status);
    }
    return (await response.json()) as T;
  }

  /**
   * The key works as a project key; used before saving it. Composio also issues user keys, which
   * look alike but go in another header, so a refused key is checked once more to say which.
   */
  async verify() {
    try {
      await this.request<Page<unknown>>('/auth_configs?limit=1');
    } catch (error) {
      if (!(error instanceof ComposioError) || error.status !== 401) throw error;
      const userKey = await this.request<Page<unknown>>('/auth_configs?limit=1', {
        keyHeader: 'x-user-api-key',
      }).then(
        () => true,
        () => false,
      );
      throw new ComposioError(
        userKey
          ? 'That’s a Composio user key. Use your project’s API key: in Composio, open the project, then Settings → API Keys.'
          : `Composio didn’t accept that key (${error.message}). Copy the project’s API key again.`,
        401,
      );
    }
  }

  /**
   * Composio's own OAuth setup for a toolkit, reused when one exists. Toolkits without a
   * Composio-managed app need the person's own setup in Composio's dashboard.
   */
  private async authConfigFor(toolkit: string): Promise<string> {
    const query = new URLSearchParams({ toolkit_slug: toolkit, limit: '20' });
    const page = await this.request<Page<{ id?: string; status?: string }>>(
      `/auth_configs?${query}`,
    );
    const existing = page.items?.find(item => item.id && item.status !== 'DISABLED');
    if (existing?.id) return existing.id;
    const created = await this.request<{ auth_config?: { id?: string } }>('/auth_configs', {
      method: 'POST',
      body: { toolkit: { slug: toolkit }, auth_config: { type: 'use_composio_managed_auth' } },
    });
    if (!created.auth_config?.id) throw new Error('Composio didn’t set up sign-in for that app.');
    return created.auth_config.id;
  }

  /** Starts sign-in; the person finishes it in the browser at `redirectUrl`. */
  async startSignIn(toolkit: string): Promise<{ accountId: string; redirectUrl: string }> {
    const authConfigId = await this.authConfigFor(toolkit);
    const link = await this.request<{ connected_account_id?: string; redirect_url?: string }>(
      '/connected_accounts/link',
      { method: 'POST', body: { auth_config_id: authConfigId, user_id: COMPOSIO_USER_ID } },
    );
    if (!link.connected_account_id || !link.redirect_url)
      throw new Error('Composio didn’t return a sign-in page.');
    return { accountId: link.connected_account_id, redirectUrl: link.redirect_url };
  }

  async account(id: string): Promise<ComposioAccount> {
    return toAccount(await this.request<RawAccount>(`/connected_accounts/${encodeURIComponent(id)}`));
  }

  /** An active account for this toolkit made earlier (by this or another Edi on the same key). */
  async activeAccount(toolkit: string): Promise<ComposioAccount | undefined> {
    const query = new URLSearchParams({
      toolkit_slugs: toolkit,
      user_ids: COMPOSIO_USER_ID,
      statuses: 'ACTIVE',
      limit: '1',
    });
    const page = await this.request<Page<RawAccount>>(`/connected_accounts?${query}`);
    const first = page.items?.[0];
    return first ? toAccount(first) : undefined;
  }

  /** Waits until the browser sign-in finishes; false when it fails, expires or is cancelled. */
  async waitUntilActive(id: string, signal: AbortSignal): Promise<boolean> {
    const deadline = Date.now() + SIGN_IN_TIMEOUT_MS;
    while (Date.now() < deadline && !signal.aborted) {
      const { status } = await this.account(id);
      if (status === 'ACTIVE') return true;
      if (status !== 'INITIALIZING' && status !== 'INITIATED') return false;
      await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }
    return false;
  }

  async removeAccount(id: string) {
    await this.request(`/connected_accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /**
   * A toolkit's tools, `preferred` first and in that order. Big toolkits list only Composio's
   * featured tools, so preferred ones missing from that page are fetched by name.
   */
  async listTools(toolkit: string, preferred: readonly string[] = []): Promise<ComposioTool[]> {
    const all = await this.toolPage({ toolkit_slug: toolkit });
    const featured =
      all.total > MAX_TOOLKIT_TOOLS
        ? (await this.toolPage({ toolkit_slug: toolkit, important: 'true' })).tools
        : [];
    const listed = featured.length > 0 ? featured : all.tools;
    const have = new Set(listed.map(tool => tool.slug));
    const missing = preferred.filter(slug => !have.has(slug));
    const named = missing.length
      ? (await this.toolPage({ tool_slugs: missing.join(',') }, missing.length)).tools
      : [];
    const rank = (slug = '') => {
      const index = preferred.indexOf(slug);
      return index === -1 ? preferred.length : index;
    };
    const seen = new Set<string>();
    return [...named, ...listed]
      .filter(tool => {
        if (!tool.slug || tool.is_deprecated || seen.has(tool.slug)) return false;
        seen.add(tool.slug);
        return true;
      })
      .sort((a, b) => rank(a.slug) - rank(b.slug))
      .map(toTool);
  }

  private async toolPage(filter: Record<string, string>, limit = MAX_TOOLKIT_TOOLS) {
    const query = new URLSearchParams({ ...filter, limit: String(limit) });
    const page = await this.request<Page<RawTool>>(`/tools?${query}`);
    const tools = page.items ?? [];
    return { tools, total: page.total_items ?? tools.length };
  }

  async execute(
    tool: { slug: string; version?: string },
    args: Record<string, unknown>,
    accountId: string,
    signal?: AbortSignal,
  ): Promise<{ successful: boolean; data: unknown; error: string | null }> {
    const result = await this.request<{ successful?: boolean; data?: unknown; error?: string | null }>(
      `/tools/execute/${encodeURIComponent(tool.slug)}`,
      {
        method: 'POST',
        body: {
          connected_account_id: accountId,
          user_id: COMPOSIO_USER_ID,
          arguments: args,
          ...(tool.version ? { version: tool.version } : {}),
        },
        ...(signal ? { signal } : {}),
      },
    );
    return {
      successful: result.successful === true,
      data: result.data ?? null,
      error: result.error ?? null,
    };
  }
}

function toAccount(raw: RawAccount): ComposioAccount {
  return {
    id: raw.id ?? '',
    toolkit: raw.toolkit?.slug ?? '',
    status: (raw.status as ComposioAccountStatus | undefined) ?? 'FAILED',
  };
}

function toTool(raw: RawTool): ComposioTool {
  const schema = raw.input_parameters ?? {};
  return {
    slug: raw.slug ?? '',
    name: raw.name ?? raw.slug ?? '',
    description: (raw.human_description || raw.description || '').slice(0, 600),
    version: raw.version ?? '',
    inputSchema: { type: 'object', properties: {}, ...schema },
    // Composio carries MCP annotations as tags; only the exact hint counts.
    readOnly: raw.tags?.includes('readOnlyHint') === true,
  };
}

/** Composio errors come as {error: {message}} or {message}; keep only a short message. */
function errorMessage(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    const message =
      typeof body.error === 'string' ? body.error : (body.error?.message ?? body.message ?? '');
    return message.slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}
