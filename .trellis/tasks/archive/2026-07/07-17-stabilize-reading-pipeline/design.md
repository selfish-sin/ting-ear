# Design: Stable Reading Pipeline

## Data Flow

`file parser -> normalized parse result -> persisted BookData -> normalized store load -> selected book/range -> player -> TTS`

Text cleaning branches from a persisted book and rejoins through a normalized edit record before preview/player selection.

## Contract Ownership

- Introduce or extend one shared book-content normalization module at the Electron/frontend-neutral TypeScript layer. It owns sentence cleanup, chapter repair, range/index clamping, and empty-content validation.
- Parsers remain responsible for format extraction and metadata. The import/reprocess boundary is responsible for enforcing the normalized result before persistence.
- The book store normalizes legacy persisted data defensively and preserves the last valid in-memory snapshot when persistence fails.
- App navigation owns atomic selection of the book plus range and resets player page/chapter/sentence/playback state before rendering the next player context.
- Player version switching uses the same sentence normalization and resets/clamps all derived indices, rather than only replacing the sentence array.

## Reading Unit Segmentation

- Keep natural-boundary detection separate from minimum-length aggregation. Candidate boundaries include Unicode sentence boundaries plus semicolons, line breaks, and Chinese/ASCII ellipses.
- Count Unicode letters and numbers rather than UTF-16 code units, whitespace, or punctuation. A candidate at 20 readable characters is complete; a shorter candidate consumes whole following candidates until it reaches the threshold or input ends.
- Preserve sentence-ending punctuation and closing quotes. Keep decimals such as `1.2` and common English abbreviations such as `Dr.` intact, and restore a space when English fragments are joined.
- Apply the rule when raw text becomes sentence data. Do not silently regroup persisted sentence arrays during load because that would invalidate stored chapter, progress, and bookmark indices; existing books adopt the rule through the established reprocess flow.

## Title Model

Use the existing persisted `BookData.title` as the user-visible title unless the current reprocess implementation overwrites parser metadata. If it does, add a backward-compatible optional source/custom-title distinction and a single display-title projection. The rename command validates centrally, persists through the existing book update path, and is exposed in the current bookshelf action menu/dialog pattern.

## Error Handling

- Convert parser/library exceptions into format-specific actionable messages at the import boundary.
- Reject normalized results with zero readable sentences before replacing an existing book.
- Never partially update store state before persistence success when the existing API can report failure.
- Log or toast the failing stage and book/file identity without including file contents or secrets.

## Compatibility

- Existing books without new optional fields continue to load.
- Invalid sentence/chapter/index data is repaired deterministically.
- Bookmark/progress indices cannot be perfectly remapped after sentence removal; clamp them and preserve valid entries. Do not silently invent text mappings.

## Verification

- Unit-test normalization and title validation as pure functions.
- Add regression coverage for sequential book opens, version changes, and persistence/reprocess title preservation at the narrowest testable layer.
- Run typecheck, lint, project tests, and production build.
