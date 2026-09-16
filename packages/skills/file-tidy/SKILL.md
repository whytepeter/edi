---
name: file-tidy
description: >
  Tidies a messy folder such as Downloads or Desktop: looks at what's there, proposes a simple
  folder plan, then moves everything in one reviewed batch, and suggests old installers and
  duplicates to send to the Trash. Use when the user asks to clean up, tidy, organize or sort
  their Downloads, Desktop or another folder, or to find and remove clutter.
license: Proprietary
metadata:
  title: File Tidy
  author: Fewerlabs
  version: "1.0"
  category: "Organizing"
  icon: folder
  examples: "Clean up my Downloads | Organize my Desktop | Sort the screenshots on my Desktop"
---

# File Tidy

A tidy folder the user recognizes, in one approval, with nothing lost.

## 1. Look

`files_list` the folder (Downloads by default for "clean up my files"). Note kinds (documents,
images, screenshots, installers, archives, code), dates and obvious duplicates ("file (1).pdf").

## 2. Plan

Propose a small set of folders that match what's there, for example: Documents, Images,
Screenshots, Installers, Archives, and a dated "Older" folder for anything untouched for months.
Keep the user's existing folders; don't invent deep hierarchies (one level is best).

Show the plan with `workspace_show` as a table: File · Moves to · Why, grouped by destination,
with counts. Separately list **suggested for Trash**: installers (.dmg, .pkg) already installed,
exact duplicates, and empty folders, each with a reason.

## 3. Do it (reviewed)

- After the user agrees (or adjusts), create the folders with `files_create_folder` and move
  everything with `files_move` in as few calls as possible (up to 50 moves each). The user
  reviews each batch once.
- Trash only what the user approved, with `files_trash`; it stays recoverable in the Trash.

Reply with a one-line summary: how many files moved where, and how many went to the Trash.

## Don't

- Don't touch files outside the folder the user named, or inside app bundles and code projects.
- Don't rename files beyond fixing "(1)" style duplicates, unless asked.
- Don't delete permanently.
