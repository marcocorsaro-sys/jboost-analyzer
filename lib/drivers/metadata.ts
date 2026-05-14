// Driver metadata catalog — static, human-readable description of what each
// driver does under the hood. Surfaced in the "Dettagli" section of the
// DriverDetail card so the user can see exactly which API was hit, which
// fields were read, and how the score is computed.
//
// Kept in sync with the calc functions in lib/analyses/run-analysis.ts.

import type { DriverKey } from '@/lib/constants';

export interface DriverDataSource {
  /** Provider name as the user knows it (e.g., "SEMrush", "Ahrefs"). */
  provider: string;
  /** Specific endpoint or fetcher invoked. */
  endpoint: string;
  /** Concrete fields read from the response. */
  fields: string[];
}

export interface DriverMetadata {
  /** Plain-language summary of WHAT this driver measures and why. */
  whatItMeasures: string;
  /** External data sources used to compute the deterministic score. */
  sources: DriverDataSource[];
  /** Plain-language description of the scoring formula. */
  formula: string;
  /** Range / interpretation hints for the user. */
  scoring: string;
  /** Notes on the LLM layer added on top (driver-agent). */
  llmLayer: string;
}

export const DRIVER_METADATA: Record<DriverKey, DriverMetadata> = {
  compliance: {
    whatItMeasures:
      'Salute tecnica del sito: errori di crawling, redirect, meta tag mancanti o duplicati, problemi HTTPS, broken link.',
    sources: [
      {
        provider: 'SEMrush',
        endpoint: 'Site Audit — Domain Overview',
        fields: ['site_health_score', 'issues[]', 'pages_crawled'],
      },
      {
        provider: 'Google PageSpeed Insights',
        endpoint: 'Lighthouse SEO category (mobile)',
        fields: ['seo_score'],
      },
    ],
    formula:
      'Preferisce il valore di seo_score (Lighthouse) se presente, altrimenti fa fallback su site_health_score (SEMrush). In entrambi i casi il risultato viene normalizzato e clampato a 0–100.',
    scoring: '0–100 — più alto = sito più "pulito" tecnicamente.',
    llmLayer:
      'Il driver-agent (Claude Sonnet 4) legge punteggio + issues + raw_data e può chiedere chiarimenti su redesign recenti, sezioni escluse dal crawler, ecc.',
  },

  experience: {
    whatItMeasures:
      'Performance percepita dall\'utente su mobile (Core Web Vitals: LCP, CLS, TBT).',
    sources: [
      {
        provider: 'Google PageSpeed Insights',
        endpoint: 'Lighthouse Performance (mobile)',
        fields: ['performance_score', 'lcp', 'cls', 'tbt'],
      },
    ],
    formula:
      'performance_score Lighthouse moltiplicato ×100 se in scala 0–1, poi clampato a 0–100. Nessuna riponderazione manuale.',
    scoring: '0–100 — Google considera "buono" sopra 90 (mobile).',
    llmLayer:
      'Il driver-agent può chiedere quale device target è prioritario (mobile-first vs desktop-heavy), se sono in corso ottimizzazioni note, ecc.',
  },

  discoverability: {
    whatItMeasures:
      'Visibilità organica del dominio nei motori di ricerca: ranking SEMrush, parole chiave organiche, traffico stimato.',
    sources: [
      {
        provider: 'SEMrush',
        endpoint: 'Domain Overview',
        fields: ['rank', 'organicKeywords', 'organicTraffic'],
      },
    ],
    formula:
      'Score derivato dal rank globale SEMrush con curva inversa (rank basso = score alto). Soglie: top 1k → ~95, top 50k → ~70, top 200k → ~50.',
    scoring: '0–100 — più alto = più visibile organicamente.',
    llmLayer:
      'Il driver-agent può chiedere su quali query/topic state puntando, se sono geo-locali o nazionali, se ci sono content gap noti.',
  },

  content: {
    whatItMeasures:
      'Qualità complessiva dei contenuti — densità di errori site-audit + lunghezza/struttura + segnali di engagement indiretto.',
    sources: [
      {
        provider: 'SEMrush',
        endpoint: 'Site Audit',
        fields: ['issues[].type (notice|warning|error)', 'pages_crawled'],
      },
      {
        provider: 'Google PageSpeed Insights',
        endpoint: 'Lighthouse SEO + Best Practices',
        fields: ['seo_score', 'best_practices_score'],
      },
      {
        provider: 'SEMrush',
        endpoint: 'Domain Overview',
        fields: ['organicKeywords'],
      },
    ],
    formula:
      'Score composito: penalità per error/warning per pagina dal site audit, bonus per Lighthouse SEO score, normalizzazione finale a 0–100.',
    scoring: '0–100 — più alto = contenuti più sani e ben strutturati.',
    llmLayer:
      'Il driver-agent può chiedere se esiste una content strategy editoriale, frequenza di pubblicazione, target audience.',
  },

  accessibility: {
    whatItMeasures:
      'Conformità WCAG (contrasti, attributi alt, navigazione da tastiera, struttura semantica).',
    sources: [
      {
        provider: 'Google PageSpeed Insights',
        endpoint: 'Lighthouse Accessibility (mobile)',
        fields: ['accessibility_score'],
      },
    ],
    formula:
      'accessibility_score Lighthouse direttamente clampato a 0–100.',
    scoring: '0–100 — Google considera "buono" sopra 90.',
    llmLayer:
      'Il driver-agent può chiedere se ci sono audit WCAG già fatti, target normativo (AGID, ADA, EAA), bacino utenti con disabilità.',
  },

  authority: {
    whatItMeasures:
      'Autorità del dominio basata su quantità e qualità dei backlink.',
    sources: [
      {
        provider: 'Ahrefs',
        endpoint: 'Domain Rating',
        fields: ['domain_rating (0–100)', 'ahrefs_rank'],
      },
      {
        provider: 'Ahrefs',
        endpoint: 'Refdomains History',
        fields: ['refdomains over time'],
      },
    ],
    formula:
      'Domain Rating Ahrefs direttamente clampato a 0–100. Lo storico refdomains viene mostrato nel raw_data per contesto.',
    scoring: '0–100 — sopra 60 = autorità alta nel proprio mercato.',
    llmLayer:
      'Il driver-agent può chiedere se è in corso una campagna di link-building, se ci sono backlink tossici noti, eventi PR recenti.',
  },

  aso_visibility: {
    whatItMeasures:
      'Presenza nelle ricerche a pagamento (paid SEM) come proxy di copertura del funnel commerciale.',
    sources: [
      {
        provider: 'SEMrush',
        endpoint: 'Domain Overview — Adwords metrics',
        fields: ['adwordsKeywords', 'adwordsTraffic', 'adwordsCost'],
      },
    ],
    formula:
      'Score logaritmico su numero di adwordsKeywords (scala log perché la distribuzione è molto skewed).',
    scoring: '0–100 — più alto = più investimento/copertura paid.',
    llmLayer:
      'Il driver-agent può chiedere se SEM è una leva attivamente usata o se il dato è puramente passivo.',
  },

  ai_relevance: {
    whatItMeasures:
      'Presenza del dominio nelle AI Overviews di Google e nei Featured Snippets — proxy di "ottimizzazione per AI search".',
    sources: [
      {
        provider: 'Ahrefs (fallback)',
        endpoint: 'AI Relevance Score',
        fields: ['ai_relevance_score', 'ai_overview_keywords', 'featured_snippet_keywords'],
      },
      {
        provider: 'DataForSEO (prioritario, se attivo)',
        endpoint: 'AI Overview Scan su top 100 keyword del dominio',
        fields: ['aiOverviewPercentage', 'successCount', 'totalKeywords'],
      },
    ],
    formula:
      'Se DataForSEO è attivo (flag USE_DATAFORSEO_AI_RELEVANCE) usa la percentuale di keyword in cui il dominio compare in AI Overview. Altrimenti usa lo score Ahrefs.',
    scoring: '0–100 — sopra 30 è raro, sopra 50 = forte presenza in risposte AI.',
    llmLayer:
      'Il driver-agent può chiedere se i contenuti sono stati esplicitamente ottimizzati per LLM (schema markup, contenuti recenti, FAQ), se ci sono pagine specifiche da spingere.',
  },

  awareness: {
    whatItMeasures:
      'Brand awareness derivata da trend di traffico/keyword brand-related nel tempo.',
    sources: [
      {
        provider: 'SEMrush',
        endpoint: 'Brand Awareness — serie storica 6 mesi',
        fields: ['date, rank, organicKeywords, organicTraffic'],
      },
      {
        provider: 'SEMrush',
        endpoint: 'Branded Keywords',
        fields: ['count', 'totalBrandedTraffic'],
      },
    ],
    formula:
      'Trend a 6 mesi del traffico organico, normalizzato e clampato. Volume di branded keywords funge da modulatore.',
    scoring: '0–100 — più alto = brand più cercato/ricordato.',
    llmLayer:
      'Il driver-agent può chiedere se ci sono campagne offline in corso, eventi/lanci recenti, target geografico del brand.',
  },
};
