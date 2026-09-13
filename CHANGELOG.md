# Changelog

Meaningful product and architecture changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Edi is not versioned for public release yet.

## Unreleased

### Added

- Cloud voices: Cartesia (Sonic 3.6) and ElevenLabs (Flash v2.5) with separate keys, checked with the provider
  before they are saved and encrypted with the keychain. Settings → Voice explains each provider, links to where
  keys are made, lists the account's voices (your own first) with previews, and a voice named "Edi" becomes
  Edi's voice when the key is added. Only the words Edi speaks are sent; a failed cloud reply falls back to a
  local voice.
- Calm Chatterbox delivery (default), Liquid Glass toolbar and section menu, a warm acknowledgement ("On it")
  and short progress lines in the bubble when Conversations is not open.

- Web fetch (`web.fetch`): Edi can read a public page from a link you gave, search results or a page it
  already read. Following Anthropic's web fetch tool, Claude Code's WebFetch and the MCP fetch server: the
  worker only allows URLs already seen (no composed URLs, so pages cannot exfiltrate data), at most 10 reads
  per answer; http upgrades to https; addresses are checked at connect time for every hop (private, loopback,
  link-local, metadata and IPv4-in-IPv6 refused); same-site redirects only, other sites are reported; robots.txt
  respected for model-chosen links; 2 MB / 20 s bounds; HTML to readable text with 40k-character parts and a
  15-minute cache; page text is marked untrusted.

- Web search: the model can search the public web through OpenRouter's server tool (Codex) and cite sources.
  Source links in replies are clickable and open in the default browser (http/https only, validated in main);
  spoken replies say the link text, never the address. Edi's self-knowledge lists web search and says
  logged-in browsing is not available.
- Kokoro 82M (MLX) is the default speech model, and Chatterbox Turbo now runs on MLX (4-bit). Measured on the M2
  Pro: Kokoro starts in ~0.15–0.3 s at ~10× real time; Chatterbox streams first audio in ~0.5 s at ~3× real
  time (PyTorch was 1.3–1.9× slower than real time). Pocket stays available.
- Settings → Voice: choose the speech model, then its voice (27 Kokoro voices, female/male), with a Preview
  button that plays a sample through Edi's speaker. Each model remembers its voice; Edi can change both.

- Edi manages its workspace: `workspace.search` (notes and generated content, by title and text), `workspace.read`,
  `workspace.update` (replace generated content in place, reviewed first) and `workspace.delete` (move a note or
  generated item to the Trash, reviewed first). Generated content now has its own `artifacts` record (migration 3
  copies existing shown content, keeping each call id so conversation cards still open it).
- Library Delete: a trash button on each row with an inline confirmation; the file goes to the macOS Trash and
  the item leaves Library, the conversation and any open artifact window.
- A kind-aware bubble preview beside Edi: kind, title, a glimpse (checklist items, table rows, text, or a
  "try it" window for interactive pages) and an Open capsule.

- Interactive pages: `workspace.show` accepts `html` for calculators, simulations, interactive charts or UI
  previews that documents, checklists and tables cannot express. Main serves each page from Edi's history over a
  private `edi-artifact://` scheme with a sandboxing CSP: opaque origin, inline scripts and styles only, no
  network, storage, pop-ups, forms or downloads. The frame is `sandbox="allow-scripts"`, and the artifact window
  runs in its own in-memory session that refuses every other request and permission. Pages are saved to
  Documents › Edi › Artifacts › Interactive and download as `.html`.
- The artifact window: shown content opens in its own native-glass window beside the card, away from Edi, with
  Copy, Download, Show in Finder and Close (or Escape). It follows the card until you move or resize it.

- Shown content (artifacts): Edi can display documents, checklists, tables and saved notes instead of reading
  them out. They appear as inline cards in Conversations and open in the artifact window; a
  voice turn with the card closed gets a compact preview beside Edi with Open. Generated content is written to
  Documents › Edi › Artifacts automatically, with Markdown for text and CSV for tables.
- Edi's workspace folder, Documents › Edi, with notes in Edi › Notes (the old “Edi Notes” folder moves once). The
  Library lists and opens everything in it.
- Edi can open any page including Settings, change its own character, size, pin, voice and spoken replies, and
  close or sleep itself. Its self-knowledge now includes where you are, card state, voice loading, Library notes,
  what it can do (and what asks first) and what is not available yet.
- Mochi, a cream dumpling character from the owner's reference. Characters react happily on hover in Appearance.
- Recommended models in Settings → AI (fast, balanced, most capable); the full catalog opens only on request.
- A speech-bubble tail on the native glass bubbles beside Edi.
- Edi, the new default character drawn from the owner's reference: warm brown skin, winged eyes, full lips, gold
  hoops behind the jaw, and small hands that appear only to wave or celebrate. Saved Mira choices move to Edi.
- Settings → Appearance → Size: Small, Medium, or Large. Edi resizes in place, keeping its feet where they were.
- Native macOS glass (vibrancy) for the right-click menu and the bubbles beside Edi, with system rounded corners
  and shadow.
- Pointer and drawing alignment: Apple Vision recognizes on-screen text locally on the full-resolution capture,
  and each `POINT`/`DRAW` tag snaps to the matching text near where the model aimed. Shapes fit the target, with
  ellipses around wide labels. Measured on a Retina fixture: mean miss 25.3 → 1.4 image pixels.
- Home, the section the card opens on: greeting, ask box, the last conversation, recently saved notes, and any
  missing setup.
- A searchable model picker in Settings → AI listing OpenRouter models that accept images and support tools, with
  price tier and context size, and a typed-ID fallback when the catalog can't load.
- Card sections: Conversations, Library, Skills, Connectors, Appearance, and Settings. The compact card switches
  sections from its title menu; the expanded card shows a sidebar. Destinations are a closed contract list that
  main and future self-navigation can target, including nested Settings pages.
- Settings → AI, Voice, Keyboard, Privacy & Permissions, and About. Voice adds a persisted **Speak replies** switch;
  Privacy lists OS permission status, states what leaves the Mac, and holds the Activity log.
- Library lists saved notes and reveals a note in Finder by ID.
- **Settings** in the character menu and the app menu (⌘,).
- Mira, a simple monochrome avatar with geometric glasses and restrained feminine styling.
- A provider-independent character expression contract for idle, listening, thinking, speaking, happy, and
  attention states, with native Electron coverage for every bundled skin.
- Character motion and skin architecture documentation.
- A compact, request-bound approval bubble with Approve, Deny, and View details actions.
- Just-in-time microphone and Screen Recording permission cards backed by one typed permission registry.
- Local screen-intent policy so ordinary questions do not attach screenshots.
- Note read, edit, and delete capabilities addressed by stable note IDs.
- A dedicated macOS media-permission module that owns native prompts and Electron session policy.
- Strict indexed-access, switch-fallthrough, and override checks across every TypeScript package.
- A developer codebase guide covering process boundaries, subsystem ownership, data flow, and common changes.

### Changed

- The Edi card is native glass too: the window is the card (no transparent margin or stray outline), with
  desktop blur, a light tint, a specular rim and 22 px corners shared with the artifact window (`.glass-window`).
  Menu and bubble windows alone clear their own material, so the card's section menu stays legible.
- Skills lists only add-on skills and is empty for now. Built-in abilities (showing content, notes, Edi's
  self-knowledge) work under the hood, the way Claude doesn't list its own tools.
- Dark mode lifts dark skin accents to a readable lightness (`--accent-fill`, minimum-lightness `--accent-strong`),
  so selected items, your messages and buttons stay legible with Edi's brown.
- Documents render `---` rules and a proper heading scale, without paragraph gaps.
- The speech-bubble tail is a short rounded nub.
- Agent replies may use up to 16,000 output tokens so reports and interactive pages fit in one tool call.

- Size in Appearance is a slider. The card stays still while dragging and re-attaches once on release.
- Chatterbox Turbo keeps its loaded model when a reply is stopped, gets up to 10 minutes to load, and Jane answers
  until it is ready. Its first Metal pass now runs during background warm-up, and speech begins from the first
  three streamed words. Settings → Voice shows loading state and real-time speed.
- Edi's mouth follows the loudness of its own speech while talking; hands and body stay still. Listening and
  thinking only change the eyes, since the bubble already shows those states.
- The card stays beside Edi whenever Edi moves, pinned or not. Pinning only keeps it open when another app takes
  focus.
- OpenRouter setup moved from the conversation view to Settings → AI. Conversations is the card's home.
- The character and app menus say **Open Edi** instead of **Show content**.
- A plain click on Edi no longer starts listening; hold Edi or ⌥ Space to talk. Keyboard activation opens the menu.
- The right-click menu is now Open Edi, Settings, Sleep Edi, and Quit Edi.
- Clicking Edi's Dock icon or opening Edi again shows Edi and its card; hands-free listening starts only from
  **Edi → Listen** in the menu bar.
- Settings → AI shows that a key is saved instead of an empty key field, and changing the model keeps the key.
- Listening, agent work, speech playback, completion, notices, permissions, and approvals now drive the active
  avatar's expression through a validated main-to-pet event.
- The character bubble now shows listening, thinking, speaking, notices, and approvals instead of chat text.
- Pocket TTS now selects Jane as Edi's default local voice. The host passes the voice explicitly and verifies
  the worker loaded the requested voice before accepting audio.
- Desktop TypeScript configuration now inherits the shared workspace rules.
- OpenRouter image input now uses the AI SDK's current file-part contract.
- Product milestones now stage self-awareness, semantic artifacts, provider/model settings, background work,
  proactivity, computer use, and community extensions without making post-alpha ideas private-alpha gates.

### Fixed

- Edi looked like it was speaking before any audio existed. The speaking state now starts with the first
  synthesized samples. Measured on the M2 Pro: warm Chatterbox Turbo runs 1.3–1.9× slower than real time, with a
  ~1.5 s fixed cost per clip. The first clip is the fewest sentences that reach four words (or a clause break for a
  long sentence), and the worker no longer re-splits clips.
- Chatterbox paused mid-sentence: the speaker queued only 3 s, so the next sentence started generating too late.
  The speech queue is now 30 s, and the first clip ends at a sentence or clause break instead of after three words.

- The pointer hand no longer jumps back to an earlier drawing after its last action, and a pointing hand rests
  below its target instead of covering it.
- Drawing labels now sit under the target they describe instead of at a shape's corner, and every finished
  shape keeps its label.
- A pinned card no longer ends up away from Edi, whether reopened or while Edi is dragged.
- Connected previously static character artwork to the live voice and agent lifecycle so documented avatar
  animations actually run.
- Made reduced-motion override every expression-specific keyframe while preserving the semantic face.
- Prevented the last assistant reply from replaying whenever the content card opens.
- Prevented generic and pasted-content requests from capturing the screen.
- Prevented note reads from following replacement symlinks or loading files larger than 64 KiB.
- Removed the oversized hold-to-talk hint from routine character and shortcut interactions.

### Removed

- The Cloud and Sprout characters (saved choices move to Edi).
- The Mira character.
- Thought dots and listening rings on the character, and hand flapping and body bobbing while speaking.
- Ordinary assistant-response streaming in the side-of-head character bubble.
- The obsolete renderer text-reveal helper and its tests.
- The temporary ⌘⇧E listening shortcut, and Conversation and Stop from the character menu.
- The More menu, the placeholder intro view, the "Here when you need me ⌘⇧E" footer, and the Extensions preview
  catalog with its non-working entries.

### Security

- Approval actions are bound to the current run and tool call and accepted only from approved surfaces.
- Microphone capture is allowed only for the pet renderer while a voice turn is opening or listening.
- The approval preload validates bounded display data and exposes no raw Electron or IPC object.
- Agent workers reject malformed, oversized, or unexpected startup data before it reaches provider code.
