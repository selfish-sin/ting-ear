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
