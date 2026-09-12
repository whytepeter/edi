import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import {
  commandSchema,
  type Activity,
  type AgentState,
  type Command,
  type Settings,
  type PermissionSnapshot,
} from '@edi/contracts';

/** Every renderer surface is identified; route allowlists still grant each command explicitly. */
export type Caller = 'workspace' | 'pet' | 'menu' | 'bubble';

type CommandOf<T extends Command['type']> = Extract<Command, { type: T }>;
interface Route<T extends Command['type']> {
  /** Every command declares which surfaces may send it; there is no default. */
  from: readonly Caller[];
  handle(command: CommandOf<T>): unknown;
}
export type CommandRoutes = { [T in Command['type']]: Route<T> };

interface IpcDependencies {
  identify(sender: WebContents): Caller | undefined;
  routes: CommandRoutes;
  settings(): Settings;
  agentState(): AgentState;
  activity(): Activity;
  permissions(): PermissionSnapshot;
}

export function registerIpc({
  identify,
  routes,
  settings,
  agentState,
  activity,
  permissions,
}: IpcDependencies) {
  const callerOf = (event: IpcMainInvokeEvent) => {
    // Subframes never inherit their window's privileges.
    const caller =
      event.senderFrame === event.sender.mainFrame ? identify(event.sender) : undefined;
    if (!caller) throw new Error('Untrusted window');
    return caller;
  };
  const authorize = (caller: Caller, allowed: readonly Caller[]) => {
    if (!allowed.includes(caller)) throw new Error(`Not allowed from ${caller}`);
  };

  ipcMain.handle('edi:settings:get', event => {
    authorize(callerOf(event), ['workspace', 'pet']);
    return settings();
  });
  ipcMain.handle('edi:agent:get', event => {
    authorize(callerOf(event), ['workspace']);
    return agentState();
  });
  ipcMain.handle('edi:activity:get', event => {
    authorize(callerOf(event), ['workspace']);
    return activity();
  });
  ipcMain.handle('edi:permissions:get', event => {
    authorize(callerOf(event), ['workspace']);
    return permissions();
  });
  ipcMain.handle('edi:bubble-approval:get', event => {
    authorize(callerOf(event), ['bubble']);
    return agentState().approval;
  });
  ipcMain.handle('edi:command', async (event, raw: unknown) => {
    const caller = callerOf(event);
    const command = commandSchema.parse(raw);
    const route = routes[command.type] as Route<Command['type']>;
    authorize(caller, route.from);
    await route.handle(command);
  });
}
