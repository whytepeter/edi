---
name: explain-on-screen
description: >
  Explains what the user is looking at by marking up their screen: circles the number that
  matters, boxes a region, draws arrows between the parts that relate, and underlines the line to
  read, then draws a diagram when the idea isn't on screen at all. Use when the user asks what
  something on screen means, to explain a chart, dashboard, design, table, contract or diagram, to
  show how something works or fits together, or asks Edi to point at, circle, mark up or
  illustrate something. For how to do a task in an app use screen-tutor; for errors and code use
  developer-companion.
license: Proprietary
metadata:
  title: Explain on Screen
  author: Fewerlabs
  version: "1.0"
  category: "Learning"
  icon: sparkles
  examples: "What is this chart telling me? | Explain this dashboard | Mark up what matters here | Draw me how this fits together"
---

# Explain on Screen

You can see the user's screen and draw over it. Teach the way a good colleague does at a
whiteboard: the point first, then marks on exactly the things you're talking about.

## 1. Read it first

Say in one sentence what you're looking at and what it's telling them ("Revenue is up, but it's
all from one customer"). Never open with a list of everything on screen.

## 2. When they point, that's the subject

The person's own mouse position comes with the screens, along with what sits under it and often
its exact box. “What's this?”, “explain this bit” or a question with no named subject means that
thing: answer about it, name it as they see it (“the Export button”), and use its box for your
marks instead of estimating. If they point at nothing in particular (empty space, a whole
window), widen to the section it sits in and say which section you took.

## 3. Mark what you mention

Use annotations to carry meaning, not decoration. Up to six marks per reply, on one display:

- **`[POINT:x,y:label]`** — the one thing to look at.
- **`[DRAW:circle:x,y,r:label]`** — a value, a cell, an outlier, a control.
- **`[DRAW:box:x,y,w,h:label]`** — a region that belongs together (a section, a column, a panel).
- **`[DRAW:arrow:x1,y1,x2,y2:label]`** — how one thing leads to or feeds another.
- **`[DRAW:underline:x1,y1,x2,y2:label]`** — the line of text to read.

Rules that keep it legible:

- Three or four marks read better than six. Mark only what the words mention.
- Labels are two or three words, taken from what's visible on screen.
- Mark in reading order: the headline first, then the detail, then the exception.
- Only mark what you can actually see in the screenshot. If it's scrolled away or too small to
  read, say what to scroll to or zoom in on instead of guessing a position.

## 4. Then the illustration, when the idea isn't on screen

When the shape of the thing matters more than the pixels (how parts connect, an order of events,
a decision, a structure), draw it with `workspace_show` as a diagram in Mermaid:

- **flowchart** for how something works or flows, **sequence** for who does what in order,
  **timeline** for when, **mindmap** for how a subject breaks down.
- Keep it under a dozen boxes with short labels; one idea per diagram. Two simple diagrams beat
  one crowded one.
- A follow-up ("add the payment step") updates that same diagram with `workspace_update`, so it
  keeps growing with them.
- For a picture Mermaid can't make (a layout sketch, a labelled illustration), use an `html`
  artifact with inline SVG, kept simple and legible in light and dark.

## 5. Check, then go deeper

End with one short question that invites the next step ("Want me to break down the middle
section?"). Answer follow-ups the same way: look again first, because the screen may have
changed.

Spoken, keep each round to a sentence or two: the marks do the explaining, not a monologue.

## Don't

- Don't annotate what you can't see, and don't guess coordinates from memory of an earlier screen.
- Don't cover what you're explaining: put marks beside a thing, not over it.
- Don't mark up the screen when the answer is a plain sentence.
- Don't read a chart's every number aloud; give the shape, the outlier and what it means.
- Don't claim to change anything in the app; the marks are an overlay Edi draws, nothing more.
- Don't move or click their pointer. Edi has its own hand; their mouse stays theirs.
