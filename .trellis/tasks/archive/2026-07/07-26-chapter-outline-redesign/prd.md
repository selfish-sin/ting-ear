# Chapter outline redesign

## Goal

Make the reader outline chapter-scoped, reliable, editable, and persistent. The selected reader chapter is the only input to generation, and changing chapters swaps the displayed record without starting generation.

## Requirements

- `BookData.chapters` is the canonical reader/TTS/AI partition. Fine-grained EPUB/Markdown headings remain body heading blocks and are regrouped into reasonable reading chapters before persistence.
- The outline panel displays the currently selected chapter only. Chapter selection follows the reader header and previous/next controls.
- Generation is manual. Chapter changes never trigger an AI request.
- Each request sends only the selected chapter sentences, with chapter-relative offsets.
- Cache records are keyed by book ID, stable chapter key, and sentence-content hash. Renaming a chapter does not invalidate its outline; changing sentence content does.
- Chapters with 10 or fewer sentences never call the model. They persist a completed `short_chapter` record with one navigable overview item.
- For longer chapters, request at least `min(12, max(2, ceil(sentenceCount / 40)))` sections and accept one to 16 validated sections.
- Section selection updates the canonical reader position and containing content block without starting playback. Existing playback state is preserved.
- Chapter names and generated section titles have inline pencil editors, Enter/blur save, Escape cancel, validation, and restore-original actions. AI analysis text is read-only.
- Regeneration confirms when custom section titles exist. Successful regeneration replaces old custom titles; failed regeneration retains the previous successful outline.
- A single FIFO process-wide queue runs one generation at a time. Accepted background work continues after chapter changes and cannot overwrite the visible record for another chapter.
- IPC reports failure when generation or persistence fails; it must not log or return success for an errored outline.
- Existing outline cache version 2 is invalidated, and existing chapter titles remain the original-title defaults.

## Acceptance Criteria

- [x] Dense-TOC EPUB regression produces a reasonable chapter count and aligned `chapters`/`structure` ranges while preserving heading blocks and global sentence progress.
- [x] Short-chapter and proportional-minimum generator tests pass, including valid one-section results, chunk-relative offsets, strict offset/count validation, and failed-regeneration preservation.
- [x] Cache writes are atomic, content changes invalidate records, and cache survives restart.
- [x] Queue tests prove FIFO ordering, one in-flight request, and no cancellation on chapter switch.
- [x] IPC/preload types use book ID plus chapter identity and return truthful success/error states.
- [x] Reader tests prove chapter switching does not generate, section clicks seek without forcing playback, stale background results stay scoped, and title edit/restore/regeneration flows persist correctly.
- [x] `npm run typecheck`, `npm test`, `npm run lint`, and `npm run build` complete successfully.
- [x] `CONTEXT.md` documents the new outline data flow, files, cache version, and known migration behavior.
