import { contextBridge, ipcRenderer } from 'electron';
import type { ApprovalRequest } from '@edi/contracts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stringWithin = (value: unknown, max: number) =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

/** Validate display data without pulling the contract runtime into this sandboxed preload. */
function asApproval(value: unknown): ApprovalRequest | null {
  if (!value || typeof value !== 'object') return null;
  const request = value as Record<string, unknown>;
  const preview = request.preview;
  if (!uuid.test(String(request.callId)) || !uuid.test(String(request.runId))) return null;
  if (!preview || typeof preview !== 'object') return null;
  const shown = preview as Record<string, unknown>;
  if (
    !stringWithin(shown.title, 120) ||
    !stringWithin(shown.action, 40) ||
    !stringWithin(shown.summary, 240) ||
    !Array.isArray(shown.fields) ||
    shown.fields.length > 8 ||
    (shown.body !== undefined && (typeof shown.body !== 'string' || shown.body.length > 4000)) ||
    !shown.fields.every(
      field =>
        field &&
        typeof field === 'object' &&
        stringWithin((field as Record<string, unknown>).label, 40) &&
        typeof (field as Record<string, unknown>).value === 'string' &&
        String((field as Record<string, unknown>).value).length <= 600,
    )
  )
    return null;
  return value as ApprovalRequest;
}

/** The bubble can only review the current approval or reveal its full context. */
contextBridge.exposeInMainWorld('ediBubble', {
  async approval() {
    return asApproval(await ipcRenderer.invoke('edi:bubble-approval:get'));
  },
  subscribeApproval(callback: (approval: ApprovalRequest) => void) {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const approval = asApproval(value);
      if (approval) callback(approval);
    };
    ipcRenderer.on('edi:bubble-approval', listener);
    return () => ipcRenderer.removeListener('edi:bubble-approval', listener);
  },
  async respond(callId: string, decision: 'approve' | 'deny') {
    if (!uuid.test(callId) || (decision !== 'approve' && decision !== 'deny')) {
      throw new Error('Invalid approval response.');
    }
    await ipcRenderer.invoke('edi:command', { type: 'respond-approval', callId, decision });
  },
  async openArtifact(callId: string) {
    if (!uuid.test(callId)) throw new Error('Invalid content.');
    await ipcRenderer.invoke('edi:command', { type: 'open-artifact', ref: { callId } });
  },
  async showContent() {
    await ipcRenderer.invoke('edi:command', { type: 'show-workspace', view: 'conversations' });
  },
});
