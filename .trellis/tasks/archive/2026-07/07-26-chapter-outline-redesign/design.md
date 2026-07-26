# Chapter Outline Redesign: Technical Design

The canonical design is [`docs/superpowers/specs/2026-07-26-chapter-outline-redesign-design.md`](../../../docs/superpowers/specs/2026-07-26-chapter-outline-redesign-design.md). This task artifact records the implementation boundaries and contracts used by the execution plan.

## Boundaries

- Parser normalization owns the reader chapter partition. `BookData.chapters` and `BookData.structure` must share the same global sentence ranges; source headings stay as blocks.
- `electron/services/ai/outline-generator.ts` owns prompt construction, short-chapter policy, structured-result validation, chunk offset merging, and generation semantics. It does not own renderer state.
- A new outline repository owns versioned per-book/per-chapter persistence with atomic writes. A process-wide FIFO queue owns concurrency and preserves accepted work after navigation.
- IPC accepts `{ bookId, chapterKey, chapterIndex }`, reloads the canonical book, computes the current content hash, and returns a truthful result only after validated persistence.
- A single `ChapterOutlinePanel` is mounted by `AiReaderView`; the old `ChapterOutline` and `SectionNav` implementations are removed or reduced to compatibility exports.

## Data contracts

```ts
type ChapterOutlineStatus = 'queued' | 'generating' | 'generated' | 'short_chapter' | 'failed'

interface ChapterOutlineSection {
  id: string
  originalTitle: string
  customTitle?: string
  point?: string
  startOffset: number
}

interface ChapterOutlineRecord {
  bookId: string
  chapterKey: string
  chapterIndex: number
  contentHash: string
  status: ChapterOutlineStatus
  minimumSections: number
  sections: ChapterOutlineSection[]
  generatedAt?: string
  error?: string
}
```

The chapter key is stable for the persisted chapter identity, while the content hash is derived only from its sentence text. Model offsets are chapter-relative, strictly increasing, begin at zero, and cover the chapter range without clamping. Valid result counts are one through 16.

## State and failure behavior

The renderer loads the record for the selected chapter and clears the previous chapter's visible status before displaying it. A generation task updates its cache entry by key; a late completion is ignored by the panel if its key no longer matches the selected chapter. Regeneration keeps the previous successful record visible until the replacement validates and persists atomically. Model, rate-limit, timeout, authentication, malformed JSON, stale-book, and persistence errors remain retryable failures and never become IPC success.

## Migration

Cache version 2 is unreadable by the new repository and is ignored. Existing books are normalized on load, preserving original chapter names and remapping the current sentence by global index. Deleting a book removes its outline cache file.
