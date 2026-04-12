/* ═══════════════════════════════════════════════════════════════════════════
 * Deterministic MarTech Pattern Matcher
 * Wappalyzer-style rules for detecting technologies from HTTP signals.
 *
 * This module is ZERO-dependency and fully deterministic (no AI calls).
 * It complements the AI-based detect.ts by providing a fast first-pass
 * scan that can run without API keys and adds baseline coverage.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── Public types ── */

export interface PatternMatch {
  category: string
  tool_name: string
  confidence: number
  evidence: string
  tool_version?: string | null
}

export interface PatternRule {
  tool_name: string
  category: string
  headers?: Record<string, RegExp>
  cookies?: RegExp[]
  scriptUrls?: RegExp[]
  html?: RegExp[]
  meta?: { name?: RegExp; content?: RegExp }[]
  urls?: string[]
}

/* ═══════════════════════════════════════════════════════════════════════════
 * DETECTION PATTERNS (150+ rules)
 *
 * Category keys are aligned with categories.ts
 * ═══════════════════════════════════════════════════════════════════════════ */

export const DETECTION_PATTERNS: PatternRule[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // ANALYTICS (20+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Google Analytics 4',
    category: 'analytics',
    scriptUrls: [
      /googletagmanager\.com\/gtag\/js\?id=G-/i,
      /google-analytics\.com\/g\/collect/i,
    ],
    html: [
      /gtag\s*\(\s*['"]config['"]\s*,\s*['"]G-[A-Z0-9]+['"]/i,
      /['"]G-[A-Z0-9]{4,12}['"]/,
    ],
    cookies: [
      /^_ga$/,
      /^_ga_[A-Z0-9]+$/,
    ],
  },
  {
    tool_name: 'Universal Analytics',
    category: 'analytics',
    scriptUrls: [
      /google-analytics\.com\/analytics\.js/i,
      /google-analytics\.com\/ga\.js/i,
    ],
    html: [
      /['"]UA-\d{4,10}-\d{1,4}['"]/,
      /ga\s*\(\s*['"]create['"]\s*,\s*['"]UA-/i,
      /_gaq\.push/i,
    ],
    cookies: [
      /^_ga$/,
      /^__utma$/,
      /^__utmb$/,
      /^__utmz$/,
    ],
  },
  {
    tool_name: 'Adobe Analytics',
    category: 'analytics',
    scriptUrls: [
      /AppMeasurement[._-]?(?:js)?/i,
      /s_code\.js/i,
      /\.2o7\.net/i,
      /omtrdc\.net/i,
      /demdex\.net/i,
    ],
    html: [
      /s\.t\(\)\s*;/,
      /s_account\s*=/i,
      /omniture/i,
      /new\s+AppMeasurement/i,
    ],
    cookies: [
      /^s_cc$/,
      /^s_sq$/,
      /^s_vi$/,
      /^s_fid$/,
      /^AMCV_/,
    ],
  },
  {
    tool_name: 'Matomo',
    category: 'analytics',
    scriptUrls: [
      /matomo\.js/i,
      /piwik\.js/i,
    ],
    html: [
      /_paq\.push/i,
      /matomo\.php/i,
      /piwik\.php/i,
    ],
    cookies: [
      /^_pk_id\./,
      /^_pk_ses\./,
    ],
  },
  {
    tool_name: 'Amplitude',
    category: 'analytics',
    scriptUrls: [
      /cdn\.amplitude\.com/i,
      /amplitude\.com\/libs/i,
    ],
    html: [
      /amplitude\.getInstance/i,
      /amplitude\.init/i,
    ],
  },
  {
    tool_name: 'Mixpanel',
    category: 'analytics',
    scriptUrls: [
      /cdn\.mxpnl\.com/i,
      /mixpanel\.com\/libs/i,
    ],
    html: [
      /mixpanel\.init/i,
      /mixpanel\.track/i,
    ],
    cookies: [
      /^mp_[a-f0-9]+_mixpanel$/,
    ],
  },
  {
    tool_name: 'Heap',
    category: 'analytics',
    scriptUrls: [
      /heapanalytics\.com/i,
      /cdn\.heapanalytics\.com/i,
    ],
    html: [
      /heap\.load\s*\(/i,
      /heap-\d{5,}/i,
    ],
  },
  {
    tool_name: 'Segment',
    category: 'analytics',
    scriptUrls: [
      /cdn\.segment\.com\/analytics\.js/i,
      /cdn\.segment\.com\/v1/i,
    ],
    html: [
      /analytics\.identify/i,
      /analytics\.track/i,
      /analytics\.page/i,
    ],
  },
  {
    tool_name: 'Plausible',
    category: 'analytics',
    scriptUrls: [
      /plausible\.io\/js\/(?:plausible|script)/i,
    ],
    html: [
      /data-domain=["'][^"']+["'][^>]*plausible/i,
    ],
  },
  {
    tool_name: 'Fathom',
    category: 'analytics',
    scriptUrls: [
      /usefathom\.com\/script\.js/i,
      /cdn\.usefathom\.com/i,
    ],
    html: [
      /fathom\.trackPageview/i,
    ],
  },
  {
    tool_name: 'Piano Analytics',
    category: 'analytics',
    scriptUrls: [
      /at-o\.net/i,
      /tag\.aticdn\.net/i,
      /piano\.io\/xtrack/i,
    ],
    html: [
      /ATInternet/i,
      /pa\.tag/i,
    ],
    cookies: [
      /^atidvisitor$/,
      /^atuserid$/,
    ],
  },
  {
    tool_name: 'Snowplow',
    category: 'analytics',
    scriptUrls: [
      /sp\.js/i,
      /snowplow/i,
    ],
    html: [
      /snowplow\s*\(\s*['"]newTracker['"]/i,
      /GlobalSnowplowNamespace/i,
    ],
    cookies: [
      /^_sp_id\./,
      /^_sp_ses\./,
    ],
  },
  {
    tool_name: 'Microsoft Clarity',
    category: 'analytics',
    scriptUrls: [
      /clarity\.ms\/tag/i,
    ],
    html: [
      /clarity\s*\(\s*["']set["']/i,
      /clarity\s*\(\s*["']identify["']/i,
    ],
    cookies: [
      /^_clsk$/,
      /^_clck$/,
    ],
  },
  {
    tool_name: 'PostHog',
    category: 'analytics',
    scriptUrls: [
      /us\.posthog\.com\/static/i,
      /app\.posthog\.com/i,
    ],
    html: [
      /posthog\.init/i,
    ],
  },
  {
    tool_name: 'Piwik PRO',
    category: 'analytics',
    scriptUrls: [
      /containers\.piwik\.pro/i,
      /piwikpro\.com/i,
    ],
    html: [
      /ppms\.js/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // TAG MANAGERS (5+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Google Tag Manager',
    category: 'tag_manager',
    scriptUrls: [
      /googletagmanager\.com\/gtm\.js\?id=GTM-/i,
      /googletagmanager\.com\/gtm\.js/i,
    ],
    html: [
      /GTM-[A-Z0-9]{4,8}/,
      /dataLayer\.push/i,
      /google_tag_manager/i,
    ],
  },
  {
    tool_name: 'Adobe Launch',
    category: 'tag_manager',
    scriptUrls: [
      /assets\.adobedtm\.com/i,
      /launch-[a-f0-9]+\.adobedtm\.com/i,
    ],
    html: [
      /_satellite\./i,
      /_satellite\.pageBottom/i,
    ],
  },
  {
    tool_name: 'Tealium iQ',
    category: 'tag_manager',
    scriptUrls: [
      /tags\.tiqcdn\.com/i,
      /tealium/i,
    ],
    html: [
      /utag\.js/i,
      /utag\.cfg/i,
      /utag_data/i,
    ],
    cookies: [
      /^utag_main$/,
    ],
  },
  {
    tool_name: 'Ensighten',
    category: 'tag_manager',
    scriptUrls: [
      /nexus\.ensighten\.com/i,
    ],
    html: [
      /Bootstrapper\.ensighten/i,
    ],
  },
  {
    tool_name: 'TagCommander',
    category: 'tag_manager',
    scriptUrls: [
      /cdn\.tagcommander\.com/i,
      /commander1\.com/i,
    ],
    html: [
      /tc_vars/i,
      /tC\.container/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CMS (15+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'WordPress',
    category: 'cms',
    html: [
      /\/wp-content\//i,
      /\/wp-includes\//i,
      /\/wp-json\//i,
    ],
    meta: [
      { name: /^generator$/i, content: /WordPress\s*([\d.]+)?/i },
    ],
    urls: ['/wp-admin/', '/wp-login.php'],
  },
  {
    tool_name: 'Drupal',
    category: 'cms',
    scriptUrls: [
      /drupal\.js/i,
    ],
    html: [
      /Drupal\.settings/i,
      /drupal--/i,
      /data-drupal-/i,
    ],
    headers: {
      'x-generator': /Drupal\s*([\d.]+)?/i,
    },
    meta: [
      { name: /^generator$/i, content: /Drupal\s*([\d.]+)?/i },
    ],
  },
  {
    tool_name: 'Joomla',
    category: 'cms',
    html: [
      /\/media\/jui\//i,
      /\/media\/system\/js\//i,
    ],
    meta: [
      { name: /^generator$/i, content: /Joomla/i },
    ],
  },
  {
    tool_name: 'Adobe Experience Manager',
    category: 'cms',
    html: [
      /\/etc\.clientlibs\//i,
      /\/content\/dam\//i,
      /\/etc\/designs\//i,
      /cq-(?:author|dialog|wcm)/i,
    ],
    urls: ['/etc.clientlibs/', '/content/dam/'],
  },
  {
    tool_name: 'Sitecore',
    category: 'cms',
    html: [
      /\/sitecore\//i,
      /__SITECORE/i,
      /sitecore-/i,
    ],
    cookies: [
      /^SC_ANALYTICS_GLOBAL_COOKIE$/,
      /^sitecore/i,
    ],
  },
  {
    tool_name: 'Contentful',
    category: 'cms',
    scriptUrls: [
      /contentful\.com/i,
    ],
    html: [
      /images\.ctfassets\.net/i,
      /cdn\.contentful\.com/i,
      /ctfassets\.net/i,
    ],
  },
  {
    tool_name: 'Strapi',
    category: 'cms',
    html: [
      /strapi/i,
      /powered-by-strapi/i,
    ],
    headers: {
      'x-powered-by': /Strapi/i,
    },
  },
  {
    tool_name: 'Sanity',
    category: 'cms',
    html: [
      /cdn\.sanity\.io/i,
      /sanity\.io\/images/i,
    ],
    scriptUrls: [
      /cdn\.sanity\.io/i,
    ],
  },
  {
    tool_name: 'Shopify',
    category: 'cms',
    html: [
      /cdn\.shopify\.com/i,
      /Shopify\.shop/i,
      /myshopify\.com/i,
    ],
    scriptUrls: [
      /cdn\.shopify\.com\/s\/files/i,
      /cdn\.shopify\.com\/shopifycloud/i,
    ],
    headers: {
      'x-shopify-stage': /.*/,
    },
    cookies: [
      /^_shopify_s$/,
      /^_shopify_y$/,
      /^cart_sig$/,
    ],
    meta: [
      { name: /^shopify-checkout-api-token$/i, content: /.*/ },
    ],
  },
  {
    tool_name: 'Wix',
    category: 'cms',
    html: [
      /parastorage\.com/i,
      /static\.wixstatic\.com/i,
      /wix-code-/i,
    ],
    scriptUrls: [
      /static\.parastorage\.com/i,
      /static\.wixstatic\.com/i,
    ],
    meta: [
      { name: /^generator$/i, content: /Wix\.com/i },
    ],
  },
  {
    tool_name: 'Squarespace',
    category: 'cms',
    html: [
      /squarespace\.com/i,
      /sqsp\.net/i,
      /squarespace-cdn\.com/i,
    ],
    scriptUrls: [
      /static1?\.squarespace\.com/i,
    ],
    meta: [
      { name: /^generator$/i, content: /Squarespace/i },
    ],
  },
  {
    tool_name: 'Ghost',
    category: 'cms',
    html: [
      /ghost-(?:portal|comments)/i,
    ],
    meta: [
      { name: /^generator$/i, content: /Ghost\s*([\d.]+)?/i },
    ],
    scriptUrls: [
      /ghost\.io/i,
    ],
  },
  {
    tool_name: 'Webflow',
    category: 'cms',
    html: [
      /assets\.website-files\.com/i,
      /webflow\.com\/js/i,
      /data-wf-(?:site|page)/i,
    ],
    scriptUrls: [
      /assets\.website-files\.com/i,
    ],
    meta: [
      { name: /^generator$/i, content: /Webflow/i },
    ],
  },
  {
    tool_name: 'HubSpot CMS',
    category: 'cms',
    html: [
      /hs-scripts\.com/i,
      /hubspot\.net\/hub/i,
      /hs-banner\.com/i,
    ],
    scriptUrls: [
      /js\.hs-scripts\.com/i,
    ],
  },
  {
    tool_name: 'Kentico',
    category: 'cms',
    html: [
      /CMSPages/i,
      /Kentico/i,
    ],
    meta: [
      { name: /^generator$/i, content: /Kentico/i },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // E-COMMERCE (10+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Shopify',
    category: 'ecommerce',
    html: [
      /Shopify\.theme/i,
      /cdn\.shopify\.com\/s\//i,
      /checkout\.shopify\.com/i,
    ],
    scriptUrls: [
      /cdn\.shopify\.com\/shopifycloud\/checkout-web/i,
    ],
    cookies: [
      /^_shopify_s$/,
      /^_shopify_y$/,
    ],
  },
  {
    tool_name: 'Magento',
    category: 'ecommerce',
    html: [
      /\/static\/version\d+\//i,
      /mage\/cookies/i,
      /Magento_Ui/i,
      /requirejs\/require/i,
    ],
    scriptUrls: [
      /requirejs\/require\.js/i,
      /mage\/requirejs/i,
    ],
    cookies: [
      /^PHPSESSID$/,
      /^form_key$/,
      /^mage-cache-storage$/,
    ],
    headers: {
      'x-magento-vary': /.*/,
    },
  },
  {
    tool_name: 'WooCommerce',
    category: 'ecommerce',
    html: [
      /woocommerce/i,
      /wc-blocks/i,
      /wc-cart/i,
    ],
    scriptUrls: [
      /woocommerce/i,
      /wc-add-to-cart/i,
    ],
    cookies: [
      /^woocommerce_/,
    ],
  },
  {
    tool_name: 'PrestaShop',
    category: 'ecommerce',
    html: [
      /prestashop/i,
      /\/modules\/ps_/i,
      /PrestaShop/i,
    ],
    meta: [
      { name: /^generator$/i, content: /PrestaShop/i },
    ],
    cookies: [
      /^PrestaShop-/i,
    ],
  },
  {
    tool_name: 'BigCommerce',
    category: 'ecommerce',
    html: [
      /bigcommerce\.com/i,
      /bc-sf-filter/i,
    ],
    scriptUrls: [
      /bigcommerce\.com/i,
      /cdn11\.bigcommerce/i,
    ],
    headers: {
      'x-bc-': /.*/,
    },
  },
  {
    tool_name: 'Salesforce Commerce Cloud',
    category: 'ecommerce',
    html: [
      /demandware\.static/i,
      /demandware\.net/i,
      /\/on\/demandware\./i,
    ],
    scriptUrls: [
      /demandware/i,
    ],
    cookies: [
      /^dwsid$/,
      /^dwanonymous/i,
    ],
  },
  {
    tool_name: 'commercetools',
    category: 'ecommerce',
    html: [
      /commercetools/i,
      /api\.(?:europe-west1|us-central1)\.gcp\.commercetools\.com/i,
    ],
  },
  {
    tool_name: 'SAP Commerce',
    category: 'ecommerce',
    html: [
      /hybris/i,
      /smartedit/i,
      /\/yacceleratorstorefront/i,
    ],
    scriptUrls: [
      /hybris/i,
    ],
  },
  {
    tool_name: 'VTEX',
    category: 'ecommerce',
    html: [
      /vtex\.com/i,
      /vteximg\.com/i,
      /vtexcommercestable/i,
    ],
    scriptUrls: [
      /vtex\.com/i,
      /vteximg\.com/i,
    ],
    headers: {
      'x-vtex-': /.*/,
    },
  },
  {
    tool_name: 'Volusion',
    category: 'ecommerce',
    html: [
      /volusion\.com/i,
      /a\/j\/vnav\.js/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // FRONTEND FRAMEWORKS (15+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'React',
    category: 'frontend_framework',
    html: [
      /data-reactroot/i,
      /_reactRootContainer/i,
      /__react/i,
      /data-reactid/i,
    ],
  },
  {
    tool_name: 'Next.js',
    category: 'frontend_framework',
    html: [
      /__NEXT_DATA__/,
      /\/_next\/static\//,
      /id="__next"/i,
    ],
    scriptUrls: [
      /\/_next\/static\/chunks/i,
    ],
    headers: {
      'x-nextjs-cache': /.*/,
      'x-nextjs-matched-path': /.*/,
    },
    urls: ['/_next/'],
  },
  {
    tool_name: 'Vue.js',
    category: 'frontend_framework',
    html: [
      /data-v-[a-f0-9]{6,8}/i,
      /__vue/i,
      /Vue\.(?:component|use|mixin)/i,
    ],
    scriptUrls: [
      /vue(?:\.min)?\.js/i,
      /vue(?:\.runtime)?(?:\.global)?(?:\.prod)?\.js/i,
    ],
  },
  {
    tool_name: 'Nuxt.js',
    category: 'frontend_framework',
    html: [
      /__NUXT__/,
      /\/_nuxt\//,
      /id="__nuxt"/i,
    ],
    scriptUrls: [
      /\/_nuxt\//i,
    ],
  },
  {
    tool_name: 'Angular',
    category: 'frontend_framework',
    html: [
      /ng-version="(\d[\d.]+)"/i,
      /ng-app/i,
      /\[\(ngModel\)\]/i,
      /ng-controller/i,
    ],
    scriptUrls: [
      /angular(?:\.min)?\.js/i,
      /(?:polyfills|runtime|main)\.[a-f0-9]+\.js/i,
    ],
  },
  {
    tool_name: 'Svelte',
    category: 'frontend_framework',
    html: [
      /svelte-[a-z0-9]+/i,
      /__svelte/i,
    ],
    scriptUrls: [
      /svelte/i,
    ],
  },
  {
    tool_name: 'SvelteKit',
    category: 'frontend_framework',
    html: [
      /__sveltekit\//,
      /\/_app\/immutable\//,
    ],
  },
  {
    tool_name: 'Gatsby',
    category: 'frontend_framework',
    html: [
      /gatsby-/i,
      /___gatsby/i,
    ],
    scriptUrls: [
      /gatsby-/i,
    ],
    meta: [
      { name: /^generator$/i, content: /Gatsby/i },
    ],
  },
  {
    tool_name: 'jQuery',
    category: 'frontend_framework',
    scriptUrls: [
      /jquery[.-](\d[\d.]*?)(?:\.min)?\.js/i,
      /jquery\.js/i,
      /code\.jquery\.com/i,
    ],
    html: [
      /jQuery\s*(?:v|\.fn\.jquery\s*=\s*['"]{1})([\d.]+)/i,
    ],
  },
  {
    tool_name: 'Bootstrap',
    category: 'frontend_framework',
    html: [
      /bootstrap(?:\.min)?\.css/i,
      /bootstrap(?:\.min)?\.js/i,
      /class="[^"]*\bcontainer\b[^"]*\brow\b/i,
    ],
    scriptUrls: [
      /bootstrap[.-](\d[\d.]*?)(?:\.bundle)?(?:\.min)?\.js/i,
    ],
  },
  {
    tool_name: 'Tailwind CSS',
    category: 'frontend_framework',
    html: [
      /tailwind/i,
      /class="[^"]*(?:flex|grid)\s[^"]*(?:items-|justify-|space-[xy]-|gap-)/i,
    ],
  },
  {
    tool_name: 'Ember.js',
    category: 'frontend_framework',
    html: [
      /ember-view/i,
      /data-ember-/i,
      /id="ember\d+"/i,
    ],
    scriptUrls: [
      /ember(?:\.min)?\.js/i,
    ],
    meta: [
      { name: /^.*$/i, content: /ember/i },
    ],
  },
  {
    tool_name: 'Remix',
    category: 'frontend_framework',
    html: [
      /__remixContext/i,
      /remix-run/i,
    ],
  },
  {
    tool_name: 'Astro',
    category: 'frontend_framework',
    html: [
      /astro-[a-z0-9]+/i,
      /data-astro-/i,
    ],
    meta: [
      { name: /^generator$/i, content: /Astro\s*v?([\d.]+)?/i },
    ],
  },
  {
    tool_name: 'Alpine.js',
    category: 'frontend_framework',
    html: [
      /x-data\s*=/i,
      /x-bind:/i,
      /x-on:/i,
      /@click\s*=/i,
    ],
    scriptUrls: [
      /alpinejs/i,
      /alpine(?:\.min)?\.js/i,
    ],
  },
  {
    tool_name: 'HTMX',
    category: 'frontend_framework',
    html: [
      /hx-get\s*=/i,
      /hx-post\s*=/i,
      /hx-trigger\s*=/i,
    ],
    scriptUrls: [
      /htmx(?:\.min)?\.js/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CDN (10+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Cloudflare',
    category: 'cdn',
    headers: {
      'cf-ray': /.+/,
      'cf-cache-status': /.+/,
    },
    cookies: [
      /^__cfduid$/,
      /^__cf_bm$/,
    ],
    html: [
      /cdnjs\.cloudflare\.com/i,
    ],
  },
  {
    tool_name: 'Akamai',
    category: 'cdn',
    headers: {
      'x-akamai-transformed': /.+/,
    },
    html: [
      /akamaized\.net/i,
      /edgekey\.net/i,
      /akadns\.net/i,
      /akamaihd\.net/i,
    ],
  },
  {
    tool_name: 'Fastly',
    category: 'cdn',
    headers: {
      'x-served-by': /cache-/i,
      'x-fastly-request-id': /.+/,
      'via': /varnish/i,
    },
    html: [
      /fastly\.net/i,
    ],
  },
  {
    tool_name: 'AWS CloudFront',
    category: 'cdn',
    headers: {
      'x-amz-cf-id': /.+/,
      'x-amz-cf-pop': /.+/,
      'via': /cloudfront/i,
    },
    html: [
      /[a-z0-9]+\.cloudfront\.net/i,
    ],
  },
  {
    tool_name: 'Azure CDN',
    category: 'cdn',
    headers: {
      'x-azure-ref': /.+/,
      'x-msedge-ref': /.+/,
    },
    html: [
      /azureedge\.net/i,
    ],
  },
  {
    tool_name: 'Google Cloud CDN',
    category: 'cdn',
    headers: {
      'via': /google/i,
      'x-goog-hash': /.+/,
    },
  },
  {
    tool_name: 'Bunny CDN',
    category: 'cdn',
    headers: {
      'cdn-pullzone': /.+/,
      'server': /BunnyCDN/i,
    },
    html: [
      /b-cdn\.net/i,
      /bunny\.net/i,
      /bunnycdn/i,
    ],
  },
  {
    tool_name: 'KeyCDN',
    category: 'cdn',
    headers: {
      'server': /keycdn/i,
    },
    html: [
      /kxcdn\.com/i,
      /keycdn\.com/i,
    ],
  },
  {
    tool_name: 'StackPath',
    category: 'cdn',
    headers: {
      'x-sp-': /.+/,
    },
    html: [
      /stackpath\.com/i,
      /stackpathdns\.com/i,
    ],
  },
  {
    tool_name: 'Imperva',
    category: 'cdn',
    cookies: [
      /^incap_ses_/,
      /^visid_incap_/,
      /^__incap_ses_/,
    ],
    headers: {
      'x-iinfo': /.+/,
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ADVERTISING (15+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Google Ads',
    category: 'ad_platforms',
    scriptUrls: [
      /googleads\.g\.doubleclick\.net/i,
      /googlesyndication\.com/i,
      /adservice\.google\./i,
      /pagead2\.googlesyndication\.com/i,
    ],
    html: [
      /google_ad_client/i,
      /AW-\d{6,}/,
    ],
    cookies: [
      /^_gcl_au$/,
      /^_gcl_aw$/,
    ],
  },
  {
    tool_name: 'Meta Pixel',
    category: 'ad_platforms',
    scriptUrls: [
      /connect\.facebook\.net\/[a-z_]+\/fbevents\.js/i,
    ],
    html: [
      /fbq\s*\(\s*['"]init['"]/i,
      /fbq\s*\(\s*['"]track['"]/i,
      /facebook\.com\/tr\?/i,
    ],
    cookies: [
      /^_fbp$/,
      /^_fbc$/,
    ],
  },
  {
    tool_name: 'TikTok Pixel',
    category: 'ad_platforms',
    scriptUrls: [
      /analytics\.tiktok\.com/i,
    ],
    html: [
      /ttq\.load/i,
      /ttq\.track/i,
      /ttq\.page/i,
    ],
    cookies: [
      /^_ttp$/,
    ],
  },
  {
    tool_name: 'LinkedIn Insight Tag',
    category: 'ad_platforms',
    scriptUrls: [
      /snap\.licdn\.com\/li\.lms-analytics/i,
    ],
    html: [
      /_linkedin_partner_id/i,
      /_linkedin_data_partner_ids/i,
    ],
    cookies: [
      /^li_fat_id$/,
      /^ln_or$/,
    ],
  },
  {
    tool_name: 'Twitter/X Pixel',
    category: 'ad_platforms',
    scriptUrls: [
      /static\.ads-twitter\.com/i,
    ],
    html: [
      /twq\s*\(\s*['"]init['"]/i,
      /twq\s*\(\s*['"]track['"]/i,
    ],
  },
  {
    tool_name: 'Pinterest Tag',
    category: 'ad_platforms',
    scriptUrls: [
      /s\.pinimg\.com\/ct\/core\.js/i,
      /ct\.pinterest\.com/i,
    ],
    html: [
      /pintrk\s*\(\s*['"]load['"]/i,
    ],
    cookies: [
      /^_pinterest_sess$/,
      /^_pin_unauth$/,
    ],
  },
  {
    tool_name: 'Criteo',
    category: 'ad_platforms',
    scriptUrls: [
      /static\.criteo\.net/i,
      /dis\.criteo\.com/i,
    ],
    html: [
      /criteo/i,
    ],
    cookies: [
      /^cto_bundle$/,
    ],
  },
  {
    tool_name: 'Google DoubleClick',
    category: 'ad_platforms',
    scriptUrls: [
      /doubleclick\.net/i,
    ],
    html: [
      /ad\.doubleclick\.net/i,
      /doubleclick\.net\/gampad/i,
    ],
    cookies: [
      /^IDE$/,
      /^test_cookie$/,
    ],
  },
  {
    tool_name: 'Taboola',
    category: 'ad_platforms',
    scriptUrls: [
      /cdn\.taboola\.com/i,
    ],
    html: [
      /window\._taboola/i,
      /trc\.taboola\.com/i,
    ],
  },
  {
    tool_name: 'Outbrain',
    category: 'ad_platforms',
    scriptUrls: [
      /outbrain\.com\/outbrain\.js/i,
      /widgets\.outbrain\.com/i,
    ],
    html: [
      /outbrain/i,
    ],
  },
  {
    tool_name: 'Microsoft/Bing Ads',
    category: 'ad_platforms',
    scriptUrls: [
      /bat\.bing\.com/i,
    ],
    html: [
      /UET\s*tag/i,
      /bat\.bing\.com\/bat\.js/i,
    ],
    cookies: [
      /^_uetsid$/,
      /^_uetvid$/,
    ],
  },
  {
    tool_name: 'Amazon Ads',
    category: 'ad_platforms',
    scriptUrls: [
      /amazon-adsystem\.com/i,
    ],
    html: [
      /amazon-adsystem\.com/i,
      /amzn_assoc_/i,
    ],
  },
  {
    tool_name: 'AdRoll',
    category: 'ad_platforms',
    scriptUrls: [
      /d\.adroll\.com/i,
      /s\.adroll\.com/i,
    ],
    html: [
      /adroll\.com/i,
      /adroll_adv_id/i,
    ],
    cookies: [
      /^__adroll/,
    ],
  },
  {
    tool_name: 'Snapchat Pixel',
    category: 'ad_platforms',
    scriptUrls: [
      /sc-static\.net\/scevent\.min\.js/i,
    ],
    html: [
      /snaptr\s*\(\s*['"]init['"]/i,
    ],
  },
  {
    tool_name: 'TradeDesk',
    category: 'ad_platforms',
    scriptUrls: [
      /js\.adsrvr\.org/i,
    ],
    html: [
      /adsrvr\.org/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CONSENT MANAGEMENT (10+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Cookiebot',
    category: 'consent_management',
    scriptUrls: [
      /consent\.cookiebot\.com/i,
    ],
    html: [
      /CookieConsent/i,
      /Cookiebot/i,
    ],
    cookies: [
      /^CookieConsent$/,
    ],
  },
  {
    tool_name: 'OneTrust',
    category: 'consent_management',
    scriptUrls: [
      /cdn\.cookielaw\.org/i,
      /optanon\.blob\.core\.windows\.net/i,
    ],
    html: [
      /onetrust/i,
      /OptanonConsent/i,
      /otBannerSdk/i,
    ],
    cookies: [
      /^OptanonConsent$/,
      /^OptanonAlertBoxClosed$/,
    ],
  },
  {
    tool_name: 'Iubenda',
    category: 'consent_management',
    scriptUrls: [
      /cdn\.iubenda\.com/i,
    ],
    html: [
      /iubenda/i,
    ],
    cookies: [
      /^_iub_cs-/,
    ],
  },
  {
    tool_name: 'Didomi',
    category: 'consent_management',
    scriptUrls: [
      /sdk\.privacy-center\.org/i,
    ],
    html: [
      /didomi/i,
      /Didomi\.(?:on|preferences)/i,
    ],
    cookies: [
      /^didomi_token$/,
      /^euconsent-v2$/,
    ],
  },
  {
    tool_name: 'TrustArc',
    category: 'consent_management',
    scriptUrls: [
      /consent\.trustarc\.com/i,
      /consent-pref\.trustarc\.com/i,
    ],
    html: [
      /trustarc/i,
      /truste/i,
    ],
  },
  {
    tool_name: 'Usercentrics',
    category: 'consent_management',
    scriptUrls: [
      /usercentrics\.eu/i,
      /app\.usercentrics\.eu/i,
    ],
    html: [
      /usercentrics/i,
    ],
  },
  {
    tool_name: 'CookieYes',
    category: 'consent_management',
    scriptUrls: [
      /cdn-cookieyes\.com/i,
    ],
    html: [
      /cookieyes/i,
    ],
    cookies: [
      /^cookieyes-consent$/,
    ],
  },
  {
    tool_name: 'Quantcast Choice',
    category: 'consent_management',
    scriptUrls: [
      /quantcast\.mgr\.consensu\.org/i,
      /cmp\.quantcast\.com/i,
    ],
    html: [
      /quantcast/i,
    ],
  },
  {
    tool_name: 'Complianz',
    category: 'consent_management',
    html: [
      /complianz-gdpr/i,
      /complianz/i,
    ],
    scriptUrls: [
      /complianz/i,
    ],
    cookies: [
      /^cmplz_/,
    ],
  },
  {
    tool_name: 'Osano',
    category: 'consent_management',
    scriptUrls: [
      /cmp\.osano\.com/i,
    ],
    html: [
      /osano/i,
    ],
  },
  {
    tool_name: 'Termly',
    category: 'consent_management',
    scriptUrls: [
      /app\.termly\.io/i,
    ],
    html: [
      /termly/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CHAT & SUPPORT (10+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Intercom',
    category: 'chat_support',
    scriptUrls: [
      /widget\.intercom\.io/i,
    ],
    html: [
      /intercomSettings/i,
      /Intercom\s*\(/i,
      /intercom-container/i,
    ],
    cookies: [
      /^intercom-/i,
    ],
  },
  {
    tool_name: 'Zendesk',
    category: 'chat_support',
    scriptUrls: [
      /static\.zdassets\.com/i,
      /zopim/i,
    ],
    html: [
      /zdassets\.com/i,
      /zendesk/i,
      /zE\s*\(\s*['"]webWidget['"]/i,
    ],
    cookies: [
      /^__zlcmid$/,
    ],
  },
  {
    tool_name: 'Drift',
    category: 'chat_support',
    scriptUrls: [
      /js\.driftt\.com/i,
      /drift\.com/i,
    ],
    html: [
      /drift\.load/i,
      /drift-widget/i,
    ],
  },
  {
    tool_name: 'LiveChat',
    category: 'chat_support',
    scriptUrls: [
      /cdn\.livechatinc\.com/i,
    ],
    html: [
      /livechatinc\.com/i,
      /window\.__lc/i,
    ],
    cookies: [
      /^__lc_cid$/,
      /^__lc_cst$/,
    ],
  },
  {
    tool_name: 'Tawk.to',
    category: 'chat_support',
    scriptUrls: [
      /embed\.tawk\.to/i,
    ],
    html: [
      /tawk\.to/i,
      /Tawk_API/i,
    ],
  },
  {
    tool_name: 'Crisp',
    category: 'chat_support',
    scriptUrls: [
      /client\.crisp\.chat/i,
    ],
    html: [
      /crisp\.chat/i,
      /\$crisp/i,
      /CRISP_WEBSITE_ID/i,
    ],
  },
  {
    tool_name: 'Freshchat',
    category: 'chat_support',
    scriptUrls: [
      /wchat\.freshchat\.com/i,
    ],
    html: [
      /freshchat/i,
    ],
  },
  {
    tool_name: 'Tidio',
    category: 'chat_support',
    scriptUrls: [
      /code\.tidio\.co/i,
    ],
    html: [
      /tidio/i,
      /tidioChatCode/i,
    ],
  },
  {
    tool_name: 'HubSpot Chat',
    category: 'chat_support',
    scriptUrls: [
      /js\.usemessages\.com/i,
    ],
    html: [
      /hubspot-messages/i,
    ],
  },
  {
    tool_name: 'Gorgias',
    category: 'chat_support',
    scriptUrls: [
      /config\.gorgias\.chat/i,
    ],
    html: [
      /gorgias/i,
    ],
  },
  {
    tool_name: 'Olark',
    category: 'chat_support',
    scriptUrls: [
      /static\.olark\.com/i,
    ],
    html: [
      /olark/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SESSION RECORDING (9 rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Hotjar',
    category: 'session_recording',
    scriptUrls: [
      /static\.hotjar\.com/i,
    ],
    html: [
      /_hjSettings/i,
      /hotjar\.com/i,
    ],
    cookies: [
      /^_hjid$/,
      /^_hjSessionUser_/,
      /^_hjSession_/,
    ],
  },
  {
    tool_name: 'FullStory',
    category: 'session_recording',
    scriptUrls: [
      /fullstory\.com\/s\/fs\.js/i,
      /edge\.fullstory\.com/i,
    ],
    html: [
      /FullStory/i,
      /window\['_fs_/i,
    ],
    cookies: [
      /^_fs_uid$/,
    ],
  },
  {
    tool_name: 'LogRocket',
    category: 'session_recording',
    scriptUrls: [
      /cdn\.(?:lr-|logrocket)/i,
      /cdn\.logrocket\.io/i,
    ],
    html: [
      /LogRocket\.init/i,
    ],
    cookies: [
      /^_lr_/,
    ],
  },
  {
    tool_name: 'Mouseflow',
    category: 'session_recording',
    scriptUrls: [
      /cdn-mouseflow\.com/i,
      /mouseflow\.com/i,
    ],
    html: [
      /mouseflow/i,
    ],
  },
  {
    tool_name: 'Crazy Egg',
    category: 'session_recording',
    scriptUrls: [
      /script\.crazyegg\.com/i,
    ],
    html: [
      /crazyegg/i,
    ],
  },
  {
    tool_name: 'Contentsquare',
    category: 'session_recording',
    scriptUrls: [
      /t\.contentsquare\.net/i,
      /contentsquare\.com/i,
    ],
    html: [
      /contentsquare/i,
    ],
  },
  {
    tool_name: 'Smartlook',
    category: 'session_recording',
    scriptUrls: [
      /rec\.smartlook\.com/i,
      /web-sdk\.smartlook\.com/i,
    ],
    html: [
      /smartlook/i,
    ],
  },
  {
    tool_name: 'Lucky Orange',
    category: 'session_recording',
    scriptUrls: [
      /d10lpsik1i8c69\.cloudfront\.net/i,
      /luckyorange\.com/i,
    ],
    html: [
      /luckyorange/i,
    ],
    cookies: [
      /^_lo_uid$/,
    ],
  },
  {
    tool_name: 'Quantum Metric',
    category: 'session_recording',
    scriptUrls: [
      /quantummetric\.com/i,
    ],
    html: [
      /QuantumMetricAPI/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // MARKETING AUTOMATION (8+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'HubSpot',
    category: 'marketing_automation',
    scriptUrls: [
      /js\.hs-scripts\.com/i,
      /js\.hs-analytics\.net/i,
    ],
    html: [
      /hubspot/i,
      /hs-scripts\.com/i,
    ],
    cookies: [
      /^hubspotutk$/,
      /^__hstc$/,
      /^__hssc$/,
      /^__hssrc$/,
    ],
  },
  {
    tool_name: 'Marketo',
    category: 'marketing_automation',
    scriptUrls: [
      /munchkin\.marketo\.net/i,
      /mkt-cdn\.com/i,
    ],
    html: [
      /Munchkin\.init/i,
      /marketo/i,
    ],
    cookies: [
      /^_mkto_trk$/,
    ],
  },
  {
    tool_name: 'Salesforce Pardot',
    category: 'marketing_automation',
    scriptUrls: [
      /pi\.pardot\.com/i,
      /pardot\.com/i,
    ],
    html: [
      /pardot/i,
      /piTracker/i,
      /piAId/i,
    ],
  },
  {
    tool_name: 'ActiveCampaign',
    category: 'marketing_automation',
    scriptUrls: [
      /trackcmp\.net/i,
      /activehosted\.com/i,
    ],
    html: [
      /activecampaign/i,
    ],
  },
  {
    tool_name: 'Braze',
    category: 'marketing_automation',
    scriptUrls: [
      /sdk\.iad-\d+\.braze\.com/i,
      /js\.appboycdn\.com/i,
    ],
    html: [
      /appboy/i,
      /braze/i,
    ],
  },
  {
    tool_name: 'Klaviyo',
    category: 'marketing_automation',
    scriptUrls: [
      /static\.klaviyo\.com/i,
    ],
    html: [
      /klaviyo/i,
      /_learnq/i,
    ],
  },
  {
    tool_name: 'Mailchimp',
    category: 'marketing_automation',
    scriptUrls: [
      /chimpstatic\.com/i,
      /list-manage\.com/i,
    ],
    html: [
      /mailchimp/i,
      /mc\.us\d+\.list-manage/i,
    ],
  },
  {
    tool_name: 'Customer.io',
    category: 'marketing_automation',
    scriptUrls: [
      /track\.customer\.io/i,
      /assets\.customer\.io/i,
    ],
    html: [
      /customerio/i,
      /_cio\.identify/i,
    ],
  },
  {
    tool_name: 'Drip',
    category: 'marketing_automation',
    scriptUrls: [
      /tag\.getdrip\.com/i,
    ],
    html: [
      /getdrip\.com/i,
    ],
  },
  {
    tool_name: 'Omnisend',
    category: 'marketing_automation',
    scriptUrls: [
      /omnisrc\.com/i,
    ],
    html: [
      /omnisend/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SEO (10+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Schema.org / JSON-LD',
    category: 'seo',
    html: [
      /<script[^>]*type=["']application\/ld\+json["']/i,
    ],
  },
  {
    tool_name: 'Yoast SEO',
    category: 'seo',
    html: [
      /yoast-schema-graph/i,
      /yoast\.com\/wordpress\/plugins\/seo/i,
      /<!-- This site is optimized with the Yoast/i,
    ],
  },
  {
    tool_name: 'Rank Math',
    category: 'seo',
    html: [
      /rank-math/i,
      /rankmath/i,
      /<!-- Rank Math/i,
    ],
  },
  {
    tool_name: 'All in One SEO',
    category: 'seo',
    html: [
      /aioseo/i,
      /all-in-one-seo-pack/i,
      /<!-- All in One SEO/i,
    ],
  },
  {
    tool_name: 'Open Graph',
    category: 'seo',
    meta: [
      { name: /^og:title$/i, content: /.*/ },
      { name: /^og:description$/i, content: /.*/ },
      { name: /^og:image$/i, content: /.*/ },
    ],
    html: [
      /property=["']og:title["']/i,
    ],
  },
  {
    tool_name: 'Twitter Cards',
    category: 'seo',
    meta: [
      { name: /^twitter:card$/i, content: /.*/ },
      { name: /^twitter:site$/i, content: /.*/ },
    ],
    html: [
      /name=["']twitter:card["']/i,
    ],
  },
  {
    tool_name: 'hreflang',
    category: 'seo',
    html: [
      /rel=["']alternate["'][^>]+hreflang/i,
      /hreflang=["'][a-z]{2}(?:-[A-Z]{2})?["']/i,
    ],
  },
  {
    tool_name: 'Canonical Tag',
    category: 'seo',
    html: [
      /rel=["']canonical["']/i,
    ],
  },
  {
    tool_name: 'Robots Meta',
    category: 'seo',
    meta: [
      { name: /^robots$/i, content: /.*/ },
    ],
    html: [
      /<meta[^>]+name=["']robots["']/i,
    ],
  },
  {
    tool_name: 'SEMrush',
    category: 'seo',
    scriptUrls: [
      /semrush\.com/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PAYMENT (8+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Stripe',
    category: 'payment',
    scriptUrls: [
      /js\.stripe\.com/i,
    ],
    html: [
      /Stripe\s*\(\s*['"][ps]k_/i,
      /stripe-js/i,
    ],
  },
  {
    tool_name: 'PayPal',
    category: 'payment',
    scriptUrls: [
      /paypal\.com\/sdk/i,
      /paypalobjects\.com/i,
    ],
    html: [
      /paypal/i,
    ],
  },
  {
    tool_name: 'Adyen',
    category: 'payment',
    scriptUrls: [
      /checkoutshopper-live\.adyen\.com/i,
      /checkoutshopper-test\.adyen\.com/i,
    ],
    html: [
      /adyen/i,
    ],
  },
  {
    tool_name: 'Klarna',
    category: 'payment',
    scriptUrls: [
      /x\.klarnacdn\.net/i,
      /klarna\.com/i,
    ],
    html: [
      /klarna/i,
    ],
  },
  {
    tool_name: 'Afterpay',
    category: 'payment',
    scriptUrls: [
      /static\.afterpay\.com/i,
      /afterpay\.com/i,
    ],
    html: [
      /afterpay/i,
      /clearpay/i,
    ],
  },
  {
    tool_name: 'Apple Pay',
    category: 'payment',
    html: [
      /apple-pay/i,
      /ApplePaySession/i,
    ],
  },
  {
    tool_name: 'Google Pay',
    category: 'payment',
    scriptUrls: [
      /pay\.google\.com/i,
    ],
    html: [
      /google-pay/i,
      /googlepay/i,
      /buyflow\/gpay/i,
    ],
  },
  {
    tool_name: 'Braintree',
    category: 'payment',
    scriptUrls: [
      /braintreegateway\.com/i,
      /braintree-web/i,
    ],
    html: [
      /braintree/i,
    ],
  },
  {
    tool_name: 'Mollie',
    category: 'payment',
    html: [
      /mollie\.com/i,
      /js\.mollie\.com/i,
    ],
    scriptUrls: [
      /js\.mollie\.com/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // HOSTING (10+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Vercel',
    category: 'hosting',
    headers: {
      'x-vercel-id': /.+/,
      'x-vercel-cache': /.+/,
      'server': /Vercel/i,
    },
    html: [
      /vercel\.app/i,
    ],
  },
  {
    tool_name: 'Netlify',
    category: 'hosting',
    headers: {
      'x-nf-request-id': /.+/,
      'server': /Netlify/i,
    },
    html: [
      /netlify/i,
    ],
  },
  {
    tool_name: 'AWS',
    category: 'hosting',
    headers: {
      'x-amzn-requestid': /.+/,
      'server': /AmazonS3/i,
    },
    html: [
      /amazonaws\.com/i,
      /elasticbeanstalk\.com/i,
      /s3\.amazonaws\.com/i,
    ],
  },
  {
    tool_name: 'Google Cloud',
    category: 'hosting',
    headers: {
      'x-cloud-trace-context': /.+/,
      'server': /Google Frontend/i,
    },
    html: [
      /appspot\.com/i,
      /run\.app/i,
    ],
  },
  {
    tool_name: 'Azure',
    category: 'hosting',
    headers: {
      'x-azure-ref': /.+/,
      'x-aspnet-version': /.+/,
    },
    html: [
      /azurewebsites\.net/i,
      /azure\.com/i,
    ],
  },
  {
    tool_name: 'Heroku',
    category: 'hosting',
    headers: {
      'via': /vegur/i,
    },
    html: [
      /herokuapp\.com/i,
    ],
  },
  {
    tool_name: 'DigitalOcean',
    category: 'hosting',
    html: [
      /digitaloceanspaces\.com/i,
    ],
    headers: {
      'server': /digitalocean/i,
    },
  },
  {
    tool_name: 'Fly.io',
    category: 'hosting',
    headers: {
      'fly-request-id': /.+/,
      'server': /Fly/i,
    },
  },
  {
    tool_name: 'Railway',
    category: 'hosting',
    html: [
      /railway\.app/i,
    ],
  },
  {
    tool_name: 'Render',
    category: 'hosting',
    headers: {
      'server': /Render/i,
    },
    html: [
      /onrender\.com/i,
    ],
  },
  {
    tool_name: 'WP Engine',
    category: 'hosting',
    headers: {
      'x-powered-by': /WP Engine/i,
    },
    html: [
      /wpenginepowered\.com/i,
      /wpengine\.com/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // FONTS & MEDIA (8+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Google Fonts',
    category: 'fonts_media',
    html: [
      /fonts\.googleapis\.com/i,
      /fonts\.gstatic\.com/i,
    ],
    scriptUrls: [
      /fonts\.googleapis\.com/i,
    ],
  },
  {
    tool_name: 'Adobe Fonts',
    category: 'fonts_media',
    html: [
      /use\.typekit\.net/i,
      /p\.typekit\.net/i,
    ],
    scriptUrls: [
      /use\.typekit\.net/i,
    ],
  },
  {
    tool_name: 'Font Awesome',
    category: 'fonts_media',
    html: [
      /font-?awesome/i,
      /fa-(?:solid|regular|brands|light)/i,
    ],
    scriptUrls: [
      /fontawesome/i,
      /font-awesome/i,
    ],
  },
  {
    tool_name: 'Cloudinary',
    category: 'fonts_media',
    html: [
      /res\.cloudinary\.com/i,
      /cloudinary/i,
    ],
  },
  {
    tool_name: 'YouTube Embed',
    category: 'fonts_media',
    html: [
      /youtube\.com\/embed\//i,
      /youtube-nocookie\.com\/embed\//i,
      /ytimg\.com/i,
    ],
  },
  {
    tool_name: 'Vimeo',
    category: 'fonts_media',
    html: [
      /player\.vimeo\.com/i,
      /vimeo\.com\/video\//i,
    ],
    scriptUrls: [
      /player\.vimeo\.com/i,
    ],
  },
  {
    tool_name: 'Wistia',
    category: 'fonts_media',
    html: [
      /fast\.wistia\.com/i,
      /wistia/i,
    ],
    scriptUrls: [
      /fast\.wistia\.com/i,
    ],
  },
  {
    tool_name: 'JW Player',
    category: 'fonts_media',
    scriptUrls: [
      /jwplayer/i,
      /jwpsrv\.com/i,
    ],
    html: [
      /jwplayer/i,
    ],
  },
  {
    tool_name: 'Brightcove',
    category: 'fonts_media',
    html: [
      /brightcove/i,
      /players\.brightcove\.net/i,
    ],
    scriptUrls: [
      /players\.brightcove\.net/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SECURITY (8+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'reCAPTCHA',
    category: 'security',
    scriptUrls: [
      /google\.com\/recaptcha/i,
      /gstatic\.com\/recaptcha/i,
    ],
    html: [
      /g-recaptcha/i,
      /grecaptcha/i,
    ],
  },
  {
    tool_name: 'hCaptcha',
    category: 'security',
    scriptUrls: [
      /hcaptcha\.com/i,
    ],
    html: [
      /h-captcha/i,
      /hcaptcha/i,
    ],
  },
  {
    tool_name: 'Cloudflare WAF',
    category: 'security',
    headers: {
      'cf-ray': /.+/,
    },
    html: [
      /cf-browser-verification/i,
      /cdn-cgi\/challenge-platform/i,
    ],
  },
  {
    tool_name: 'HSTS',
    category: 'security',
    headers: {
      'strict-transport-security': /.+/,
    },
  },
  {
    tool_name: 'Content Security Policy',
    category: 'security',
    headers: {
      'content-security-policy': /.+/,
    },
  },
  {
    tool_name: 'X-Frame-Options',
    category: 'security',
    headers: {
      'x-frame-options': /.+/,
    },
  },
  {
    tool_name: 'Wordfence',
    category: 'security',
    html: [
      /wordfence/i,
      /wfwaf-/i,
    ],
    scriptUrls: [
      /wordfence/i,
    ],
  },
  {
    tool_name: 'Sucuri',
    category: 'security',
    headers: {
      'x-sucuri-id': /.+/,
      'server': /Sucuri/i,
    },
    html: [
      /sucuri\.net/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PERFORMANCE / ERROR MONITORING (8+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Sentry',
    category: 'error_monitoring',
    scriptUrls: [
      /browser\.sentry-cdn\.com/i,
      /sentry\.io/i,
    ],
    html: [
      /Sentry\.init/i,
      /sentry/i,
    ],
  },
  {
    tool_name: 'New Relic',
    category: 'performance',
    scriptUrls: [
      /nr-data\.net/i,
      /js-agent\.newrelic\.com/i,
    ],
    html: [
      /NREUM/i,
      /newrelic/i,
    ],
  },
  {
    tool_name: 'Datadog RUM',
    category: 'performance',
    scriptUrls: [
      /datadoghq\.com/i,
      /datadog-rum/i,
    ],
    html: [
      /DD_RUM/i,
      /dd_rum/i,
      /datadogRum/i,
    ],
  },
  {
    tool_name: 'Dynatrace',
    category: 'performance',
    scriptUrls: [
      /dynatrace/i,
      /ruxit/i,
    ],
    html: [
      /dynatrace/i,
      /dtrum/i,
    ],
  },
  {
    tool_name: 'Bugsnag',
    category: 'error_monitoring',
    scriptUrls: [
      /d2wy8f7a9ursnm\.cloudfront\.net/i,
      /bugsnag/i,
    ],
    html: [
      /Bugsnag\.start/i,
      /bugsnag/i,
    ],
  },
  {
    tool_name: 'SpeedCurve',
    category: 'performance',
    scriptUrls: [
      /cdn\.speedcurve\.com/i,
    ],
    html: [
      /speedcurve/i,
      /LUX\.init/i,
    ],
  },
  {
    tool_name: 'Rollbar',
    category: 'error_monitoring',
    scriptUrls: [
      /rollbar\.com/i,
      /cdn\.rollbar\.com/i,
    ],
    html: [
      /Rollbar\.init/i,
    ],
  },
  {
    tool_name: 'TrackJS',
    category: 'error_monitoring',
    scriptUrls: [
      /tracker\.js/i,
      /cdn\.trackjs\.com/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // UX WIDGETS (8+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Trustpilot',
    category: 'ux_widgets',
    scriptUrls: [
      /widget\.trustpilot\.com/i,
    ],
    html: [
      /trustpilot/i,
      /tp-widget/i,
    ],
  },
  {
    tool_name: 'Yotpo',
    category: 'ux_widgets',
    scriptUrls: [
      /staticw2\.yotpo\.com/i,
    ],
    html: [
      /yotpo/i,
    ],
  },
  {
    tool_name: 'Bazaarvoice',
    category: 'ux_widgets',
    scriptUrls: [
      /bazaarvoice\.com/i,
      /display\.ugc\.bazaarvoice/i,
    ],
    html: [
      /bazaarvoice/i,
      /bvapi/i,
      /BVRRWidget/i,
    ],
  },
  {
    tool_name: 'OptinMonster',
    category: 'ux_widgets',
    scriptUrls: [
      /a\.omappapi\.com/i,
      /optinmonster/i,
    ],
    html: [
      /optinmonster/i,
    ],
  },
  {
    tool_name: 'Privy',
    category: 'ux_widgets',
    scriptUrls: [
      /widget\.privy\.com/i,
      /privy\.com/i,
    ],
    html: [
      /privy/i,
    ],
  },
  {
    tool_name: 'Calendly',
    category: 'ux_widgets',
    scriptUrls: [
      /assets\.calendly\.com/i,
    ],
    html: [
      /calendly/i,
      /calendly-inline-widget/i,
    ],
  },
  {
    tool_name: 'Typeform',
    category: 'ux_widgets',
    scriptUrls: [
      /embed\.typeform\.com/i,
    ],
    html: [
      /typeform/i,
    ],
  },
  {
    tool_name: 'Judge.me',
    category: 'ux_widgets',
    scriptUrls: [
      /judge\.me/i,
    ],
    html: [
      /judge\.me/i,
      /jdgm/i,
    ],
  },
  {
    tool_name: 'Sumo',
    category: 'ux_widgets',
    scriptUrls: [
      /sumo\.com/i,
      /load\.sumo\.com/i,
    ],
    html: [
      /sumo-/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // A/B TESTING (6+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Optimizely',
    category: 'ab_testing',
    scriptUrls: [
      /cdn\.optimizely\.com/i,
      /optimizely\.com\/js/i,
    ],
    html: [
      /optimizely/i,
    ],
    cookies: [
      /^optimizelyEndUserId$/,
    ],
  },
  {
    tool_name: 'VWO',
    category: 'ab_testing',
    scriptUrls: [
      /dev\.visualwebsiteoptimizer\.com/i,
    ],
    html: [
      /visualwebsiteoptimizer/i,
      /vwo_/i,
      /VWO\s*=/i,
    ],
    cookies: [
      /^_vwo_/,
      /^_vis_opt_/,
    ],
  },
  {
    tool_name: 'AB Tasty',
    category: 'ab_testing',
    scriptUrls: [
      /abtasty\.com/i,
      /try\.abtasty\.com/i,
    ],
    html: [
      /abtasty/i,
      /ABTasty/i,
    ],
    cookies: [
      /^ABTasty$/,
    ],
  },
  {
    tool_name: 'Google Optimize',
    category: 'ab_testing',
    scriptUrls: [
      /optimize\.google\.com/i,
      /googleoptimize\.com/i,
    ],
    html: [
      /google_optimize/i,
    ],
    cookies: [
      /^__gaexp$/,
    ],
  },
  {
    tool_name: 'LaunchDarkly',
    category: 'ab_testing',
    scriptUrls: [
      /app\.launchdarkly\.com/i,
      /sdk\.launchdarkly\.com/i,
    ],
    html: [
      /launchdarkly/i,
    ],
  },
  {
    tool_name: 'Kameleoon',
    category: 'ab_testing',
    scriptUrls: [
      /kameleoon\.com/i,
    ],
    html: [
      /kameleoon/i,
    ],
  },
  {
    tool_name: 'Convert',
    category: 'ab_testing',
    scriptUrls: [
      /cdn-\d+\.convertexperiments\.com/i,
    ],
    html: [
      /convert\.com/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PERSONALIZATION (5+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Dynamic Yield',
    category: 'personalization',
    scriptUrls: [
      /cdn\.dynamicyield\.com/i,
    ],
    html: [
      /dynamicyield/i,
      /DY\.recommend/i,
    ],
    cookies: [
      /^_dy/,
    ],
  },
  {
    tool_name: 'Algolia',
    category: 'personalization',
    scriptUrls: [
      /algoliasearch/i,
      /algolia\.net/i,
    ],
    html: [
      /algolia/i,
      /algoliasearch/i,
    ],
  },
  {
    tool_name: 'Bloomreach',
    category: 'personalization',
    scriptUrls: [
      /cdn\.brcdn\.com/i,
    ],
    html: [
      /bloomreach/i,
      /pathfora/i,
      /brcdn\.com/i,
    ],
  },
  {
    tool_name: 'Nosto',
    category: 'personalization',
    scriptUrls: [
      /connect\.nosto\.com/i,
    ],
    html: [
      /nostojs/i,
      /nosto/i,
    ],
  },
  {
    tool_name: 'Insider',
    category: 'personalization',
    scriptUrls: [
      /insnw\.net/i,
      /useinsider\.com/i,
    ],
    html: [
      /useinsider/i,
      /Insider\.init/i,
    ],
  },
  {
    tool_name: 'Coveo',
    category: 'personalization',
    scriptUrls: [
      /static\.cloud\.coveo\.com/i,
    ],
    html: [
      /coveo/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ACCESSIBILITY (3+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'AccessiBe',
    category: 'accessibility',
    scriptUrls: [
      /acsbapp\.com/i,
      /acsbap\.com/i,
    ],
    html: [
      /acsb-trigger/i,
      /accessibe/i,
    ],
  },
  {
    tool_name: 'UserWay',
    category: 'accessibility',
    scriptUrls: [
      /cdn\.userway\.org/i,
      /userway\.org/i,
    ],
    html: [
      /userway/i,
    ],
  },
  {
    tool_name: 'AudioEye',
    category: 'accessibility',
    scriptUrls: [
      /audioeye\.com/i,
    ],
    html: [
      /audioeye/i,
    ],
  },
  {
    tool_name: 'EqualWeb',
    category: 'accessibility',
    scriptUrls: [
      /equalweb\.com/i,
    ],
    html: [
      /equalweb/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // EMAIL (5+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Mailchimp',
    category: 'email_platform',
    html: [
      /chimpstatic\.com/i,
      /list-manage\.com/i,
      /mailchimp/i,
    ],
    scriptUrls: [
      /chimpstatic\.com/i,
    ],
  },
  {
    tool_name: 'SendGrid',
    category: 'email_platform',
    html: [
      /sendgrid\.net/i,
      /sendgrid/i,
    ],
  },
  {
    tool_name: 'Brevo',
    category: 'email_platform',
    scriptUrls: [
      /sibautomation\.com/i,
      /sendinblue\.com/i,
      /brevo\.com/i,
    ],
    html: [
      /sendinblue/i,
      /brevo/i,
    ],
  },
  {
    tool_name: 'ConvertKit',
    category: 'email_platform',
    scriptUrls: [
      /convertkit\.com/i,
    ],
    html: [
      /convertkit/i,
    ],
  },
  {
    tool_name: 'Constant Contact',
    category: 'email_platform',
    scriptUrls: [
      /ctctcdn\.com/i,
    ],
    html: [
      /constantcontact/i,
      /ctctcdn\.com/i,
    ],
  },
  {
    tool_name: 'Campaign Monitor',
    category: 'email_platform',
    html: [
      /createsend\.com/i,
      /campaignmonitor/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // AFFILIATE (5+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Impact',
    category: 'affiliate',
    scriptUrls: [
      /impact\.com/i,
      /impact-ad\.com/i,
    ],
    html: [
      /impact\.com/i,
    ],
  },
  {
    tool_name: 'Commission Junction',
    category: 'affiliate',
    scriptUrls: [
      /dpbolvw\.net/i,
      /jdoqocy\.com/i,
      /anrdoezrs\.net/i,
    ],
    html: [
      /cj\.com/i,
      /commission-junction/i,
    ],
  },
  {
    tool_name: 'ShareASale',
    category: 'affiliate',
    scriptUrls: [
      /shareasale\.com/i,
    ],
    html: [
      /shareasale/i,
    ],
  },
  {
    tool_name: 'Awin',
    category: 'affiliate',
    scriptUrls: [
      /awin1\.com/i,
      /dwin1\.com/i,
    ],
    html: [
      /awin/i,
    ],
    cookies: [
      /^_aw_m_/,
    ],
  },
  {
    tool_name: 'Rakuten Advertising',
    category: 'affiliate',
    scriptUrls: [
      /rakuten\.com/i,
    ],
    html: [
      /rakuten/i,
    ],
  },
  {
    tool_name: 'Partnerize',
    category: 'affiliate',
    scriptUrls: [
      /partnerize\.com/i,
      /prf\.hn/i,
    ],
    html: [
      /partnerize/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // IMAGE OPTIMIZATION (5+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Cloudinary',
    category: 'image_optimization',
    html: [
      /res\.cloudinary\.com/i,
    ],
  },
  {
    tool_name: 'Imgix',
    category: 'image_optimization',
    html: [
      /imgix\.net/i,
      /\.imgix\.com/i,
    ],
  },
  {
    tool_name: 'next/image',
    category: 'image_optimization',
    html: [
      /\/_next\/image\?/i,
    ],
  },
  {
    tool_name: 'Sirv',
    category: 'image_optimization',
    html: [
      /sirv\.com/i,
    ],
    scriptUrls: [
      /sirv\.com/i,
    ],
  },
  {
    tool_name: 'ImageEngine',
    category: 'image_optimization',
    html: [
      /imgeng\.in/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SOCIAL (3+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Facebook SDK',
    category: 'social',
    scriptUrls: [
      /connect\.facebook\.net\/[a-z_]+\/sdk\.js/i,
    ],
    html: [
      /fb-root/i,
      /FB\.init/i,
    ],
  },
  {
    tool_name: 'AddThis',
    category: 'social',
    scriptUrls: [
      /addthis\.com/i,
      /s7\.addthis\.com/i,
    ],
    html: [
      /addthis/i,
    ],
  },
  {
    tool_name: 'ShareThis',
    category: 'social',
    scriptUrls: [
      /sharethis\.com/i,
      /platform-api\.sharethis\.com/i,
    ],
    html: [
      /sharethis/i,
    ],
  },
  {
    tool_name: 'Disqus',
    category: 'social',
    scriptUrls: [
      /disqus\.com/i,
    ],
    html: [
      /disqus/i,
      /disqus_thread/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CUSTOMER DATA / CDP (4+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Segment',
    category: 'customer_data',
    scriptUrls: [
      /cdn\.segment\.com/i,
    ],
    html: [
      /analytics\.identify/i,
    ],
  },
  {
    tool_name: 'mParticle',
    category: 'customer_data',
    scriptUrls: [
      /jssdkcdns\.mparticle\.com/i,
    ],
    html: [
      /mparticle/i,
    ],
  },
  {
    tool_name: 'Tealium AudienceStream',
    category: 'customer_data',
    html: [
      /tealium/i,
      /audiencestream/i,
    ],
  },
  {
    tool_name: 'BlueConic',
    category: 'customer_data',
    scriptUrls: [
      /blueconic\.net/i,
    ],
    html: [
      /blueconic/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // DNS & SSL (3+ rules)
  // ─────────────────────────────────────────────────────────────────────────
  {
    tool_name: 'Cloudflare DNS',
    category: 'dns',
    headers: {
      'cf-ray': /.+/,
    },
  },
  {
    tool_name: 'Let\'s Encrypt',
    category: 'dns',
    html: [
      /letsencrypt/i,
    ],
  },
]


/* ═══════════════════════════════════════════════════════════════════════════
 * runPatternMatching
 *
 * Evaluates every PatternRule against the provided signals and returns
 * a deduplicated, sorted array of PatternMatch results.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function runPatternMatching(params: {
  html: string
  headers: Record<string, string>
  scripts: string[]
  cookies: string[]
  metas: string[]
}): PatternMatch[] {
  const { html, headers, scripts, cookies, metas } = params

  // Normalise header keys to lower-case once
  const lcHeaders: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    lcHeaders[k.toLowerCase()] = v
  }

  // Collect all raw matches (may contain duplicates)
  const raw: PatternMatch[] = []

  for (const rule of DETECTION_PATTERNS) {
    const evidences: string[] = []

    // ── Headers ──
    if (rule.headers) {
      for (const [hdrKey, hdrRegex] of Object.entries(rule.headers)) {
        const val = lcHeaders[hdrKey.toLowerCase()]
        if (val !== undefined && hdrRegex.test(val)) {
          evidences.push(`header ${hdrKey}: ${val.slice(0, 80)}`)
        }
      }
    }

    // ── Cookies ──
    if (rule.cookies) {
      for (const cookieRegex of rule.cookies) {
        for (const c of cookies) {
          // Cookie string may be "name=value" or just "name"
          const cookieName = c.split('=')[0].trim()
          if (cookieRegex.test(cookieName)) {
            evidences.push(`cookie: ${cookieName}`)
          }
        }
      }
    }

    // ── Script URLs ──
    if (rule.scriptUrls) {
      for (const urlRegex of rule.scriptUrls) {
        for (const s of scripts) {
          if (urlRegex.test(s)) {
            evidences.push(`script: ${s.slice(0, 120)}`)
          }
        }
      }
    }

    // ── HTML body ──
    if (rule.html) {
      for (const htmlRegex of rule.html) {
        const m = htmlRegex.exec(html)
        if (m) {
          // Extract a concise snippet around the match
          const start = Math.max(0, m.index - 10)
          const end = Math.min(html.length, m.index + m[0].length + 10)
          evidences.push(`html: ${html.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 100)}`)
        }
      }
    }

    // ── Meta tags ──
    // metas come as raw <meta .../> strings; we parse name/property + content
    if (rule.meta) {
      for (const metaRule of rule.meta) {
        for (const metaStr of metas) {
          const nameMatch = metaStr.match(/(?:name|property)=["']([^"']+)["']/i)
          const contentMatch = metaStr.match(/content=["']([^"']+)["']/i)

          if (metaRule.name && nameMatch) {
            const nameVal = nameMatch[1]
            const contentVal = contentMatch ? contentMatch[1] : ''
            if (metaRule.name.test(nameVal)) {
              if (metaRule.content) {
                if (metaRule.content.test(contentVal)) {
                  evidences.push(`meta ${nameVal}="${contentVal.slice(0, 80)}"`)
                }
              } else {
                evidences.push(`meta name="${nameVal}"`)
              }
            }
          }
        }
      }
    }

    // ── Produce match if any evidence found ──
    if (evidences.length > 0) {
      // Deduplicate evidence strings for this rule
      const uniqueEvidences = Array.from(new Set(evidences))

      // Determine confidence
      const confidence = computeConfidence(rule, uniqueEvidences)

      // Try to extract version from evidence strings
      const version = extractVersion(rule, uniqueEvidences, html)

      raw.push({
        category: rule.category,
        tool_name: rule.tool_name,
        confidence,
        evidence: uniqueEvidences.slice(0, 5).join('; '),
        tool_version: version,
      })
    }
  }

  // ── Deduplicate: same tool_name + category -> keep highest confidence ──
  const deduped = new Map<string, PatternMatch>()
  for (const m of raw) {
    const key = `${m.category}::${m.tool_name}`
    const existing = deduped.get(key)
    if (!existing || m.confidence > existing.confidence) {
      // Merge evidence if the existing one had different evidence
      if (existing) {
        const mergedEvidence = existing.evidence + '; ' + m.evidence
        deduped.set(key, {
          ...m,
          evidence: mergedEvidence.slice(0, 500),
          tool_version: m.tool_version || existing.tool_version,
        })
      } else {
        deduped.set(key, m)
      }
    } else if (existing && !existing.tool_version && m.tool_version) {
      existing.tool_version = m.tool_version
    }
  }

  // Sort by confidence desc, then category, then tool_name
  const results = Array.from(deduped.values())
  results.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence
    if (a.category !== b.category) return a.category.localeCompare(b.category)
    return a.tool_name.localeCompare(b.tool_name)
  })

  return results
}


/* ═══════════════════════════════════════════════════════════════════════════
 * Internal helpers
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Compute confidence score based on how many independent signal types matched.
 *
 * - 1 signal type  -> 0.80 (single source)
 * - 2 signal types -> 0.90 (corroborated)
 * - 3+ signal types -> 0.95 (definitive)
 *
 * Header-only security rules (HSTS, CSP, X-Frame-Options) get 0.95 since
 * they are unambiguous by nature.
 */
function computeConfidence(rule: PatternRule, evidences: string[]): number {
  // Count distinct signal types
  const types = new Set<string>()
  for (const e of evidences) {
    if (e.startsWith('header ')) types.add('header')
    else if (e.startsWith('cookie:')) types.add('cookie')
    else if (e.startsWith('script:')) types.add('script')
    else if (e.startsWith('html:')) types.add('html')
    else if (e.startsWith('meta ')) types.add('meta')
  }

  // Security headers are definitive single-source signals
  const definitiveHeaders = ['HSTS', 'Content Security Policy', 'X-Frame-Options']
  if (definitiveHeaders.includes(rule.tool_name)) {
    return 0.95
  }

  if (types.size >= 3) return 0.95
  if (types.size === 2) return 0.90
  // Stronger single signals (header matches, unique cookies) get 0.85
  if (types.has('header') || types.has('cookie')) return 0.85
  return 0.80
}

/**
 * Attempt to extract a version string from evidence or raw HTML.
 *
 * Checks for common version patterns in:
 * - Meta generator tags  (WordPress 6.4.2, Drupal 10, etc.)
 * - Script URL version segments  (jquery-3.7.1.min.js, bootstrap@5.3.2)
 * - Angular ng-version attribute
 * - Inline JS version assignments
 */
function extractVersion(
  rule: PatternRule,
  evidences: string[],
  html: string,
): string | null {
  // 1. Check meta generator tags in evidence
  for (const e of evidences) {
    if (e.startsWith('meta ')) {
      const vMatch = e.match(/(\d+(?:\.\d+){1,3})/)
      if (vMatch) return vMatch[1]
    }
  }

  // 2. Tool-specific version extraction
  switch (rule.tool_name) {
    case 'Angular': {
      const m = html.match(/ng-version="(\d[\d.]+)"/i)
      if (m) return m[1]
      break
    }
    case 'jQuery': {
      // From script URL
      for (const e of evidences) {
        const m = e.match(/jquery[.-](\d[\d.]+)/i)
        if (m) return m[1]
      }
      // From inline
      const jqHtml = html.match(/jQuery\s*(?:v|\.fn\.jquery\s*=\s*["'])(\d[\d.]+)/i)
      if (jqHtml) return jqHtml[1]
      break
    }
    case 'Bootstrap': {
      for (const e of evidences) {
        const m = e.match(/bootstrap[.@-](\d[\d.]+)/i)
        if (m) return m[1]
      }
      break
    }
    case 'WordPress': {
      const m = html.match(/WordPress\s+([\d.]+)/i)
      if (m) return m[1]
      break
    }
    case 'Drupal': {
      const m = html.match(/Drupal\s+([\d.]+)/i)
      if (m) return m[1]
      break
    }
    case 'Ghost': {
      const m = html.match(/Ghost\s+([\d.]+)/i)
      if (m) return m[1]
      break
    }
    case 'Astro': {
      const m = html.match(/Astro\s*v?([\d.]+)/i)
      if (m) return m[1]
      break
    }
    case 'Next.js': {
      const m = html.match(/"version"\s*:\s*"(\d[\d.]+)"/i)
      if (m) return m[1]
      break
    }
    default:
      break
  }

  // 3. Generic version extraction from script URL evidence
  for (const e of evidences) {
    if (e.startsWith('script:')) {
      const m = e.match(/[/@-](\d+\.\d+(?:\.\d+)?)/i)
      if (m) return m[1]
    }
  }

  return null
}
