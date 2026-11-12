import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privacyReason, screenSharingApp, settingsSchema, voicePrivacyLines } from './index';

test('a screen share is noticed by the bar the call app puts up', () => {
  for (const [owner, name, app] of [
    ['zoom.us', 'zoom share statusbar window', 'Zoom'],
    ['zoom.us', 'Zoom Share Toolbar', 'Zoom'],
    ['Google Chrome', 'meet.google.com is sharing your screen.', 'Google Chrome'],
    ['Arc', 'teams.microsoft.com is sharing a window.', 'Arc'],
    ['Microsoft Teams', 'Sharing control bar', 'Microsoft Teams'],
    ['Slack', 'Screen share', 'Slack'],
    ['FaceTime', 'Screen Sharing', 'FaceTime'],
    ['QuickTime Player', 'Screen Recording', 'QuickTime Player'],
  ] as const)
    assert.equal(
      screenSharingApp([
        { owner: 'Finder', name: 'Desktop' },
        { owner, name },
      ]),
      app,
    );
});

test('ordinary windows, and windows without titles, are not a share', () => {
  assert.equal(
    screenSharingApp([
      { owner: 'zoom.us', name: 'Zoom Meeting' },
      { owner: 'Google Chrome', name: 'Screen sharing tips - Google Search' },
      { owner: 'Slack', name: 'general - Fewerlabs' },
      { owner: 'zoom.us' },
    ]),
    null,
  );
});

test('privacy settings default to looking, pausing for shares, and no extra private apps', () => {
  const settings = settingsSchema.parse({ skin: 'edi', pinned: false });
  assert.equal(settings.privacyPaused, false);
  assert.equal(settings.pauseWhenSharing, true);
  assert.deepEqual(settings.privateApps, []);
  // A damaged list doesn't break settings.
  assert.deepEqual(
    settingsSchema.parse({ skin: 'edi', pinned: false, privateApps: 'nope' }).privateApps,
    [],
  );
  assert.equal(
    privacyReason({ paused: 'sharing', sharingApp: 'Zoom' }),
    'The user is sharing their screen in Zoom.',
  );
  assert.equal(privacyReason({ paused: null, sharingApp: null }), null);
});

test('Settings only says voice stays on this Mac when it does', () => {
  assert.deepEqual(voicePrivacyLines({ model: 'kokoro', input: 'local' }), [
    'Voice recordings, transcription and speech stay on this Mac.',
  ]);
  // A cloud voice sends the words it speaks; hearing is still local.
  assert.deepEqual(voicePrivacyLines({ model: 'elevenlabs', input: 'local' }), [
    'What you say is turned into words on this Mac.',
    'What Edi says aloud goes to ElevenLabs as text to be spoken.',
  ]);
  // Cloud recognition streams the microphone; a local voice still speaks here.
  assert.deepEqual(voicePrivacyLines({ model: 'chatterbox', input: 'cartesia' }), [
    'While you talk, your microphone audio goes to Cartesia to be turned into words.',
    'Edi’s voice is made on this Mac.',
  ]);
  for (const line of voicePrivacyLines({ model: 'cartesia', input: 'cartesia' }))
    assert.doesNotMatch(line, /stay on this Mac|on this Mac\.$/);
});
