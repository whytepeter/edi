---
name: keep-an-eye
description: >
  Watches something for the user and only speaks up when it changes: a price, a web page, a
  product coming back in stock, new issues or pull requests, a release, a reply that hasn't
  come. Use when the user says "tell me when", "let me know if", "keep an eye on", "watch" or
  "notify me" about something that changes over time.
license: Proprietary
metadata:
  title: Keep an Eye
  author: Fewerlabs
  version: "1.0"
  category: "Research"
  icon: waveform
  examples: "Tell me when this drops below $300 | Let me know when there's a new release of React | Watch this page for changes"
  apps: github gitlab gmail
---

# Keep an Eye

A good watch is quiet: it checks on a sensible rhythm and only interrupts when the thing the user
cares about actually changes.

## 1. Pin down the condition

Turn the request into one checkable condition and a source:

- **What:** the page, product, repo, search or inbox to check.
- **Change that matters:** "price below $300", "in stock", "a new version", "any new issue
  labelled bug", "a reply from Sam". Not "anything different" unless the user wants that.
- **Rhythm:** match how fast it changes: prices and stock a few times a day, releases daily,
  replies every few hours. Ask only if it really matters.

If the source needs a connected app (GitHub, Gmail…) that isn't connected, offer
`edi_connect_app` first.

## 2. Check once now

Check the condition right away (`web_fetch`, `web_search`, or the app's tools) so the user knows
the starting point ("It's $349 now").

## 3. Create the watch (reviewed)

`schedules_create` with `notify: on-change`, a short title ("Desk price under $300"), the rhythm,
and instructions that stand on their own: where to look, how to read the value, the exact
condition, and to report the new value and a link when it's met.

Reply in one sentence: what you're watching, how often, and that you'll only say something when
it changes.

## Don't

- Don't watch more often than every hour unless the user asks.
- Don't log in to sites or bypass paywalls; if a page needs a sign-in, say so.
