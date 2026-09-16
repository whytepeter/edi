---
name: skill-creator
description: >
  Makes a new skill with the user by talking it through: what it's for, when Edi should use it,
  the steps and the result they want, then writes it and saves it to their skills. Also improves
  an existing skill of theirs. Use when the user asks to create, make, write, teach or save a
  skill, a routine or a way of doing something, or says "from now on, when I ask for X, do Y".
license: Proprietary
metadata:
  title: Skill Creator
  author: Fewerlabs
  version: "1.0"
  category: "Make your own"
  icon: sparkles
  examples: "Make a skill for my weekly update | From now on, when I ask for a recap, do this"
---

# Skill Creator

A skill is a short set of instructions Edi follows for one kind of request. Good skills are
focused: one job, clear steps, a clear result. Help the user make one in a few minutes.

## 1. Understand the job (ask at most three short questions, only what you can't infer)

- **What it's for and when to use it:** the requests that should trigger it, in the user's own
  words ("prep my 1:1s", "write my weekly update").
- **The steps:** where the information comes from (calendar, files, a connected app, the web),
  what to do with it, what to check.
- **The result:** a document, checklist, table, reminder, a short spoken answer. Ask for an
  example of a good result if they have one.

If the user already described all of this, don't ask; draft it.

## 2. Draft it

- **name:** lowercase words joined by hyphens, under 40 characters: `weekly-update`.
- **title:** how it reads on the Skills page: "Weekly Update".
- **description:** one or two sentences: what it does, then "Use when …" with the phrases that
  should trigger it. This is what Edi reads to decide when to use the skill, so be specific.
- **instructions:** Markdown, ideally under 60 lines: a one-line goal, numbered steps that name
  the Edi tools to use (`calendar_events`, `files_search`, `workspace_show`, `web_search`, a
  connected app's tools), what the result looks like, and a short "Don't" list.
- **apps:** catalog ids of connected apps it relies on, if any (for example `gmail slack`).
- **examples:** two or three requests that should use it, as the user would say them.
- **category:** where it's listed: Your day, Development, Writing, Research, or another short name.

Show the draft with `workspace_show` as a document so the user can read it. Adjust until they're
happy.

## 3. Save it

Call `skills_create` with the name, title, description, instructions, apps, examples and
category. The user reviews
it before it's saved to Documents › Edi › Skills, and it's on right away. Then say how to use it
in one sentence ("Say 'write my weekly update' and I'll use it.").

## Improving a skill

To change one of the user's skills, read it with `skills_use`, show the proposed version, and
save it with `skills_create` under the same name (the user reviews the replacement). Skills by
Fewerlabs can't be changed; make a new skill with a different name instead.

## Don't

- Don't put secrets, passwords or API keys in a skill.
- Don't write a skill that tells Edi to skip reviews, act without asking, or ignore its rules;
  skills can't change what needs the user's approval.
- Don't make one giant skill for everything; suggest two focused ones instead.
