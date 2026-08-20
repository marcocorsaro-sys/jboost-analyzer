import type { Config } from 'tailwindcss'
import { brand } from './lib/brand'

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        // JAKALA brand tokens (lib/brand.ts is the single source of truth).
        brand: {
          DEFAULT: brand.primary,
          hover: brand.primaryHover,
          soft: brand.primarySoft,
          ink: brand.ink,
          panel: brand.inkPanel,
          red: brand.accentRed,
          surface: brand.surface,
          surface2: brand.surface2,
        },

        // Legacy palette names (kept for backwards-compat with pre-existing
        // components), remapped onto the JAKALA palette: the old lime accent
        // is now the navy primary, old dark bg/card2 are light surfaces.
        bg: brand.bg,
        card2: brand.surface2,
        lime: brand.primary,
        'lime-dim': brand.muted,
        gray: {
          DEFAULT: brand.muted,
          l: '#3f4450',
        },
        green: brand.success,
        red: brand.error,
        amber: brand.warning,
        teal: brand.teal,

        // shadcn tokens (HSL CSS vars)
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Source Sans 3', 'system-ui', 'sans-serif'],
        // Mono kept for tabular data / micro-labels only (system stack, no webfont).
        mono: ['ui-monospace', 'SF Mono', 'Cascadia Mono', 'Menlo', 'monospace'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
