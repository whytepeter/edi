---
name: daily-brief
description: >
  Plans the user's day: today's calendar, reminders that are due or overdue, and important unread
  email or messages, turned into a short checklist with the one thing to do first. Use when the
  user asks what their day looks like, to plan today or tomorrow, for a morning or daily brief,
  or for a daily routine they can put on a schedule.
license: Proprietary
metadata:
  title: Daily Brief
  author: Fewerlabs
  version: "1.0"
  apps: googlecalendar outlook gmail slack todoist googletasks
---

# Daily Brief

A brief the user can take in at a glance: what's fixed, what's due, what needs them. Quiet on
a light day, focused on a busy one.

## Gather (skip what isn't available, don't ask about it)

- **Calendar:** today's events with `calendar_events` (and Google Calendar or Outlook when
  connected). Note gaps of 30 minutes or more; those are when work gets done.
- **Due things:** `reminders_list` for due and overdue reminders; Todoist or Google Tasks when
  connected.
- **Needs a reply:** with Gmail, Outlook or Slack connected, unread messages from people (not
  newsletters or notifications) since the last working day, and anything that asks the user a
  direct question. At most five.
- **Carry-over:** unfinished items from yesterday's brief if one is in the workspace
  (`workspace_search` "Daily brief").

## The brief

Show it with `workspace_show` as a checklist titled "Today, <weekday> <date>":

1. **First:** the single most important thing, and why, in one line.
2. **Fixed:** events in time order: `09:30 Standup (15 min)`.
3. **Due:** reminders and tasks, overdue first.
4. **Replies:** who is waiting and what about, one line each.
5. **Focus time:** the best free block for deep work.

Spoken or in chat, say one or two sentences: how busy the day is and the first thing. Don't
read the list out.

## On a schedule

When the user wants this every morning, create it with `schedules_create` (for example weekdays
at 8:00), with instructions to follow this skill. A scheduled brief should be quiet: save it and
notify briefly, don't speak unless the user asked for spoken briefs.

## Tomorrow and the week

"Plan tomorrow" works the same with tomorrow's date. "My week" gives one line per day with its
fixed events and the one deadline that matters.

## Don't

- Don't mark emails read, reply, or change events or reminders unless asked, and then through
  the usual review.
- Don't include private message contents beyond the one-line gist.
