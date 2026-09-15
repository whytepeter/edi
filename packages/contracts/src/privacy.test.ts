import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privacyReason, screenSharingApp, settingsSchema } from './index';

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
    assert.equal(screenSharingApp([{ owner: 'Finder', name: 'Desktop' }, { owner, name }]), app);
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
