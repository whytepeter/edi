import test from 'node:test';
import assert from 'node:assert/strict';
import type { PrivacyState, PrivateApp } from '../../packages/contracts/src/index';
import { PrivacyGuard } from '../../apps/desktop/src/main/privacy/privacy-guard';

function setup() {
  const settings = {
    privacyPaused: false,
    pauseWhenSharing: true,
    privateApps: [] as PrivateApp[],
  };
  let windows: { owner: string; name?: string }[] = [];
  const protectedCalls: boolean[] = [];
  const window = {
    isDestroyed: () => false,
    setContentProtection: (enabled: boolean) => protectedCalls.push(enabled),
  };
  const guard = new PrivacyGuard({
    settings: () => settings,
    windowList: async () => JSON.stringify(windows),
    ownWindows: () => [window],
  });
  const seen: PrivacyState[] = [];
  guard.onChange(state => seen.push(state));
  return { settings, guard, seen, protectedCalls, share: (list: typeof windows) => (windows = list) };
}

test('a screen share pauses looking and keeps Edi out of the share until it ends', async () => {
  const { guard, seen, protectedCalls, share } = setup();
  await guard.check();
  assert.deepEqual(guard.state, { paused: null, sharingApp: null });
  assert.deepEqual(protectedCalls, [], 'nothing is touched while nobody shares');

  share([{ owner: 'zoom.us', name: 'zoom share statusbar window' }]);
  await guard.check();
  assert.deepEqual(guard.state, { paused: 'sharing', sharingApp: 'Zoom' });
  assert.equal(guard.pauseFor('com.apple.Safari'), 'sharing');
  await guard.check();
  share([]);
  await guard.check();
  assert.deepEqual(guard.state, { paused: null, sharingApp: null });
  // Protected on every check while shared (new windows too), lifted once when it ends.
  assert.deepEqual(protectedCalls, [true, true, false]);
  assert.deepEqual(
    seen.map(state => state.paused),
    ['sharing', null],
  );
});

test('pausing by hand, pausing for shares off, and private apps', async () => {
  const { settings, guard, share } = setup();
  settings.privateApps = [{ bundleId: 'com.example.bank', name: 'Bank' }];
  assert.equal(guard.pauseFor('com.example.bank'), 'private-app');
  assert.equal(guard.pauseFor('com.1password.1password'), 'private-app', 'password managers too');
  assert.equal(guard.pauseFor('com.apple.Safari'), null);

  settings.privacyPaused = true;
  assert.equal(guard.pauseFor('com.apple.Safari'), 'you');

  settings.privacyPaused = false;
  settings.pauseWhenSharing = false;
  share([{ owner: 'Google Chrome', name: 'meet.google.com is sharing your screen.' }]);
  await guard.check();
  assert.deepEqual(guard.state, { paused: null, sharingApp: null }, 'not watched when switched off');
});
