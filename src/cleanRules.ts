/**
 * 清洗格式正则规则 —— 前后端共享的单一数据源。
 *
 * 用户在「设置 → 清洗」中编辑的规则列表即此结构；主进程 enhancedClean
 * 按顺序应用这些规则。默认值复刻了原 enhancedClean 中纯正则相关的清洗行为
 * （去页码/页眉正则 + 半角标点转全角），结构性清洗（合硬断行、CJK 空格、
 * 空行压缩、单字母竖排合并、重复页眉）仍由 enhancedClean 始终执行。
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
  {
    id: 'default-sanitize-ext-ascii',
    name: '清除扩展 ASCII 乱码（0x80-0x9F，如 ¸ 等解码错误残留）',
    pattern: '[\\x80-\\x9F]',
    replacement: '',
    flags: 'g',
    enabled: true
  },
  {
    id: 'default-sanitize-zerowidth',
    name: '清除零宽空格、BOM 等隐藏干扰字符',
    pattern: '[\\u200B-\\u200D\\uFEFF\\u007F]',
    replacement: '',
    flags: 'g',
    enabled: true
  },
  {
    id: 'default-page-number',
    name: '删除纯页码行（≤3 位，避开 4 位年份）',
    pattern: '^\\d{1,3}$',
    replacement: '',
    flags: 'gm',
    enabled: true
  },
  {
    id: 'default-page-zh',
    name: '删除“第 X 页”',
    pattern: '^第\\s*\\d{1,4}\\s*页$',
    replacement: '',
    flags: 'gm',
    enabled: true
  },
  {
    id: 'default-page-en',
    name: '删除“Page X”',
    pattern: '^[Pp]age\\s*\\d{1,4}$',
    replacement: '',
    flags: 'gm',
    enabled: true
  },
  {
    id: 'default-page-total',
    name: '删除“12 / 345”页码/总页数',
    pattern: '^\\d{1,4}\\s*\\/\\s*\\d{1,4}$',
    replacement: '',
    flags: 'gm',
    enabled: true
  },
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
    name: '中文前半年右括号 → 全角',
    pattern: '\\)(?=[\\u4e00-\\u9fff])',
    replacement: '）',
    flags: 'g',
    enabled: true
  }
]
