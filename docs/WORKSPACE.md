I’d make `~/Documents/Edi` the **user-visible Edi Workspace**, and organize it so it stays understandable even if Edi creates thousands of things over time.

A strong structure would be:

```text
~/Documents/Edi/
│
├── Inbox/
│   ├── Files/
│   ├── Links/
│   └── Captures/
│
├── Notes/
│   ├── Quick Notes/
│   ├── Meeting Notes/
│   └── Daily Notes/
│
├── Tasks/
│   ├── Active/
│   ├── Completed/
│   └── Scheduled/
│
├── Research/
│   ├── Web Research/
│   ├── Comparisons/
│   └── Sources/
│
├── Projects/
│   └── <project-name>/
│       ├── Notes/
│       ├── Research/
│       ├── Files/
│       ├── Outputs/
│       └── References/
│
├── Artifacts/
│   ├── Reports/
│   ├── Diagrams/
│   ├── Charts/
│   ├── Tables/
│   ├── Checklists/
│   ├── Images/
│   └── Generated Files/
│
├── Conversations/
│   └── Saved/
│
├── Media/
│   ├── Images/
│   ├── Audio/
│   └── Video/
│
├── Automations/
│   ├── Watches/
│   ├── Schedules/
│   └── Results/
│
├── People/
│   └── <person-name>/
│
├── Imports/
│
├── Exports/
│
├── Archive/
│
└── .edi/
    ├── index/
    ├── metadata/
    ├── task-state/
    ├── artifact-state/
    ├── search/
    ├── thumbnails/
    ├── cache/
    └── trash/
```

The important part is that **the visible folders are for the user**, while `.edi/` is Edi’s private bookkeeping.

### How I would use each area

**Inbox** should be the landing zone for things Edi hasn't organized yet. For example, if you send Edi a Telegram file, screenshot, URL, PDF, or voice note, it can initially arrive here.

Edi can then ask or infer:

> “This looks related to the Edi project. Move it to Projects/Edi?”

That prevents random files from getting scattered everywhere.

**Notes** is for lightweight human-readable material. Not every piece of generated content should become a note.

**Tasks** should mostly represent persistent task outputs, not Edi's internal execution queue. The actual task state should live in Edi's database. A task folder could contain things like:

```text
Tasks/Active/Find frontend jobs/
    task.md
    results.md
    sources.json
```

But the authoritative running state remains internal.

### Projects should be the most important organizational unit

For anything substantial, Edi should create a project.

For example:

```text
Projects/
├── Glown/
│   ├── Notes/
│   ├── Research/
│   ├── Files/
│   ├── Outputs/
│   └── References/
│
├── Ant Kingdom Saga/
│   ├── Notes/
│   ├── Research/
│   ├── Files/
│   ├── Outputs/
│   └── References/
│
└── Job Search/
    ├── Notes/
    ├── Research/
    ├── Files/
    ├── Outputs/
    └── References/
```

That makes Edi much more useful because users can say:

> “Save this to the Glown project.”

> “What have we researched for Ant Kingdom Saga?”

> “Find the report you made for my job search.”

Edi can understand the project boundary rather than searching the entire workspace blindly.

### Artifacts should represent things Edi creates

This is where your Dynamic Content concept becomes persistent.

For example:

```text
Artifacts/Reports/
    Remote frontend jobs - 2026-09-13.md

Artifacts/Diagrams/
    Edi architecture.svg

Artifacts/Charts/
    AI model cost comparison.json

Artifacts/Checklists/
    Edi v0.1 release checklist.md
```

But I would also let an artifact belong to a project.

For instance, this:

```text
Projects/Edi/Outputs/architecture.svg
```

is better than always dumping everything into global `Artifacts/Diagrams`.

Think of `Artifacts/` as the home for **standalone content**, while project-specific content stays with its project.

### Research deserves its own concept

Research often has more structure than a normal note:

```text
Research/
└── Local TTS models/
    ├── summary.md
    ├── sources.json
    ├── comparisons.csv
    └── attachments/
```

Edi can preserve where facts came from instead of producing a report with no provenance.

That will matter when Edi does background research for you.

### Automations

This would make background Edi activity easy to inspect:

```text
Automations/
├── Watches/
│   └── Senior Frontend Jobs/
│       ├── watch.md
│       └── results/
│
├── Schedules/
│   └── Weekly Job Search/
│
└── Results/
```

But again, the actual scheduler shouldn't depend on these files. These are user-visible representations.

### People is optional but potentially powerful

Later Edi could have:

```text
People/
├── Sarah/
│   ├── notes.md
│   └── files/
│
└── Recruiter - Acme/
    ├── notes.md
    └── correspondence/
```

I wouldn't automatically build profiles on everyone Edi encounters. The user should intentionally save people here.

### Imports and Exports should be deliberately different

**Imports**

Things brought into Edi.

```text
Imports/
    resume.pdf
    requirements.docx
```

**Exports**

Things leaving Edi.

```text
Exports/
    Edi Architecture.pdf
    Job Search Report.csv
```

That distinction will make debugging and file management much cleaner.

### Archive instead of deleting everything

Old projects, research and completed work can move to:

```text
Archive/
    Projects/
    Research/
    Tasks/
```

The workspace stays clean without losing useful history.

### `.edi` is very important

Users should normally never need to touch it.

Example:

```text
.edi/
├── metadata/
│   └── artifact-index.json
├── index/
├── thumbnails/
├── task-state/
├── search/
├── cache/
└── trash/
```

This lets Edi know things that can't be represented cleanly by folders alone, such as:

- artifact IDs
- originating conversation
- originating task
- project relationships
- tags
- creation dates
- last opened
- pinned state
- source URLs
- renderer type
- versions
- whether something is generated or imported

But I would **not put critical application state only in `.edi` files**. Your SQLite database should remain authoritative for Edi's runtime state. The Documents folder is the workspace, not the database.

### One thing I would avoid

Don't make Edi automatically generate deeply nested folders like:

```text
Research/2026/September/13/Web/Jobs/Remote/Frontend/Senior/React/
```

It looks organized initially but becomes miserable to navigate.

Keep folders relatively shallow and let **metadata + search + tags** handle finer categorization.

### The rule I would give Edi

The organization logic can be this simple:

```text
Unclassified input       → Inbox
Quick human writing      → Notes
Work with a goal         → Project
Long-running operation   → Task
Investigation            → Research
Generated rich content   → Artifact
Incoming external file   → Imports
Outgoing generated file  → Exports
Old inactive content     → Archive
Internal metadata        → .edi
```

And the strongest principle should be:

> **Prefer organizing around what the user is working on, not around file types.**

So if Edi generates a report, diagram, CSV and screenshot for the same project, keeping them together under `Projects/<name>` is usually better than scattering them into four global folders.

That would give Edi a workspace that remains useful from **10 files to tens of thousands of artifacts**, without turning `Documents/Edi` into another messy Downloads folder.