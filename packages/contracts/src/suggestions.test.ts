import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appInFront,
  suggestNow,
  suggestionCooldownMs,
  type SuggestionMoment,
} from './suggestions';

const moment = (over: Partial<SuggestionMoment> = {}): SuggestionMoment => ({
  app: { bundleId: 'com.apple.Safari', name: 'Safari' },
  host: null,
  connectable: [
    { id: 'github', name: 'GitHub' },
    { id: 'gmail', name: 'Gmail' },
  ],
  skills: [{ name: 'developer-companion', title: 'Developer Companion', apps: ['github'] }],
  shownAt: new Map(),
  now: 1_000_000,
  ...over,
});

test('the app in front is read from its bundle id, or the site in a browser', () => {
  assert.equal(appInFront(moment({ app: { bundleId: 'com.tinyspeck.slackmacgap', name: 'Slack' } })), 'slack');
  assert.equal(appInFront(moment({ host: 'github.com' })), 'github');
  assert.equal(appInFront(moment({ host: 'www.linkedin.com' })), 'linkedin');
  assert.equal(appInFront(moment({ host: 'news.ycombinator.com' })), null);
  assert.equal(appInFront(moment()), null, 'a browser with no address says nothing');
});

test('an app Edi could connect is offered once, then left alone for a week', () => {
  const at = moment({ host: 'github.com' });
  const first = suggestNow('subtle', at);
  assert.deepEqual(first, {
    key: 'connect:github',
    kind: 'connect-app',
    text: 'Connect GitHub so I can help with it?',
    action: { label: 'Connect', appId: 'github' },
  });

  const shownAt = new Map([['connect:github', at.now]]);
  assert.equal(suggestNow('subtle', { ...at, shownAt }), null, 'not again straight away');
  assert.equal(
    suggestNow('subtle', { ...at, shownAt, now: at.now + suggestionCooldownMs - 1 }),
    null,
    'still quiet a moment before the week is up',
  );
  assert.equal(
    suggestNow('subtle', { ...at, shownAt, now: at.now + suggestionCooldownMs })?.key,
    'connect:github',
    'offered again a week later',
  );
  assert.equal(suggestNow('off', at), null, 'off means nothing at all');
});

test('a skill for that app is only offered at the fuller level, and once connected', () => {
  const connected = moment({ host: 'github.com', connectable: [{ id: 'gmail', name: 'Gmail' }] });
  assert.equal(suggestNow('subtle', connected), null, 'subtle keeps skills to itself');

  const helpful = suggestNow('helpful', connected);
  assert.equal(helpful?.kind, 'use-skill');
  assert.match(helpful?.text ?? '', /Developer Companion skill/);
  assert.deepEqual(helpful?.action, { label: 'Show me' });

  // Connecting comes first when both would apply.
  assert.equal(suggestNow('helpful', moment({ host: 'github.com' }))?.kind, 'connect-app');
  assert.equal(
    suggestNow('helpful', {
      ...connected,
      shownAt: new Map([[`skill:developer-companion:github`, connected.now]]),
    }),
    null,
  );
});
