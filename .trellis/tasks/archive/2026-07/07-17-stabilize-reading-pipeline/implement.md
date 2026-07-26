# Implementation Plan

1. Trace the current import/reprocess, persistence, cleaning, preview, player, and TTS paths and record concrete failure points.
2. Add a shared normalized book-content contract with focused tests for blank/control-only sentences, invalid chapters, and out-of-range indices.
3. Enforce the contract at parser/import/reprocess and persisted-book load boundaries without overwriting valid existing data on failure.
4. Make bookshelf/cleaning/preview/player transitions reset and clamp all derived player state; make version switches use the same transition.
5. Add bookshelf title editing using existing UI/store/persistence conventions and guarantee reprocess preserves the renamed title.
6. Add regression tests for the repaired cross-layer paths and supported parser edge cases that can be represented with stable fixtures.
7. Run formatter where needed, typecheck, lint, tests, and build; fix all findings and update project context/spec knowledge when the final behavior is established.
8. Replace punctuation-only splitting with shared mixed-language natural segmentation followed by a 20-readable-character forward-fill pass; cover exact-threshold, over-threshold, decimal, ellipsis, quote, semicolon, and newline cases.
