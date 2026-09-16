import { z } from 'zod';
import { defineCapability } from '@edi/capabilities';
import type { Connector } from '@edi/contracts';

export interface ConnectableApp {
  id: string;
  name: string;
}

/**
 * Connecting an app the person asked to use. Approving opens the app's sign-in; once it is
 * connected Edi picks the original request back up in the same conversation, and whatever it
 * then wants to do is reviewed like any other action. Connecting never runs the request itself.
 */
export function connectAppCapability(deps: {
  /** Short-list apps not connected yet that can be connected now. */
  available(): ConnectableApp[];
  /** Adds the app and starts signing in; returns the connection's id. */
  start(appId: string): string;
  /** Continue `request` in the run's conversation once the connection is live. */
  resumeAfter(connectionId: string, app: ConnectableApp, request: string, runId: string): void;
}) {
  return defineCapability({
    id: 'edi.connect_app',
    title: 'Connect an app',
    description:
      'Connect one of the user’s apps when they ask for something in an app that is not connected ' +
      'yet (for example "add this to my Todoist" with no Todoist tools). Use an id from ' +
      'appsToConnect in the Edi setup (edi_inspect_setup). Restate the request so it can continue ' +
      'after sign-in. The user approves, signs in in their browser, and you continue on your own ' +
      'once it is connected: do not attempt the request now, just tell them to finish signing in.',
    effect: 'write',
    timeoutMs: 10_000,
    input: z
      .object({
        app: z.string().min(1).max(40).describe('App id from appsToConnect'),
        request: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .describe('What the user asked for, to continue once the app is connected'),
      })
      .strict(),
    prepare({ app: appId, request }, context) {
      const app = deps.available().find(entry => entry.id === appId);
      if (!app)
        throw new Error(
          'That app can’t be connected from here. It may already be connected, or it needs the Composio key in Connectors.',
        );
      return {
        preview: {
          title: `Connect ${app.name}`,
          action: 'Connect',
          summary: `Open ${app.name}’s sign-in in your browser. Once it’s connected, Edi continues with your request.`,
          fields: [
            { label: 'App', value: app.name },
            { label: 'Then', value: request },
          ],
        },
        async execute() {
          const connectionId = deps.start(app.id);
          deps.resumeAfter(connectionId, app, request, context.runId);
          return {
            summary: `Opened ${app.name}’s sign-in.`,
            output: {
              note:
                `${app.name}’s sign-in is open in the browser. Tell the user to finish signing in; ` +
                'you will continue the request automatically once it is connected. Do not try it now.',
            },
          };
        },
      };
    },
  });
}

export interface WaitingRequest {
  conversationId: string;
  app: ConnectableApp;
  request: string;
}

/**
 * Requests waiting on an app the person agreed to connect, by connection id. When the app
 * connects the request continues once; switching the app off, removing it or waiting past
 * `waitMs` drops it. A sign-in that fails keeps waiting, since the person can retry it.
 */
export function resumeWhenConnected(options: {
  onChange(listener: (connectors: Connector[]) => void): unknown;
  continueRequest(waiting: WaitingRequest): void;
  waitMs: number;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const waiting = new Map<string, WaitingRequest & { until: number }>();
  options.onChange(list => {
    for (const [id, entry] of waiting) {
      const connector = list.find(item => item.id === id);
      if (!connector || connector.status === 'off' || now() > entry.until) {
        waiting.delete(id);
        continue;
      }
      if (connector.status !== 'connected') continue;
      waiting.delete(id);
      const { until: _until, ...request } = entry;
      options.continueRequest(request);
    }
  });
  return {
    wait(connectionId: string, request: WaitingRequest) {
      waiting.set(connectionId, { ...request, until: now() + options.waitMs });
    },
    get size() {
      return waiting.size;
    },
  };
}
