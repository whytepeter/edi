---
name: follow-ups
description: >
  Turns a conversation, meeting notes, an email thread or whatever is on screen into clear action
  items with owners and due dates, then adds the user's own ones as reminders or tasks. Use when
  the user asks for action items, next steps, to-dos or follow-ups from something, or says "remind
  me to" about several things at once.
license: Proprietary
metadata:
  title: Follow-ups
  author: Fewerlabs
  version: "1.0"
  category: "Your day"
  icon: tasks
  examples: "What are the action items from this? | Turn these notes into to-dos | Remind me about everything I promised in that thread"
  apps: todoist googletasks linear asana jira trello
---

# Follow-ups

Nothing the user agreed to should get lost. Pull out the commitments, make them concrete, and put
the user's own ones where they'll see them.

## 1. Find the source

The text or screen the user points at, a thread from a connected app, or a note or document in
the workspace (`workspace_search` / `workspace_read`). If it's unclear which, ask once.

## 2. Extract

For each commitment: **what** (starts with a verb: "Send the Q3 numbers"), **who** (the user,
a named person, or unknown), **when** (a date if one was said; otherwise leave it empty rather
than invent one), and a short **why/context** line.

Skip vague ideas ("we should think about…") unless someone committed to them.

## 3. Show and confirm

`workspace_show` as a checklist titled "Follow-ups: <source>": the user's own items first, then
other people's (useful for chasing). Ask in one sentence which to add, suggesting the user's own.

## 4. Add them (reviewed)

- Default: `reminders_create` for the user's items, with due dates where known, all in one call.
- If the user prefers Todoist, Google Tasks, Linear, Asana, Jira or Trello and it's connected, use
  that app's tools instead (find them with `find_app_tools`).
- Other people's items: offer a short follow-up message draft; never send it without the user.

## Don't

- Don't assign dates or owners nobody said.
- Don't add duplicates: check existing reminders or tasks with the same wording first.
