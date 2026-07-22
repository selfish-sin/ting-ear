import { useState } from 'react'
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, Check, AlertTriangle, RotateCcw, ClipboardPaste, Copy } from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
import { DEFAULT_CLEAN_RULES, type CleanRule } from '../cleanRules'
import { CLEAN_RULE_IMPORT_PROMPT } from '../cleanRulePrompt'

interface Props {
  showToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

/** 校验单条规则：返回错误信息或 null（合法） */
function validateRule(rule: CleanRule): string | null {
  if (!rule.pattern.trim()) return '正则表达式不能为空'
  try {
    new RegExp(rule.pattern, rule.flags || '')
  } catch (e) {
    return (e as Error).message
  }
  return null
}

/** 用单条规则处理示例文本，用于编辑区实时预览 */
function applySingleRule(rule: CleanRule, text: string): string {
  if (!rule.enabled || !rule.pattern) return text
  try {
    const re = new RegExp(rule.pattern, rule.flags || 'g')
    return text.replace(re, rule.replacement || '')
  } catch {
    return text
  }
}

/** 规则在文本中的匹配次数（用于诊断“为什么没效果”）。零宽匹配按 1 计，避免死循环 */
function countMatches(rule: CleanRule, text: string): number {
  if (!rule.enabled || !rule.pattern) return 0
  try {
    const re = new RegExp(rule.pattern, rule.flags || '')
    if (!re.global) return re.test(text) ? 1 : 0
    const m = text.match(re)
    return m ? m.length : 0
  } catch {
    return 0
  }
}

export interface RuleTrace {
  rule: CleanRule
  skipped: boolean // 未启用
  matched: number // 匹配处数
  changed: boolean // 是否改变了文本
}

/** 逐条试跑（严格镜像后端 enhancedClean 中 applyRegexRules 的顺序与“仅启用项生效”语义），用于定位失效原因 */
function traceRules(text: string, rules: CleanRule[]): { out: string; traces: RuleTrace[] } {
  let out = text
  const traces: RuleTrace[] = []
  for (const rule of rules) {
    if (!rule.enabled || !rule.pattern) {
      traces.push({ rule, skipped: true, matched: 0, changed: false })
      continue
    }
    const before = out
    const matched = countMatches(rule, before)
    let after = before
    try {
      after = before.replace(new RegExp(rule.pattern, rule.flags || 'g'), rule.replacement || '')
    } catch {
      /* 跳过非法规则 */
    }
    out = after
    traces.push({ rule, skipped: false, matched, changed: after !== before })
  }
  return { out, traces }
}

/** 诊断：pattern 含 ^ 或 $ 但 flags 没 m → 很可能“整段才匹配一次” */
function isLineAnchorWithoutM(rule: CleanRule): boolean {
  return /[$^]/.test(rule.pattern) && !rule.flags.includes('m')
}

/** 单条规则预览 + 诊断（未匹配警告 / flags 提示） */
function SingleRulePreview({ rule, text }: { rule: CleanRule; text: string }) {
  const matched = countMatches(rule, text)
  const after = applySingleRule(rule, text)
  const noMatch = rule.enabled && !!rule.pattern && !validateRule(rule) && matched === 0
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`px-1.5 py-0.5 rounded ${
            !rule.enabled
              ? 'bg-gray-100 dark:bg-gray-700 text-gray-400'
              : matched > 0
              ? 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-300'
              : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300'
          }`}
        >
          {!rule.enabled ? '已停用' : matched > 0 ? `匹配 ${matched} 处` : '未匹配'}
        </span>
        {noMatch && (
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-300">
            <AlertTriangle className="w-3 h-3" />
            测试文本中没匹配到：检查 pattern 是否写对、flags 是否需要 m
          </span>
        )}
        {isLineAnchorWithoutM(rule) && (
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-300">
            <AlertTriangle className="w-3 h-3" />
            含 ^ 或 $ 但缺 m 标志，通常需改成 gm 才会逐行匹配
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 bg-gray-50 dark:bg-gray-900">
          <div className="text-gray-400 mb-1">原文（测试文本）</div>
          <pre className="whitespace-pre-wrap break-words text-gray-600 dark:text-gray-300 font-mono max-h-40 overflow-auto">
            {text || '（测试文本为空）'}
          </pre>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 bg-gray-50 dark:bg-gray-900">
          <div className="text-gray-400 mb-1">应用后</div>
          <pre className="whitespace-pre-wrap break-words text-primary font-mono max-h-40 overflow-auto">
            {after || '（无内容）'}
          </pre>
        </div>
      </div>
    </div>
  )
}

function makeId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/** 把外部大模型返回的 JSON 解析、校验、归一化为 CleanRule[] */
function parseImportedRules(text: string): { rules: CleanRule[]; error: string | null } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { rules: [], error: `JSON 解析失败：${(e as Error).message}` }
  }
  // 接受：单条对象 / 对象数组 / { "rules": [...] }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { rules?: unknown }).rules)
      ? (data as { rules: unknown[] }).rules
      : [data]

  if (!Array.isArray(list) || list.length === 0) {
    return { rules: [], error: '未发现任何规则对象' }
  }

  const out: CleanRule[] = []
  for (let i = 0; i < list.length; i++) {
    const item = list[i] as Record<string, unknown>
    if (!item || typeof item !== 'object' || typeof item.pattern !== 'string') {
      return { rules: [], error: `第 ${i + 1} 条缺少合法的 pattern 字段` }
    }
    const rule: CleanRule = {
      id: typeof item.id === 'string' && item.id ? item.id : makeId(),
      name: typeof item.name === 'string' && item.name ? item.name : 'AI 生成的规则',
      pattern: item.pattern,
      replacement: typeof item.replacement === 'string' ? item.replacement : '',
      flags: typeof item.flags === 'string' && item.flags ? item.flags : 'g',
      enabled: item.enabled === undefined ? true : Boolean(item.enabled)
    }
    const err = validateRule(rule)
    if (err) return { rules: [], error: `第 ${i + 1} 条（${rule.name}）非法：${err}` }
    out.push(rule)
  }
  return { rules: out, error: null }
}

const SAMPLE = '第 1 页\n今天天气不错,适合看书.欢迎阅读(中文)内容!'

export default function CleanRulesSettings({ showToast }: Props) {
  const { settings, setSettings } = useSettingsStore()
  const initial = settings.cleanRules && settings.cleanRules.length > 0 ? settings.cleanRules : DEFAULT_CLEAN_RULES
  const [rules, setRules] = useState<CleanRule[]>([...initial])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [importText, setImportText] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [testText, setTestText] = useState(SAMPLE)

  const updateRule = (id: string, patch: Partial<CleanRule>) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const errors = rules.map((r) => validateRule(r)).filter(Boolean)
  const hasError = errors.length > 0

  const handleSave = () => {
    if (hasError) {
      showToast('error', '存在不合法的正则规则，无法保存')
      return
    }
    setSettings({ cleanRules: rules })
    setEditingId(null)
    showToast('success', '清洗规则已保存')
  }

  const handleCancel = () => {
    setRules([...(settings.cleanRules && settings.cleanRules.length > 0 ? settings.cleanRules : DEFAULT_CLEAN_RULES)])
    setEditingId(null)
  }

  const handleReset = () => {
    setSettings({ cleanRules: DEFAULT_CLEAN_RULES })
    setRules([...DEFAULT_CLEAN_RULES])
    setEditingId(null)
    showToast('success', '已恢复默认清洗规则')
  }

  const handleAdd = () => {
    const r: CleanRule = { id: makeId(), name: '', pattern: '', replacement: '', flags: 'gm', enabled: true }
    setRules((prev) => [...prev, r])
    setEditingId(r.id)
  }

  const handleDelete = (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id))
    if (editingId === id) setEditingId(null)
  }

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= rules.length) return
    setRules((prev) => {
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  /** 一键复制提示词到剪贴板（无需手动打开文件） */
  const handleCopyPrompt = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(CLEAN_RULE_IMPORT_PROMPT)
      } else {
        const ta = document.createElement('textarea')
        ta.value = CLEAN_RULE_IMPORT_PROMPT
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      showToast('success', '提示词已复制，发给任意大模型即可')
    } catch {
      showToast('error', '复制失败，请手动复制 prompts/clean-rule-import.md')
    }
  }

  /** 从 AI 生成的 JSON 导入规则 */
  const handleImport = () => {
    const text = importText.trim()
    if (!text) {
      showToast('warning', '请先粘贴由 AI 生成的规则 JSON')
      return
    }
    const { rules: imported, error } = parseImportedRules(text)
    if (error || imported.length === 0) {
      showToast('error', error || '未导入任何规则')
      return
    }
    setRules((prev) => [...prev, ...imported])
    setEditingId(imported[0].id)
    setImportText('')
    setShowImport(false)
    showToast('success', `已导入 ${imported.length} 条规则`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">清洗格式正则规则</h3>
          <p className="text-xs text-gray-400 mt-0.5 max-w-md">
            规则自上而下顺序应用。合并硬断行、CJK 空格清理、空行压缩等结构性清洗始终开启，不在此列表。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowImport((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            从 AI 导入
          </button>
          <button
            onClick={handleAdd}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary/90"
          >
            <Plus className="w-3.5 h-3.5" />
            添加规则
          </button>
        </div>
      </div>

      {/* AI 导入窗口 */}
      {showImport && (
        <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-primary">粘贴 AI 生成的规则 JSON</div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyPrompt}
                className="flex items-center gap-1 px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                title="复制提示词，发给任意大模型"
              >
                <Copy className="w-3.5 h-3.5" />
                复制提示词
              </button>
              <span className="text-xs text-gray-400">
                模板见 <code className="font-mono">prompts/clean-rule-import.md</code>
              </span>
            </div>
          </div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={'把自然语言丢给 AI（配合 prompts/clean-rule-import.md 的提示词），把返回的 JSON 粘到这里：\n[\n  { "name": "去除星号", "pattern": "\\\\*", "replacement": "", "flags": "g" }\n]'}
            spellCheck={false}
            rows={5}
            className="w-full px-2.5 py-2 text-xs font-mono bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
          />
          <div className="flex justify-end">
            <button
              onClick={handleImport}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary/90"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              导入规则
            </button>
          </div>
        </div>
      )}

      {/* 测试文本 + 试跑全部规则（用于诊断“为什么没效果”） */}
      {(() => {
        const run = traceRules(testText, rules)
        return (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
        <div className="text-xs font-medium text-gray-600 dark:text-gray-300">
          测试文本（粘贴你真实遇到问题的文本，下方预览与试跑都用它）
        </div>
        <textarea
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          placeholder="把实际没被清洗掉的文本粘到这里，逐条/全部试跑看效果"
          spellCheck={false}
          rows={3}
          className="w-full px-2.5 py-2 text-xs font-mono bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
        />

        <div>
          <div className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
            试跑全部规则（按列表顺序，仅启用规则生效）
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 bg-gray-50 dark:bg-gray-900">
              <div className="text-gray-400 mb-1">运行前</div>
              <pre className="whitespace-pre-wrap break-words text-gray-600 dark:text-gray-300 font-mono max-h-48 overflow-auto">
                {testText || '（测试文本为空）'}
              </pre>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 bg-gray-50 dark:bg-gray-900">
              <div className="text-gray-400 mb-1">运行后（当前列表，未保存也生效）</div>
              <pre className="whitespace-pre-wrap break-words text-primary font-mono max-h-48 overflow-auto">
                {run.out || '（无内容）'}
              </pre>
            </div>
          </div>

          {/* 逐条追踪：定位是“哪条没生效 / 被后一条覆盖” */}
          <ul className="mt-2 space-y-1">
            {run.traces.map((t, i) => (
              <li
                key={t.rule.id}
                className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400"
              >
                <span className="w-4 text-right text-gray-400">{i + 1}.</span>
                <span
                  className={`px-1.5 py-0.5 rounded shrink-0 ${
                    t.skipped
                      ? 'bg-gray-100 dark:bg-gray-700 text-gray-400'
                      : t.matched > 0
                      ? 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-300'
                      : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300'
                  }`}
                >
                  {t.skipped ? '已停用' : t.matched > 0 ? `匹配${t.matched}处` : '未匹配'}
                </span>
                <span className="truncate">
                  {t.rule.name || '未命名'} ·{' '}
                  <code className="font-mono">
                    /{t.rule.pattern}/{t.rule.flags}
                  </code>
                </span>
                {!t.skipped && t.matched > 0 && !t.changed && (
                  <span className="text-gray-400 shrink-0">（匹配到但替换后无变化）</span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-400">
            提示：保存后才对真实导入的文本生效；结构性清洗（合并断行、CJK 空格、空行压缩、重复页眉）始终在规则之后额外执行，规则里无需处理。
          </p>
          </div>
        </div>
        )
      })()}

      {/* 规则列表 */}
      <div className="space-y-2">
        {rules.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-6 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
            暂无规则，点击右上角“添加规则”
          </div>
        )}
        {rules.map((rule, index) => {
          const err = validateRule(rule)
          const isEditing = editingId === rule.id
          return (
            <div key={rule.id} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              {/* 行摘要 */}
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-900/50">
                <button
                  onClick={() => updateRule(rule.id, { enabled: !rule.enabled })}
                  className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${
                    rule.enabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                  title={rule.enabled ? '已启用' : '已停用'}
                >
                  <span
                    className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${
                      rule.enabled ? 'left-4' : 'left-0.5'
                    }`}
                  />
                </button>

                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-700 dark:text-gray-200 truncate">
                    {rule.name || <span className="text-gray-400">未命名规则</span>}
                  </div>
                  <div className="text-xs font-mono text-gray-400 truncate">
                    /{rule.pattern || '—'}/{rule.flags}
                  </div>
                </div>

                {err && (
                  <span className="flex items-center gap-1 text-xs text-red-500 shrink-0" title={err}>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    非法
                  </span>
                )}

                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    className="p-1 text-gray-400 hover:text-primary rounded disabled:opacity-30"
                    title="上移"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => move(index, 1)}
                    disabled={index === rules.length - 1}
                    className="p-1 text-gray-400 hover:text-primary rounded disabled:opacity-30"
                    title="下移"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setEditingId(isEditing ? null : rule.id)}
                    className="p-1 text-gray-400 hover:text-primary rounded"
                    title="编辑"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(rule.id)}
                    className="p-1 text-gray-400 hover:text-red-500 rounded"
                    title="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* 编辑区 */}
              {isEditing && (
                <div className="p-3 space-y-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">规则说明</label>
                    <input
                      value={rule.name}
                      onChange={(e) => updateRule(rule.id, { name: e.target.value })}
                      placeholder="如：删除纯页码行"
                      className="w-full px-2.5 py-1.5 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                      正则表达式 <span className="text-gray-400">（必填）</span>
                    </label>
                    <input
                      value={rule.pattern}
                      onChange={(e) => updateRule(rule.id, { pattern: e.target.value })}
                      placeholder="如：^\d{1,3}$"
                      spellCheck={false}
                      className={`w-full px-2.5 py-1.5 text-sm font-mono bg-gray-50 dark:bg-gray-900 border rounded-lg text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 ${
                        err ? 'border-red-400 focus:ring-red-300' : 'border-gray-200 dark:border-gray-700 focus:ring-primary/30'
                      }`}
                    />
                    {err ? (
                      <p className="flex items-center gap-1 text-xs text-red-500 mt-1">
                        <AlertTriangle className="w-3 h-3" />
                        {err}
                      </p>
                    ) : (
                      <p className="flex items-center gap-1 text-xs text-green-500 mt-1">
                        <Check className="w-3 h-3" />
                        格式合法
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">替换为</label>
                      <input
                        value={rule.replacement}
                        onChange={(e) => updateRule(rule.id, { replacement: e.target.value })}
                        placeholder="留空=删除匹配内容"
                        spellCheck={false}
                        className="w-full px-2.5 py-1.5 text-sm font-mono bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">标志</label>
                      <input
                        value={rule.flags}
                        onChange={(e) => updateRule(rule.id, { flags: e.target.value })}
                        placeholder="gm"
                        spellCheck={false}
                        className="w-full px-2.5 py-1.5 text-sm font-mono bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                  </div>

                  {/* 实时预览 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">规则预览</label>
                    <SingleRulePreview rule={rule} text={testText} />
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1 text-xs text-gray-500 dark:text-gray-400 hover:underline"
                    >
                      收起
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 操作栏 */}
      <div className="flex items-center justify-between pt-1">
        <button
          onClick={handleReset}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          恢复默认
        </button>
        <div className="flex gap-2">
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:underline"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={hasError}
            className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
