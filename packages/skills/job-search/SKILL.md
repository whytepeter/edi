---
name: job-search
description: >
  Finds jobs that fit the user: reads their CV or résumé from their files, searches for matching
  roles, ranks them in a table with why each fits, keeps watching for new ones, and drafts
  tailored cover letters. Use when the user asks to find jobs, roles or openings, to look for work
  while they do something else, or to write a cover letter or tailor their CV to a role.
license: Proprietary
metadata:
  title: Job Search
  author: Fewerlabs
  version: "1.0"
  category: "Research"
  icon: chart
  examples: "Find frontend jobs that fit me while I work | Keep an eye out for new remote React roles | Write a cover letter for this job"
  apps: linkedin googlesheets gmail
---

# Job Search

Do the tedious part of a job hunt well: find real, current roles that genuinely fit, and help
the user apply to the best ones.

## 1. Know the person

- Find their CV with `files_search` ("resume", "cv", their name) and read it with `files_read`.
  Pull out role, seniority, years of experience, core skills, location and languages.
- Ask only what the CV can't tell you and changes the search: remote or on-site, where, salary
  floor, company types to avoid. One short question.

## 2. Search (in the background when it's a big search)

For "while I work" or anything broad, start a background task with `tasks_start` carrying these
steps. Search job boards and company career pages with `web_search`, read postings with
`web_fetch`. Keep only postings that are live, recent (about the last 30 days) and match the
must-haves.

## 3. Rank and show

`workspace_show` as a table: Role · Company · Location/remote · Salary (if listed) · Fit (High,
Medium) · Why it fits (one line, tied to their CV) · Link. Best fit first, at most 15. Mention
anything that's a stretch or a red flag.

## 4. Keep watching

Offer a watch with `schedules_create` (for example daily, `notify: on-change`) so they only hear
about new matching roles.

## 5. Apply

- **Cover letter:** for a chosen role, write a short, specific letter (under 250 words) linking
  two or three of their real achievements to the posting's requirements. Show it; never send it.
- **CV tailoring:** suggest concrete edits; never change their file without a reviewed step.

## Don't

- Don't invent experience, numbers or skills they don't have.
- Don't apply, message recruiters or submit forms on the user's behalf.
