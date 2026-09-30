/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f7ff',
          100: '#e0effe',
          200: '#bae0fd',
          300: '#7cc5fb',
          400: '#36a7f7',
          500: '#0c8ce9',
          600: '#026fc7',
          700: '#0358a1',
          800: '#074b85',
          900: '#0c3f6e',
        },
        // 源码中已在使用的 text-slate-850：Tailwind 3 默认色阶只有 800/900，
        // 此前该工具类不生成任何 CSS。取默认 slate-800 (#1e293b) 与 slate-900 (#0f172a) 的中点。
        slate: {
          850: '#172033',
        },
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
      },
      // 源码中已在使用的 w-4.5 / h-4.5：Tailwind 3 默认 spacing 刻度不含 4.5（4.5 × 0.25rem）。
      spacing: {
        4.5: '1.125rem',
      },
      // 源码中已在使用的 shadow-2xs / shadow-xs：Tailwind 3 默认 boxShadow 无此两档。
      // 取值与 Tailwind v4 官方同名令牌保持一致。
      boxShadow: {
        '2xs': '0 1px rgb(0 0 0 / 0.05)',
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
      },
      // 源码中已在使用的 animate-fade-in / animate-in：此前既无 keyframes 也无 animation 定义。
      // 这里给 animate-in 一个"淡入"的最小实现（与 markup 中同时出现的 fade-in 语义一致）。
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both',
        in: 'fade-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
}
