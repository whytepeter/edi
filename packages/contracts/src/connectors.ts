import { z } from 'zod';

/**
 * Apps connected over MCP (remote servers, Streamable HTTP). Their sign-in lives encrypted on
 * this Mac; what they can do shows up as Edi tools that are always reviewed, and whatever they
 * return is information from another service, never instructions.
 */
export const connectorStatusSchema = z.enum([
  'connected',
  'connecting',
  'needs-sign-in',
  'signing-in',
  'error',
  'off',
]);
export type ConnectorStatus = z.infer<typeof connectorStatusSchema>;

export const connectorToolSchema = z
  .object({
    name: z.string().min(1).max(128),
    title: z.string().max(120),
    description: z.string().max(600),
    enabled: z.boolean(),
    /** What the server says about the tool; shown, never trusted to skip review. */
    readOnly: z.boolean(),
  })
  .strict();
export type ConnectorTool = z.infer<typeof connectorToolSchema>;

export const connectorSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(60),
    url: z.string().url().max(2048),
    /** A server from Edi's short list, or one the person added by address. */
    catalogId: z.string().max(40).nullable(),
    enabled: z.boolean(),
    status: connectorStatusSchema,
    error: z.string().max(300),
    tools: z.array(connectorToolSchema).max(200),
    addedAt: z.number().int().nonnegative(),
  })
  .strict();
export type Connector = z.infer<typeof connectorSchema>;
export const connectorListSchema = z.array(connectorSchema).max(50);

/** Remote MCP servers checked to offer sign-in with self-registration and PKCE. */
export const connectorCatalog = [
  {
    id: 'notion',
    name: 'Notion',
    url: 'https://mcp.notion.com/mcp',
    description: 'Search, read and update pages and databases in your workspace.',
  },
  {
    id: 'linear',
    name: 'Linear',
    url: 'https://mcp.linear.app/mcp',
    description: 'Find, create and update issues, projects and comments.',
  },
  {
    id: 'asana',
    name: 'Asana',
    url: 'https://mcp.asana.com/mcp',
    description: 'Look up and manage tasks, projects and teammates’ work.',
  },
] as const;
export type ConnectorCatalogEntry = (typeof connectorCatalog)[number];

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
