import { shell } from 'electron'

/** 仅允许在系统浏览器中打开 http(s) 链接，拒绝 file/javascript 等危险协议 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export async function safeOpenExternal(url: string): Promise<boolean> {
  if (!isSafeExternalUrl(url)) {
    console.warn('[safeOpenExternal] blocked unsafe URL:', url.slice(0, 120))
    return false
  }
  await shell.openExternal(url)
  return true
}
