# Reader Interaction Foundation Design

## Goal

Make TingEar's primary reading surfaces feel like one coherent desktop reader by fixing context-menu behavior, reducing paragraph card noise, restoring the chapter-title rendering contract, and adding keyboard-visible interaction states.

## Scope

This change covers the main bookshelf and AI reading view only.

- Replace the bookshelf's raw-coordinate menu with a reusable accessible context menu.
- Reuse that menu for paragraph and selected-text actions in the AI reader.
- Group bookshelf commands without removing existing capabilities.
- Clamp and flip menus within the current viewport and allow long menus to scroll.
- Support Escape, ArrowUp, ArrowDown, Home, End, Shift+F10, outside-click dismissal, and focus restoration.
- Render a chapter title when structured content does not already contain an equivalent heading block.
- Present normal paragraphs as continuous reading content; retain framed treatments for quotes, code, and notes.
- Add global focus-visible and reduced-motion rules.

The change does not redesign settings, the bottom player, AI answer actions, or the native subtitle/floating-ball menus. Those are separate follow-up slices.

## Interaction Model

### Shared context menu

`ContextMenu` owns viewport placement, focus, keyboard navigation, dismissal, and menu semantics. Callers provide declarative groups and commands. Each command has an id, label, optional icon, disabled/danger state, and an `onSelect` callback.

The menu is rendered through a portal. Initial placement uses an estimated size and is recalculated from the measured menu before paint. Positioning keeps an 8 px viewport margin, prefers the pointer origin, shifts left/up when needed, and applies a bounded scroll area when the menu is taller than the viewport.

### Bookshelf

Right-clicking a book or activating its visible overflow button opens the same command set. Commands are grouped as:

1. Reading: open, select chapters, favorite.
2. Book metadata: replace cover, regenerate cover, edit title.
3. Export: export bookmarks, export audio.
4. Album operations when an album is active.
5. Content tools: remove spaces, clean format.
6. Destructive: delete book.

Existing handlers remain the owners of mutations; the menu only invokes them.

### AI reader

Right-clicking a block without a selection operates on that block. Right-clicking while text inside the reader is selected operates on the selected text. Available actions are read aloud, copy, quote, and ask AI. "Ask AI" uses the existing quote-and-focus flow rather than introducing a second AI request path.

The existing selection toolbar remains the fast mouse-selection surface. The context menu provides a discoverable paragraph-level and keyboard-invokable alternative.

## Reading Presentation

Normal paragraphs are unframed and participate in a continuous article flow. The active paragraph uses a subtle background and left marker rather than a full card border. Quotes, code, footnotes, and endnotes keep specialized framed surfaces. The content column remains bounded, but its typography uses consistent paragraph spacing and reading line height.

`ContentCards` renders `chapter.title` before blocks only when the first meaningful heading block does not already match the title. This avoids duplicate chapter titles while making the data contract explicit.

## Accessibility

- The context menu uses `role="menu"`, `role="menuitem"`, and separators.
- Opening focuses the first enabled command; closing restores focus to the trigger when available.
- Keyboard navigation skips disabled commands.
- Every icon-only trigger has an accessible label.
- Shared button styles receive a visible keyboard focus ring.
- Motion-heavy transitions and animations are disabled when `prefers-reduced-motion: reduce` is active.

## Code Boundaries

- `src/components/ui/ContextMenu.tsx`: generic menu types, placement, focus, keyboard, and portal rendering.
- `src/components/BookShelf.tsx`: book command definitions and existing book handlers.
- `src/components/reader/ContentCards.tsx`: chapter-title contract and reader context-menu orchestration.
- `src/components/reader/ContentCard.tsx`: semantic block presentation only.
- `src/styles/globals.css`: global focus and reduced-motion rules.

No new dependency is required.

## Testing

- Pure placement tests cover bottom-right clamping and small viewports.
- Static rendering tests cover menu roles, disabled/danger states, chapter-title de-duplication, and paragraph presentation.
- Existing reader tests must pass without weakening their chapter-title assertion.
- Typecheck, lint, and the full test command are required before completion.

## Risks

- The bookshelf has many inline handlers. Migration must preserve every command and its close behavior.
- Portal menus are not present during server rendering unless the surface component is tested independently.
- Browser selection text can outlive a right-click. Reader actions must snapshot text at menu-open time.
- Existing uncommitted work is extensive, so edits remain confined to the listed files and new test/component files.
