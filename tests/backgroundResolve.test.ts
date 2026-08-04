import { resolveBackgroundDataUrl, getBackgroundsDirPath } from '../electron/ipc/fileHandlers'
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let passed = 0
let failed = 0

async function assert(label: string, fn: () => boolean | Promise<boolean>): Promise<void> {
  try {
    if (await fn()) {
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

async function main(): Promise<void> {
  await assert('resolveBackgroundDataUrl 不存在的预设返回 null', async () => {
    const r = await resolveBackgroundDataUrl('preset', 'definitely-not-exist')
    return r === null
  })

  await assert('resolveBackgroundDataUrl 不存在的自定义路径返回 null', async () => {
    const r = await resolveBackgroundDataUrl('custom', 'backgrounds/nope.jpg')
    return r === null
  })

  await assert('resolveBackgroundDataUrl 自定义图返回 data URL', async () => {
    // 造一个临时文件当作自定义背景图
    const tmpBgDir = mkdtempSync(join(tmpdir(), 'tingear-bg-'))
    const relPath = 'backgrounds/test.jpg'
    const abs = join(tmpBgDir, relPath)
    // 模拟目录结构
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

  await assert('getBackgroundsDirPath 路径以 backgrounds 结尾', () => {
    // 测试环境下 app 不可用，通过环境变量指定数据目录
    const tmpBgDir = mkdtempSync(join(tmpdir(), 'tingear-bg-'))
    process.env.TINGEAR_BG_TEST_DATADIR = tmpBgDir
    try {
      const d = getBackgroundsDirPath()
      return d.endsWith('backgrounds') && existsSync(d)
    } finally {
      rmSync(tmpBgDir, { recursive: true, force: true })
      delete process.env.TINGEAR_BG_TEST_DATADIR
    }
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

void main()
