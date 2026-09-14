import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  activitySchema,
  artifactRefSchema,
  cloudProviderSchema,
  cloudVoiceListSchema,
  artifactSchema,
  agentStateSchema,
  characterExpressionSchema,
  characterInspectionSchema,
  characterListSchema,
  characterMoodSchema,
  commandSchema,
  librarySchema,
  modelCatalogSchema,
  settingsSchema,
  systemInfoSchema,
  permissionSnapshotSchema,
  fileAccessActionSchema,
  fileAccessSchema,
  usagePeriodSchema,
  conversationListSchema,
  usageSummarySchema,
  workspaceViewSchema,
  voiceHostEventSchema,
  type DesktopBridge,
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
  permissions: async () =>
    permissionSnapshotSchema.parse(await ipcRenderer.invoke('edi:permissions:get')),
  fileAccess: async () => fileAccessSchema.parse(await ipcRenderer.invoke('edi:file-access:get')),
  fileAccessAction: async action =>
    fileAccessSchema.parse(
      await ipcRenderer.invoke('edi:file-access:act', fileAccessActionSchema.parse(action)),
    ),
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
  // The renderer never sees file paths; only this preload turns a dropped File into one.
  inspectCharacterFile: async file =>
    characterInspectionSchema.parse(
      await ipcRenderer.invoke('edi:characters:inspect-file', webUtils.getPathForFile(file)),
    ),
};
contextBridge.exposeInMainWorld('edi', bridge);
