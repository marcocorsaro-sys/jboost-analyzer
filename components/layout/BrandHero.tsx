'use client'

import * as React from 'react'

import { B } from '@/lib/brand'

interface BrandHeroProps {
  /** White title over the navy band. */
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Actions (CTA buttons, …) rendered under the title. */
  children?: React.ReactNode
  /** Full-bleed photo from /public/brand (jakala.com language). */
  image?: string
  /** Band height in px. */
  height?: number
  className?: string
}

/**
 * BrandHero — the JAKALA full-bleed band: photo + navy gradient overlay +
 * white title (jakala.com visual language). Used on /home and /login.
 *
 * Photography is optional by design: /public/brand ships empty (see its
 * README — drop hero-1.jpg / hero-2.jpg from the JAKALA media kit there).
 * When the image is missing (onError) the band falls back to an elegant
 * navy gradient with the translucent "goccia" drop motif, so the brand
 * reads correctly with zero assets.
 */
export function BrandHero({
  title,
  subtitle,
  children,
  image = '/brand/hero-1.jpg',
  height = 260,
  className,
}: BrandHeroProps) {
  const [imageOk, setImageOk] = React.useState(true)

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: B.radiusLg,
        minHeight: `${height}px`,
        display: 'flex',
        alignItems: 'flex-end',
        // Fallback base: deep navy gradient (always painted; the photo and
        // overlay stack on top when the asset exists).
        background: `linear-gradient(135deg, ${B.primary} 0%, ${B.inkPanel} 70%)`,
      }}
    >
      {imageOk && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          aria-hidden
          onError={() => setImageOk(false)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      )}

      {/* Navy gradient overlay (jakala.com: dark overlay on full-bleed photo) */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(120deg, ${B.heroOverlayFrom} 0%, ${B.heroOverlayTo} 100%)`,
        }}
      />

      {/* "Gocce" motif — translucent blue drops, the Jakala decorative mark. */}
      <svg
        aria-hidden
        viewBox="0 0 600 260"
        preserveAspectRatio="xMaxYMid slice"
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          height: '100%',
          width: 'auto',
          opacity: 0.55,
          pointerEvents: 'none',
        }}
      >
        <path
          d="M470 30c40 52 64 88 64 122a64 64 0 1 1-128 0c0-34 24-70 64-122Z"
          fill="#4353ff"
          fillOpacity="0.35"
        />
        <path
          d="M560 120c26 34 42 58 42 80a42 42 0 1 1-84 0c0-22 16-46 42-80Z"
          fill="#8a94ff"
          fillOpacity="0.30"
        />
        <circle cx="420" cy="210" r="26" fill="#b7bdff" fillOpacity="0.25" />
      </svg>

      <div style={{ position: 'relative', padding: '36px 40px', maxWidth: '760px' }}>
        <div
          style={{
            color: B.onPrimary,
            fontSize: 'clamp(40px, 5vw, 64px)',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            lineHeight: 1.05,
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              color: 'rgba(255, 255, 255, 0.85)',
              fontSize: '18px',
              lineHeight: 1.5,
              marginTop: '12px',
              fontWeight: 400,
            }}
          >
            {subtitle}
          </div>
        )}
        {children && <div style={{ marginTop: '24px' }}>{children}</div>}
      </div>
    </div>
  )
}

export default BrandHero
