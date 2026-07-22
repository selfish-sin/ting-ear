import { create } from 'zustand'

interface QuickTextState {
  text: string
  setText: (text: string) => void
  appendText: (text: string) => void
  clear: () => void
}

export const useQuickTextStore = create<QuickTextState>((set) => ({
  text: '',
  setText: (text) => set({ text }),
  appendText: (text) => set((s) => ({ text: s.text ? s.text + '\n\n' + text : text })),
  clear: () => set({ text: '' })
}))
