Here’s a compact summary you can give directly to Codex:

# Edi Dynamic Content / Artifact Rendering Summary
## Goal
Edi should not reduce every rich result to Markdown.
When a result is better understood visually or interactively, Edi should render it as rich Dynamic Content.
Examples:
- color suggestions → visual palette
- comparisons → cards or table
- numerical data → chart
- architecture → diagram
- jobs → structured result cards
- checklists → interactive checklist
- research → rich report
- custom interactive experiences → sandboxed HTML
The system should remain flexible enough to render things we have not explicitly designed yet.
---
## Core Principle
Do not create a hardcoded artifact type for every use case.
For example, avoid making `color-palette`, `job-results`, etc. fundamental renderer types.
Instead use:
> structured semantic data + presentation description
Edi should have a small set of trusted UI primitives that can be dynamically composed.
---
## Rendering Levels
### 1. Structured Dynamic Content
This should be the default.
The model provides structured data and a declarative presentation document.
Edi renders it using trusted React components.
Example primitives:
- Stack
- Grid
- Card
- Text
- Heading
- Badge
- Metric
- Image
- Swatch / color
- Table
- Chart
- Code
- List
- Checklist
- Progress
- Divider
- Button
- Link
- Gallery
Example concept:
```ts
{
  data: {
    colors: [
      {
        name: "Primary",
        value: "#6C5CE7"
      }
    ]
  },
  view: {
    layout: "grid",
    blocks: [
      {
        component: "swatch",
        bind: "colors"
      }
    ]
  }
}

The model describes the composition.

Edi owns the actual components and styling.

⸻

2. Visual Artifacts

Support richer visual formats such as:

* SVG
* diagrams
* charts
* visual scenes

These can still live within the Dynamic Content surface.

⸻

3. Interactive HTML Artifacts

For experiences that cannot reasonably be represented using Edi’s normal primitives, support self-contained:

* HTML
* CSS
* JavaScript

Examples:

* interactive calculators
* custom visualizations
* playgrounds
* simulations
* UI prototypes
* interactive design previews

These must run inside a sandbox.

Generated HTML must never execute directly inside Edi’s trusted React environment.

⸻

HTML Security

Treat generated HTML/JS as untrusted content.

Use a sandboxed iframe or similarly isolated renderer.

The artifact should have:

* no Node access
* no Electron access
* no filesystem access
* no raw IPC
* no credentials
* no direct capability access
* no shell access

Generated artifacts must not be able to bypass Edi’s capability and approval system.

Avoid exposing raw Electron APIs.

⸻

Artifact Bridge

If an HTML artifact needs to interact with Edi, expose a very small validated bridge.

Conceptually:

Artifact
   ↓
postMessage
   ↓
Artifact Host
   ↓
validate message
   ↓
Edi

Potential supported actions:

* copy value
* resize artifact
* emit UI action
* request save
* request export
* open approved link

Do not expose arbitrary IPC or capability execution.

⸻

Artifact Model

Keep artifact data separate from its presentation.

Conceptually:

Artifact {
  id
  title
  data
  metadata
  source
  persistence
  presentation
}

Presentation could support:

presentation: {
  renderer: "document" | "markdown" | "svg" | "html",
  compact?: ...,
  expanded?: ...
}

The exact schema can evolve.

Do not make generated HTML the only source of truth where structured underlying data exists.

⸻

Compact and Expanded Views

The same artifact should support different presentations.

Example:

Color result
   ↓
Compact Edi bubble
"6 colors suggested"
+ small swatches
   ↓
Expand
Full palette
usage guidance
contrast information
actions
   ↓
Optional interactive preview
Sandboxed HTML UI

The compact view and full Dynamic Content view should represent the same underlying artifact.

⸻

Saving vs Exporting

Saving means preserving the artifact inside Edi Workspace. Generated content is preserved there as part of
creation, so the expanded view does not need a second **Save to Library** action.

Exporting means creating an external representation.

For example, a color artifact could export as:

* CSS variables
* Tailwind config
* JSON
* Markdown
* image
* other formats later

Do not automatically create .md files when a rich visual artifact is more appropriate.

Markdown remains one supported representation, not the universal output format.

⸻

Presentation Selection

Edi should decide:

What is the best way to present this result?

instead of:

What file should I create?

Preferred flow:

Agent result
   ↓
Structured semantic data
   ↓
Choose appropriate presentation
   ↓
Render and preserve Dynamic Content in Edi Workspace
   ↓
Optional Export

⸻

Figma Color Example

If the user asks Edi for color suggestions from a design:

Bad experience:

colors.md
# Primary
#6C5CE7
...

Preferred experience:

* visual color swatches
* color names
* hex/RGB values
* suggested usage
* contrast/accessibility notes
* copy buttons
* full palette preview
* optional UI preview
* export options

A Markdown representation can still be available through Export.

⸻

Architecture Rule

Use:

trusted native composition when possible, sandboxed HTML when arbitrary presentation or interaction is genuinely required.

Do not allow model-generated HTML, JavaScript, SVG, or other content to bypass Edi’s security boundaries.

This should integrate with the existing Dynamic Content, Artifact, Workspace, Capability, and Presentation architecture rather than creating a parallel rendering system.
