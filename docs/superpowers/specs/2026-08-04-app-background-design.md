# App Background Image Design

## Goal

Let users enrich the app with a background image — either a built-in preset or an uploaded custom image — rendered behind the entire app window with a tunable overlay so text stays readable. This turns the plain solid-color shell into a warmer, more immersive reader environment without disturbing the existing layout or reading surfaces.

## Scope

This change adds a full-app background layer (root level, including the sidebar) and the settings to control it.

- Add a `background` field to `AppSettings` with enable toggle, source (preset/custom), fit mode, blur, overlay color, and overlay opacity.
- Ship 6–8 built-in preset images bundled via `electron-builder` `extraResources`.
- Support uploading a custom image; copy it into the data directory and resolve it at runtime.
- Add a root-level `AppBackground` component that renders the image plus a semi-transparent overlay, adapting overlay color to the current theme when set to `auto`.
- Transparentize the large empty containers so the background shows through; keep card/panel/floating-layer backgrounds for local readability.
- Add a "背景" section to the general settings panel with preset thumbnails, upload, and the overlay/fit/blur controls.

The change does not alter TTS, playback, bookmarks, AI features, or the floating-ball/subtitle windows. It does not add an online image gallery (deferred). The existing window-opacity slider is left untouched; the new overlay opacity is a separate control.

## Confirmed Decisions

From the brainstorming dialogue:

- **Scope of effect:** full-app root layer (entire window, including the sidebar).
- **Preset source:** built-in presets + user upload. No online gallery.
- **Presentation:** background image + a semi-transparent overlay over it.
- **Upload storage:** copy the uploaded file into `{dataDir}/backgrounds/`, store only the relative path.
- **Theme adaptation:** overlay color `auto` follows the active theme (white overlay in light, black in dark).
- **Overlay control granularity:** overlay opacity slider + overlay color choice (`auto` / black / white / custom hex).

## Data Model

New type in `src/global.d.ts`:

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

export interface AppSettings {
  // ... existing fields
  background?: BackgroundSettings
}
```

`src/stores/settingsStore.ts`:

- `defaultSettings.background`:
  ```ts
  {
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
  Default `enabled: false` so existing users are unaffected.
- New action `setBackground(partial: Partial<BackgroundSettings>)` following the existing `set + saveSettings()` pattern.
- In `loadSettings`, merge `loaded.background` over the default (`{ ...defaultBg, ...loaded.background }`) so old configs missing the field or individual keys are backfilled.

## Presets and Upload

### Built-in presets

New file `src/backgroundPresets.ts`:

```ts
export interface PresetBg {
  id: string
  name: string
  file: string // filename in resources/backgrounds/
}

export const PRESET_BACKGROUNDS: PresetBg[] = [
  { id: 'aurora',   name: '极光', file: 'aurora.jpg' },
  // ... 6–8 entries
]
```

Preset images live in `resources/backgrounds/`, each compressed to ~200–400 KB (1920 wide, JPG quality ~80). Image direction: dark, low-contrast, large color blocks (landscapes / abstract) so they read as calm backgrounds, not focal content.

`electron-builder.yml` `extraResources` gains:
```yml
extraResources:
  - from: electron/ocr
    to: ocr
  - from: resources/backgrounds
    to: backgrounds
```

Runtime path resolution (main process):
- Dev: `join(__dirname, '../../resources/backgrounds/<file>')` (mirrors `floatingBallHandlers` / `main.ts` icon resolution).
- Packaged: `join(process.resourcesPath, 'backgrounds', '<file>')`.

### Upload

New IPC `background:add` in `electron/ipc/fileHandlers.ts`, mirroring the existing `cover:upload` handler:

1. `dialog.showOpenDialog` with filter `['png', 'jpg', 'jpeg', 'webp']`.
2. Copy the chosen file into `getBackgroundsDir()` as `{timestamp}-{originalName}` (avoids collisions).
3. Return the relative path `backgrounds/{timestamp}-{name}` for the renderer to store in `settings.background.customPath`.

A new `getBackgroundsDir()` helper mirrors `getCoversDir()` — ensures `{dataDir}/backgrounds/` exists and returns its absolute path. `getDataDir()` already handles custom data-dir and creation, so the backgrounds dir follows the user's configured data directory and travels with data migration.

### Path resolution

New IPC `background:resolve` → returns a data URL (`data:image/<ext>;base64,...`) for a given source, so the renderer's `<img>` works regardless of dev/packaged/file-restriction differences. This reuses the exact pattern from `cover:getDataUrl`:

- `source='preset'` + `presetId`: look up the preset `file`, resolve the bundled resource path, read + base64.
- `source='custom'` + `customPath`: join `getDataDir()` + `customPath`, verify existence, read + base64.
- Missing file → return `null` (renderer hides the image and falls back to solid color).

New IPC `background:list` → returns the preset list (`[{ id, name }]`) so the renderer does not hardcode the bundled filenames; the bundled files are the source of truth.

New IPC `background:remove` → deletes a custom image file; if it is the active one, the renderer sets `enabled=false` first. (Optional polish; presets are never deleted.)

### Preload exposure (`electron/preload.ts`)

```ts
backgroundList: () => ipcRenderer.invoke('background:list'),
backgroundAdd: () => ipcRenderer.invoke('background:add'),
backgroundResolve: (source: 'preset' | 'custom', key: string | null) =>
  ipcRenderer.invoke('background:resolve', source, key),
backgroundRemove: (customPath: string) => ipcRenderer.invoke('background:remove', customPath),
```

These are also added to the `Api` type in `src/global.d.ts`.

## AppBackground Component

New component `src/components/AppBackground.tsx`:

- Subscribes to `settings.background` and `settings.theme` from `useSettingsStore`.
- Resolves the current image to a data URL via `window.api.backgroundResolve(...)` whenever `source` + `presetId`/`customPath` changes (memoized).
- If `!enabled` or resolve returns null → render nothing (the root div's solid color shows).
- Computes the overlay hex: `overlayColor === 'auto'` → `#000000` in dark theme, `#ffffff` in light theme; otherwise the literal hex. Theme resolution follows the same `system` → `matchMedia` logic already in `App.tsx`.
- Renders:
  ```tsx
  <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
    <img src={imgUrl} className="w-full h-full"
         style={{
           objectFit: fit === 'stretch' ? 'fill' : fit,
           filter: blur > 0 ? `blur(${blur}px)` : undefined,
           // blur 会露出边缘，放大一点避免透明边
           transform: blur > 0 ? 'scale(1.05)' : undefined
         }}
         onError={() => { /* 隐藏背景图，退纯色兜底，toast 一次 */ }} />
    <div className="absolute inset-0"
         style={{ backgroundColor: overlayHex, opacity: overlayOpacity }} />
  </div>
  ```

Mount point: `App.tsx` root div. The root div already has `relative`; `AppBackground` is inserted as the first child so everything else stacks above it (`z-0` for background, existing content naturally above). The root div keeps its `bg-gray-50 dark:bg-dark-bg` as the solid-color fallback when the background is disabled or fails to load.

## Container Transparentization

Principle: **only large empty containers become transparent; cards / panels / floating layers keep their own backgrounds for local readability.**

Containers to change to `bg-transparent` (remove the solid `bg-white dark:bg-dark-bg`):

- `App.tsx` main content wrapper `<div className="flex-1 flex flex-col ... bg-white dark:bg-dark-bg ...">` → `bg-transparent`.
- `PlayerView.tsx` root `<div className="... bg-white dark:bg-dark-bg relative ...">` → `bg-transparent`.
- `SideNav`, `BookShelf`, and other full-area views: transparentize the area containers, but keep their inner cards (book cards, list rows) as-is so items remain distinguishable.

Containers to KEEP their backgrounds (cards / panels / floating layers):

- `ReaderHeader` (top bar) — keep its panel bg.
- `ControlBar` / `ProgressBar` wrapper (`bg-white dark:bg-dark-surface`) — keep; this is the bottom playback panel.
- Dropdowns (`chapterDropdownOpen`, `versionDropdownOpen` menus) — keep `bg-white dark:bg-dark-raised`.
- The search bar strip — keep its `bg-gray-50 dark:bg-dark-muted`.
- `SentenceRow` active/hover states — keep their `bg-primary/10` etc.
- Settings modal, range selector, toasts, OSD — keep (top-level overlays).
- Empty-state placeholder in `PlayerView` ("请从书架选择一本书…") — keep its bg.

The exact set is finalized during implementation by grepping `bg-white dark:bg-dark-bg` and judging each occurrence against the principle above.

## Settings UI

Add a "背景" subsection inside the existing "外观" block of `GeneralSettingsPanel.tsx` (flat, not collapsed — same level as theme/font-size), placed after the existing appearance controls:

```
背景
┌──────────────────────────────────────┐
│ 预设  [缩略图 aurora] [极光]  ...        │  ← horizontal scroll of preset
│       thumbnails, current highlighted    │
│                                          │
│ [+ 上传图片]   [使用背景图 ☑]            │
│                                          │
│ 填充模式: ●填充 ○适应 ○拉伸              │
│ 背景模糊: ━━●━━ 0px                     │
│ 遮罩颜色: ●自动 ○黑 ○白 ○自定义[色板]   │
│ 遮罩透明: ━━●━━ 70%                     │
└──────────────────────────────────────┘
```

Interactions:

- Click a preset thumbnail → `setBackground({ source: 'preset', presetId, enabled: true })`.
- Click "上传图片" → `window.api.backgroundAdd()` → on success `setBackground({ source: 'custom', customPath, enabled: true })`; on cancel/error show toast.
- "使用背景图" checkbox → `setBackground({ enabled })`.
- Fit mode radios, blur slider, overlay color radios (with a `<input type="color">` when "自定义" is picked), overlay opacity slider → all call `setBackground` live for instant preview.

Preset thumbnails are themselves resolved via `window.api.backgroundResolve('preset', id)` to data URLs (small thumbnails; acceptable cost). They load once on panel mount.

The existing "窗口透明度" slider (`windowOpacity`, controls whole-window opacity for the always-on-top/floating-ball use case) is visually separate and labeled distinctly from the new "遮罩透明" slider to avoid confusion.

## Error Handling and Edge Cases

- **Image load failure (`<img onError>`):** hide the image layer, fall back to the root solid color, toast once "背景图加载失败" (dedup so it does not spam).
- **Custom image file missing** (user deleted the `backgrounds/` dir): `background:resolve` returns null → `AppBackground` renders nothing; optionally auto-`setEnabled(false)` + toast "背景图文件已丢失，已关闭背景".
- **Preset image missing** (packaging anomaly): same null fallback to solid color.
- **Non-image / corrupted upload:** `background:add` validates the extension and attempts to read the file; on failure returns `{ success: false, error }`, renderer toasts.
- **Large image performance:** no hard size limit on upload (user's responsibility), but the upload toast notes "大图可能影响性能". Built-in presets are pre-compressed.
- **Theme switch:** `overlayColor: 'auto'` re-evaluates on theme change; no reload needed.
- **Background disabled:** `enabled: false` → `AppBackground` returns null, root div solid color takes over — identical to today.
- **Data directory migration:** since custom images live under `{dataDir}/backgrounds/`, they move with the data directory when migrated; relative paths in settings stay valid.
- **Settings export/import:** `background` rides along in `settings.json` like every other setting; preset references are by id (stable), custom by relative path (valid as long as the data dir comes too).

## Files Touched

New:

- `resources/backgrounds/*.{jpg,...}` — 6–8 preset images.
- `src/backgroundPresets.ts` — preset metadata.
- `src/components/AppBackground.tsx` — the background layer component.

Modified:

- `src/global.d.ts` — `BackgroundSettings` type, `AppSettings.background`, `Api` preload shape.
- `src/stores/settingsStore.ts` — default, `setBackground` action, `loadSettings` merge.
- `src/components/settings/GeneralSettingsPanel.tsx` — "背景" subsection.
- `src/App.tsx` — mount `AppBackground`, transparentize the main content wrapper.
- `src/components/PlayerView.tsx` — transparentize root container.
- `src/components/SideNav.tsx`, `src/components/BookShelf.tsx`, etc. — transparentize area containers (per the principle; finalized during implementation).
- `electron/ipc/fileHandlers.ts` — `getBackgroundsDir`, `background:list/add/resolve/remove` handlers.
- `electron/preload.ts` — expose the four background IPC methods.
- `electron-builder.yml` — `extraResources` backgrounds entry.

## Testing

- **Unit:** `settingsStore` default/merge/`setBackground` persists; `AppBackground` resolves null when disabled or file missing.
- **Integration (existing test harness):** IPC `background:add` copies a temp image and returns a relative path; `background:resolve` returns a data URL for it; `background:resolve` returns null for a missing path.
- **Manual:** toggle enabled, switch presets, upload a custom image, adjust each slider, switch light/dark/system theme and confirm overlay flips; enable immersive mode and confirm the background still shows; disable and confirm solid color returns.
