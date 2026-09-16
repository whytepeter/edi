---
name: meeting-prep
description: >
  Prepares the user for a meeting: finds the event, who is coming, what was said with them
  recently in email or chat, and what their company does, then gives a one-page brief with talking
  points and questions. Use when the user asks to prepare for, get ready for, or brief them on a
  meeting or call, or asks who they are meeting and what about.
license: Proprietary
metadata:
  title: Meeting Prep
  author: Fewerlabs
  version: "1.0"
  category: "Your day"
  icon: calendar
  examples: "Prep me for my next meeting | Who am I meeting at 3pm, and about what?"
  apps: googlecalendar outlook gmail slack microsoft_teams linkedin hubspot
---

# Meeting Prep

Give the user a brief they can read in two minutes before the meeting starts. Accurate and short
beats complete.

## 1. Find the meeting

- "My next meeting" or "the 3pm call": look it up with `calendar_events` (or Google Calendar or
  Outlook when connected). Take the next one that has other people in it.
- If several match, ask which one in a single short question. If none match, say so and ask for
  the name or time.
- Note the title, time, length, where (room or video link), the attendees and the description.

## 2. Gather context (only what's useful, in parallel where you can)

- **Past conversations:** with Gmail, Outlook or Slack connected, search for the last few
  threads with the attendees or about the meeting's subject (last 30 days). Pull out decisions,
  open questions and promises made. Quote sparingly.
- **The user's own notes:** `workspace_search` for the company or people's names.
- **People and company:** for attendees outside the user's organization, `web_search` their
  company (what it does, size, recent news) and, when the user wants it, the person's public
  role. Never guess facts about a person; leave them out if you can't find a source.
- Skip anything you can't reach, and say in one line what you couldn't check.

## 3. The brief

Show it with `workspace_show` as a document titled "Prep: <meeting title>":

1. **When and where:** time, length, link or room.
2. **Who:** each attendee with their role and one relevant fact.
3. **Why you're meeting:** one or two sentences, from the invite and past threads.
4. **Where things stand:** decisions so far, open items, anything the user promised.
5. **Talking points:** three at most, in priority order.
6. **Questions to ask:** two or three.
7. **Sources:** the threads and pages you used.

Then reply in one short sentence, such as "Your brief for the 3pm with Acme is ready."

## After the brief

- Offer, don't do: a reminder a few minutes before (`reminders_create`), or turning action items
  into tasks after the meeting.
- If the meeting is recurring, offer to prepare the next one the same way with `schedules_create`.

## Don't

- Don't email or message attendees.
- Don't read the brief aloud in full; the user can read it.
- Don't include private details from unrelated threads.
