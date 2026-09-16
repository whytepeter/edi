import { z } from 'zod';

/**
 * Connected apps: either direct MCP servers (Streamable HTTP with their own OAuth) or
 * Composio-managed apps (OAuth handled by Composio). Their sign-in lives encrypted on
 * this Mac; what they can do shows up as Edi tools (read-only ones run without approval,
 * writes are reviewed), and whatever they return is information from another service, never
 * instructions.
 */
export const connectorStatusSchema = z.enum([
  'connected',
  'connecting',
  'needs-sign-in',
  /** A Composio app while Composio's key is missing or refused. */
  'needs-key',
  'signing-in',
  'error',
  'off',
]);
export type ConnectorStatus = z.infer<typeof connectorStatusSchema>;

export const connectorProviderSchema = z.enum(['mcp', 'composio', 'local']);
export type ConnectorProvider = z.infer<typeof connectorProviderSchema>;

/**
 * The runtimes Edi will start a local server with. Only these two, and only a published
 * package: a free-form command would be a way to run anything on this Mac, which is the one
 * thing a connector must never be.
 */
export const localServerRuntimeSchema = z.enum(['node', 'python']);
export type LocalServerRuntime = z.infer<typeof localServerRuntimeSchema>;

/**
 * An exact version, never a range. A `^1.4` or `latest` would let the code change between
 * launches, so nothing the person reviewed would still be what runs.
 */
export const pinnedVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[0-9]+(\.[0-9]+)*([-+][0-9A-Za-z.-]+)?$/, 'Pin an exact version, like 1.4.2.');

/** A published package name: npm's scoped form, or a Python distribution. Never a path or URL. */
export const localPackageSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(
    /^(@[a-z0-9][a-z0-9-._~]*\/)?[A-Za-z0-9][A-Za-z0-9-._~]*$/,
    'Use a published package name.',
  );

/** How Edi starts a server that runs on this Mac, over stdio. */
export const localServerSchema = z
  .object({
    runtime: localServerRuntimeSchema,
    package: localPackageSchema,
    version: pinnedVersionSchema,
    /** Plain arguments passed after the package name; never a shell line. */
    args: z.array(z.string().max(200)).max(20),
  })
  .strict();
export type LocalServer = z.infer<typeof localServerSchema>;

/**
 * `npx notes-server@1.4.2`: exactly how a local server will be run. Shared, so Connectors and
 * the main process always say the same thing.
 */
export function describeLocalServer(local: LocalServer) {
  return local.runtime === 'node'
    ? `npx ${local.package}@${local.version}`
    : `uvx ${local.package}==${local.version}`;
}

export const connectorToolSchema = z
  .object({
    name: z.string().min(1).max(128),
    title: z.string().max(120),
    description: z.string().max(600),
    enabled: z.boolean(),
    /** The server's readOnlyHint annotation; read-only tools run without approval. */
    readOnly: z.boolean(),
  })
  .strict();
export type ConnectorTool = z.infer<typeof connectorToolSchema>;

export const connectorSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(60),
    url: z.string().max(2048),
    /** A server from Edi's short list, or one the person added by address. */
    catalogId: z.string().max(40).nullable(),
    /** How this app connects: direct MCP or through Composio. */
    provider: connectorProviderSchema,
    /** Composio's connection account id, when provider is composio. */
    composioConnectionId: z.string().max(200).nullable(),
    /** How to start it, when it runs on this Mac; null for the others. */
    local: localServerSchema.nullable(),
    enabled: z.boolean(),
    status: connectorStatusSchema,
    error: z.string().max(300),
    tools: z.array(connectorToolSchema).max(200),
    addedAt: z.number().int().nonnegative(),
  })
  .strict();
export type Connector = z.infer<typeof connectorSchema>;
export const connectorListSchema = z.array(connectorSchema).max(50);

/** Remote servers must use https; plain http is allowed only on this Mac (local testing). */
export const connectorUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(value => {
    try {
      const url = new URL(value);
      if (url.username || url.password) return false;
      if (url.protocol === 'https:') return true;
      return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    } catch {
      return false;
    }
  }, 'Use the server’s https address.');
