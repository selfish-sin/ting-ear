# Background Polish & Theme Color Icon Penetration

## Goal

Two related polish passes requested after living with the background feature:

1. **Background logic cleanup** — remove the "painful design logic" (redundant enable toggle, dead "from image" button, invalid state after delete, fragmented quality controls) and the dead code left by the earlier six-style design.
2. **Theme color penetration into icons** — let the theme color reach icon surfaces more coherently: solid primary buttons use a dark theme variant for their icons (instead of flat white), and the sidebar selected state makes its icon match the theme color.

Both are quality/consistency work. No new features, no new settings keys, no main-process changes.

## Scope

### In scope
- `src/components/settings/BackgroundSettingsPanel.tsx` — restructure UI (8 items → 4 sections), fix the four logic smells.
- `src/styles/globals.css` — delete dead `paper/mint/lavender/ink` `data-panel-fx` rules.
- `src/global.d.ts` — drop deprecated `fit/overlayColor/panelColor` fields from `BackgroundSettings`.
- `src/hooks/useIsDark.ts` (new) — extract the triplicated `useIsDark` / `useIsDarkQuick` / inline `matchMedia` logic.
- `src/components/AppBackground.tsx`, `src/App.tsx`, `BackgroundSettingsPanel.tsx` — consume the new hook.
- `src/panelSurface.ts` — drop the unused `_color` param of `resolvePanelRgb`.
- `src/themeColors.ts` — add `--on-primary-rgb` computation (dark variant in light theme, white in dark theme).
- `src/App.tsx` — write `--on-primary-rgb` alongside the theme effect.
- ~10 `bg-primary text-white` icon buttons — swap `text-white` for `text-[rgb(var(--on-primary-rgb))]`.
- `src/components/SideNav.tsx` — selected-state icon takes theme color.
- `CONTEXT.md` — refresh the background section to match.

### Out of scope
- Background IPC, path validation, preset bundling, `extractImageColor` algorithm — all correct, untouched.
- `App.tsx` panel-variable injection effect refactor (independent; not touched unless it blocks).
- `AiSettingsPanel.tsx` (1889 lines; separate concern).
- No new preset images, no preset image edits.
- No luminance-based auto foreground selection — the rule is a simple light/dark split.

## Confirmed Decisions

From brainstorming dialogue:

- **Quality sliders:** restructure 8 items into 4, do NOT collapse to one slider. Rationale: content area needs higher opacity than sidebar for readability; merging loses that.
- **"Enable" checkbox:** removed. Selecting a preset/upload enables; selecting "无背景" disables. One action does both.
- **"From image" base color:** disabled with hint when no image is enabled, not a silent dead button.
- **Delete custom image:** lands on "无背景" valid state, not `presetId:null`.
- **Base color selection:** single radio group (跟日夜 / 取自底图 / 自定义), custom bound to color input.
- **Solid button icons:** light theme → `primary-700` (dark variant); dark theme → white. Simple split, no auto-luminance.
- **Sidebar icons:** default gray stays (correct — full theme color would be noisy); selected-state icon gains theme color.
- **Keep it simple:** no new utility functions beyond `useIsDark` extraction and `--on-primary-rgb` computation.

## Design

### 1. Background panel restructure

New layout (4 sections, down from ~8 line items):

```
背景设置页
├─ ① 底图
│   ├─ [当前选中预览缩略图]   ← 新增,顶部显示现在用的是哪张
│   ├─ [无背景] [极光] [黄昏] [深林] [远海] [山峦] [星云] [上传]
│   │   ↑ "无背景" 作为第一个选项,取代"启用"复选框
│   ├─ 底图模糊  ───●───  (disabled when 无背景)
│   └─ 底图压暗  ───●───  (disabled when 无背景)  ← 从遮罩区挪来
├─ ② 底层色
│   └─ ○ 跟日夜   ○ 取自底图(disabled+hint if 无背景)   ◉ 自定义 [color]
├─ ③ 组件浓度  ───●───   ☑ 毛玻璃   ← 并排紧凑
└─ ④ 正文浓度  ───●───
```

**Logic changes:**

- `enabled` field stays in `BackgroundSettings` (data model), but UI no longer exposes a checkbox. "无背景" option sets `enabled:false`; any preset/upload sets `enabled:true`.
- Selecting "无背景": `setBackground({ enabled: false })`.
- Selecting a preset: `setBackground({ source:'preset', presetId:id, enabled:true })`.
- Upload: `setBackground({ source:'custom', customPath, enabled:true })`.
- Delete custom: `setBackground({ source:'preset', presetId:null, enabled:false })` then async remove file. (`presetId:null` + `enabled:false` is now a valid "无背景" state, not a broken preset state.)
- "取自底图" radio: `disabled` when `!enabled`; tooltip/hint "需先选底图".

**当前选中预览缩略图:** at the top of 底图 section, show the active image (resolved via `backgroundResolve`) or a "无背景" placeholder. Reuses the existing `presetThumbs` map for presets; resolves custom path on demand.

### 2. Dead code cleanup

- `globals.css`: delete `html[data-panel-on][data-panel-fx='paper'|'mint'|'lavender'|'ink']` blocks and their `.dark` variants (~50 lines). Keep `frost` (still reachable via `resolvePanelEffect`).
- `global.d.ts` `BackgroundSettings`: remove `fit`, `overlayColor`, `panelColor`. Keep `panelEffect` (`normalizeBackground` still reads it for `frost` compat).
- `panelSurface.ts` `resolvePanelRgb(_color, isDark)` → `resolvePanelRgb(isDark)`. Update call site in `App.tsx`.
- `settingsStore.ts` `normalizeBackground`: stop carrying `fit/overlayColor/panelColor` through merge (they're gone from the type; old `settings.json` values are silently dropped by the spread, which is fine).

### 3. `useIsDark` extraction

New `src/hooks/useIsDark.ts`:
```ts
export function useIsDark(): boolean {
  const theme = useSettingsStore((s) => s.settings.theme)
  const [isDark, setIsDark] = useState(false)
  useEffect(() => {
    if (theme === 'dark') { setIsDark(true); return }
    if (theme === 'light') { setIsDark(false); return }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setIsDark(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [theme])
  return isDark
}
```
Replace: `AppBackground.tsx` `useIsDark`, `BackgroundSettingsPanel.tsx` `useIsDarkQuick`, `App.tsx` two inline `matchMedia` blocks (the theme effect keeps its own `applyTheme` logic but can call `useIsDark` — need to verify the effect can use a hook; if not, the effect keeps inline but the other two sites consolidate).

Note: `App.tsx`'s panel-variable effect uses `isDark` inside an effect with its own `matchMedia` subscription because effects can't conditionally use hooks. That effect keeps its inline `mq` logic but the other two component-level sites (`AppBackground`, `BackgroundSettingsPanel`) use the shared hook.

### 4. Theme color: `--on-primary-rgb`

`themeColors.ts` `applyThemeColorToDom` — add:
```ts
// 实心按钮前景：浅色主题用深变体(primary-700)，深色主题用白
// 深色主题下深变体对比度不足，留白
```
But `applyThemeColorToDom` doesn't know the theme. So: compute both candidates, write `--on-primary-rgb` based on a `isDark` param. Two options:

- **Option A:** pass `isDark` into `applyThemeColorToDom(hex, isDark)`. App.tsx already has theme; calls it from a combined effect.
- **Option B:** write `--on-primary-rgb` separately in App.tsx's theme effect (which already knows dark/light).

Choose **Option B** — keeps `applyThemeColorToDom` focused on primary variants; App.tsx theme effect already switches on dark/light and is the right place to set the foreground-on-primary. Add a helper `onPrimaryRgb(hex, isDark)` in `themeColors.ts` returning the rgb string.

```ts
// themeColors.ts
export function onPrimaryRgb(hex: string, isDark: boolean): string {
  if (isDark) return '255, 255, 255'
  const c = parseHexColor(normalizeThemeColor(hex))
  if (!c) return '255, 255, 255'
  // primary-700 = mix toward black 0.32
  return mixToward(c.r, c.g, c.b, 0.32, 0)
}
```

App.tsx theme effect writes `root.style.setProperty('--on-primary-rgb', onPrimaryRgb(themeColor, isDark))` alongside `applyThemeColorToDom`.

### 5. Solid button icon color swap

Replace `text-white` with `text-[rgb(var(--on-primary-rgb))]` in `bg-primary` icon buttons. Files (from grep):

- `ControlBar.tsx:207` (play button)
- `ai/ChatInput.tsx:69` (send button)
- `BookShelf.tsx:1442,1498,1564` (batch action buttons)
- `CleanRulesSettings.tsx:295,333,597`
- `HistoryView.tsx:183`
- `QuickTextPanel.tsx:94`
- `SettingsModal.tsx:81`
- `EditHistoryDialog.tsx:122`
- `ErrorBoundary.tsx:42`
- `RangeSelector.tsx:310,356,367,436`
- `ScreenshotOverlay.tsx:400`

Keep `text-white` where the background is NOT primary (e.g. `bg-black/70` OSD, `bg-red-500` close button, `FloatingBall` which has its own theming).

### 6. Sidebar selected-state icon

`SideNav.tsx`: the active nav item uses `nav-item-active` (text-primary). The `<Icon>` itself inherits `currentColor`, so it already follows `text-primary` on the active item. Verify: `nav-item-active` is `text-primary`, icon has no explicit color → icon is already primary on selection. **No change needed** — confirm during implementation. If the settings/expand buttons (which use `nav-item-idle`) should also gain theme color on hover, they already do via `nav-item-idle` `hover:text-primary`.

So this section may be a no-op — verify and move on.

## Testing

- `tests/backgroundSettings.test.ts` — update for "无背景" option logic, delete-custom lands on valid state.
- `tests/panelSurface.test.ts` — update `resolvePanelRgb` signature (drop `_color` param).
- `tests/themeColors.test.ts` — add `onPrimaryRgb` cases (light→dark variant, dark→white).
- Manual: switch theme color, verify solid button icons show dark variant in light theme / white in dark theme.
- `npm test` + `npm run typecheck` + `npm run lint`.

## Risks

- **`text-white` → `--on-primary-rgb` swap missing a site:** grep is the source of truth; verify each `bg-primary text-white` site.
- **`--on-primary-rgb` not set before App.tsx effect runs:** default in `:root` (globals.css) should be `255,255,255` so initial paint is safe.
- **"无背景" state breaking old settings:** old users with `enabled:false` already see no background; "无背景" is just the UI label for that. No migration needed.
- **Deleting `fit/overlayColor/panelColor` from type:** old `settings.json` still has these keys; `normalizeBackground` spread ignores them. No error, just dropped. Safe.
