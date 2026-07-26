# Chapter Outline Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Replace the fragmented outline flow with one chapter-scoped, cached, editable outline panel that analyzes only the selected reader chapter.

**Architecture:** Normalize parser output into canonical reader chapters, then resolve one chapter by stable key and sentence-content hash. A versioned repository and process-wide FIFO queue own persistence and concurrency; IPC exposes identity-based operations; `AiReaderView` mounts one panel that swaps records on chapter changes.

**Tech Stack:** TypeScript, Electron IPC/preload, React, Zustand, Vitest-style existing test scripts, Node filesystem APIs.

## Global Constraints

- Short chapters are `<= 10` sentences and never call AI.
- Normal chapters request `min(12, max(2, ceil(sentenceCount / 40)))` sections and accept at most 16.
- Model offsets are chapter-relative and invalid offsets are rejected, never clamped.
- Cache key is book + stable chapter key + sentence-content hash; chapter renames do not change the hash.
- One FIFO queue permits one in-flight outline generation process-wide.
- Preserve unrelated user worktree changes and stage only files for this feature.

---

### Task 1: Normalize canonical reading chapters

**Files:**
- Modify: `electron/services/parsers/epubParser.ts`
- Modify: `electron/services/parsers/structureBuilder.ts`
- Modify: `src/utils/bookData.ts`
- Test: `tests/epubParserStructure.test.ts`, `tests/structureBuilder.test.ts`, `tests/structureVersionMismatch.test.ts`

- [ ] Write a dense-TOC regression test with aligned chapter/structure ranges.
- [ ] Run `npm test -- tests/epubParserStructure.test.ts tests/structureBuilder.test.ts`; expect the current tiny-chapter failure.
- [ ] Implement regrouping at the parser/structure boundary while retaining heading blocks and global ranges.
- [ ] Run focused parser tests and `npm test -- tests/structureVersionMismatch.test.ts tests/bookData.test.ts`.
- [ ] Inspect diff and commit only parser/test files.

### Task 2: Shared outline contracts and generator rules

**Files:**
- Modify: `src/global.d.ts`, `electron/services/ai/outline-generator.ts`, `src/utils/contentHash.ts`
- Test: `tests/outlineGenerator.test.ts`

- [ ] Add failing tests for short threshold, proportional minimum, one-section success, chunk offsets, and strict count/range validation.
- [ ] Run the focused test and verify it fails for the current implementation.
- [ ] Implement shared records, prompt inputs, validation, and chapter-relative merge behavior.
- [ ] Run focused generator tests and `tests/llmCaller.test.ts`.
- [ ] Commit generator contracts and tests.

### Task 3: Repository and FIFO queue

**Files:**
- Create: `electron/services/ai/outline-repository.ts`, `electron/services/ai/outline-queue.ts`
- Modify: `electron/services/ai/outline-generator.ts`
- Test: `tests/outlineRepository.test.ts`, `tests/outlineQueue.test.ts`

- [ ] Add failing atomic-cache, version-invalidation, regeneration-preservation, FIFO, and single-flight tests.
- [ ] Run focused tests and verify missing behavior.
- [ ] Implement repository and process-wide queue.
- [ ] Run focused tests plus the AI service test set.
- [ ] Commit repository/queue changes.

### Task 4: IPC and preload

**Files:**
- Modify: `electron/ipc/aiHandlers.ts`, `electron/preload.ts`, `src/global.d.ts`
- Test: `tests/outlineIpc.test.ts`, `tests/ipcStreaming.test.ts`

- [ ] Add failing tests for identity-based requests and truthful errors.
- [ ] Implement stale checks, queue integration, and edit/restore/regenerate IPC methods.
- [ ] Run focused IPC tests and `npm run typecheck`.
- [ ] Commit IPC contract changes.

### Task 5: Title edit persistence

**Files:**
- Modify: `src/utils/bookData.ts`, `src/stores/bookStore.ts`, `src/global.d.ts`
- Test: `tests/chapterTitleEditing.test.ts`

- [ ] Add failing validation/save/cancel/restore/hash-stability tests.
- [ ] Implement original/custom title fields and unified display-title helper.
- [ ] Persist section custom titles and clear only after successful regeneration.
- [ ] Run focused title tests and `tests/bookStore.test.ts`.
- [ ] Commit title persistence changes.

### Task 6: Unified reader panel

**Files:**
- Create: `src/components/reader/ChapterOutlinePanel.tsx`
- Modify: `src/components/reader/AiReaderView.tsx`, `src/components/reader/ContentCards.tsx`
- Remove/compatibility-wrap: `src/components/reader/SectionNav.tsx`, `src/components/reader/ChapterOutline.tsx`
- Test: `tests/readerComponents.test.ts`

- [ ] Add failing tests for chapter swap, manual generation, one-section rendering, edits, stale completion, and seek/playback behavior.
- [ ] Implement and mount the unified panel with accessible pencil/restore/confirm controls.
- [ ] Run reader tests and `npm run typecheck`.
- [ ] Commit renderer changes.

### Task 7: Migration, docs, and verification

**Files:**
- Modify: `CONTEXT.md`
- Modify: `docs/superpowers/plans/2026-07-26-chapter-outline-redesign.md`
- Test: `tests/outlineIntegration.test.ts`

- [ ] Add restart, invalidation, old-cache, deletion, and dense-TOC integration tests.
- [ ] Update `CONTEXT.md` with exact files, cache version, data flow, and risks.
- [ ] Run `npm run typecheck`, `npm test`, `npm run lint`, and `npm run build`.
- [ ] Run `git diff --check`, stage only task files, and commit `feat: redesign chapter-scoped outlines`.
