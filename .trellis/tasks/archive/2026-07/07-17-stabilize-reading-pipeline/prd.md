# Stabilize reading pipeline and add bookshelf title editing

## Goal

Fix bookshelf-to-player and cleaning navigation, eliminate invalid or empty sentence entries, harden supported file parsing and cross-layer book data flow, and add persistent custom bookshelf titles.

## Requirements

- Bookshelf-to-preview/player navigation must always open the selected book with a valid sentence range and reset stale player indices from the previously opened book.
- Text-cleaning apply/cancel/navigation must keep operating on the intended book and must not leave the player on stale sentences, chapters, pages, or ranges.
- Every supported import format (EPUB, TXT, PDF, DOCX, Markdown, HTML) and every reprocess/edit-history path must produce the same normalized book contract:
  - sentences contain non-empty, readable text only;
  - natural sentence fragments shorter than 20 Unicode letters/numbers are joined forward until the accumulated reading unit reaches 20; units already at or above 20 are not extended;
  - mixed Chinese/English punctuation, decimals, ellipses, closing quotes, semicolons, and line boundaries are segmented without losing punctuation or splitting numeric decimals;
  - chapters use finite, non-negative, in-bounds indices/counts;
  - an empty parse is reported as a useful error instead of being persisted as a broken book.
- Existing persisted books with malformed sentence/chapter/progress data must be normalized when loaded so legacy data cannot crash or corrupt the UI.
- The player must clamp navigation and display state to the active sentence set, including original/edit-history version switches.
- Users can rename a bookshelf article from its existing item actions. The trimmed title must be non-empty, length-limited, persisted, and immediately reflected in bookshelf search/sort/display and subsequent views.
- Reprocessing or cleaning a renamed book must preserve the user-defined title.
- Removed COMET functionality must not be restored or referenced by the new flow.
- Failures at file, persistence, and navigation boundaries must surface actionable messages without discarding a previously valid book.

## Acceptance Criteria

- [x] Opening different books in succession never shows sentence numbers below 1, above the visible total, blank/invalid entries, or content from the previous book.
- [x] Entering and leaving text cleaning, applying a cleaned version, and switching among original/edit-history versions keeps sentence, chapter, page, range, and playback state coherent.
- [x] Shared normalization is applied to import, reprocess, persisted-book load, and edit-history/version data; malformed legacy data is repaired where possible and rejected with a clear error otherwise.
- [x] EPUB, TXT, PDF, DOCX, Markdown, and HTML parser fixtures cover empty input, control characters/blank fragments, and malformed chapter bounds without uncaught parser exceptions.
- [x] A bookshelf title can be renamed, survives reload and reprocessing, and validation rejects blank/overlong titles without changing stored data.
- [x] Typecheck, lint, existing tests, and new focused regression tests pass.
- [x] No COMET UI, IPC, service, setting, or navigation behavior is introduced.
- [x] New imports, reprocessing, quick text, and manual-clean sentence generation share the same mixed-punctuation segmentation and 20-character forward-fill behavior.

## Notes

- Treat the broad "full-chain" request as the supported document-to-playback path in this repository: file import/reprocess -> persisted `BookData` -> bookshelf/cleaning/preview -> player/TTS. Unrelated TTS engine deployment and OCR behavior are outside this change unless a traced defect directly affects this path.
- Preserve existing user data and current UI conventions. Do not replace persistence formats unless a backward-compatible optional field is required.
