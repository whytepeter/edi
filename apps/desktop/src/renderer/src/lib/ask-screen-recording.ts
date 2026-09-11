/** Ask macOS for Screen Recording. Not a window-share picker. */
export async function askForScreenRecording(): Promise<boolean> {
  if (!window.edi) return false;
  await window.edi.command({ type: 'request-screen-recording' });
  const state = await window.edi.agent();
  return state.screenAccess === 'granted';
}
