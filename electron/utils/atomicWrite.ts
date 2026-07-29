import { existsSync, mkdirSync, writeFileSync, renameSync } from 'fs'
import { dirname } from 'path'

/** 原子写盘：先写同目录 .tmp 再 rename，避免断电截断目标文件 */
export function atomicWriteFile(filePath: string, payload: string, encoding: BufferEncoding = 'utf-8'): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, payload, encoding)
  renameSync(tmpPath, filePath)
}
