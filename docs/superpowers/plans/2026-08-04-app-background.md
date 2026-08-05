# App Background Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-app background image layer with built-in presets + user upload, a semi-transparent overlay adapting to theme, and settings UI to control it.

**Architecture:** A root-level `AppBackground` component renders the image + overlay behind everything. `AppSettings` gains a `background` field. New main-process IPC handlers manage preset listing, upload-copy, data-URL resolution, and removal. Large empty containers become `bg-transparent`; cards/panels keep their backgrounds.

**Tech Stack:** Electron + React + TypeScript + Zustand + Tailwind. Tests are standalone `.test.ts` files run via `node scripts/run-tests.mjs` (tsx-based, custom `assert` helper, no vitest).

## Global Constraints

- Preset images live in `resources/backgrounds/`, bundled via `electron-builder.yml` `extraResources` → `to: backgrounds`.
- Dev resource path: `app.isPackaged ? join(process.resourcesPath, 'backgrounds', file) : join(__dirname, '../../resources/backgrounds', file)`. `__dirname` in compiled main is `out/main`, so `../../resources` reaches repo-root `resources/`.
- Uploaded images copy into `{dataDir}/backgrounds/` (use `getDataDir()` from `electron/ipc/fileHandlers.ts`); store only the relative path `backgrounds/<name>` in settings.
- Image data reaches the renderer as a `data:image/<ext>;base64,...` URL (mirrors `cover:getDataUrl`) — never a raw file path — so `<img src>` works in dev and packaged.
- Default `background.enabled = false`; existing users see no change until they opt in.
- Tests use the project's existing pattern: a single `.test.ts` file in `tests/` with a local `assert(label, fn)` helper, run by `node scripts/run-tests.mjs`. No vitest/jest.
- Match surrounding code style: Chinese comments where the file uses them, 2-space indent, single quotes.

---

## File Structure

**New files:**
- `resources/backgrounds/*.jpg` — 6 preset images (compressed ~200-400KB each, 1920 wide).
- `src/backgroundPresets.ts` — preset metadata (`PRESET_BACKGROUNDS` array + types).
- `src/components/AppBackground.tsx` — root background layer component.
- `tests/backgroundPresets.test.ts` — preset metadata tests.
- `tests/backgroundSettings.test.ts` — settings store merge + `setBackground` tests.
- `tests/backgroundResolve.test.ts` — main-process resolve/add IPC tests.

**Modified files:**
- `src/global.d.ts` — add `BackgroundSettings` type, `AppSettings.background`, four `Api` methods.
- `src/stores/settingsStore.ts` — default `background`, `setBackground` action, `loadSettings` merge.
- `electron/preload.ts` — expose `backgroundList/backgroundAdd/backgroundResolve/backgroundRemove`.
- `electron/ipc/fileHandlers.ts` — `getBackgroundsDir`, `background:list/add/resolve/remove` handlers.
- `electron-builder.yml` — `extraResources` backgrounds entry.
- `src/components/settings/GeneralSettingsPanel.tsx` — "背景" subsection.
- `src/App.tsx` — mount `AppBackground`, transparentize main content wrapper.
- `src/components/PlayerView.tsx` — transparentize root container.
- `src/components/SideNav.tsx`, `src/components/BookShelf.tsx` — transparentize area containers (judged per the principle).

---

### Task 1: Preset metadata module

**Files:**
- Create: `src/backgroundPresets.ts`
- Test: `tests/backgroundPresets.test.ts`

**Interfaces:**
- Produces: `PresetBg` interface, `PRESET_BACKGROUNDS: PresetBg[]` exported from `src/backgroundPresets.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/backgroundPresets.test.ts`:

```ts
import { PRESET_BACKGROUNDS, type PresetBg } from '../src/backgroundPresets'

let passed = 0
let failed = 0

function assert(label: string, fn: () => boolean): void {
  try {
    if (fn()) {
      passed++
      console.log(`  ok ${label}`)
    } else {
      failed++
      console.log(`  fail ${label}`)
    }
  } catch (error) {
    failed++
    console.log(`  fail ${label} - ${(error as Error).message}`)
  }
}

assert('PRESET_BACKGROUNDS 非空', () => PRESET_BACKGROUNDS.length >= 6)

assert('每项有 id/name/file', () =>
  PRESET_BACKGROUNDS.every(
    (p: PresetBg) => typeof p.id === 'string' && p.id.length > 0 && typeof p.name === 'string' && typeof p.file === 'string' && p.file.endsWith('.jpg')
  )
)

assert('id 唯一', () => new Set(PRESET_BACKGROUNDS.map((p) => p.id)).size === PRESET_BACKGROUNDS.length)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx tests/backgroundPresets.test.ts`
Expected: FAIL — module `../src/backgroundPresets` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/backgroundPresets.ts`:

```ts
/** 内置背景图预设元数据。图片文件在 resources/backgrounds/，打包到 resourcesPath/backgrounds/。 */
export interface PresetBg {
  id: string
  name: string
  /** 文件名，对应 resources/backgrounds/ 下的图片 */
  file: string
}

export const PRESET_BACKGROUNDS: PresetBg[] = [
  { id: 'aurora', name: '极光', file: 'aurora.jpg' },
  { id: 'dusk', name: '黄昏', file: 'dusk.jpg' },
  { id: 'forest', name: '深林', file: 'forest.jpg' },
  { id: 'ocean', name: '远海', file: 'ocean.jpg' },
  { id: 'mountain', name: '山峦', file: 'mountain.jpg' },
  { id: 'nebula', name: '星云', file: 'nebula.jpg' }
]
```

Note: the actual JPG files are added in Task 8 (bundling). This task only defines metadata; the resolve handler (Task 4) returns null for missing files, so tests don't need the binaries.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx tests/backgroundPresets.test.ts`
Expected: `3 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add src/backgroundPresets.ts tests/backgroundPresets.test.ts
git commit -m "feat(background): 内置背景预设元数据模块"
```

---

### Task 2: BackgroundSettings type + settings store

**Files:**
- Modify: `src/global.d.ts` (add `BackgroundSettings` after `FloatingBallSettings`, add `background?` to `AppSettings`)
- Modify: `src/stores/settingsStore.ts` (default, `setBackground`, `loadSettings` merge)
- Test: `tests/backgroundSettings.test.ts`

**Interfaces:**
- Produces: `BackgroundSettings` type exported from `src/global.d.ts`; `setBackground(partial: Partial<BackgroundSettings>)` and `defaultSettings.background` on `useSettingsStore`.

- [ ] **Step 1: Write the failing test**

Create `tests/backgroundSettings.test.ts`:

```ts
import { defaultSettings, useSettingsStore } from '../src/stores/settingsStore'
import type { BackgroundSettings } from '../src/global'

let passed = 0
let failed = 0

function assert(label: string, fn: () => boolean): void {
  try {
    if (fn()) {
      passed++
      console.log(`  ok ${label}`)
    } else {
      failed++
      console.log(`  fail ${label}`)
    }
  } catch (error) {
    failed++
    console.log(`  fail ${label} - ${(error as Error).message}`)
  }
}

const expectedDefault: BackgroundSettings = {
  enabled: false,
  source: 'preset',
  presetId: null,
  customPath: null,
  fit: 'cover',
  blur: 0,
  overlayColor: 'auto',
  overlayOpacity: 0.7
}

assert('defaultSettings.background 字段完整且默认关闭', () => {
  const bg = defaultSettings.background as BackgroundSettings | undefined
  if (!bg) return false
  return (Object.keys(expectedDefault) as Array<keyof BackgroundSettings>).every(
    (k) => bg[k] === expectedDefault[k]
  )
})

assert('setBackground 局部更新并保留其它字段', () => {
  const store = useSettingsStore.getState()
  // 重置到默认，避免被前序 case 污染
  useSettingsStore.setState({ settings: { ...defaultSettings } })
  store.setBackground({ enabled: true, overlayOpacity: 0.5 })
  const bg = useSettingsStore.getState().settings.background as BackgroundSettings
  return bg.enabled === true && bg.overlayOpacity === 0.5 && bg.fit === 'cover' && bg.blur === 0
})

assert('setBackground 未提供的字段保持不变', () => {
  useSettingsStore.setState({ settings: { ...defaultSettings } })
  useSettingsStore.getState().setBackground({ blur: 8 })
  const bg = useSettingsStore.getState().settings.background as BackgroundSettings
  return bg.blur === 8 && bg.enabled === false && bg.overlayOpacity === 0.7
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx tests/backgroundSettings.test.ts`
Expected: FAIL — `defaultSettings.background` is `undefined`, `setBackground` is not a function.

- [ ] **Step 3: Add the type to `src/global.d.ts`**

In `src/global.d.ts`, immediately after the `FloatingBallSettings` interface (which ends around line 1060 with `mode: 'ball' | 'hover' | 'mini'` + closing `}`), add:

```ts
export interface BackgroundSettings {
  /** 是否启用背景图（关则纯色，回到现在） */
  enabled: boolean
  /** 用内置预设还是用户上传 */
  source: 'preset' | 'custom'
  /** 预设 id（如 'aurora'）；source=preset 时生效 */
  presetId: string | null
  /** 自定义图在数据目录下的相对路径（如 'backgrounds/xxx.jpg'）；source=custom 时生效 */
  customPath: string | null
  /** 填充模式：cover 填满裁切 / contain 完整留白 / stretch 拉伸 */
  fit: 'cover' | 'contain' | 'stretch'
  /** 背景图高斯模糊 px，0–20，默认 0 */
  blur: number
  /** 'auto' = 按主题自动（浅色白 / 深色黑）；否则为 hex 色如 '#1a1a2e' */
  overlayColor: 'auto' | string
  /** 遮罩透明度 0–1，默认 0.7 */
  overlayOpacity: number
}
```

Then in the `AppSettings` interface (around line 1062), add a new field after `ai?: AiSettings`:

```ts
  /** AI 阅读助手配置 */
  ai?: AiSettings
  /** 应用背景图配置 */
  background?: BackgroundSettings
```

- [ ] **Step 4: Update `src/stores/settingsStore.ts` default + action**

In `src/stores/settingsStore.ts`:

4a. Add the import of `BackgroundSettings` to the existing type import line (line 4):

```ts
import type { AppSettings, FloatingBallSettings, ShortcutMap, BackgroundSettings } from '../global'
```

4b. Define the default background object. Add right after the `defaultFloatingBall` const (before `interface SettingsState`):

```ts
const defaultBackground: BackgroundSettings = {
  enabled: false,
  source: 'preset',
  presetId: null,
  customPath: null,
  fit: 'cover',
  blur: 0,
  overlayColor: 'auto',
  overlayOpacity: 0.7
}
```

4c. Add `background: defaultBackground,` to `defaultSettings` (after the `ai: mergeAiSettings()` line):

```ts
  ai: mergeAiSettings(),
  background: defaultBackground
}
```

4d. Add `setBackground` to the `SettingsState` interface (after `setShortcuts`):

```ts
  setShortcuts: (shortcuts: ShortcutMap) => void
  setBackground: (partial: Partial<BackgroundSettings>) => void
  loadSettings: () => Promise<void>
```

4e. Add the `setBackground` action implementation in the store body (after `setShortcuts` impl, before `loadSettings`):

```ts
  setBackground: (partial) => {
    set((s) => ({
      settings: {
        ...s.settings,
        background: { ...(s.settings.background ?? defaultBackground), ...partial }
      }
    }))
    get().saveSettings()
  },
```

4f. In `loadSettings`, merge the loaded background over the default so old configs missing keys are backfilled. Find the `set({ settings: { ...defaultSettings, ...loadedSettings, ... } })` block and add a `background` merge. After the `ai: mergeAiSettings(loadedSettings.ai)` line inside that `set` call, add:

```ts
            ai: mergeAiSettings(loadedSettings.ai),
            background: { ...defaultBackground, ...(loadedSettings.background || {}) }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx tests/backgroundSettings.test.ts`
Expected: `3 passed, 0 failed`

- [ ] **Step 6: Run full test suite to confirm no regression**

Run: `npm test`
Expected: all test files pass (including pre-existing ones).

- [ ] **Step 7: Commit**

```bash
git add src/global.d.ts src/stores/settingsStore.ts tests/backgroundSettings.test.ts
git commit -m "feat(background): BackgroundSettings 类型与 store action"
```

---

### Task 3: Preload + Api type exposure

**Files:**
- Modify: `src/global.d.ts` (add four methods to the `Api` interface)
- Modify: `electron/preload.ts` (add four methods to the `api` object)

**Interfaces:**
- Produces: `window.api.backgroundList()`, `window.api.backgroundAdd()`, `window.api.backgroundResolve(source, key)`, `window.api.backgroundRemove(customPath)` available to the renderer (wired to IPC channels `background:list/add/resolve/remove` implemented in Task 4).

- [ ] **Step 1: Add to the `Api` interface in `src/global.d.ts`**

Find the `dataDirMigrate` entry inside `export interface Api { ... }` (around line 438-439) and add after it, before the closing `}` of the interface:

```ts
  /** 迁移数据到新目录 */
  dataDirMigrate: (newDir: string) =>
    ipcRenderer.invoke('dataDir:migrate', newDir) as Promise<{ success: boolean; migrated?: boolean; oldPath?: string; newPath?: string; error?: string; message?: string }>
  // === 背景图 ===
  /** 列出内置预设（id+name），文件名不暴露给渲染进程 */
  backgroundList: () => ipcRenderer.invoke('background:list') as Promise<Array<{ id: string; name: string }>>
  /** 上传自定义背景图：弹文件选择框，复制到数据目录，返回相对路径 */
  backgroundAdd: () => ipcRenderer.invoke('background:add') as Promise<{ success: boolean; customPath?: string; error?: string }>
  /** 解析图源为 data URL；文件缺失返回 null */
  backgroundResolve: (source: 'preset' | 'custom', key: string | null) =>
    ipcRenderer.invoke('background:resolve', source, key) as Promise<string | null>
  /** 删除自定义背景图文件 */
  backgroundRemove: (customPath: string) => ipcRenderer.invoke('background:remove', customPath) as Promise<{ success: boolean; error?: string }>
```

- [ ] **Step 2: Add to the `api` object in `electron/preload.ts`**

In `electron/preload.ts`, find the `dataDirMigrate` entry (around line 438-439) and add after it, before the closing `}` of the `api` object:

```ts
  dataDirMigrate: (newDir: string) =>
    ipcRenderer.invoke('dataDir:migrate', newDir) as Promise<{ success: boolean; migrated?: boolean; oldPath?: string; newPath?: string; error?: string; message?: string }>,

  // === 背景图 ===
  backgroundList: () => ipcRenderer.invoke('background:list'),
  backgroundAdd: () => ipcRenderer.invoke('background:add'),
  backgroundResolve: (source: 'preset' | 'custom', key: string | null) =>
    ipcRenderer.invoke('background:resolve', source, key),
  backgroundRemove: (customPath: string) => ipcRenderer.invoke('background:remove', customPath)
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/global.d.ts electron/preload.ts
git commit -m "feat(background): preload 暴露背景图 IPC 接口"
```

---

### Task 4: Main-process background IPC handlers

**Files:**
- Modify: `electron/ipc/fileHandlers.ts` (add `getBackgroundsDir` + four handlers near the cover handlers)
- Test: `tests/backgroundResolve.test.ts`

**Interfaces:**
- Consumes: `PRESET_BACKGROUNDS` from `src/backgroundPresets.ts`, `getDataDir()` from `fileHandlers.ts` itself, `app.isPackaged` from electron.
- Produces: IPC channels `background:list`, `background:add`, `background:resolve`, `background:remove` registered via `ipcMain.handle`.

- [ ] **Step 1: Write the failing test**

Create `tests/backgroundResolve.test.ts`. This test exercises the pure helpers (`getBackgroundsDir` path logic, resolve returning null for missing files) by importing the handler module's exported helpers. Since the handlers are registered as side-effects, we test the exported `getBackgroundsDir` and a `resolveBackgroundDataUrl` pure function we extract in Step 3.

```ts
import { resolveBackgroundDataUrl, getBackgroundsDir } from '../electron/ipc/fileHandlers'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let passed = 0
let failed = 0

function assert(label: string, fn: () => boolean): void {
  try {
    if (fn()) {
      passed++
      console.log(`  ok ${label}`)
    } else {
      failed++
      console.log(`  fail ${label}`)
    }
  } catch (error) {
    failed++
      console.log(`  fail ${label} - ${(error as Error).message}`)
  }
}

assert('resolveBackgroundDataUrl 不存在的预设返回 null', async () => {
  const r = await resolveBackgroundDataUrl('preset', 'definitely-not-exist')
  return r === null
})

assert('resolveBackgroundDataUrl 不存在的自定义路径返回 null', async () => {
  const r = await resolveBackgroundDataUrl('custom', 'backgrounds/nope.jpg')
  return r === null
})

assert('resolveBackgroundDataUrl 自定义图返回 data URL', async () => {
  // 造一个临时文件当作自定义背景图
  const tmpBgDir = mkdtempSync(join(tmpdir(), 'tingear-bg-'))
  const relPath = 'backgrounds/test.jpg'
  const abs = join(tmpBgDir, relPath)
  // 模拟目录结构
  const { mkdirSync } = await import('fs')
  mkdirSync(join(tmpBgDir, 'backgrounds'), { recursive: true })
  writeFileSync(abs, Buffer.from([0xff, 0xd8, 0xff, 0xe0])) // fake jpg header
  // 临时替换 getDataDir —— 通过环境变量约定
  process.env.TINGEAR_BG_TEST_DATADIR = tmpBgDir
  const r = await resolveBackgroundDataUrl('custom', relPath)
  const ok = r !== null && r.startsWith('data:image/jpeg;base64,')
  rmSync(tmpBgDir, { recursive: true, force: true })
  delete process.env.TINGEAR_BG_TEST_DATADIR
  return ok
})

assert('getBackgroundsDir 路径以 backgrounds 结尾', () => {
  const d = getBackgroundsDir()
  return d.endsWith('backgrounds') && existsSync(d)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx tests/backgroundResolve.test.ts`
Expected: FAIL — `resolveBackgroundDataUrl` / `getBackgroundsDir` not exported.

- [ ] **Step 3: Implement the handlers in `electron/ipc/fileHandlers.ts`**

3a. Add import of `PRESET_BACKGROUNDS` near the top imports. Find the existing import block and add (the file already imports from `../../src/global`, so a sibling import from `../../src/backgroundPresets` works):

```ts
import { PRESET_BACKGROUNDS } from '../../src/backgroundPresets'
```

3b. Add a `getBackgroundsDir` helper. Find `function getCoversDir()` (around line 1012) and add right after it:

```ts
  function getBackgroundsDir(): string {
    const dir = join(getDataDir(), 'backgrounds')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    return dir
  }
```

3c. Add a preset resource-path resolver (dev vs packaged). Add near `getBackgroundsDir`:

```ts
  /** 预设图打包路径：dev 下走 resources/，打包后走 process.resourcesPath */
  function resolvePresetFilePath(file: string): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'backgrounds', file)
      : join(__dirname, '../../resources/backgrounds', file)
  }
```

3d. Add the exported pure resolve function (testable without IPC). Add as a top-level export near the bottom of the file (outside `registerFileHandlers`, after the existing `flushLibraryProgressOnQuit` export pattern). Note it must respect `getDataDir()`, so we reference it via the module-level `getDataDir` which is already exported:

```ts
/** 把背景图源解析为 data URL；文件缺失返回 null。纯函数，供 IPC 与测试复用。 */
export async function resolveBackgroundDataUrl(
  source: 'preset' | 'custom',
  key: string | null
): Promise<string | null> {
  try {
    let absPath: string | null = null
    if (source === 'preset') {
      const preset = PRESET_BACKGROUNDS.find((p) => p.id === key)
      if (!preset) return null
      absPath = app.isPackaged
        ? join(process.resourcesPath, 'backgrounds', preset.file)
        : join(__dirname, '../../resources/backgrounds', preset.file)
    } else {
      if (!key) return null
      // 测试钩子：允许临时指定数据目录
      const base = process.env.TINGEAR_BG_TEST_DATADIR || getDataDir()
      absPath = join(base, key)
    }
    if (!existsSync(absPath)) return null
    const buf = readFileSync(absPath)
    const ext = absPath.toLowerCase().endsWith('.png')
      ? 'png'
      : absPath.toLowerCase().endsWith('.webp')
        ? 'webp'
        : 'jpeg'
    return `data:image/${ext};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/** 数据目录下的 backgrounds/ 绝对路径（已确保存在）。导出供测试。 */
export function getBackgroundsDirPath(): string {
  return join(getDataDir(), 'backgrounds')
}
```

Note: `getCoversDir` is scoped inside `registerFileHandlers`, but `getDataDir` is module-level exported, so `getBackgroundsDirPath` + `resolveBackgroundDataUrl` can live at module level. The test imports `getBackgroundsDir` — to match, re-export it: add `export { getBackgroundsDirPath as getBackgroundsDir }` is NOT needed; instead the test imports `getBackgroundsDir` — update the test import to `getBackgroundsDirPath`. **Fix the test:** change `getBackgroundsDir` references to `getBackgroundsDirPath` in `tests/backgroundResolve.test.ts`.

3e. Register the four IPC handlers inside `registerFileHandlers`. Find the `cover:getDataUrl` handler (around line 1068-1078) and add after it:

```ts
  // === 背景图 ===
  ipcMain.handle('background:list', async () => {
    return PRESET_BACKGROUNDS.map((p) => ({ id: p.id, name: p.name }))
  })

  ipcMain.handle('background:add', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return { success: false, error: '无活动窗口' }
      const result = await dialog.showOpenDialog(win, {
        title: '选择背景图片',
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '取消选择' }
      }
      const srcPath = result.filePaths[0]
      const ext = srcPath.toLowerCase().split('.').pop() || 'jpg'
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const dest = join(getBackgroundsDir(), name)
      copyFileSync(srcPath, dest)
      return { success: true, customPath: `backgrounds/${name}` }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('background:resolve', async (_event, source: 'preset' | 'custom', key: string | null) => {
    return resolveBackgroundDataUrl(source, key)
  })

  ipcMain.handle('background:remove', async (_event, customPath: string) => {
    try {
      const abs = join(getDataDir(), customPath)
      if (existsSync(abs)) unlinkSync(abs)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
```

`copyFileSync` and `unlinkSync` are already imported at the top of the file (line 2).

- [ ] **Step 4: Fix the test import name**

In `tests/backgroundResolve.test.ts`, change the import line to:

```ts
import { resolveBackgroundDataUrl, getBackgroundsDirPath } from '../electron/ipc/fileHandlers'
```

And change the assertion using `getBackgroundsDir()` to `getBackgroundsDirPath()`:

```ts
assert('getBackgroundsDirPath 路径以 backgrounds 结尾', () => {
  const d = getBackgroundsDirPath()
  return d.endsWith('backgrounds') && existsSync(d)
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx tests/backgroundResolve.test.ts`
Expected: `4 passed, 0 failed`

Note: importing `fileHandlers` pulls in electron — if tsx complains about electron in a pure-node test context, wrap the electron-dependent assertions behind `try/catch` (already done) and ensure `app`/`process.resourcesPath` access only happens inside the handlers, not at module top-level. `resolveBackgroundDataUrl` references `app.isPackaged` — if this throws in test (no electron app), guard it: change `app.isPackaged` to `(app && app.isPackaged)` and `process.resourcesPath` access to a try/catch fallback. Verify by running the test; if it fails on `app`, add the guard in Step 3's `resolveBackgroundDataUrl` preset branch:

```ts
      let packaged = false
      try { packaged = app?.isPackaged === true } catch { packaged = false }
      absPath = packaged
        ? join(process.resourcesPath, 'backgrounds', preset.file)
        : join(__dirname, '../../resources/backgrounds', preset.file)
```

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/fileHandlers.ts tests/backgroundResolve.test.ts
git commit -m "feat(background): 主进程背景图 IPC（list/add/resolve/remove）"
```

---

### Task 5: AppBackground component

**Files:**
- Create: `src/components/AppBackground.tsx`

**Interfaces:**
- Consumes: `useSettingsStore` (`settings.background`, `settings.theme`), `window.api.backgroundResolve`.
- Produces: default-exported `AppBackground` React component rendering `null` when disabled, else an `absolute inset-0 z-0` image+overlay layer.

- [ ] **Step 1: Create the component**

Create `src/components/AppBackground.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'

/** 解析当前主题是否为深色（与 App.tsx 的逻辑一致） */
function useIsDark(): boolean {
  const theme = useSettingsStore((s) => s.settings.theme)
  const [isDark, setIsDark] = useState(false)
  useEffect(() => {
    if (theme === 'dark') {
      setIsDark(true)
      return
    }
    if (theme === 'light') {
      setIsDark(false)
      return
    }
    // system
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setIsDark(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [theme])
  return isDark
}

/**
 * 全应用根层背景图。disabled 或图片缺失时返回 null，由根 div 纯色兜底。
 * 渲染：<img> 背景层 + 半透明遮罩层；pointer-events-none 不挡交互。
 */
export default function AppBackground() {
  const background = useSettingsStore((s) => s.settings.background)
  const isDark = useIsDark()
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  // 图源变化时重新解析为 data URL
  useEffect(() => {
    if (!background?.enabled) {
      setImgUrl(null)
      setFailed(false)
      return
    }
    let cancelled = false
    const key = background.source === 'preset' ? background.presetId : background.customPath
    window.api
      ?.backgroundResolve(background.source, key)
      .then((url) => {
        if (cancelled) return
        setImgUrl(url)
        setFailed(false)
      })
      .catch(() => {
        if (cancelled) return
        setImgUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [background?.enabled, background?.source, background?.presetId, background?.customPath])

  if (!background?.enabled || !imgUrl || failed) return null

  const overlayHex =
    background.overlayColor === 'auto' ? (isDark ? '#000000' : '#ffffff') : background.overlayColor

  const objectFit =
    background.fit === 'stretch' ? 'fill' : background.fit === 'contain' ? 'contain' : 'cover'

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
      <img
        src={imgUrl}
        alt=""
        aria-hidden="true"
        className="w-full h-full"
        style={{
          objectFit,
          filter: background.blur > 0 ? `blur(${background.blur}px)` : undefined,
          // blur 露出边缘，略微放大遮住透明边
          transform: background.blur > 0 ? 'scale(1.05)' : undefined
        }}
        onError={() => setFailed(true)}
      />
      <div
        className="absolute inset-0"
        style={{ backgroundColor: overlayHex, opacity: background.overlayOpacity }}
      />
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/AppBackground.tsx
git commit -m "feat(background): AppBackground 根层背景组件"
```

---

### Task 6: Mount AppBackground + transparentize App root

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `AppBackground` from `src/components/AppBackground.tsx`.

- [ ] **Step 1: Import and mount AppBackground**

In `src/App.tsx`, add the import near the other component imports (after the `PlayerView` import around line 5):

```ts
import AppBackground from './components/AppBackground'
```

In the returned JSX, the root div is currently (around line 1024):

```tsx
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-gray-50 dark:bg-dark-bg relative">
```

Insert `<AppBackground />` as the first child inside this root div, before `<LoadingOverlay .../>`:

```tsx
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-gray-50 dark:bg-dark-bg relative">
      <AppBackground />
      <LoadingOverlay
```

The root div keeps `bg-gray-50 dark:bg-dark-bg` as the solid fallback when background is disabled; `AppBackground` (z-0) sits above it and the content stacks above via existing z-index.

- [ ] **Step 2: Transparentize the main content wrapper**

Find the main content wrapper (around line 1057):

```tsx
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 bg-white dark:bg-dark-bg min-w-0">
```

Change to:

```tsx
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 bg-transparent min-w-0">
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(background): 挂载 AppBackground 并透明化主内容区"
```

---

### Task 7: Transparentize PlayerView + SideNav + BookShelf containers

**Files:**
- Modify: `src/components/PlayerView.tsx`
- Modify: `src/components/SideNav.tsx`
- Modify: `src/components/BookShelf.tsx`

**Principle:** Only the large area containers become transparent. Cards, panels, dropdowns, the bottom playback bar, the search strip, and active/hover row states keep their backgrounds. The empty-state placeholder keeps its bg.

- [ ] **Step 1: Transparentize PlayerView root**

In `src/components/PlayerView.tsx`, find the returned root div (around line 625-628):

```tsx
    <div
      className={`flex flex-col overflow-hidden bg-white dark:bg-dark-bg relative min-h-0 ${
        immersive ? 'absolute inset-0' : 'flex-1'
      }`}
    >
```

Change `bg-white dark:bg-dark-bg` to `bg-transparent`:

```tsx
    <div
      className={`flex flex-col overflow-hidden bg-transparent relative min-h-0 ${
        immersive ? 'absolute inset-0' : 'flex-1'
      }`}
    >
```

Do NOT touch the `SentenceRow` classes, the `ReaderHeader`, the search bar strip bg, the loading overlay, or the empty-state placeholder bg (around line 616) — those keep their backgrounds.

- [ ] **Step 2: Inspect and transparentize SideNav area container**

Run: `grep -n "bg-white\|bg-gray-50\|dark:bg-dark" src/components/SideNav.tsx`
Identify the outermost area wrapper. If `SideNav` has a root container like `<div className="... bg-white dark:bg-dark-... ">`, change that single outermost bg to `bg-transparent`. Inner selected-state pills, hover backgrounds, and icons keep their colors. If SideNav is already transparent or only uses translucent overlays, leave it.

(Execute the grep, read the matches, apply the change only to the outermost area container. If unsure, default to leaving SideNav's own panel semi-opaque rather than fully transparent — a translucent panel (`bg-white/80 dark:bg-dark-surface/80`) is acceptable per the principle since the sidebar is a persistent panel, not an empty area. Prefer `bg-white/80 dark:bg-dark-surface/80` for the sidebar so it stays readable while letting the background tint through.)

- [ ] **Step 3: Inspect and transparentize BookShelf area container**

Run: `grep -n "bg-white\|bg-gray-50\|dark:bg-dark" src/components/BookShelf.tsx`
Apply the same judgment: transparentize only the outermost area wrapper. Book grid cards (`BookGridCard`, `BookListRow`) keep their card backgrounds.

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/PlayerView.tsx src/components/SideNav.tsx src/components/BookShelf.tsx
git commit -m "feat(background): 透明化播放器/侧栏/书架大块容器"
```

---

### Task 8: Bundle preset images + electron-builder config

**Files:**
- Create: `resources/backgrounds/aurora.jpg`, `dusk.jpg`, `forest.jpg`, `ocean.jpg`, `mountain.jpg`, `nebula.jpg`
- Modify: `electron-builder.yml`

- [ ] **Step 1: Add the preset images**

Place 6 compressed JPG images (1920 wide, ~200-400KB each, dark/low-contrast/calming) into `resources/backgrounds/` with filenames matching `PRESET_BACKGROUNDS`: `aurora.jpg`, `dusk.jpg`, `forest.jpg`, `ocean.jpg`, `mountain.jpg`, `nebula.jpg`.

Image sourcing note for the implementer: use license-free images (e.g. Unsplash, Pexels, or procedurally generated gradients). Prefer dark, low-saturation, large-block compositions so white/black overlay text stays readable. Compress with any image tool to ~300KB at 1920px wide, JPG quality ~80.

- [ ] **Step 2: Update `electron-builder.yml` extraResources**

Find the existing `extraResources` block (around line 20):

```yml
extraResources:
  - from: electron/ocr
    to: ocr
```

Add the backgrounds entry:

```yml
extraResources:
  - from: electron/ocr
    to: ocr
  - from: resources/backgrounds
    to: backgrounds
```

- [ ] **Step 3: Verify the dev path resolves**

The dev path in `resolveBackgroundDataUrl` is `join(__dirname, '../../resources/backgrounds', file)`. In dev, `__dirname` for the compiled main is `out/main`, so `../../resources` = repo-root `resources/`. Confirm `resources/backgrounds/aurora.jpg` exists relative to repo root.

Run: `ls resources/backgrounds/`
Expected: the 6 jpg files listed.

- [ ] **Step 4: Commit**

```bash
git add resources/backgrounds/ electron-builder.yml
git commit -m "feat(background): 内置 6 张预设背景图 + 打包配置"
```

---

### Task 9: Settings UI — "背景" subsection

**Files:**
- Modify: `src/components/settings/GeneralSettingsPanel.tsx`

**Interfaces:**
- Consumes: `useSettingsStore` (`settings.background`, `setBackground`), `PRESET_BACKGROUNDS` from `src/backgroundPresets.ts`, `window.api.backgroundList/backgroundAdd/backgroundResolve`.

- [ ] **Step 1: Add imports**

At the top of `src/components/settings/GeneralSettingsPanel.tsx`, add to the existing imports:

```ts
import { ImageIcon, Upload, Trash2 } from 'lucide-react'
import { PRESET_BACKGROUNDS } from '../../backgroundPresets'
```

(`lucide-react` is already used in this file.)

- [ ] **Step 2: Pull background state + thumb URLs in the component**

Inside `GeneralSettingsPanel` (after the existing `useSettingsStore()` destructure around line 44), add:

```ts
  const { settings, setSettings, setAlwaysOnTop, setFloatingBallEnabled, setTheme, setOpacity, setFontSize, setShortcuts } = useSettingsStore()
  const setBackground = useSettingsStore((s) => s.setBackground)
  const background = settings.background
```

Add a state for preset thumbnail data URLs (load once on mount):

```ts
  // --- 背景预设缩略图 ---
  const [presetThumbs, setPresetThumbs] = useState<Record<string, string>>({})
  const [uploadingBg, setUploadingBg] = useState(false)
  useEffect(() => {
    let cancelled = false
    Promise.all(
      PRESET_BACKGROUNDS.map(async (p) => {
        const url = await window.api?.backgroundResolve('preset', p.id)
        return [p.id, url] as const
      })
    ).then((entries) => {
      if (cancelled) return
      const map: Record<string, string> = {}
      for (const [id, url] of entries) if (url) map[id] = url
      setPresetThumbs(map)
    })
    return () => {
      cancelled = true
    }
  }, [])
```

Add the upload handler:

```ts
  const handleUploadBackground = async () => {
    if (uploadingBg) return
    setUploadingBg(true)
    try {
      const result = await window.api?.backgroundAdd()
      if (result?.success && result.customPath) {
        setBackground({ source: 'custom', customPath: result.customPath, enabled: true })
        showToast('success', '背景图已上传')
      } else if (result?.error && result.error !== '取消选择') {
        showToast('error', result.error)
      }
    } finally {
      setUploadingBg(false)
    }
  }
```

- [ ] **Step 3: Render the "背景" subsection**

Find the end of the "外观" block. The "外观" `<div>` closes right before the "窗口行为" `<div>` (around line 218, the `</div>` after the grid). Insert a new "背景" block immediately after the "外观" closing `</div>` and before "窗口行为":

```tsx
      {/* ===== 背景（平铺） ===== */}
      <div>
        <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">背景</h3>
        <div className="flex flex-wrap gap-2">
          {PRESET_BACKGROUNDS.map((p) => (
            <button
              key={p.id}
              onClick={() => setBackground({ source: 'preset', presetId: p.id, enabled: true })}
              className={`relative h-16 w-24 overflow-hidden rounded-lg border-2 transition-all ${
                background?.source === 'preset' && background?.presetId === p.id
                  ? 'border-primary ring-2 ring-primary/30'
                  : 'border-gray-200 hover:border-primary/40 dark:border-gray-700'
              }`}
              title={p.name}
            >
              {presetThumbs[p.id] ? (
                <img src={presetThumbs[p.id]} alt={p.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gray-100 dark:bg-gray-800">
                  <ImageIcon className="h-5 w-5 text-gray-300" />
                </div>
              )}
            </button>
          ))}
          <button
            onClick={handleUploadBackground}
            disabled={uploadingBg}
            className="flex h-16 w-24 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-300 text-xs text-gray-400 hover:border-primary/50 hover:text-primary disabled:opacity-50 dark:border-gray-600"
            title="上传自定义背景图"
          >
            <Upload className="h-4 w-4" />
            上传
          </button>
        </div>

        <div className="mt-3 flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={background?.enabled === true}
              onChange={(e) => setBackground({ enabled: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            使用背景图
          </label>
          {background?.source === 'custom' && background.customPath && (
            <button
              onClick={async () => {
                const cp = background.customPath
                if (!cp) return
                setBackground({ source: 'preset', presetId: null, enabled: false })
                await window.api?.backgroundRemove(cp)
                showToast('info', '已删除自定义背景图')
              }}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500"
            >
              <Trash2 className="h-3 w-3" /> 删除当前自定义图
            </button>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">填充模式</span>
            <div className="flex gap-1.5">
              {(['cover', 'contain', 'stretch'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setBackground({ fit: f })}
                  className={`px-2.5 py-1 text-xs rounded border ${
                    background?.fit === f
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-primary/30'
                  }`}
                >
                  {f === 'cover' ? '填充' : f === 'contain' ? '适应' : '拉伸'}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">背景模糊: {background?.blur ?? 0}px</span>
            <input
              type="range" min="0" max="20" step="1"
              value={background?.blur ?? 0}
              onChange={(e) => setBackground({ blur: parseInt(e.target.value) })}
              className="w-full"
            />
          </label>
          <div>
            <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">遮罩颜色</span>
            <div className="flex items-center gap-1.5">
              {([
                { v: 'auto', label: '自动' },
                { v: '#000000', label: '黑' },
                { v: '#ffffff', label: '白' }
              ] as const).map((o) => (
                <button
                  key={o.v}
                  onClick={() => setBackground({ overlayColor: o.v })}
                  className={`px-2.5 py-1 text-xs rounded border ${
                    (background?.overlayColor ?? 'auto') === o.v
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-primary/30'
                  }`}
                >
                  {o.label}
                </button>
              ))}
              <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
                <input
                  type="color"
                  value={(background?.overlayColor ?? 'auto').startsWith('#') ? (background.overlayColor as string) : '#1a1a2e'}
                  onChange={(e) => setBackground({ overlayColor: e.target.value })}
                  className="h-6 w-6 rounded cursor-pointer"
                  title="自定义遮罩色"
                />
                自定义
              </label>
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">遮罩透明: {Math.round((background?.overlayOpacity ?? 0.7) * 100)}%</span>
            <input
              type="range" min="0" max="1" step="0.05"
              value={background?.overlayOpacity ?? 0.7}
              onChange={(e) => setBackground({ overlayOpacity: parseFloat(e.target.value) })}
              className="w-full"
            />
          </label>
        </div>
      </div>
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors. (If lint flags unused `ImageIcon`/`setSettings`, confirm they're used; remove unused imports.)

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/GeneralSettingsPanel.tsx
git commit -m "feat(background): 设置面板「背景」小节（预设/上传/遮罩控件）"
```

---

### Task 10: Manual verification + CONTEXT.md update

**Files:**
- Modify: `CONTEXT.md`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all test files pass.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual smoke test (dev)**

Run: `npm run dev`
Verify:
1. Settings → 外观 → 背景: 6 preset thumbnails appear.
2. Click a preset → background shows behind the whole app (sidebar + content).
3. Toggle "使用背景图" off → solid color returns.
4. Upload a custom image → it becomes the background.
5. Adjust overlay opacity slider → overlay lightens/darkens live.
6. Switch theme light → dark → overlay flips white↔black when set to "自动".
7. Adjust blur slider → background blurs.
8. Switch fit mode cover/contain/stretch → image fit changes.
9. Enter player immersive mode → background still visible.
10. Disable background → everything back to original.

- [ ] **Step 4: Update CONTEXT.md**

Per the AGENTS.md rule (new source files + new feature → update CONTEXT.md). Add to the file index: `src/backgroundPresets.ts`, `src/components/AppBackground.tsx`. Add a "背景图" note in the features/坑点 section. Refresh the 当前状态 block. Keep total ≤ 300 lines.

- [ ] **Step 5: Commit**

```bash
git add CONTEXT.md
git commit -m "docs: CONTEXT 补充背景图功能"
```

---

## Self-Review

**Spec coverage:**
- Data model (BackgroundSettings, AppSettings.background) → Task 2. ✅
- settingsStore default + setBackground + loadSettings merge → Task 2. ✅
- Built-in presets metadata → Task 1; image files + bundling → Task 8. ✅
- Upload (copy to data dir, return rel path) → Task 4 `background:add`. ✅
- Path resolution (data URL) → Task 4 `resolveBackgroundDataUrl` + `background:resolve`. ✅
- AppBackground component (image + overlay, theme auto, null fallback) → Task 5. ✅
- Container transparentization (App, PlayerView, SideNav, BookShelf) → Tasks 6, 7. ✅
- Settings UI (presets, upload, fit, blur, overlay color, opacity) → Task 9. ✅
- Error handling (img onError, missing file → null, non-image upload) → Task 5 (onError) + Task 4 (resolve null + add validation via extension filter). ✅
- electron-builder extraResources → Task 8. ✅
- Preload + Api type → Task 3. ✅
- CONTEXT.md → Task 10. ✅

**Placeholder scan:** No TBD/TODO. Image sourcing in Task 8 gives concrete guidance (Unsplash/Pexels, 1920px, ~300KB, JPG 80). SideNav/BookShelf transparency in Task 7 gives a concrete decision rule (translucent panel for sidebar, transparent area wrapper for shelf, cards keep bg). ✅

**Type consistency:** `BackgroundSettings` fields match across Task 2 (type), Task 5 (component reads them), Task 9 (UI binds them). `setBackground(partial)` signature consistent. `backgroundResolve(source, key)` signature consistent across Task 3 (preload), Task 4 (handler), Task 5 (component), Task 9 (thumbs). `getBackgroundsDirPath` export name consistent (test fixed in Task 4 Step 4). ✅
