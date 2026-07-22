/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,tsx,ts,jsx,js}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#3B82F6',
        highlight: '#FFF3CD',
        'sentence-hover': '#F3F4F6',
        'dark-bg': '#1F2937',
        'dark-surface': '#374151',
        'dark-border': '#4B5563'
      },
      fontFamily: {
        sans: ['Microsoft YaHei', 'PingFang SC', 'sans-serif']
      },
      keyframes: {
        'capture-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(59,130,246,0.45)' },
          '50%': { boxShadow: '0 0 0 7px rgba(59,130,246,0)' }
        }
      },
      animation: {
        capture: 'capture-pulse 1.4s ease-in-out infinite'
      }
    }
  },
  plugins: []
}
