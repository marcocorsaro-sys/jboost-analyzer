/**
 * Wappalyzer-style fingerprints, starter pack curato per JBoost Analyzer.
 *
 * Copre ~50 tecnologie tra le più diffuse sui siti dei clienti Jakala:
 * CMS, e-commerce, analytics, tag manager, ad platforms, CDN, A/B testing,
 * marketing automation, chatbot, consent banner, schema generators.
 *
 * NON è il dataset completo Wappalyzer (~3000 fingerprints). È un subset
 * pragmatico che possiamo estendere senza limiti man mano che incontriamo
 * tecnologie nuove sui clienti.
 *
 * Schema fingerprint
 * ------------------
 * Ogni fingerprint dichiara il `name` della tecnologia e `category`
 * (Gartner-friendly tassonomia). I match avvengono su quattro segnali:
 *
 *   - htmlContains: pattern (regex string) presente nell'HTML body
 *   - htmlPattern: regex compilata in fase di match
 *   - headerKey + headerValuePattern: header HTTP che deve contenere
 *     il pattern (es. Server: cloudflare)
 *   - scriptPattern: regex su tutti gli `src` di <script> tag (utile per
 *     CDN o vendor SaaS che si caricano via <script src="...">)
 *   - metaName + metaContentPattern: meta tag (es. <meta name="generator">)
 *   - cookiePattern: regex su nomi di cookie ricevuti via Set-Cookie
 *
 * `confidence` è un valore 0..100 che indica quanto è specifico il match.
 * Es: <meta name="generator" content="WordPress 6.5"> → 100. Pattern
 * regex generico su class name → 50. Un match vince se confidence >= 30.
 */

export type FingerprintCategory =
  | 'CMS'
  | 'E-commerce'
  | 'Analytics'
  | 'Tag Manager'
  | 'Ad Platform'
  | 'A/B Testing'
  | 'Marketing Automation'
  | 'Email Marketing'
  | 'CRM'
  | 'Chatbot'
  | 'Consent Banner'
  | 'CDN'
  | 'Hosting'
  | 'Web Framework'
  | 'JS Library'
  | 'Cookie Manager'
  | 'Performance'
  | 'Personalization'
  | 'Schema Generator'
  | 'Other'

export interface Fingerprint {
  name: string
  category: FingerprintCategory
  /** URL della homepage del vendor — utile nel report. */
  website?: string
  /** Logo/icona per UI futuro. Slug short che useremo poi per asset internal. */
  iconSlug?: string
  /** Match HTML body contains (regex). Confidence 60. */
  htmlPattern?: RegExp
  /** Match HTTP header (regex). Confidence 80. */
  headerKey?: string
  headerValuePattern?: RegExp
  /** Match script src URL (regex). Confidence 70. */
  scriptPattern?: RegExp
  /** Match meta tag content. Confidence 100. */
  metaName?: string
  metaContentPattern?: RegExp
  /** Match cookie name (regex). Confidence 70. */
  cookiePattern?: RegExp
  /** Optional version capture: una named group `version` nel regex chosen. */
  versionFrom?: 'meta' | 'header' | 'script' | 'html'
}

export const FINGERPRINTS: Fingerprint[] = [
  // ---------- CMS ----------
  {
    name: 'WordPress',
    category: 'CMS',
    website: 'https://wordpress.org',
    iconSlug: 'wordpress',
    metaName: 'generator',
    metaContentPattern: /WordPress\s*(?<version>[\d.]+)?/i,
    versionFrom: 'meta',
  },
  {
    name: 'Drupal',
    category: 'CMS',
    metaName: 'generator',
    metaContentPattern: /Drupal\s*(?<version>[\d.]+)?/i,
    versionFrom: 'meta',
  },
  {
    name: 'Joomla',
    category: 'CMS',
    metaName: 'generator',
    metaContentPattern: /Joomla(!?)\s*(?<version>[\d.]+)?/i,
    versionFrom: 'meta',
  },
  {
    name: 'Webflow',
    category: 'CMS',
    metaName: 'generator',
    metaContentPattern: /Webflow/i,
    headerKey: 'x-powered-by',
    headerValuePattern: /webflow/i,
  },
  {
    name: 'Wix',
    category: 'CMS',
    metaName: 'generator',
    metaContentPattern: /Wix\.com/i,
  },
  {
    name: 'Squarespace',
    category: 'CMS',
    metaName: 'generator',
    metaContentPattern: /Squarespace/i,
  },
  {
    name: 'HubSpot CMS',
    category: 'CMS',
    metaName: 'generator',
    metaContentPattern: /HubSpot/i,
    // fallback signals: hubfs (CDN HubSpot), hs-cos (template engine),
    // hs/scriptloader (loader concatenato), classic external scripts.
    htmlPattern: /hubfs\/|hs-cos|\/hs\/scriptloader|js\.hs-scripts\.com|hs-analytics\.net/i,
    versionFrom: 'meta',
  },
  {
    name: 'Adobe Experience Manager',
    category: 'CMS',
    htmlPattern: /\/etc\.clientlibs\/|\/content\/dam\//i,
  },
  {
    name: 'Contentful',
    category: 'CMS',
    scriptPattern: /(images\.ctfassets\.net|\.contentful\.com)/i,
  },

  // ---------- E-commerce ----------
  {
    name: 'Shopify',
    category: 'E-commerce',
    htmlPattern: /Shopify\.theme|cdn\.shopify\.com/i,
  },
  {
    name: 'Magento',
    category: 'E-commerce',
    htmlPattern: /Magento_|\/static\/version\d+\/frontend\//i,
    headerKey: 'x-magento-cache-debug',
    headerValuePattern: /./,
  },
  {
    name: 'WooCommerce',
    category: 'E-commerce',
    htmlPattern: /woocommerce|wc-block/i,
  },
  {
    name: 'PrestaShop',
    category: 'E-commerce',
    metaName: 'generator',
    metaContentPattern: /PrestaShop\s*(?<version>[\d.]+)?/i,
    versionFrom: 'meta',
  },
  {
    name: 'BigCommerce',
    category: 'E-commerce',
    htmlPattern: /cdn\d?\.bigcommerce\.com/i,
  },

  // ---------- Analytics ----------
  {
    name: 'Google Analytics 4',
    category: 'Analytics',
    // GA4 può essere caricato sia come script src esterno
    // (googletagmanager.com/gtag/js?id=G-XXX) sia inline tramite la funzione
    // gtag('config', 'G-XXX'). Match entrambi.
    scriptPattern: /googletagmanager\.com\/gtag\/js\?id=G-/i,
    htmlPattern: /gtag\s*\(\s*['"]config['"]\s*,\s*['"]G-[A-Z0-9]+['"]|googletagmanager\.com\/gtag\/js\?id=G-/i,
  },
  {
    name: 'Universal Analytics',
    category: 'Analytics',
    scriptPattern: /google-analytics\.com\/(analytics|ga)\.js/i,
  },
  {
    name: 'Adobe Analytics',
    category: 'Analytics',
    scriptPattern: /\.omtrdc\.net|\.sc\.omtrdc\.net|s_code\.js|AppMeasurement/i,
  },
  {
    name: 'Matomo',
    category: 'Analytics',
    scriptPattern: /matomo\.js|piwik\.js/i,
  },
  {
    name: 'Plausible',
    category: 'Analytics',
    scriptPattern: /plausible\.io\/js\/script/i,
  },
  {
    name: 'Hotjar',
    category: 'Analytics',
    scriptPattern: /static\.hotjar\.com|hotjar-/i,
  },
  {
    name: 'Microsoft Clarity',
    category: 'Analytics',
    scriptPattern: /clarity\.ms\/tag/i,
  },

  // ---------- Tag Manager ----------
  {
    name: 'Google Tag Manager',
    category: 'Tag Manager',
    // GTM viene caricato di norma con inline snippet `gtm.js?id=GTM-XXX`
    // o come <iframe src="...ns.html?id=GTM-XXX"> noscript fallback.
    // Quindi cerchiamo entrambi i pattern, sia in script src che nel body.
    scriptPattern: /googletagmanager\.com\/(gtm|gtag)\.js/i,
    htmlPattern: /googletagmanager\.com\/(gtm|ns)\.(?:js|html)\?id=GTM-/i,
  },
  {
    name: 'Adobe Launch',
    category: 'Tag Manager',
    scriptPattern: /assets\.adobedtm\.com/i,
  },
  {
    name: 'Tealium iQ',
    category: 'Tag Manager',
    scriptPattern: /tags\.tiqcdn\.com/i,
  },

  // ---------- Ad Platforms ----------
  {
    name: 'Meta Pixel',
    category: 'Ad Platform',
    htmlPattern: /connect\.facebook\.net\/[^"]+\/fbevents\.js|fbq\(/i,
  },
  {
    name: 'LinkedIn Insight',
    category: 'Ad Platform',
    scriptPattern: /snap\.licdn\.com\/li\.lms-analytics/i,
  },
  {
    name: 'TikTok Pixel',
    category: 'Ad Platform',
    htmlPattern: /analytics\.tiktok\.com|ttq\.load/i,
  },
  {
    name: 'Google Ads Conversion',
    category: 'Ad Platform',
    htmlPattern: /googleadservices\.com\/pagead\/conversion/i,
  },

  // ---------- A/B Testing ----------
  {
    name: 'Optimizely',
    category: 'A/B Testing',
    scriptPattern: /cdn\.optimizely\.com/i,
  },
  {
    name: 'VWO',
    category: 'A/B Testing',
    scriptPattern: /dev\.visualwebsiteoptimizer\.com/i,
  },
  {
    name: 'Google Optimize',
    category: 'A/B Testing',
    scriptPattern: /optimize\.google\.com\/optimize\.js/i,
  },

  // ---------- Marketing Automation / Email ----------
  {
    name: 'HubSpot',
    category: 'Marketing Automation',
    scriptPattern: /js\.hs-scripts\.com|js\.hsforms\.net/i,
  },
  {
    name: 'Marketo',
    category: 'Marketing Automation',
    scriptPattern: /munchkin\.marketo\.net/i,
  },
  {
    name: 'Salesforce Pardot',
    category: 'Marketing Automation',
    scriptPattern: /pi\.pardot\.com/i,
  },
  {
    name: 'Mailchimp',
    category: 'Email Marketing',
    htmlPattern: /chimpstatic\.com|list-manage\.com/i,
  },
  {
    name: 'Klaviyo',
    category: 'Email Marketing',
    scriptPattern: /static\.klaviyo\.com|klaviyo-cdn/i,
  },

  // ---------- Chatbot ----------
  {
    name: 'Intercom',
    category: 'Chatbot',
    scriptPattern: /js\.intercomcdn\.com|widget\.intercom\.io/i,
  },
  {
    name: 'Zendesk Chat',
    category: 'Chatbot',
    scriptPattern: /static\.zdassets\.com\/ekr/i,
  },
  {
    name: 'Drift',
    category: 'Chatbot',
    scriptPattern: /js\.driftt\.com|widget\.drift\.com/i,
  },

  // ---------- Consent Banner / Cookie Manager ----------
  {
    name: 'OneTrust',
    category: 'Consent Banner',
    scriptPattern: /cdn\.cookielaw\.org|onetrust-cdn/i,
  },
  {
    name: 'Cookiebot',
    category: 'Consent Banner',
    scriptPattern: /consent\.cookiebot\.com/i,
  },
  {
    name: 'Iubenda',
    category: 'Consent Banner',
    scriptPattern: /cdn\.iubenda\.com/i,
  },
  {
    name: 'Usercentrics',
    category: 'Consent Banner',
    scriptPattern: /app\.usercentrics\.eu|privacy-proxy\.usercentrics\.eu/i,
  },

  // ---------- CDN / Hosting ----------
  {
    name: 'Cloudflare',
    category: 'CDN',
    headerKey: 'server',
    headerValuePattern: /cloudflare/i,
  },
  {
    name: 'Akamai',
    category: 'CDN',
    headerKey: 'server',
    headerValuePattern: /AkamaiGHost/i,
  },
  {
    name: 'Fastly',
    category: 'CDN',
    headerKey: 'x-served-by',
    headerValuePattern: /cache-/i,
  },
  {
    name: 'AWS CloudFront',
    category: 'CDN',
    headerKey: 'x-amz-cf-id',
    headerValuePattern: /./,
  },
  {
    name: 'Vercel',
    category: 'Hosting',
    headerKey: 'server',
    headerValuePattern: /Vercel/i,
  },
  {
    name: 'Netlify',
    category: 'Hosting',
    headerKey: 'server',
    headerValuePattern: /Netlify/i,
  },

  // ---------- Web Framework ----------
  {
    name: 'Next.js',
    category: 'Web Framework',
    headerKey: 'x-powered-by',
    headerValuePattern: /Next\.js/i,
  },
  {
    name: 'Nuxt.js',
    category: 'Web Framework',
    htmlPattern: /__NUXT__|window\.__NUXT__/i,
  },
  {
    name: 'React',
    category: 'JS Library',
    htmlPattern: /data-reactroot|__REACT_DEVTOOLS_GLOBAL_HOOK__/i,
  },
  {
    name: 'Swiper',
    category: 'JS Library',
    scriptPattern: /swiper(?:-bundle)?\.(?:min\.)?js/i,
  },
  {
    name: 'GSAP',
    category: 'JS Library',
    scriptPattern: /gsap(?:\.min)?\.js|TweenMax|ScrollTrigger/i,
  },

  // ---------- Performance / Personalization ----------
  {
    name: 'New Relic',
    category: 'Performance',
    scriptPattern: /js-agent\.newrelic\.com/i,
  },
  {
    name: 'Datadog RUM',
    category: 'Performance',
    scriptPattern: /www\.datadoghq-browser-agent\.com/i,
  },
  {
    name: 'Dynamic Yield',
    category: 'Personalization',
    scriptPattern: /dynamicyield\.com/i,
  },
]
