/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: 'var(--text-color)',
        cream: 'var(--bg-color)',
        border: 'var(--border-color)',
        surface: 'var(--surface-color)',
        surfaceAlt: 'var(--surface-alt)',
        textMuted: 'var(--text-muted)',
        accentText: 'var(--accent-text)',
        brutalRed: 'var(--accent-red)',
        brutalBlue: 'var(--accent-blue)',
        brutalYellow: 'var(--accent-yellow)',
      },
      boxShadow: {
        'brutal': '6px 6px 0px 0px var(--shadow-color)',
        'brutal-sm': '4px 4px 0px 0px var(--shadow-color)',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Space Grotesk', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
