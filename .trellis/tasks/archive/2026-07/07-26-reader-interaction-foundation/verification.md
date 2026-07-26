# Verification

## Scope

- Shared accessible context menu for bookshelf and AI reader.
- Visible bookshelf overflow controls and grouped existing commands.
- Reader block/selection actions, chapter-title de-duplication, and continuous reading typography.
- Global keyboard focus and reduced-motion behavior.
- Narrow `AiReaderView` store subscriptions and strict AI-history corruption validation.
- Restored spoiler-free source filtering and configured spoiler prompt propagation found by the full-suite gate.

## Manual checks

- Electron bookshelf menu stayed inside the viewport near the bottom edge and exposed every command group.
- Grid/list overflow controls and the destructive action treatment were visually checked.
- AI reader displayed a missing chapter title once, rendered normal paragraphs continuously, and showed all five reader context actions.
- Escape dismissed the reader menu.

## Automated checks

Fresh final results:

- `npm run typecheck`: passed.
- `npm run lint`: passed with no warnings.
- `npm test`: passed, including context-menu, reader, AI history, spoiler-filter, and RAG coverage.
- `npm run build`: passed for main, preload, and renderer bundles.
- `git diff --check`: passed for the tracked and newly created files in this task.

Commands:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```
