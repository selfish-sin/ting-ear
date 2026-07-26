# Reader Interaction Foundation

## Problem

The bookshelf context menu can overflow the viewport and lacks keyboard semantics. The AI reader uses a card-heavy paragraph layout, has no paragraph right-click actions, and currently disagrees with its component test about where chapter titles are rendered.

## Acceptance Criteria

- Bookshelf and reader context menus remain within the viewport and support keyboard navigation.
- Both book cards and list rows expose a visible overflow trigger.
- Existing bookshelf commands remain available and are grouped.
- Reader blocks offer read, play-from-here, copy, quote, and ask-AI actions.
- Chapter titles render exactly once when structured blocks omit or contain an equivalent heading.
- Normal paragraphs are visually continuous; quotes, code, and notes remain distinct.
- Keyboard focus is visible and reduced-motion preferences are respected.
- Typecheck, lint, tests, and production build succeed.

## References

- Design: `docs/superpowers/specs/2026-07-26-reader-interaction-foundation-design.md`
- Plan: `docs/superpowers/plans/2026-07-26-reader-interaction-foundation.md`

