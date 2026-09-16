import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  activitySchema,
  artifactRefSchema,
  cloudProviderSchema,
  cloudVoiceListSchema,
  artifactSchema,
  exportFormatSchema,
  agentStateSchema,
  characterExpressionSchema,
  characterInspectionSchema,
  characterListSchema,
  characterMoodSchema,
  commandSchema,
  librarySchema,
  localModelsStateSchema,
  modelCatalogSchema,
  settingsSchema,
  systemInfoSchema,
  permissionSnapshotSchema,
  fileAccessActionSchema,
  fileAccessSchema,
  usagePeriodSchema,
  conversationListSchema,
  taskListSchema,
  scheduleListSchema,
  approvalRulesSchema,
  privacyStateSchema,
  memoryListSchema,
  connectorListSchema,
  skillsStateSchema,
  usageSummarySchema,
  workspaceViewSchema,
  voiceHostEventSchema,
  type DesktopBridge,
  personalVoiceAddResultSchema,
} from '@edi/contracts';

const bridge: DesktopBridge = {
  onNavigate: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = workspaceViewSchema.safeParse(value);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on('edi:navigate', listener);
    return () => ipcRenderer.removeListener('edi:navigate', listener);
  },
  onOpenArtifact: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = artifactRefSchema.safeParse(value);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on('edi:open-artifact', listener);
    return () => ipcRenderer.removeListener('edi:open-artifact', listener);
  },
  artifact: async ref =>
    artifactSchema.parse(
      await ipcRenderer.invoke('edi:artifact:get', artifactRefSchema.parse(ref)),
    ),
  exportArtifact: async (ref, format, choose = false) => {
    const result: unknown = await ipcRenderer.invoke('edi:artifact:export', {
      ref: artifactRefSchema.parse(ref),
      format: exportFormatSchema.parse(format),
      choose: choose === true,
    });
    return result && typeof result === 'object' && 'name' in result
      ? { name: String(result.name).slice(0, 200) }
      : null;
  },
  permissions: async () =>
    permissionSnapshotSchema.parse(await ipcRenderer.invoke('edi:permissions:get')),
  fileAccess: async () => fileAccessSchema.parse(await ipcRenderer.invoke('edi:file-access:get')),
  fileAccessAction: async action =>
    fileAccessSchema.parse(
      await ipcRenderer.invoke('edi:file-access:act', fileAccessActionSchema.parse(action)),
    ),
  tasks: async () => taskListSchema.parse(await ipcRenderer.invoke('edi:tasks:get')),
  schedules: async () => scheduleListSchema.parse(await ipcRenderer.invoke('edi:schedules:get')),
  approvalRules: async () =>
    approvalRulesSchema.parse(await ipcRenderer.invoke('edi:approval-rules:get')),
  connectors: async () => connectorListSchema.parse(await ipcRenderer.invoke('edi:connectors:get')),
  skills: async () => skillsStateSchema.parse(await ipcRenderer.invoke('edi:skills:get')),
  onSkills: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = skillsStateSchema.safeParse(value);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on('edi:skills', listener);
    return () => ipcRenderer.removeListener('edi:skills', listener);
  },
  composioConfigured: async () => {
    const result = await ipcRenderer.invoke('edi:composio-configured:get');
    return result === true;
  },
  onConnectors: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = connectorListSchema.safeParse(value);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on('edi:connectors', listener);
    return () => ipcRenderer.removeListener('edi:connectors', listener);
  },
  memories: async () => memoryListSchema.parse(await ipcRenderer.invoke('edi:memories:get')),
  onMemories: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = memoryListSchema.safeParse(value);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on('edi:memories', listener);
    return () => ipcRenderer.removeListener('edi:memories', listener);
  },
  privacy: async () => privacyStateSchema.parse(await ipcRenderer.invoke('edi:privacy:get')),
  onPrivacy: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = privacyStateSchema.safeParse(value);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on('edi:privacy', listener);
    return () => ipcRenderer.removeListener('edi:privacy', listener);
  },
  onApprovalRules: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = approvalRulesSchema.safeParse(value);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on('edi:approval-rules', listener);
    return () => ipcRenderer.removeListener('edi:approval-rules', listener);
  },
  onSchedules: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = scheduleListSchema.safeParse(value);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on('edi:schedules', listener);
    return () => ipcRenderer.removeListener('edi:schedules', listener);
  },
  onTasks: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = taskListSchema.safeParse(value);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on('edi:tasks', listener);
    return () => ipcRenderer.removeListener('edi:tasks', listener);
  },
  onPermissions: callback => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) => {
      const parsed = permissionSnapshotSchema.safeParse(status);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on('edi:permissions', listener);
    return () => ipcRenderer.removeListener('edi:permissions', listener);
  },
  agent: async () => agentStateSchema.parse(await ipcRenderer.invoke('edi:agent:get')),
  activity: async () => activitySchema.parse(await ipcRenderer.invoke('edi:activity:get')),
  library: async () => librarySchema.parse(await ipcRenderer.invoke('edi:library:get')),
  system: async () => systemInfoSchema.parse(await ipcRenderer.invoke('edi:system:get')),
  models: async () => modelCatalogSchema.parse(await ipcRenderer.invoke('edi:models:get')),
  /** Models Ollama and LM Studio serve on this Mac; `fresh` asks the runtimes again. */
  localModels: async (fresh = false) =>
    localModelsStateSchema.parse(await ipcRenderer.invoke('edi:local-models:get', fresh === true)),
  cloudVoices: async provider =>
    cloudVoiceListSchema.parse(
      await ipcRenderer.invoke('edi:cloud-voices:get', cloudProviderSchema.parse(provider)),
    ),
  conversations: async query =>
    conversationListSchema.parse(await ipcRenderer.invoke('edi:conversations:get', query ?? '')),
  usage: async days =>
    usageSummarySchema.parse(
      await ipcRenderer.invoke('edi:usage:get', usagePeriodSchema.parse(days)),
    ),
  onAgent: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = agentStateSchema.safeParse(value);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on('edi:agent', listener);
    return () => ipcRenderer.removeListener('edi:agent', listener);
  },
  settings: async () => settingsSchema.parse(await ipcRenderer.invoke('edi:settings:get')),
  command: async command => {
    await ipcRenderer.invoke('edi:command', commandSchema.parse(command));
  },
  onSettings: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = settingsSchema.safeParse(value);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on('edi:settings', listener);
    return () => ipcRenderer.removeListener('edi:settings', listener);
  },
  onVoice: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = voiceHostEventSchema.safeParse(value);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on('edi:voice', listener);
    return () => ipcRenderer.removeListener('edi:voice', listener);
  },
  onCharacterExpression: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = characterExpressionSchema.safeParse(value);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on('edi:character-expression', listener);
    return () => ipcRenderer.removeListener('edi:character-expression', listener);
  },
  onCharacterMood: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = characterMoodSchema.safeParse(value);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on('edi:character-mood', listener);
    return () => ipcRenderer.removeListener('edi:character-mood', listener);
  },
  characters: async () => characterListSchema.parse(await ipcRenderer.invoke('edi:characters:get')),
  onCharacters: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = characterListSchema.safeParse(value);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on('edi:characters', listener);
    return () => ipcRenderer.removeListener('edi:characters', listener);
  },
  pickCharacterPackage: async () =>
    characterInspectionSchema.nullable().parse(await ipcRenderer.invoke('edi:characters:pick')),
  addPersonalVoice: async input =>
    personalVoiceAddResultSchema.parse(await ipcRenderer.invoke('edi:personal-voices:add', input)),
  // The renderer never sees file paths; only this preload turns a dropped File into one.
  inspectCharacterFile: async file =>
    characterInspectionSchema.parse(
      await ipcRenderer.invoke('edi:characters:inspect-file', webUtils.getPathForFile(file)),
    ),
};
contextBridge.exposeInMainWorld('edi', bridge);
