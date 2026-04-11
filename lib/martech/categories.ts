export interface MartechCategoryDef {
  key: string
  label: string
  icon: string
  description: string
  area: 'platform' | 'data' | 'acquisition' | 'experience' | 'infrastructure' | 'governance'
}

/**
 * Enterprise-grade MarTech categories aligned with Accenture/Gartner taxonomy.
 * Grouped by strategic area for executive-level reporting.
 */
export const MARTECH_CATEGORIES: MartechCategoryDef[] = [
  // ── Platform & Content ──
  { key: 'cms', label: 'CMS / DXP', icon: '◧', description: 'Content Management & Digital Experience Platform', area: 'platform' },
  { key: 'ecommerce', label: 'E-Commerce', icon: '◉', description: 'E-Commerce Platform & Cart', area: 'platform' },
  { key: 'frontend_framework', label: 'Frontend Framework', icon: '⊞', description: 'Frontend JS Framework & Rendering', area: 'platform' },
  { key: 'hosting', label: 'Hosting / PaaS', icon: '◎', description: 'Hosting, PaaS & Deployment', area: 'platform' },

  // ── Data & Analytics ──
  { key: 'analytics', label: 'Web Analytics', icon: '◎', description: 'Web Analytics, Behavioral Tracking & BI', area: 'data' },
  { key: 'tag_manager', label: 'Tag Management', icon: '⊕', description: 'Tag Management & Data Layer', area: 'data' },
  { key: 'customer_data', label: 'CDP / DMP', icon: '◬', description: 'Customer Data Platform & Data Management', area: 'data' },
  { key: 'session_recording', label: 'Session Recording', icon: '◫', description: 'Session Recording, Heatmaps & UX Analytics', area: 'data' },
  { key: 'ab_testing', label: 'A/B Testing', icon: '◫', description: 'A/B Testing, Experimentation & Feature Flags', area: 'data' },

  // ── Acquisition & Marketing ──
  { key: 'ad_platforms', label: 'Advertising', icon: '◉', description: 'Advertising Pixels, Retargeting & Attribution', area: 'acquisition' },
  { key: 'seo', label: 'SEO & Structured Data', icon: '⊕', description: 'SEO Tools, Schema.org & Search Optimization', area: 'acquisition' },
  { key: 'social', label: 'Social & OG', icon: '◎', description: 'Social Media Integration, Pixels & OpenGraph', area: 'acquisition' },
  { key: 'marketing_automation', label: 'Marketing Automation', icon: '⚡', description: 'Marketing Automation & Campaign Management', area: 'acquisition' },
  { key: 'email_platform', label: 'Email Platform', icon: '◈', description: 'Email Marketing & Transactional Email', area: 'acquisition' },
  { key: 'crm', label: 'CRM', icon: '◬', description: 'Customer Relationship Management', area: 'acquisition' },
  { key: 'affiliate', label: 'Affiliate / Referral', icon: '⊞', description: 'Affiliate Marketing & Referral Programs', area: 'acquisition' },

  // ── Experience & Engagement ──
  { key: 'personalization', label: 'Personalizzazione', icon: '⊞', description: 'Personalization, Recommendations & AI', area: 'experience' },
  { key: 'chat_support', label: 'Chat & Support', icon: '◈', description: 'Live Chat, Chatbot & Customer Support', area: 'experience' },
  { key: 'consent_management', label: 'Consent / CMP', icon: '◬', description: 'Cookie Consent & Privacy Management', area: 'experience' },
  { key: 'accessibility', label: 'Accessibilità', icon: '◧', description: 'Accessibility Overlays & Compliance Tools', area: 'experience' },
  { key: 'fonts_media', label: 'Fonts & Media', icon: '◫', description: 'Web Fonts, Typography & Media Services', area: 'experience' },
  { key: 'ux_widgets', label: 'UX & Widgets', icon: '⊕', description: 'UX Components, Reviews, Popups & Notifications', area: 'experience' },

  // ── Infrastructure & Performance ──
  { key: 'cdn', label: 'CDN', icon: '◉', description: 'Content Delivery Network & Edge Computing', area: 'infrastructure' },
  { key: 'performance', label: 'Performance', icon: '⚙', description: 'Performance Monitoring, RUM & Optimization', area: 'infrastructure' },
  { key: 'security', label: 'Security & WAF', icon: '◬', description: 'Security, WAF, Bot Protection & DDoS', area: 'infrastructure' },
  { key: 'dns', label: 'DNS & SSL', icon: '◧', description: 'DNS Provider, SSL Certificate & Domain Services', area: 'infrastructure' },
  { key: 'image_optimization', label: 'Image Optimization', icon: '◎', description: 'Image CDN, Optimization & Lazy Loading', area: 'infrastructure' },

  // ── Governance ──
  { key: 'error_monitoring', label: 'Error Monitoring', icon: '◈', description: 'Error Tracking, Logging & Observability', area: 'governance' },
  { key: 'payment', label: 'Payment', icon: '⊞', description: 'Payment Processing & Checkout', area: 'governance' },
  { key: 'other', label: 'Altro', icon: '◫', description: 'Other Detected Technologies', area: 'governance' },
]

export const CATEGORY_MAP: Record<string, MartechCategoryDef> = Object.fromEntries(
  MARTECH_CATEGORIES.map(c => [c.key, c])
)

export const AREA_LABELS: Record<string, string> = {
  platform: 'Platform & Content',
  data: 'Data & Intelligence',
  acquisition: 'Acquisition & Marketing',
  experience: 'Experience & Engagement',
  infrastructure: 'Infrastructure & Performance',
  governance: 'Governance & Operations',
}
