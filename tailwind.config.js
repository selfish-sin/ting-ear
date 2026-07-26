/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,tsx,ts,jsx,js}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 主色：偏靛紫蓝，阅读场景更沉稳，少一点「系统默认蓝」感
        primary: {
          DEFAULT: '#4F6EF7',
          50: '#F0F3FF',
          100: '#E0E7FF',
          200: '#C7D2FE',
          300: '#A5B4FC',
          400: '#818CF8',
          500: '#4F6EF7',
          600: '#3B5BDB',
          700: '#364FC7'
        },
        highlight: '#FEF3C7',
        'sentence-hover': '#F3F4F6',
        // 浅色表面层级
        surface: {
          DEFAULT: '#F8F9FC',
          raised: '#FFFFFF',
          muted: '#F1F3F9'
        },
        // 深色表面层级（偏亮灰蓝，避免发黑）
        'dark-bg': '#1C1F28',
        'dark-surface': '#262A35',
        'dark-raised': '#2F3442',
        'dark-border': '#3E4556',
        'dark-muted': '#2A2F3C'
      },
      fontFamily: {
        sans: [
          '"Segoe UI"',
          '"PingFang SC"',
          '"Microsoft YaHei UI"',
          '"Microsoft YaHei"',
          'system-ui',
          'sans-serif'
        ]
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.04)',
        card: '0 1px 3px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.06)',
        glow: '0 0 0 1px rgba(79, 110, 247, 0.12), 0 8px 24px rgba(79, 110, 247, 0.18)',
        nav: '1px 0 0 rgba(15, 23, 42, 0.04)'
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1rem'
      },
      keyframes: {
        'capture-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(79,110,247,0.45)' },
          '50%': { boxShadow: '0 0 0 7px rgba(79,110,247,0)' }
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        }
      },
      animation: {
        capture: 'capture-pulse 1.4s ease-in-out infinite',
        'fade-up': 'fade-up 0.25s ease-out'
      },
      zIndex: {
        dropdown: '100',
        overlay: '200',
        modal: '300',
        toast: '400',
        osd: '500'
      }
    }
  },
  plugins: []
}
