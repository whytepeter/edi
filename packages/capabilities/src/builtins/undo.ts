import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { defineCapability, type Capability } from '../types';

/** One action Edi took, as recorded: what was asked, what came back, and when. */
export interface RecordedAction {
  id: string;
  runId: string;
  capability: string;
  title: string;
  effect: string;
  status: string;
  summary: string;
  input: unknown;
  output: unknown;
  createdAt: number;
}

/** How an action is reversed: the tool that does it and that tool's input, or how to by hand. */
export type Reversal =
  | { tool: string; input: unknown; label: string }
  | { manual: string };

const moveList = z.array(z.object({ from: z.string(), to: z.string() })).min(1);
const pathList = z.array(z.string()).min(1);
const nameOf = (path: string) => basename(path) || path;

/** Only Edi's own, recorded effects are reversed, through the same reviewed tools. */
export function reversal(action: RecordedAction): Reversal {
  if (action.status !== 'succeeded')
    return { manual: 'It didn’t go through, so there’s nothing to undo.' };
  const output = (action.output ?? {}) as Record<string, unknown>;
  switch (action.capability) {
    case 'files.move': {
      const moves = moveList.safeParse(output.moves);
      if (!moves.success)
        return { manual: 'Edi didn’t record where those came from; move them back in Finder.' };
      return {
        tool: 'files.move',
        input: { moves: moves.data.map(({ from, to }) => ({ from: to, to: from })) },
        label:
          moves.data.length === 1
            ? `Put ${nameOf(moves.data[0]!.from)} back`
            : `Put ${moves.data.length} items back`,
      };
    }
    case 'files.create_folder': {
      const created = pathList.safeParse(output.created);
      if (!created.success) return { manual: 'Remove the folder in Finder.' };
      return {
        tool: 'files.trash',
        input: { paths: created.data },
        label:
          created.data.length === 1
            ? `Move the new folder ${nameOf(created.data[0]!)} to the Trash`
            : `Move ${created.data.length} new folders to the Trash`,
      };
    }
    case 'calendar.create': {
      const eventId = z.string().min(1).safeParse(output.eventId);
      if (!eventId.success) return { manual: 'Remove the event in Calendar.' };
      const title = (action.input as { title?: unknown } | null)?.title;
      return {
        tool: 'calendar.delete',
        input: { eventId: eventId.data, ...(typeof title === 'string' ? { title } : {}) },
        label: `Remove the event${typeof title === 'string' ? ` “${title}”` : ''}`,
      };
    }
    case 'reminders.create':
      return { manual: 'Edi can’t remove reminders yet; delete them in Reminders.' };
    case 'files.trash':
    case 'workspace.delete':
      return { manual: 'It’s in the Trash: open the Trash in Finder, select it and choose Put Back.' };
    case 'notes.save':
    case 'workspace.update':
      return { manual: 'Delete it from Library, or ask Edi to change it back.' };
    default:
      return { manual: 'Edi can’t undo that kind of action.' };
  }
}

const periodStart = (since: 'today' | 'week' | 'all', now: number) => {
  if (since === 'all') return 0;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return since === 'today' ? start.getTime() : start.getTime() - 6 * 24 * 60 * 60 * 1000;
};

/**
 * What Edi did, for “what did you do today?”, and undoing its own reversible actions. An undo is
 * reviewed like any change and runs through the tool that reverses it, so the same checks apply.
 */
export function activityCapabilities(deps: {
  /** Recent actions, newest first. */
  recent(limit: number): RecordedAction[];
  /** One of Edi's tools by id, to reverse an action with. */
  tool(id: string): Capability | undefined;
  home: string;
  now?: () => number;
}) {
  /** Actions already undone (an undo records the id it reversed). */
  const undone = (actions: RecordedAction[]) =>
    new Set(
      actions
        .filter(action => action.capability === 'edi.undo' && action.status === 'succeeded')
        .map(action => (action.output as { undid?: unknown } | null)?.undid)
        .filter((id): id is string => typeof id === 'string'),
    );

  const recentActions = defineCapability({
    id: 'edi.recent_actions',
    title: 'Check what Edi did',
    description:
      'List actions Edi took, newest first: what, when, whether it went through, and whether Edi ' +
      'can undo it (then pass its id to edi_undo) or how the user can. Use for “what did you do ' +
      'today?”, “did you move those?”, and before undoing.',
    effect: 'read',
    timeoutMs: 3_000,
    input: z
      .object({
        since: z.enum(['today', 'week', 'all']).optional().describe('Default today'),
        includeReads: z
          .boolean()
          .optional()
          .describe('Also list looking things up; by default only changes are listed'),
      })
      .strict(),
    prepare({ since = 'today', includeReads = false }) {
      return {
        preview: { title: 'Check what Edi did', action: 'Check', summary: 'List recent actions.', fields: [] },
        async execute() {
          const all = deps.recent(200);
          const reversed = undone(all);
          const from = periodStart(since, deps.now?.() ?? Date.now());
          const actions = all
            .filter(
              action =>
                action.createdAt >= from &&
                action.capability !== 'edi.recent_actions' &&
                (includeReads || action.effect === 'write'),
            )
            .slice(0, 40)
            .map(action => {
              const plan = reversal(action);
              return {
                id: action.id,
                what: action.title,
                result: action.summary.slice(0, 300),
                status: action.status,
                at: new Date(action.createdAt).toString().slice(0, 24),
                undo: reversed.has(action.id)
                  ? 'already undone'
                  : 'tool' in plan
                    ? 'Edi can undo it'
                    : plan.manual,
              };
            });
          return {
            summary: actions.length
              ? `Found ${actions.length} ${actions.length === 1 ? 'action' : 'actions'}.`
              : 'Nothing yet.',
            output: { since, actions },
          };
        },
      };
    },
  });

  const undo = defineCapability({
    id: 'edi.undo',
    title: 'Undo an action',
    description:
      'Undo one of Edi’s own actions, by its id from edi_recent_actions, or the most recent one Edi ' +
      'can undo when no id is given: moves and renames go back, folders Edi made go to the Trash ' +
      'while still empty, events Edi added are removed. The user reviews it. When it can’t be ' +
      'undone, the error says how the user can reverse it.',
    effect: 'write',
    timeoutMs: 60_000,
    input: z.object({ actionId: z.string().uuid().optional() }).strict(),
    async prepare({ actionId }, context) {
      const actions = deps.recent(200);
      const reversed = undone(actions);
      const target = actionId
        ? actions.find(action => action.id === actionId)
        : actions.find(
            action =>
              action.capability !== 'edi.undo' &&
              !reversed.has(action.id) &&
              'tool' in reversal(action),
          );
      if (!target)
        throw new Error(
          actionId ? 'Edi can’t find that action any more.' : 'There’s nothing recent Edi can undo.',
        );
      if (reversed.has(target.id)) throw new Error(`“${target.title}” was already undone.`);
      const plan = reversal(target);
      if ('manual' in plan) throw new Error(`Edi can’t undo “${target.title}”. ${plan.manual}`);
      if (target.capability === 'files.create_folder')
        for (const path of (plan.input as { paths: string[] }).paths) {
          const full = path.startsWith('~/') ? join(deps.home, path.slice(2)) : path;
          const entries = await readdir(full).catch(() => null);
          if (entries === null) throw new Error(`${nameOf(path)} isn’t there any more.`);
          if (entries.some(name => !name.startsWith('.')))
            throw new Error(`${nameOf(path)} has things in it now, so Edi leaves it.`);
        }
      const tool = deps.tool(plan.tool);
      if (!tool) throw new Error('Edi can’t do that here.');
      const prepared = await tool.prepare(tool.input.parse(plan.input), context);
      // No “Always allow”: every undo is reviewed on its own.
      return {
        preview: {
          ...prepared.preview,
          title: `Undo “${target.title}”`,
          action: 'Undo',
          summary: `${plan.label}.`,
        },
        async execute(signal) {
          const result = await prepared.execute(signal);
          return {
            summary: `Undid “${target.title}”: ${result.summary}`,
            output: { undid: target.id, result: result.output ?? null },
          };
        },
      };
    },
  });

  return [recentActions, undo] as const;
}
