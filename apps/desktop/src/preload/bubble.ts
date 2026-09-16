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

/** A suggestion is one line and one action; the bubble shows nothing it can't check. */
function asSuggestion(value: unknown): { text: string; label: string } | null {
  if (!value || typeof value !== 'object') return null;
  const offer = value as Record<string, unknown>;
  const action = offer.action as Record<string, unknown> | undefined;
  if (!stringWithin(offer.text, 160) || !action || !stringWithin(action.label, 40)) return null;
  return { text: String(offer.text), label: String(action.label) };
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
  /** The quiet offer this bubble shows, and the person's answer to it. */
  async suggestion() {
    return asSuggestion(await ipcRenderer.invoke('edi:bubble-suggestion:get'));
  },
  subscribeSuggestion(callback: (suggestion: { text: string; label: string }) => void) {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const suggestion = asSuggestion(value);
      if (suggestion) callback(suggestion);
    };
    ipcRenderer.on('edi:bubble-suggestion', listener);
    return () => ipcRenderer.removeListener('edi:bubble-suggestion', listener);
  },
  async respondSuggestion(accept: boolean) {
    await ipcRenderer.invoke('edi:command', {
      type: accept === true ? 'suggestion-accept' : 'suggestion-dismiss',
    });
  },
  async respond(callId: string, decision: 'approve' | 'approve-always' | 'deny') {
    if (!uuid.test(callId) || !['approve', 'approve-always', 'deny'].includes(decision)) {
      throw new Error('Invalid approval response.');
    }
    await ipcRenderer.invoke('edi:command', { type: 'respond-approval', callId, decision });
  },
  /** Short progress for the thinking bubble ("Searching the web"); plain text only. */
  subscribeText(callback: (text: string) => void) {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (typeof value === 'string' && value.length <= 60) callback(value);
    };
    ipcRenderer.on('edi:bubble-text', listener);
    return () => ipcRenderer.removeListener('edi:bubble-text', listener);
  },
  async openArtifact(callId: string) {
    if (!uuid.test(callId)) throw new Error('Invalid content.');
    await ipcRenderer.invoke('edi:command', { type: 'open-artifact', ref: { callId } });
  },
  async showContent() {
    await ipcRenderer.invoke('edi:command', { type: 'show-workspace', view: 'conversations' });
  },
});
