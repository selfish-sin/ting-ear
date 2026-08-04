/** 内置背景图预设元数据。图片文件在 resources/backgrounds/，打包到 resourcesPath/backgrounds/。 */
export interface PresetBg {
  id: string
  name: string
  /** 文件名，对应 resources/backgrounds/ 下的图片 */
  file: string
}

export const PRESET_BACKGROUNDS: PresetBg[] = [
  { id: 'aurora', name: '极光', file: 'aurora.jpg' },
  { id: 'dusk', name: '黄昏', file: 'dusk.jpg' },
  { id: 'forest', name: '深林', file: 'forest.jpg' },
  { id: 'ocean', name: '远海', file: 'ocean.jpg' },
  { id: 'mountain', name: '山峦', file: 'mountain.jpg' },
  { id: 'nebula', name: '星云', file: 'nebula.jpg' }
]
