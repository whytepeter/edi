import { session, shell, systemPreferences, type BrowserWindow, type WebContents } from 'electron';
import { type PermissionId, type PermissionSnapshot, type PermissionStatus } from '@edi/contracts';
import { PermissionManager } from '../permission-manager';
import { eventKit, macAccessibilityTrusted, ScreenRecording } from '../permissions';

interface VoicePermissionState {
  readonly wantsMicrophone: boolean;
}

interface MacMediaPermissionDependencies {
  workspace: BrowserWindow;
  pet: BrowserWindow;
  voice: VoicePermissionState;
  revealPermissionCard(): void;
  onChange(snapshot: PermissionSnapshot): void;
}

export interface MacMediaPermissions {
  manager: PermissionManager;
  /** Permission sheets must not be dismissed by the card's normal blur behavior. */
  holdsCardOpen(): boolean;
}

function microphoneStatus(): PermissionStatus {
  return systemPreferences.getMediaAccessStatus('microphone');
}

/** Chromium may ask with either the specific capture name or the broader media name. */
function isAudioOnly(details: object) {
  const types = 'mediaTypes' in details ? details.mediaTypes : undefined;
  if (Array.isArray(types)) return types.length > 0 && types.every(type => type === 'audio');
  const type = 'mediaType' in details ? details.mediaType : undefined;
  return type === undefined || type === 'audio';
}

/**
 * Owns macOS permission prompts and Electron's renderer permission allowlist.
 * Renderers only see PermissionManager state; native adapters and Settings URLs stay here.
 */
export function createMacMediaPermissions({
  workspace,
  pet,
  voice,
  revealPermissionCard,
  onChange,
}: MacMediaPermissionDependencies): MacMediaPermissions {
  let holdCard = false;
  let microphoneProbe = false;
  const screenRecording = new ScreenRecording();

  const requestScreenRecording = async () => {
    const cardWasOpen = !workspace.isDestroyed() && workspace.isVisible();
    holdCard = true;
    try {
      // Asking from the card briefly focuses the pet. Preserve the card so macOS does not
      // dismiss its own sheet when the workspace receives the corresponding blur event.
      if (cardWasOpen && !workspace.isDestroyed()) {
        workspace.show();
        workspace.focus();
      } else if (!pet.isDestroyed()) pet.show();
      return await screenRecording.request();
    } finally {
      // CGRequest can return before the sheet becomes visible. This timer protects that gap;
      // it does not block the click or keep the permission request itself alive.
      setTimeout(() => {
        holdCard = false;
        if (cardWasOpen && !workspace.isDestroyed()) workspace.show();
      }, 8_000);
    }
  };

  const requestMicrophone = async (): Promise<PermissionStatus> => {
    if (microphoneStatus() === 'granted') return 'granted';
    holdCard = true;
    microphoneProbe = true;
    try {
      if (!workspace.isDestroyed()) {
        workspace.show();
        workspace.focus();
      }
      try {
        if (await systemPreferences.askForMediaAccess('microphone')) return 'granted';
      } catch {
        // Chromium's audio-only request below can still trigger the system prompt.
      }
      if (!pet.isDestroyed()) {
        await pet.webContents.executeJavaScript(
          'navigator.mediaDevices.getUserMedia({audio:true,video:false}).then(s=>{s.getTracks().forEach(t=>t.stop());true}).catch(()=>false)',
        );
      }
      return microphoneStatus();
    } catch {
      return microphoneStatus();
    } finally {
      microphoneProbe = false;
      holdCard = false;
    }
  };

  const settingsUrls: Record<PermissionId, string> = {
    microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    'screen-recording':
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    reminders: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders',
    calendar: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars',
  };
  // Reminders and Calendar: full access through EventKit; write-only counts as not enough.
  const kit = eventKit();
  const eventStatus = (entity: 0 | 1): PermissionStatus => {
    if (!kit) return 'unavailable';
    const status = kit.status(entity);
    return status === 3
      ? 'granted'
      : status === 0
        ? 'not-determined'
        : status === 1
          ? 'restricted'
          : 'denied';
  };
  const eventAdapter = (entity: 0 | 1, id: 'reminders' | 'calendar') => ({
    status: () => eventStatus(entity),
    request: async () => {
      if (kit && eventStatus(entity) === 'not-determined') await kit.request(entity);
      return eventStatus(entity);
    },
    openSettings: () => shell.openExternal(settingsUrls[id]).then(() => undefined),
  });
  // macOS reports only trusted or not; after Edi has asked once, not trusted means switched off.
  let accessibilityAsked = false;
  const accessibilityStatus = (): PermissionStatus => {
    const trusted = macAccessibilityTrusted();
    if (trusted === 'unavailable') return 'unavailable';
    return trusted ? 'granted' : accessibilityAsked ? 'denied' : 'not-determined';
  };
  const manager = new PermissionManager(
    {
      microphone: {
        status: microphoneStatus,
        request: requestMicrophone,
        openSettings: () => shell.openExternal(settingsUrls.microphone).then(() => undefined),
      },
      'screen-recording': {
        status: () => screenRecording.status(),
        request: requestScreenRecording,
        openSettings: () =>
          shell.openExternal(settingsUrls['screen-recording']).then(() => undefined),
      },
      accessibility: {
        status: accessibilityStatus,
        request: async () => {
          accessibilityAsked = true;
          macAccessibilityTrusted(true);
          return accessibilityStatus();
        },
        openSettings: () => shell.openExternal(settingsUrls.accessibility).then(() => undefined),
      },
      reminders: eventAdapter(1, 'reminders'),
      calendar: eventAdapter(0, 'calendar'),
    },
    revealPermissionCard,
  );
  manager.onChange(onChange);

  const allowMicrophone = (contents: WebContents | null, permission: string, details: object) => {
    if (permission !== 'microphone' && permission !== 'audioCapture' && permission !== 'media') {
      return false;
    }
    if (permission === 'media' && !isAudioOnly(details)) return false;
    // Chromium pre-checks with no WebContents. Denying that probe suppresses the prompt.
    if (!contents) return voice.wantsMicrophone || microphoneProbe;
    return contents === pet.webContents && (voice.wantsMicrophone || microphoneProbe);
  };

  // Nothing is granted except audio capture to the pet while a voice turn is opening or active.
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    allowMicrophone(contents, permission, details),
  );
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(allowMicrophone(contents, permission, details));
  });

  return { manager, holdsCardOpen: () => holdCard };
}
