export { CapabilityBroker, DIRECT_APP_TOOLS, toolNameFor } from './broker';
export {
  defineCapability,
  OutcomeUnknownError,
  type ApprovalGate,
  type Capability,
  type CallContext,
  type Effect,
  type PreparedAction,
  type ToolCallRecorder,
  type ToolManifestEntry,
  type ToolOutcome,
} from './types';
export {
  notesCapabilities,
  readLibraryNote,
  slugify,
  writeNewNote,
  type ListedNote,
  type NoteStore,
} from './builtins/notes';
export {
  deleteWorkspaceItem,
  readWorkspaceItem,
  renameWorkspaceItem,
  searchWorkspace,
  toArtifactContent,
  workspaceCapabilities,
  writeWorkspaceArtifact,
  type ArtifactStore,
  type WorkspaceArtifact,
  type WorkspaceDependencies,
} from './builtins/workspace';
export {
  fetchPage,
  htmlToText,
  isPublicAddress,
  readableAddress,
  robotsAllows,
  unreadableShell,
  webCapabilities,
  type WebFetchDependencies,
  type WebFetchOutput,
} from './builtins/web';
export {
  ediPreferencesSchema,
  ediSetupCapabilities,
  type EdiPreferences,
  type EdiSetupSnapshot,
} from './builtins/edi-setup';
export {
  displayPath,
  fileCapabilities,
  locateFile,
  type FileDependencies,
  type FileRoot,
} from './builtins/files';
export {
  activityCapabilities,
  reversal,
  type RecordedAction,
  type Reversal,
} from './builtins/undo';
export {
  macCapabilities,
  parseLocalTime,
  type CalendarEvent,
  type EventAccess,
  type EventStore,
  type MacDependencies,
  type ReminderItem,
} from './builtins/mac';
