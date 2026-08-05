/**
 * 真·MCP 协议宿主（stdio / HTTP）。
 * - stdio：spawn 外部进程，newline-delimited JSON-RPC
 * - http：POST JSON-RPC（streamable HTTP 简化版 / 单次 request）
 * 不依赖 @modelcontextprotocol SDK，便于 Electron 主进程稳定打包。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { AiMcpServerConfig } from '../../../src/global'
import { healMcpServerConfig, isMcpServerConfigured } from '../../../src/aiSettings'
import type { OpenAiToolDef, ToolExecutionResult } from './tool-registry'

const PROTOCOL_VERSION = '2024-11-05'
const DEFAULT_TIMEOUT_MS = 30000
const RESULT_CHAR_LIMIT = 12000

export interface McpListedTool {
  serverId: string
  serverName: string
  name: string
  /** 暴露给模型的完整名：mcp_{serverId}_{toolName} */
  exposedName: string
  description?: string
  inputSchema?: Record<string, unknown>
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc?: string
  id?: number | string | null
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

function clip(text: string, max = RESULT_CHAR_LIMIT): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…(已截断)`
}

function sanitizeServerId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'mcp'
}

export function exposeMcpToolName(serverId: string, toolName: string): string {
  return `mcp_${sanitizeServerId(serverId)}_${toolName.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

export function parseExposedMcpToolName(
  exposed: string
): { serverId: string; toolName: string } | null {
  if (!exposed.startsWith('mcp_')) return null
  // 运行时靠 registry 映射更稳；此函数仅作后备
  const rest = exposed.slice(4)
  const idx = rest.indexOf('_')
  if (idx <= 0) return null
  return { serverId: rest.slice(0, idx), toolName: rest.slice(idx + 1) }
}

/** Zotero 等预置模板（默认关闭，用户启用后才拉起） */
export const MCP_SERVER_TEMPLATES: AiMcpServerConfig[] = [
  {
    id: 'zotero',
    name: 'Zotero MCP',
    enabled: false,
    transport: 'stdio',
    command: 'uvx',
    args: ['zotero-mcp'],
    env: {},
    description:
      '社区 Zotero MCP。需本机已装 Zotero 与 uv/uvx。也可用 npx 或自定义 command。启用后对话可检索你的文献库。'
  }
]

class StdioMcpSession {
  private proc: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >()
  private bufferLines: string[] = []
  private started = false
  private startPromise: Promise<void> | null = null

  constructor(private readonly config: AiMcpServerConfig) {}

  async ensureStarted(signal?: AbortSignal): Promise<void> {
    if (this.started && this.proc && !this.proc.killed) return
    if (this.startPromise) return this.startPromise
    this.startPromise = this.start(signal)
    try {
      await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  private async start(signal?: AbortSignal): Promise<void> {
    const command = this.config.command?.trim()
    if (!command) throw new Error(`MCP「${this.config.name}」未配置 command`)

    const args = Array.isArray(this.config.args) ? this.config.args : []
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(this.config.env || {})
    }
    // 不默认泄露敏感变量以外的用户 env 已在 process.env；显式 env 覆盖

    this.proc = spawn(command, args, {
      cwd: this.config.cwd || undefined,
      env,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    const rl = createInterface({ input: this.proc.stdout })
    rl.on('line', (line) => this.onLine(line))
    this.proc.stderr.on('data', () => {
      // 保留 stderr 不刷屏；错误走 RPC error
    })
    this.proc.on('exit', () => {
      this.started = false
      for (const [, p] of this.pending) {
        clearTimeout(p.timer)
        p.reject(new Error(`MCP「${this.config.name}」进程已退出`))
      }
      this.pending.clear()
      this.proc = null
    })

    if (signal) {
      const onAbort = () => this.dispose()
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    await this.request(
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'ting-ear', version: '1.0.0' }
      },
      this.config.timeoutMs
    )
    // 通知已初始化（无 id）
    this.notify('notifications/initialized', {})
    this.started = true
  }

  private onLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg: JsonRpcResponse
    try {
      msg = JSON.parse(trimmed) as JsonRpcResponse
    } catch {
      return
    }
    if (msg.id === undefined || msg.id === null) return
    const id = Number(msg.id)
    const pending = this.pending.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(id)
    if (msg.error) {
      pending.reject(
        new Error(msg.error.message || `MCP RPC error ${msg.error.code ?? ''}`)
      )
      return
    }
    pending.resolve(msg.result)
  }

  private notify(method: string, params: unknown): void {
    if (!this.proc?.stdin.writable) return
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params })
    this.proc.stdin.write(payload + '\n')
  }

  async request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    if (!this.proc?.stdin.writable) {
      throw new Error(`MCP「${this.config.name}」未连接`)
    }
    const id = this.nextId++
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
    const ms = Math.max(3000, timeoutMs ?? this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP「${this.config.name}」 ${method} 超时`))
      }, ms)
      this.pending.set(id, { resolve, reject, timer })
    })
    this.proc.stdin.write(JSON.stringify(req) + '\n')
    return result
  }

  dispose(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error('MCP 已关闭'))
    }
    this.pending.clear()
    if (this.proc && !this.proc.killed) {
      try {
        this.proc.kill()
      } catch {
        /* ignore */
      }
    }
    this.proc = null
    this.started = false
  }
}

async function httpRpc(
  config: AiMcpServerConfig,
  method: string,
  params?: unknown,
  signal?: AbortSignal
): Promise<unknown> {
  const url = config.url?.trim()
  if (!url) throw new Error(`MCP「${config.name}」未配置 url`)
  const id = Date.now()
  const body = {
    jsonrpc: '2.0',
    id,
    method,
    params
  }
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...(config.headers || {})
  }
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(3000, config.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  )
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`)
    }
    // 可能是单条 JSON 或 SSE
    const jsonLine = text
      .split(/\r?\n/)
      .map((l) => l.replace(/^data:\s*/, '').trim())
      .find((l) => l.startsWith('{'))
    if (!jsonLine) throw new Error('MCP HTTP 响应无 JSON')
    const parsed = JSON.parse(jsonLine) as JsonRpcResponse
    if (parsed.error) {
      throw new Error(parsed.error.message || 'MCP HTTP error')
    }
    return parsed.result
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}

export class McpHost {
  private sessions = new Map<string, StdioMcpSession>()
  private toolIndex = new Map<string, McpListedTool>()
  /** 最近一次 refreshTools 的分服务错误（供设置页展示） */
  private lastErrors: string[] = []

  constructor(private getServers: () => AiMcpServerConfig[]) {}

  listConfiguredServers(): AiMcpServerConfig[] {
    return this.getServers().filter(Boolean)
  }

  getLastRefreshErrors(): string[] {
    return [...this.lastErrors]
  }

  /** 拉起已启用 server，列出工具并注册到 exposedName 索引 */
  async refreshTools(signal?: AbortSignal): Promise<McpListedTool[]> {
    this.toolIndex.clear()
    this.lastErrors = []
    const listed: McpListedTool[] = []
    const servers = this.getServers()
      .filter((s) => s.enabled)
      .map((s) => healMcpServerConfig(s))

    for (const server of servers) {
      const cfg = isMcpServerConfigured(server)
      if (!cfg.ok) {
        this.lastErrors.push(`${server.name || server.id}: ${cfg.reason}`)
        continue
      }
      try {
        const tools = await this.listServerTools(server, signal)
        for (const t of tools) {
          listed.push(t)
          this.toolIndex.set(t.exposedName, t)
        }
        if (tools.length === 0) {
          this.lastErrors.push(`${server.name || server.id}: 已连接但 tools/list 为空`)
        }
      } catch (error) {
        // 单个 server 失败不拖垮其它，但必须可诊断
        const msg = error instanceof Error ? error.message : String(error)
        this.lastErrors.push(`${server.name || server.id}: ${msg}`)
      }
    }
    return listed
  }

  async listServerTools(
    server: AiMcpServerConfig,
    signal?: AbortSignal
  ): Promise<McpListedTool[]> {
    const healed = healMcpServerConfig(server)
    const cfg = isMcpServerConfigured(healed)
    if (!cfg.ok) throw new Error(cfg.reason || 'MCP 配置不完整')

    const raw = await this.withServer(healed, async (call) => {
      const result = (await call('tools/list', {})) as {
        tools?: Array<{
          name?: string
          description?: string
          inputSchema?: Record<string, unknown>
        }>
      }
      return result?.tools || []
    }, signal)

    return raw
      .filter((t) => typeof t.name === 'string' && t.name.trim())
      .map((t) => {
        const name = t.name!.trim()
        return {
          serverId: healed.id,
          serverName: healed.name || healed.id,
          name,
          exposedName: exposeMcpToolName(healed.id, name),
          description: t.description,
          inputSchema:
            t.inputSchema && typeof t.inputSchema === 'object'
              ? t.inputSchema
              : { type: 'object', properties: {} }
        }
      })
  }

  toOpenAiTools(tools: McpListedTool[]): OpenAiToolDef[] {
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.exposedName,
        description: `[MCP:${t.serverName}] ${t.description || t.name}`,
        parameters: t.inputSchema || { type: 'object', properties: {} }
      }
    }))
  }

  async callTool(
    exposedName: string,
    argumentsJson: string,
    signal?: AbortSignal
  ): Promise<ToolExecutionResult> {
    let meta = this.toolIndex.get(exposedName)
    if (!meta) {
      // 索引可能过期：强制刷新一次
      await this.refreshTools(signal)
      meta = this.toolIndex.get(exposedName)
    }
    if (!meta) {
      return { content: JSON.stringify({ error: `未知 MCP 工具: ${exposedName}` }) }
    }
    const serverRaw = this.getServers().find((s) => s.id === meta!.serverId)
    if (!serverRaw || !serverRaw.enabled) {
      return { content: JSON.stringify({ error: `MCP 服务未启用: ${meta.serverId}` }) }
    }
    const server = healMcpServerConfig(serverRaw)
    const cfg = isMcpServerConfigured(server)
    if (!cfg.ok) {
      return { content: JSON.stringify({ error: cfg.reason || 'MCP 配置不完整' }) }
    }

    let args: unknown = {}
    try {
      args = argumentsJson?.trim() ? JSON.parse(argumentsJson) : {}
    } catch {
      args = { raw: argumentsJson }
    }

    try {
      const result = await this.withServer(
        server,
        (call) =>
          call('tools/call', {
            name: meta!.name,
            arguments: args
          }),
        signal
      )
      return { content: clip(formatMcpToolResult(result)) }
    } catch (error) {
      return {
        content: JSON.stringify({
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  /** 探测单个 server：初始化 + tools/list */
  async probe(
    server: AiMcpServerConfig,
    signal?: AbortSignal
  ): Promise<{ ok: boolean; toolCount: number; tools: string[]; error?: string }> {
    try {
      const healed = healMcpServerConfig(server)
      const tools = await this.listServerTools(healed, signal)
      return {
        ok: true,
        toolCount: tools.length,
        tools: tools.map((t) => t.name)
      }
    } catch (error) {
      return {
        ok: false,
        toolCount: 0,
        tools: [],
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  dispose(): void {
    for (const session of this.sessions.values()) session.dispose()
    this.sessions.clear()
    this.toolIndex.clear()
  }

  private async withServer<T>(
    server: AiMcpServerConfig,
    fn: (call: (method: string, params?: unknown) => Promise<unknown>) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    if (server.transport === 'http') {
      // HTTP：每次独立；先 initialize 再业务（部分网关可跳过）
      try {
        await httpRpc(
          server,
          'initialize',
          {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'ting-ear', version: '1.0.0' }
          },
          signal
        )
      } catch {
        // 部分 HTTP MCP 不需要 initialize
      }
      return fn((method, params) => httpRpc(server, method, params, signal))
    }

    let session = this.sessions.get(server.id)
    if (!session) {
      session = new StdioMcpSession(server)
      this.sessions.set(server.id, session)
    }
    await session.ensureStarted(signal)
    return fn((method, params) => session!.request(method, params, server.timeoutMs))
  }
}

function formatMcpToolResult(result: unknown): string {
  if (result == null) return 'null'
  if (typeof result === 'string') return result
  // MCP tools/call 常见：{ content: [{ type:'text', text:'...' }] }
  if (typeof result === 'object' && result && 'content' in result) {
    const content = (result as { content?: unknown }).content
    if (Array.isArray(content)) {
      const texts = content
        .map((item) => {
          if (!item || typeof item !== 'object') return String(item)
          const o = item as { type?: string; text?: string; json?: unknown }
          if (typeof o.text === 'string') return o.text
          if (o.json !== undefined) return JSON.stringify(o.json)
          return JSON.stringify(o)
        })
        .filter(Boolean)
      if (texts.length) return texts.join('\n')
    }
  }
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}

/** 合并默认模板：用户配置优先，缺 zotero 模板则补一条（仍默认关闭） */
export function mergeMcpServers(
  configured: AiMcpServerConfig[] | undefined | null
): AiMcpServerConfig[] {
  const list = Array.isArray(configured) ? configured.map(normalizeServer) : []
  const ids = new Set(list.map((s) => s.id))
  for (const tmpl of MCP_SERVER_TEMPLATES) {
    if (!ids.has(tmpl.id)) list.push({ ...tmpl })
  }
  return list
}

function normalizeServer(raw: AiMcpServerConfig): AiMcpServerConfig {
  return healMcpServerConfig(raw)
}
