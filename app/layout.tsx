import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'JBoost Analyzer',
  description: 'SEO/GEO Analysis Platform — 9 Driver Framework',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
