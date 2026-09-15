import { z } from 'zod';
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import {
  commandSchema,
  type Activity,
  type Artifact,
  type ArtifactRef,
  artifactRefSchema,
  exportFormatSchema,
  type ExportFormat,
  cloudProviderSchema,
  usagePeriodSchema,
  fileAccessActionSchema,
  type CloudProviderId,
  type CloudVoiceOption,
  type UsagePeriod,
  type ConversationSummary,
  type Task,
  type Schedule,
  type ApprovalRule,
  type Connector,
  type SkillsState,
  type UsageSummary,
  type AgentState,
  type Command,
  type LibraryItem,
  type ModelOption,
  type Settings,
  type SystemInfo,
  type PermissionSnapshot,
  type FileAccess,
  type FileAccessAction,
  type CharacterDescriptor,
  type CharacterInspection,
  personalVoiceNameSchema,
  type PersonalVoiceAddResult,
} from '@edi/contracts';

/** Every renderer surface is identified; route allowlists still grant each command explicitly. */
export type Caller = 'workspace' | 'pet' | 'menu' | 'bubble' | 'artifact' | 'export';

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
  library(): LibraryItem[];
  system(): SystemInfo;
  models(): Promise<ModelOption[]>;
  cloudVoices(provider: CloudProviderId): Promise<CloudVoiceOption[]>;
  usage(days: UsagePeriod): Promise<UsageSummary>;
  conversations(query: string): ConversationSummary[];
  tasks(): Task[];
  schedules(): Schedule[];
  approvalRules(): ApprovalRule[];
  connectors(): Connector[];
  skills(): Promise<SkillsState>;
  composioConfigured(): boolean;
  artifact(ref: ArtifactRef): Promise<Artifact>;
  exportArtifact(
    ref: ArtifactRef,
    format: ExportFormat,
    choose: boolean,
  ): Promise<{ name: string } | null>;
  permissions(): PermissionSnapshot;
  fileAccess(): FileAccess;
  fileAccessAction(action: FileAccessAction): Promise<FileAccess>;
  characters(): CharacterDescriptor[];
  pickCharacterPackage(): Promise<CharacterInspection | null>;
  inspectCharacterFile(path: string): Promise<CharacterInspection>;
  addPersonalVoice(name: string): Promise<PersonalVoiceAddResult>;
}

export function registerIpc({
  identify,
  routes,
  settings,
  agentState,
  activity,
  library,
  system,
  models,
  cloudVoices,
  usage,
  conversations,
  tasks,
  schedules,
  approvalRules,
  connectors,
  skills,
  composioConfigured,
  artifact,
  exportArtifact,
  permissions,
  fileAccess,
  fileAccessAction,
  characters,
  pickCharacterPackage,
  inspectCharacterFile,
  addPersonalVoice,
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
    authorize(callerOf(event), ['workspace', 'pet', 'artifact']);
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
  ipcMain.handle('edi:library:get', event => {
    authorize(callerOf(event), ['workspace']);
    return library();
  });
  ipcMain.handle('edi:system:get', event => {
    authorize(callerOf(event), ['workspace']);
    return system();
  });
  ipcMain.handle('edi:artifact:get', (event, ref: unknown) => {
    // The hidden export page reads the content it draws for a PDF or picture.
    authorize(callerOf(event), ['artifact', 'export']);
    return artifact(artifactRefSchema.parse(ref));
  });
  ipcMain.handle('edi:artifact:export', (event, raw: unknown) => {
    authorize(callerOf(event), ['artifact']);
    const input = z
      .object({ ref: artifactRefSchema, format: exportFormatSchema, choose: z.boolean() })
      .strict()
      .parse(raw);
    return exportArtifact(input.ref, input.format, input.choose);
  });
  ipcMain.handle('edi:models:get', event => {
    authorize(callerOf(event), ['workspace']);
    return models();
  });
  ipcMain.handle('edi:cloud-voices:get', (event, provider: unknown) => {
    authorize(callerOf(event), ['workspace']);
    return cloudVoices(cloudProviderSchema.parse(provider));
  });
  ipcMain.handle('edi:skills:get', event => {
    authorize(callerOf(event), ['workspace']);
    return skills();
  });
  ipcMain.handle('edi:connectors:get', event => {
    authorize(callerOf(event), ['workspace']);
    return connectors();
  });
  ipcMain.handle('edi:composio-configured:get', event => {
    authorize(callerOf(event), ['workspace']);
    return composioConfigured();
  });
  ipcMain.handle('edi:approval-rules:get', event => {
    authorize(callerOf(event), ['workspace']);
    return approvalRules();
  });
  ipcMain.handle('edi:schedules:get', event => {
    authorize(callerOf(event), ['workspace']);
    return schedules();
  });
  ipcMain.handle('edi:tasks:get', event => {
    authorize(callerOf(event), ['workspace']);
    return tasks();
  });
  ipcMain.handle('edi:conversations:get', (event, query: unknown) => {
    authorize(callerOf(event), ['workspace']);
    return conversations(z.string().max(200).optional().parse(query) ?? '');
  });
  ipcMain.handle('edi:usage:get', (event, days: unknown) => {
    authorize(callerOf(event), ['workspace']);
    return usage(usagePeriodSchema.parse(days));
  });
  ipcMain.handle('edi:file-access:get', event => {
    authorize(callerOf(event), ['workspace']);
    return fileAccess();
  });
  ipcMain.handle('edi:file-access:act', (event, action: unknown) => {
    authorize(callerOf(event), ['workspace']);
    return fileAccessAction(fileAccessActionSchema.parse(action));
  });
  ipcMain.handle('edi:permissions:get', event => {
    authorize(callerOf(event), ['workspace']);
    return permissions();
  });
  ipcMain.handle('edi:bubble-approval:get', event => {
    authorize(callerOf(event), ['bubble']);
    return agentState().approval;
  });
  ipcMain.handle('edi:characters:get', event => {
    authorize(callerOf(event), ['workspace', 'pet', 'artifact']);
    return characters();
  });
  ipcMain.handle('edi:characters:pick', event => {
    authorize(callerOf(event), ['workspace']);
    return pickCharacterPackage();
  });
  ipcMain.handle('edi:characters:inspect-file', (event, path: unknown) => {
    authorize(callerOf(event), ['workspace']);
    if (typeof path !== 'string' || path.length > 4096) throw new Error('Invalid file');
    return inspectCharacterFile(path);
  });
  ipcMain.handle('edi:personal-voices:add', (event, raw: unknown) => {
    authorize(callerOf(event), ['workspace']);
    const input = z
      .object({ name: personalVoiceNameSchema, consent: z.literal(true) })
      .strict()
      .parse(raw);
    return addPersonalVoice(input.name);
  });
  ipcMain.handle('edi:command', async (event, raw: unknown) => {
    const caller = callerOf(event);
    const command = commandSchema.parse(raw);
    const route = routes[command.type] as Route<Command['type']>;
    authorize(caller, route.from);
    await route.handle(command);
  });
}
