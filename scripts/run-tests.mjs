/**
 * 串行跑 tests/*.test.ts，互不短路：一个失败不阻止后续。
 * 用法: node scripts/run-tests.mjs
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const testsDir = join(root, 'tests')
const files = readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.ts'))
  .sort()

let failed = 0
const failures = []

console.log(`Running ${files.length} test files…\n`)

for (const file of files) {
  const path = join(testsDir, file)
  process.stdout.write(`▶ ${file} … `)
  const result = spawnSync(process.execPath, ['--import', 'tsx', path], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, FORCE_COLOR: '0' }
  })
  if (result.status === 0) {
    console.log('ok')
  } else {
    failed += 1
    failures.push(file)
    console.log('FAIL')
    if (result.stdout) console.log(result.stdout.slice(-2000))
    if (result.stderr) console.log(result.stderr.slice(-2000))
  }
}

console.log('\n---')
console.log(`Total: ${files.length}, failed: ${failed}`)
if (failures.length) {
  console.log('Failed files:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
process.exit(0)
