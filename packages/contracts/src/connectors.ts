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

export const connectorProviderSchema = z.enum(['mcp', 'composio']);
export type ConnectorProvider = z.infer<typeof connectorProviderSchema>;

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
