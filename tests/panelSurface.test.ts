import {
  DEFAULT_PANEL_OPACITY,
  clampPanelOpacity,
  resolvePanelBlur,
  resolvePanelEffect,
  resolvePanelRgb
} from '../src/panelSurface'

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

assert('默认不透明度 0.72', () => DEFAULT_PANEL_OPACITY === 0.72)

assert('resolvePanelRgb 跟日夜', () =>
  resolvePanelRgb(false) === '255, 255, 255' && resolvePanelRgb(true) === '38, 42, 53'
)

assert('clampPanelOpacity 边界', () =>
  clampPanelOpacity(0) === 0.15 &&
  clampPanelOpacity(2) === 1 &&
  clampPanelOpacity(0.5) === 0.5 &&
  clampPanelOpacity('x') === DEFAULT_PANEL_OPACITY
)

assert('resolvePanelEffect：glass 优先', () =>
  resolvePanelEffect({ glass: true }) === 'frost' &&
  resolvePanelEffect({ glass: false, panelEffect: 'frost' }) === 'plain' &&
  resolvePanelEffect({ panelEffect: 'frost' }) === 'frost' &&
  resolvePanelEffect({}) === 'plain'
)

assert('resolvePanelBlur', () =>
  resolvePanelBlur(0.72, 'frost') === '20px' &&
  resolvePanelBlur(0.98, 'plain') === '0px' &&
  resolvePanelBlur(0.72, 'plain') === '12px'
)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
