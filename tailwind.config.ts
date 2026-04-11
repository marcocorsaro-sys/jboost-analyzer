import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#111318',
        card: '#1a1c24',
        card2: '#22252e',
        lime: '#c8e64a',
        'lime-dim': '#8ba832',
        gray: {
          DEFAULT: '#7a7f8d',
          l: '#b0b5c0',
        },
        green: '#10b981',
        red: '#ef4444',
        amber: '#f59e0b',
        teal: '#2dd4bf',
        border: '#2a2d38',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
