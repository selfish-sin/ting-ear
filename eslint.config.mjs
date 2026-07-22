import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', '*.bak-*']
  },
  // 主进程 (Node.js) — 允许 require()
  {
    files: ['electron/**/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off'
    }
  },
  // 渲染进程 (React)
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'react-hooks/exhaustive-deps': 'off'
    }
  }
)
