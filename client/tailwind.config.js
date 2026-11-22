/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#F4F2ED',
        surface: '#FFFFFF',
        'surface-2': '#FBF9F5',
        ink: '#1A1E24',
        graphite: '#1B2027',
        muted: '#737B86',
        line: '#E4E0D8',
        accent: {
          DEFAULT: '#D85B2A',
          soft: '#FBEEE7',
          dark: '#C44F22',
        },
        ok: {
          DEFAULT: '#2E8B65',
          soft: '#E7F4EE',
        },
        warn: {
          DEFAULT: '#C58A20',
          soft: '#FCF3E0',
        },
        bad: {
          DEFAULT: '#C4453B',
          soft: '#FBEAE8',
        },
      },
      fontFamily: {
        display: ['Space Grotesk', 'Noto Sans SC', 'sans-serif'],
        body: ['Noto Sans SC', 'Space Grotesk', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(27,32,39,.04), 0 10px 28px rgba(27,32,39,.05)',
        pop: '0 24px 70px rgba(0,0,0,.24)',
      },
      borderRadius: {
        card: '12px',
      },
    },
  },
  plugins: [],
};
