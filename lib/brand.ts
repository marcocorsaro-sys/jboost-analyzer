/**
 * JAKALA brand design tokens — the single source of truth for the visual
 * identity (white layout, navy "goccia blu" primary, red used sparingly).
 *
 * Every inline style in the app imports from here (usually as `B`), the CSS
 * variables in app/globals.css mirror these values, and tailwind.config.ts
 * imports this module directly. Changing one hex here rebrands the app.
 *
 * Derived from jakala.com: white surfaces, deep navy #040066 primary, near-
 * black ink, red #f00a0a reserved for the mark / critical alerts only.
 */

export const brand = {
  // ── Surfaces ─────────────────────────────────────────────────────────────
  bg: '#ffffff', // page background
  surface: '#f5f6f8', // cards / raised panels
  surface2: '#eceef2', // insets, hovers, code/console blocks
  border: '#e2e5ea',

  // ── Text ─────────────────────────────────────────────────────────────────
  ink: '#0b0b14', // primary text
  muted: '#5c6270', // secondary text (AA on white)
  mutedLight: '#8a90a0', // decorative / disabled only — NOT body text (< AA)

  // ── Brand ────────────────────────────────────────────────────────────────
  primary: '#040066', // JAKALA navy ("goccia blu")
  primaryHover: '#0a0a8f',
  primarySoft: '#eef0ff', // chip / selection backgrounds
  onPrimary: '#ffffff', // text on primary
  accentRed: '#f00a0a', // brand red — mark, critical alerts ONLY
  inkPanel: '#06062e', // dark contrast band (hero, footer, top rail)

  // ── Semantics (AA-checked on white; error darkened from accentRed) ───────
  success: '#0f8a5f',
  warning: '#a16207',
  error: '#d90808',
  teal: '#0f766e', // "good" score band
  info: '#0369a1',

  // ── Charts (client = navy, competitors = navy declinations) ──────────────
  chartClient: '#040066',
  chartCompetitors: ['#4353ff', '#8a94ff', '#b7bdff'] as string[],
  chartGrid: '#e2e5ea',

  // ── Misc ─────────────────────────────────────────────────────────────────
  overlay: 'rgba(11, 11, 20, 0.5)', // modal backdrops
  heroOverlayFrom: 'rgba(4, 0, 102, 0.82)', // BrandHero gradient over photos
  heroOverlayTo: 'rgba(6, 6, 46, 0.55)',

  // ── Typography ───────────────────────────────────────────────────────────
  // Source Sans 3 is loaded via next/font in app/layout.tsx → --font-sans.
  fontSans: "var(--font-sans, 'Source Sans 3', system-ui), system-ui, sans-serif",
  fontMono: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, monospace",

  // ── Spacing / radii used by inline-styled components ─────────────────────
  radiusSm: '8px',
  radiusMd: '10px',
  radiusLg: '16px',

  // ── Radius scale (premium SaaS: generous card radius, pill chips) ────────
  radius: {
    card: '16px',
    control: '12px',
    input: '10px',
    pill: '999px',
  },

  // ── Elevation (subtle navy-tinted shadows; hover lifts the card) ─────────
  shadow: {
    card: '0 1px 2px rgba(4, 0, 102, 0.05)',
    cardHover: '0 8px 24px rgba(4, 0, 102, 0.10)',
    dialog: '0 24px 64px rgba(4, 0, 102, 0.18)',
  },

  // ── Motion ───────────────────────────────────────────────────────────────
  transition: 'all 150ms ease',

  // ── Typographic scale (big numbers, strong hierarchy, air) ───────────────
  // Read these from components instead of hardcoding px sizes.
  type: {
    /** Hero numbers — driver scores, LEADER-INDEX. */
    display: { fontSize: '64px', lineHeight: 1.05, fontWeight: 800, letterSpacing: '-0.02em' },
    /** Secondary big numbers — competitor chips, stat tiles. */
    displaySm: { fontSize: '40px', lineHeight: 1.1, fontWeight: 750, letterSpacing: '-0.02em' },
    /** Page title — one per page. */
    h1: { fontSize: '34px', lineHeight: 1.15, fontWeight: 750, letterSpacing: '-0.02em' },
    /** Section title. */
    h2: { fontSize: '22px', lineHeight: 1.2, fontWeight: 700, letterSpacing: '-0.01em' },
    /** Card / sub-section title. */
    h3: { fontSize: '18px', lineHeight: 1.3, fontWeight: 700, letterSpacing: '-0.01em' },
    /** Body copy. */
    body: { fontSize: '16px', lineHeight: 1.55, fontWeight: 400 },
    /** Secondary body (muted text — never smaller than this). */
    bodySm: { fontSize: '14px', lineHeight: 1.5, fontWeight: 400 },
    /** Micro-label — the ONLY sub-14px size allowed: uppercase, wide tracking. */
    label: {
      fontSize: '13px',
      lineHeight: 1.3,
      fontWeight: 600,
      letterSpacing: '0.08em',
      textTransform: 'uppercase' as const,
    },
    /** Numeric alignment for scores and table numbers. */
    num: { fontVariantNumeric: 'tabular-nums' as const },
  },
} as const

/** Short alias used pervasively in inline styles. */
export const B = brand

export type Brand = typeof brand
