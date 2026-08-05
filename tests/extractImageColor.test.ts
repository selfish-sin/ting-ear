import {
  THEME_BASE_DARK,
  THEME_BASE_LIGHT,
  resolveBaseColor,
  rgbToHex
} from '../src/utils/extractImageColor'

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

assert('rgbToHex', () => rgbToHex(79, 110, 247) === '#4F6EF7')

assert('auto 浅色', () => resolveBaseColor('auto', false, null) === THEME_BASE_LIGHT)

assert('auto 深色', () => resolveBaseColor('auto', true, null) === THEME_BASE_DARK)

assert('fromImage 有缓存用缓存', () =>
  resolveBaseColor('fromImage', false, '#1A2B3C') === '#1A2B3C'
)

assert('fromImage 无缓存回退主题', () =>
  resolveBaseColor('fromImage', true, null) === THEME_BASE_DARK &&
  resolveBaseColor('fromImage', false, undefined) === THEME_BASE_LIGHT
)

assert('自定义 hex', () => resolveBaseColor('#AABBCC', false, null) === '#AABBCC')

assert('非法值回退主题', () => resolveBaseColor('oops', true, null) === THEME_BASE_DARK)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
