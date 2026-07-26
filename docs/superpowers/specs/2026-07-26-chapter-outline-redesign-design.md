# Chapter Outline Redesign

Date: 2026-07-26

## Goal

Replace the conflicting outline implementations with one chapter-scoped outline module. The module analyzes only the currently selected reading chapter, stores results independently per chapter, and switches displayed results when the reader changes chapters.

## Confirmed Product Rules

- The chapter is the same chapter selected by the reader header and previous/next chapter controls.
- Source headings inside that chapter remain body structure and do not become separate reading chapters.
- Generating an outline is manual. Changing chapters never starts an AI request automatically.
- Each AI request receives only the selected chapter's sentences.
- Generated outlines persist across application restarts and are keyed by book, chapter, and chapter-content hash.
- Changing chapter content invalidates its outline. Renaming the chapter does not invalidate it.
- Chapters with 10 sentences or fewer do not call AI. They enter a completed `short_chapter` state with one navigable overview entry.
- For longer chapters, the requested minimum section count is:

  ```text
  minimumSections = min(12, max(2, ceil(sentenceCount / 40)))
  ```

- AI may return more than the minimum when the argument structure requires it, up to 16 sections.
- A valid one-section AI result is accepted as generated rather than discarded.
- Clicking a section updates the reading position and locates the containing content block. It does not start playback. Playing remains playing from the new position; paused remains paused.
- Chapter names and generated section titles are editable. Analysis text is not editable.
- Regeneration asks for confirmation and replaces manual section-title edits only after a new result succeeds.
- Chapter names and generated section titles can be restored to their original values.

## Architecture

### Canonical reading chapters

`BookData.chapters` remains the canonical chapter list used by the reader, TTS, AI context, and outline generation. Structured EPUB/Markdown input must be regrouped into reasonable reading chapters before persistence. Fine source headings remain `heading` blocks inside a reading chapter.

The accepted `BookData.structure` must have the same chapter partition as `BookData.chapters`. EPUB TOC fragments are merged by the existing chapter-size policy while retaining all blocks and their global sentence ranges. Oversized chapters are split only at block boundaries when possible.

### Chapter outline records

Each chapter has an independent persisted record:

```ts
interface ChapterOutlineRecord {
  bookId: string
  chapterKey: string
  chapterIndex: number
  contentHash: string
  status: 'queued' | 'generating' | 'generated' | 'short_chapter' | 'failed'
  minimumSections: number
  sections: ChapterOutlineSection[]
  generatedAt?: string
  error?: string
}

interface ChapterOutlineSection {
  id: string
  originalTitle: string
  customTitle?: string
  point?: string
  startOffset: number
}
```

`chapterKey` must be stable for the persisted reading chapter. The content hash is based only on chapter sentences, not its editable title.

Editable reading chapter titles store both `originalTitle` and `customTitle`. Existing consumers receive the display title through one helper so title rendering does not diverge between the reader header, outline panel, player, and history.

### Generation queue

Outline generation uses one process-wide FIFO queue. Only one model request runs at a time. Changing chapters does not cancel an accepted task. The task completes in the background and updates that chapter's cache without replacing the newly selected chapter's visible state.

The renderer requests generation by book ID and chapter identity, not by sending the entire mutable book object. The main process reloads and normalizes the persisted book, resolves the requested chapter, computes the content hash, and generates from that exact sentence range.

## Data Flow

```text
Select chapter
  -> resolve canonical ReadingChapter
  -> load ChapterOutlineRecord(bookId, chapterKey, contentHash)
     -> generated/short_chapter: render sections
     -> queued/generating: render progress
     -> failed: render error and retry
     -> missing: render "Generate chapter outline"

Generate
  -> short chapter: persist short_chapter record without model call
  -> otherwise enqueue one chapter request
  -> model returns structured sections
  -> validate offsets, ordering, title/point lengths, count bounds
  -> atomically persist successful result
  -> retain previous successful result if regeneration fails
```

## User Interface

One `ChapterOutlinePanel` replaces both the unused `ChapterOutline` and the mounted `SectionNav`.

The panel contains:

1. Current reading chapter title, edit button, and restore action when customized.
2. A chapter-specific status area.
3. Generated section rows showing title and one or two lines of analysis.
4. Per-section edit and restore actions.
5. Generate, retry, or regenerate command as appropriate.

The panel remembers its collapsed/expanded state. Changing chapters keeps the panel mounted and swaps only the chapter record. A chapter switch must never show the previous chapter's loading, error, or sections.

Section selection calls the reader's canonical seek operation. Content blocks expose both sentence-range start and end so the containing block is selected when a section starts in the middle of a paragraph.

## Editing Rules

- Edits are explicit and saved on Enter or blur; Escape cancels.
- Empty titles, control characters, and titles over 120 characters are rejected.
- Chapter title edits persist in book data without changing original source files.
- Section title edits persist alongside the generated record.
- Regeneration shows a confirmation when any section has a custom title.
- The previous successful outline remains visible while regenerating.
- A successful regeneration atomically replaces the old generated sections and their custom titles.
- A failed regeneration leaves the old outline intact and displays a non-destructive error state.

## Model Contract

The model receives:

- chapter display title;
- numbered sentences from the selected chapter only;
- required minimum and maximum section counts;
- strict JSON schema instructions.

For chunked chapters, sentence numbers remain chapter-relative. Each chunk prompt states its actual first and last offsets; it must not require every chunk's first section to start at zero. Merging validates and de-duplicates overlap boundaries before enforcing a chapter-level first offset of zero.

Provider errors remain failures. IPC must not return `success: true` or log "generation complete" when the outline contains an error. Rate-limit retries honor `Retry-After` when available and remain inside the single queue.

## Persistence And Migration

- Cache writes are atomic.
- Existing cache version 2 is invalidated because it cannot represent edit metadata or reliable status.
- Existing books retain their original chapter titles as defaults.
- On load, structurally over-fragmented EPUB/Markdown books are regrouped or marked for safe reprocessing without losing reading progress.
- Reading position is remapped by global sentence index after regrouping.
- Deleting a book deletes its outline records.

## Error Handling

- Missing or changed chapter: reject generation as stale.
- Invalid model JSON: show a retryable error and keep any previous outline.
- Invalid/out-of-range section offsets: reject the result rather than silently clamp it.
- Rate limit, timeout, network, and authentication errors remain distinguishable to the user.
- Switching books or chapters cannot attach a late result to the wrong visible chapter.

## Testing

### Parser and migration

- A realistic EPUB with hundreds of nested TOC anchors produces reasonable reading chapters while preserving heading blocks.
- Chapter and structure partitions remain aligned after regrouping.
- Existing progress maps to the same global sentence.

### Generator

- Short chapters never call the model.
- Proportional minimum section counts cover boundary values.
- One-section results are valid.
- Chunk offsets remain chapter-relative and merge correctly.
- Failed regeneration preserves the previous successful record.
- Queue order and rate-limit behavior are deterministic.

### Renderer

- Switching chapters swaps records without triggering generation.
- Clicking a section selects the containing block and updates reading position without forcing playback.
- Chapter and section title edit, cancel, validation, persistence, regeneration confirmation, and restore behaviors work.
- Background completion for another chapter does not replace the current panel.

### Integration

- IPC reports failure as failure and success only after validated persistence.
- Cache survives restart and invalidates on content changes.
- Reimported or reprocessed books cannot display stale outlines.

## Out Of Scope

- Whole-book outline generation.
- Automatic generation on chapter change or import.
- Editing AI analysis text.
- Reordering sections.
- Modifying original source files.
- A full hierarchical source-outline tree redesign.
