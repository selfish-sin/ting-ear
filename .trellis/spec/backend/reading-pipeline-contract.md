# Reading Pipeline Contract

## Scenario: Persisted document to player activation

### 1. Scope / Trigger

Use this contract whenever code changes file parsing, `BookData` persistence, text-clean edit records, bookshelf/player navigation, bookmarks/history jumps, or player version switching. These paths share sentence, chapter, range, and index invariants.

### 2. Signatures

```typescript
normalizeBookData(value: unknown): BookData | null
normalizeBookCollection(value: unknown): BookData[]
normalizeSentences(value: unknown): string[]
normalizeChapters(value: unknown, sentenceCount: number): Chapter[]
normalizeSentenceRange(range, sentenceCount): { start: number; end: number } | null
clampSentenceIndex(index, sentenceCount, range?): number
MIN_READABLE_SENTENCE_LENGTH = 20
splitReadableSentences(text: string): string[]

saveProgress(data: BookData[]): Promise<{ success: boolean; error?: string }>
```

The renderer must enter the player through the App-owned activation transition. Components such as the shelf, bookmarks, history, cleaner, and player version selector pass the target book/index/range/version upward instead of writing player stores independently.

### 3. Contracts

- `BookData.sentences`: trimmed strings containing at least one Unicode letter or number; never empty/control-only/punctuation-only fragments.
- `BookData.chapters`: contiguous, ordered, non-empty partitions of `[0, sentences.length)` with finite non-negative indices.
- `sentenceRange`: half-open `[start, end)`; a full-book range normalizes to `null`.
- `currentSentenceIndex`: always clamped to the active range; `currentChapterIndex` is derived from that sentence.
- `currentVersionId === null`: active text is the persisted base version and its time map may be saved.
- `currentVersionId !== null`: active text is transient original/edit-history content; progress may be clamped into the base book, but transient sentences/time maps must not replace base content.
- User title edits update `BookData.title`; `originalTitle` retains parser metadata. Reimport/reprocess preserves the current user-visible title.
- Raw text becomes reading units in two passes: detect natural boundaries first, then join whole following fragments while the current unit contains fewer than 20 Unicode letters/numbers. Punctuation and whitespace do not count toward the threshold; units at or above 20 are never extended.
- Natural segmentation must preserve punctuation and closing quotes, keep decimal/version points and common English abbreviations intact, and support Chinese/English full stops, questions, exclamations, semicolons, line boundaries, and ellipses in the same input.
- Do not regroup persisted `sentences` arrays during defensive load normalization. Regrouping changes indices; existing books adopt new segmentation through reprocess, where chapter/progress remapping already has an owner.

### 4. Validation & Error Matrix

| Condition                                             | Required result                                              |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| Parser returns zero readable sentences                | `{ success: false, error }`; do not replace an existing book |
| Persisted book has invalid sentences/chapters/indices | Repair on load; skip only a book with no valid id/content    |
| Save payload contains an invalid book or duplicate id | Reject the whole save; do not partially write                |
| Clean/edit record normalizes to zero sentences        | Show a warning; do not create the record                     |
| Clean/title save fails                                | Roll back optimistic store state and show an error           |
| Requested bookmark/history index is out of bounds     | Clamp to the active book/range and derive its chapter        |
| User title is blank or longer than 120 characters     | Reject without changing stored data                          |
| A natural fragment has fewer than 20 readable chars   | Append whole following fragments until `>= 20` or input ends |
| A natural fragment has exactly/more than 20 chars     | Emit it without consuming the next fragment                  |
| Mixed punctuation contains `1.2.3`, `Dr.`, or quotes  | Keep protected tokens/closers intact while preserving marks  |

### 5. Good/Base/Bad Cases

- Good: switching from a 10,000-sentence base book to a 20-sentence edit record resets range, sentence, chapter, page, playback, and time map atomically.
- Base: a valid full-book selection stores `sentenceRange = null` and uses normal pagination.
- Bad: setting a range before `setCurrentBook()` loses the range because `setCurrentBook()` intentionally clears cross-book state.
- Bad: calling `setSentences(record.sentences)` without updating the active book/chapters leaves player bounds based on another version.
- Good: an 8-character sentence followed by a 12-character sentence becomes one reading unit; the next 20-character sentence remains separate.
- Base: the final fragment may remain shorter than 20 when no following fragment exists.
- Bad: applying a single regex that splits every ASCII period breaks decimals, versions, and abbreviations before the threshold rule can operate.

### 6. Tests Required

- Unit: control/punctuation fragments are removed and legacy indices are clamped.
- Unit: malformed chapter starts become one contiguous in-bounds partition.
- Unit: full range becomes `null`; partial ranges preserve half-open bounds.
- Parser compatibility: UTF-8 TXT/Markdown, HTML script/style/entity behavior, minimal EPUB/DOCX, and actionable malformed PDF failure.
- Cross-layer regression: sequential book activation, edit/original version activation, bookmark/history jumps, save failure rollback, and renamed-title preservation.
- Segmentation: exact/over/under threshold behavior, punctuation-only filtering, decimals, common English abbreviations after a long prefix, closing quotes, semicolons, Chinese/ASCII ellipses, and English text joined across a line break.

### 7. Wrong vs Correct

#### Wrong

```typescript
setSentenceRange(range)
setCurrentBook(book) // clears the range
setCurrentSentenceIndex(book.currentSentenceIndex) // may be outside selected version
setCurrentView('player')
```

#### Correct

```typescript
const normalized = normalizeBookData(book)
const normalizedRange = normalizeSentenceRange(range, normalized.sentences.length)
const sentenceIndex = clampSentenceIndex(index, normalized.sentences.length, normalizedRange)
setCurrentBook(normalized)
setSentenceRange(normalizedRange)
setCurrentSentenceIndex(sentenceIndex)
setCurrentChapterIndex(findChapterIndex(normalized.chapters, sentenceIndex))
setCurrentView('player')
```

The real implementation must also stop old playback, reset page/time-map state, and mark whether the active version is transient.

#### Wrong: threshold logic mixed into punctuation matching

```typescript
text.split(/[。！？.!?；;]/).map((part) => part.slice(0, 20))
```

#### Correct: segment first, then forward-fill whole fragments

```typescript
const fragments = naturalSentenceFragments(text)
for (const fragment of fragments) {
  current = appendSentenceFragment(current, fragment)
  if (readableCharacterCount(current) >= MIN_READABLE_SENTENCE_LENGTH) flush()
}
```
