# Chapter outline redesign implementation plan

This plan is executed in order. Every task follows red-green-refactor: add one focused failing test, run it, implement the smallest change, rerun the focused test and the relevant existing suite, then commit the task. The current worktree contains unrelated user changes; stage only files listed for the task.

## Task 1: Normalize canonical reading chapters

Files: `electron/services/parsers/epubParser.ts`, `electron/services/parsers/structureBuilder.ts`, `src/utils/bookData.ts`, `tests/epubParserStructure.test.ts`, `tests/structureBuilder.test.ts`, `tests/structureVersionMismatch.test.ts`.

1. Add a dense-TOC fixture test asserting that nested anchors merge into reader-sized chapters, heading blocks remain present, and `chapters`/`structure` ranges are identical.
2. Run `npm test -- tests/epubParserStructure.test.ts tests/structureBuilder.test.ts`; confirm the regression fails with hundreds of tiny chapters.
3. Implement regrouping at the parser/structure boundary using existing chapter-size policy, preserving block boundaries and global sentence ranges; normalize old persisted books and remap current sentence by global index.
4. Rerun the focused tests and `npm test -- tests/structureVersionMismatch.test.ts tests/bookData.test.ts`.

## Task 2: Establish shared outline contracts and generator rules

Files: `src/global.d.ts`, `electron/services/ai/outline-generator.ts`, `src/utils/contentHash.ts`, `tests/outlineGenerator.test.ts`.

1. Add tests for `minimumSections` boundary values, <=10 sentence short chapters without model calls, valid one-section results, strict offsets, max 16 sections, and chapter-relative chunk merging.
2. Run the focused test file and observe failures against the current <=5/one-placeholder policy and discarded one-section output.
3. Introduce shared types, change the short threshold to 10, calculate `min(12, max(2, ceil(count/40)))`, validate without clamping, and accept one section. Keep model input limited to the selected sentence range.
4. Run focused generator tests and existing `tests/llmCaller.test.ts`.

## Task 3: Add versioned outline repository and FIFO queue

Files: create `electron/services/ai/outline-repository.ts`, create `electron/services/ai/outline-queue.ts`, modify `electron/services/ai/outline-generator.ts`, `tests/outlineRepository.test.ts`, `tests/outlineQueue.test.ts`.

1. Add tests for atomic writes, cache-key/content-hash invalidation, v2 invalidation, regeneration preservation, FIFO ordering, one in-flight job, and accepted jobs surviving chapter changes.
2. Run the focused tests and confirm missing repository/queue behavior.
3. Implement repository read/write/delete using temp-file-plus-rename, and a process-wide queue with deterministic status callbacks. Regeneration writes only after a new record validates.
4. Run focused tests and the full AI service test set.

## Task 4: Correct IPC and preload contracts

Files: `electron/ipc/aiHandlers.ts`, `electron/preload.ts`, `src/global.d.ts`, `tests/ipcStreaming.test.ts`, create `tests/outlineIpc.test.ts`.

1. Add tests proving IPC receives book/chapter identity, reloads the current chapter, returns `success: false` for model/persistence errors, and never logs completion on failure.
2. Run focused tests and observe the current whole-book-object and false-success behavior.
3. Wire repository and queue into one handler, reject stale chapter identity/content, return the persisted record only after success, and expose typed edit/restore/regenerate operations.
4. Run focused IPC tests, `npm run typecheck`, and existing streaming tests.

## Task 5: Persist chapter and section title edits

Files: `src/utils/bookData.ts`, `src/stores/bookStore.ts`, `src/global.d.ts`, create `tests/chapterTitleEditing.test.ts`.

1. Add tests for title validation, Enter/blur save, Escape cancel, restore-original, stable content hash across renames, and persistence after reload.
2. Run the focused test and verify the edit API is absent or inconsistent.
3. Add original/custom title fields and store actions; make every consumer use one display-title helper. Persist section custom titles alongside outline records and clear them only after successful regeneration.
4. Run focused title tests and `tests/bookStore.test.ts`.

## Task 6: Replace both outline UIs with one chapter-scoped panel

Files: create `src/components/reader/ChapterOutlinePanel.tsx`, modify `src/components/reader/AiReaderView.tsx`, `src/components/reader/ContentCards.tsx`, remove or compatibility-wrap `src/components/reader/SectionNav.tsx` and `src/components/reader/ChapterOutline.tsx`, `tests/readerComponents.test.ts`.

1. Add renderer tests for chapter switch without generation, per-chapter status swap, manual generate/retry/regenerate, inline edits, read-only analysis, restore actions, and stale background completion.
2. Run the focused renderer tests and confirm the old panel is mounted and one-section results are not rendered.
3. Mount the unified panel, bind section clicks to the canonical seek operation and containing block selection, preserve play/pause state, and keep collapsed state per panel. Add accessible pencil/restore/confirm controls.
4. Run renderer tests, `npm run typecheck`, and the existing reader component suite.

## Task 7: Migration, docs, and full verification

Files: `CONTEXT.md`, `docs/superpowers/plans/2026-07-26-chapter-outline-redesign.md`, `tests/outlineIntegration.test.ts`.

1. Add integration tests for restart persistence, content invalidation, old-cache invalidation, book deletion cleanup, and a real dense-TOC chapter-stat fixture.
2. Run the integration test and confirm any missing migration/documentation behavior.
3. Update `CONTEXT.md` index/current-state/risk entries with exact files and cache version, and finalize the plan checklist.
4. Run `npm run typecheck`, `npm test`, `npm run lint`, and `npm run build`; record any pre-existing failures separately and fix task-owned failures before completion.

## Review and commit gates

- After each task, inspect `git diff --check` and stage only task files.
- Before the final commit, compare every requirement in `prd.md` and the design spec to code/tests, then run all four verification commands fresh.
- Commit message: `feat: redesign chapter-scoped outlines`.

## Execution log

- 2026-07-26: Tasks 1-7 implemented in the active worktree. Dense-TOC regrouping, chapter-scoped generation, version 3 repository, FIFO queue, identity-based IPC, unified panel, title editing, migration notes, and regression tests are present.
- 2026-07-26: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` completed successfully. The worktree had pre-existing unrelated changes, so no broad cleanup or reset was performed.
- 2026-07-26: Added canonical IPC input reload and stale chapter-key/content rejection; added `tests/outlineIpc.test.ts` to the main test chain. Fresh full verification and Electron dev startup completed successfully.
