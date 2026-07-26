/**
 * 清洗格式正则规则 —— 前后端共享的单一数据源。
 *
 * 用户在「设置 → 清洗」中编辑的规则列表即此结构；主进程 enhancedClean
 * 按顺序应用这些规则。
 *
 * 结构性格式优化（始终执行、不由本列表控制）：
 *   消毒控制字符、竖排单字母合并、重复页眉删除、硬断行合并、
 *   CJK 间空格清理、半角标点收尾规范化、空行压缩、多余空白压缩
 *
 * 本列表负责「用正则能表达」的清洗：页码、期号、常见页眉格式、标点半角转全角等。
 */

export interface CleanRule {
  /** 稳定 id（用于列表 key 与排序） */
  id: string
  /** 规则说明（展示给用户，如“删除纯页码行”） */
  name: string
  /** 正则表达式源串 */
  pattern: string
  /** 替换串，支持 $1 等反向引用；留空表示删除匹配内容 */
  replacement: string
  /** 正则标志，如 'gm'、'gi'（g=全局, m=多行, i=忽略大小写） */
  flags: string
  /** 是否启用 */
  enabled: boolean
}

export const DEFAULT_CLEAN_RULES: CleanRule[] = [
  // ── 乱码 / 隐藏字符（与 sanitizeControlChars 互补，可被用户关掉）──
  {
    id: 'default-sanitize-ext-ascii',
    name: '清除扩展 ASCII 乱码（0x80-0x9F，如解码错误残留）',
    pattern: '[\\x80-\\x9F]',
    replacement: '',
    flags: 'g',
    enabled: true
  },
  {
    id: 'default-sanitize-zerowidth',
    name: '清除零宽空格、BOM、软连字符等隐藏字符',
    pattern: '[\\u200B-\\u200F\\u2028-\\u202F\\u2060\\uFEFF\\u00AD\\u007F]',
    replacement: '',
    flags: 'g',
    enabled: true
  },
  {
    id: 'default-sanitize-pua',
    name: '清除 Unicode 私用区乱码方块（U+E000–U+F8FF）',
    pattern: '[\\uE000-\\uF8FF]',
    replacement: '',
    flags: 'g',
    enabled: true
  },
  {
    id: 'default-nbsp-to-space',
    name: '不间断空格 / 全角空格 → 普通空格',
    pattern: '[\\u00A0\\u3000]',
    replacement: ' ',
    flags: 'g',
    enabled: true
  },

  // ── 页码 / 页眉常见格式 ──
  {
    id: 'default-page-number',
    name: '删除纯页码行（≤3 位数字，避开 4 位年份）',
    pattern: '^\\s*\\d{1,3}\\s*$',
    replacement: '',
    flags: 'gm',
    enabled: true
  },
  {
    id: 'default-page-zh',
    name: '删除「第 X 页」行',
    pattern: '^\\s*第\\s*\\d{1,4}\\s*页\\s*$',
    replacement: '',
    flags: 'gm',
    enabled: true
  },
  {
    id: 'default-page-en',
    name: '删除 “Page X” 行',
    pattern: '^\\s*[Pp]age\\s*\\d{1,4}\\s*$',
    replacement: '',
    flags: 'gm',
    enabled: true
  },
  {
    id: 'default-page-total',
    name: '删除「12 / 345」页码/总页数行',
    pattern: '^\\s*\\d{1,4}\\s*[/／]\\s*\\d{1,4}\\s*$',
    replacement: '',
    flags: 'gm',
    enabled: true
  },
  {
    id: 'default-page-dash',
    name: '删除「- 12 -」「— 12 —」居中页码行',
    pattern: '^\\s*[-–—·•]\\s*\\d{1,4}\\s*[-–—·•]\\s*$',
    replacement: '',
    flags: 'gm',
    enabled: true
  },
  {
    id: 'default-page-of',
    name: '删除 “12 of 345” 页码行',
    pattern: '^\\s*\\d{1,4}\\s+of\\s+\\d{1,4}\\s*$',
    replacement: '',
    flags: 'gmi',
    enabled: true
  },
  {
    id: 'default-issue-zh',
    name: '删除「第 X 期」「总第 X 期」行',
    pattern: '^\\s*(?:总)?第\\s*\\d{1,4}\\s*期\\s*$',
    replacement: '',
    flags: 'gm',
    enabled: true
  },
  {
    id: 'default-year-issue',
    name: '删除「2020 年第 3 期」类卷期行',
    pattern: '^\\s*\\d{4}\\s*年\\s*第\\s*\\d{1,3}\\s*期\\s*$',
    replacement: '',
    flags: 'gm',
    enabled: true
  },

  // ── 中文语境半角标点 → 全角 ──
  {
    id: 'default-punct-comma',
    name: '中文后半角逗号 → 全角',
    pattern: '(?<=[\\u4e00-\\u9fff]),',
    replacement: '，',
    flags: 'g',
    enabled: true
  },
  {
    id: 'default-punct-period',
    name: '中文后半角句号 → 全角',
    pattern: '(?<=[\\u4e00-\\u9fff])\\.',
    replacement: '。',
    flags: 'g',
    enabled: true
  },
  {
    id: 'default-punct-semicolon',
    name: '中文后半角分号 → 全角',
    pattern: '(?<=[\\u4e00-\\u9fff]);',
    replacement: '；',
    flags: 'g',
    enabled: true
  },
  {
    id: 'default-punct-colon',
    name: '中文后半角冒号 → 全角',
    pattern: '(?<=[\\u4e00-\\u9fff]):',
    replacement: '：',
    flags: 'g',
    enabled: true
  },
  {
    id: 'default-punct-question',
    name: '中文后半角问号 → 全角',
    pattern: '(?<=[\\u4e00-\\u9fff])\\?',
    replacement: '？',
    flags: 'g',
    enabled: true
  },
  {
    id: 'default-punct-exclaim',
    name: '中文后半角感叹号 → 全角',
    pattern: '(?<=[\\u4e00-\\u9fff])!',
    replacement: '！',
    flags: 'g',
    enabled: true
  },
  {
    id: 'default-punct-lparen',
    name: '中文后半角左括号 → 全角',
    pattern: '(?<=[\\u4e00-\\u9fff])\\(',
    replacement: '（',
    flags: 'g',
    enabled: true
  },
  {
    id: 'default-punct-rparen',
    name: '中文前半角右括号 → 全角',
    pattern: '\\)(?=[\\u4e00-\\u9fff])',
    replacement: '）',
    flags: 'g',
    enabled: true
  }
]
