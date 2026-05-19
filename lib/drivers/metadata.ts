// Driver metadata catalog — surfaced in the "Dettagli" panel of each
// DriverDetail card. For every driver explains:
//   - whatItMeasures  : what business question it answers
//   - dataSpecifics   : exact data points fetched (granularity, sample size, freshness)
//   - technology      : the API/SDK + auth + concrete endpoint hit
//   - sources         : machine-readable per-provider listing for UI rendering
//   - formula         : prose description of the math
//   - formulaExample  : a worked numeric example
//   - scoring         : range/meaning
//   - scoreBands      : explicit bands with thresholds + interpretation
//   - considerationsLogic : how the score is translated into observations + recommendations
//   - llmLayer        : the LLM layer wrapped around the deterministic calc
//
// Kept in sync with the calc functions in lib/drivers/*.ts.

import type { DriverKey } from '@/lib/constants';

export interface DriverDataSource {
  provider: string;
  endpoint: string;
  fields: string[];
}

export interface DriverScoreBand {
  range: string;
  label: string;
  meaning: string;
  color: 'green' | 'teal' | 'amber' | 'red';
}

export interface DriverMetadata {
  whatItMeasures: string;
  dataSpecifics: string;
  technology: string;
  sources: DriverDataSource[];
  formula: string;
  formulaExample: string;
  scoring: string;
  scoreBands: DriverScoreBand[];
  considerationsLogic: string;
  llmLayer: string;
}

const BAND_HIGH: DriverScoreBand['color'] = 'green';
const BAND_MID: DriverScoreBand['color'] = 'teal';
const BAND_LOW: DriverScoreBand['color'] = 'amber';
const BAND_CRIT: DriverScoreBand['color'] = 'red';

export const DRIVER_METADATA: Record<DriverKey, DriverMetadata> = {
  compliance: {
    whatItMeasures:
      'Salute tecnica del sito agli occhi di un motore di ricerca: presenza di errori di crawl, redirect rotti, meta tag mancanti o duplicati, problemi HTTPS/SSL, broken link interni, dimensione media delle pagine.',
    dataSpecifics:
      'SEMrush Site Audit esegue un crawl fino a 100 pagine del dominio e classifica i problemi rilevati in Errors / Warnings / Notices. Lo score `site_health_score` è già una sintesi 0-100 ponderata da SEMrush. Lighthouse SEO controlla 11 audit specifici (canonical, robots.txt, viewport, ecc.) e ritorna un punteggio 0-1.',
    technology:
      'API REST SEMrush v3 (endpoint `domain_rank`/`siteaudit_overview`, auth via `key` query param). Google PageSpeed Insights API v5 (endpoint `runPagespeed?strategy=mobile`, auth via API key, categoria=seo). Entrambi chiamati in parallelo via `Promise.allSettled` con timeout 45s.',
    sources: [
      {
        provider: 'SEMrush',
        endpoint: 'Site Audit — Domain Overview',
        fields: ['site_health_score', 'issues[]', 'pages_crawled', '_meta.is_mock'],
      },
      {
        provider: 'Google PageSpeed Insights',
        endpoint: 'Lighthouse SEO category (mobile)',
        fields: ['seo_score'],
      },
    ],
    formula:
      'Preferisce `seo_score` di Lighthouse quando disponibile (più recente e granulare), altrimenti fallback su `site_health_score` di SEMrush. Il valore in scala 0-1 viene moltiplicato per 100, poi clampato a 0-100.',
    formulaExample:
      'Lighthouse seo_score = 0.92 → score = round(92) = 92. Se Lighthouse fallisce e SEMrush ritorna site_health_score = 78 → score = 78.',
    scoring: '0-100, più alto = sito tecnicamente più pulito.',
    scoreBands: [
      { range: '90-100', label: 'Eccellente', meaning: 'Nessun errore critico, marginal gains residui.', color: BAND_HIGH },
      { range: '70-89',  label: 'Buono',      meaning: 'Pochi errori da sistemare (redirect, meta).',  color: BAND_MID },
      { range: '50-69',  label: 'Medio',      meaning: 'Audit dedicato necessario, problemi visibili.', color: BAND_LOW },
      { range: '0-49',   label: 'Critico',    meaning: 'Penalità di ranking probabili, intervento urgente.', color: BAND_CRIT },
    ],
    considerationsLogic:
      'Il sistema confronta lo score con la mediana del settore (se nota) e cita i 3 issues con più `pages_count`. Se site_health < 70 le raccomandazioni privilegiano un audit completo + fix del top issue.',
    llmLayer:
      'Il driver-agent (Claude Sonnet) legge punteggio + issues + raw_data e può chiedere chiarimenti su redesign recenti, sezioni escluse dal crawler, scelte di canonicalizzazione, ambienti staging visibili.',
  },

  experience: {
    whatItMeasures:
      'Esperienza percepita dall\'utente su mobile: quanto velocemente la pagina diventa interattiva, quanto si muove durante il caricamento (CLS), quanto l\'utente aspetta per il primo contenuto (LCP).',
    dataSpecifics:
      'Lighthouse esegue una singola run lab-based su strategia=mobile (Moto G4 simulato, 4G slow). Restituisce 6 audit core: FCP, LCP, TBT, CLS, Speed Index, TTI. Il `performance_score` è la media pesata 0-1 di questi audit (LCP 25%, TBT 30%, CLS 25%, FCP 10%, SI 10%).',
    technology:
      'Google PageSpeed Insights API v5 (`runPagespeed?strategy=mobile&category=performance`, auth API key, quota free ~25k req/giorno). Run lab-based singola — non field data CrUX.',
    sources: [
      {
        provider: 'Google PageSpeed Insights',
        endpoint: 'Lighthouse Performance (mobile)',
        fields: ['performance_score', 'lcp', 'cls', 'tbt', 'fcp', 'speed_index'],
      },
    ],
    formula:
      '`performance_score` ritornato da Lighthouse moltiplicato ×100 (se in scala 0-1), poi clampato a 0-100. Nessuna riponderazione manuale: la formula di Lighthouse è già la più diffusa industry-wide.',
    formulaExample:
      'Lighthouse ritorna performance_score=0.42 → score = round(42) = 42 (banda "media"). Audit sottostanti: LCP=4.2s, TBT=890ms, CLS=0.18.',
    scoring: '0-100. Google considera "Good" ≥90, "Needs improvement" 50-89, "Poor" <50.',
    scoreBands: [
      { range: '90-100', label: 'Eccellente', meaning: 'UX in linea con i top performer del web.', color: BAND_HIGH },
      { range: '75-89',  label: 'Buono',      meaning: 'Velocità decente, margine su LCP/CLS.',    color: BAND_MID },
      { range: '50-74',  label: 'Da migliorare', meaning: 'Risk di bounce su connessioni 4G.',    color: BAND_LOW },
      { range: '0-49',   label: 'Critico',    meaning: 'Utente abbandona prima del rendering.',   color: BAND_CRIT },
    ],
    considerationsLogic:
      'Le considerazioni citano i 3 audit con score più basso e suggeriscono interventi mirati (es. immagini WebP per LCP, code-splitting per TBT). PSI è notoriamente rumoroso (±10 punti tra run vicini), quindi le raccomandazioni richiedono trend, non singole misurazioni.',
    llmLayer:
      'Il driver-agent può chiedere se sono in corso ottimizzazioni note, qual è il device target prioritario (mobile-first vs desktop-heavy), se ci sono A/B test in atto che impattano la performance.',
  },

  discoverability: {
    whatItMeasures:
      'Quanto è facile trovare il dominio nei motori di ricerca: posizione globale, numero di keyword organiche su cui rankia, traffico organico mensile stimato.',
    dataSpecifics:
      'SEMrush Domain Overview restituisce in una singola riga CSV i contatori cumulativi del dominio nel database del paese selezionato (es. database=it, us). Tre campi chiave: rank globale (Rk, più basso=più visibile), organicKeywords (Or, num. keyword in top 100), organicTraffic (Ot, traffico mensile stimato).',
    technology:
      'API SEMrush v3 (`type=domain_rank`, auth `key` query param, database=country code ISO). Output: CSV semicolon-separated. Parsing custom con `normalizeSemrushRow`.',
    sources: [
      {
        provider: 'SEMrush',
        endpoint: 'Domain Overview — type=domain_rank',
        fields: ['Rk (rank)', 'Or (organicKeywords)', 'Ot (organicTraffic)', 'Oc (organicCost)'],
      },
    ],
    formula:
      'Score primario rank-based, scala logaritmica inversa: `100 - min(90, log10(rank) × 20)`. Più basso il rank, più alto lo score. Fallback (no rank): media tra log10(organicTraffic)/8 × 100 e log10(organicKeywords)/7 × 100.',
    formulaExample:
      'rank=1000 → 100 - min(90, 3 × 20) = 40. rank=50000 → 100 - min(90, 4.7 × 20) = 6. rank=100 → 100 - 40 = 60. (Più sei in basso in classifica, peggiore lo score.)',
    scoring: '0-100. Domini top-1K mondo ≈ 95+, top-50K ≈ 70, top-200K ≈ 50.',
    scoreBands: [
      { range: '80-100', label: 'Forte',       meaning: 'Visibilità organica molto alta, copertura keyword ampia.', color: BAND_HIGH },
      { range: '60-79',  label: 'Solida',      meaning: 'Buona presenza in SERP, spazio sui topical gap.',       color: BAND_MID },
      { range: '40-59',  label: 'Media',       meaning: 'Pochi cluster di keyword presidiati.',                   color: BAND_LOW },
      { range: '0-39',   label: 'Bassa',       meaning: 'Dominio praticamente invisibile in SERP.',               color: BAND_CRIT },
    ],
    considerationsLogic:
      'Le raccomandazioni si concentrano su content gap analysis quando lo score è medio-alto, e su tactical wins (correggere title/meta delle top 20 pagine) quando lo score è basso. Considera anche il rapporto traffico/keyword (efficacia della keyword strategy).',
    llmLayer:
      'Il driver-agent può chiedere su quali query/topic state puntando, se la strategia è geo-locale o nazionale/internazionale, se ci sono content gap già noti da campagne passate.',
  },

  content: {
    whatItMeasures:
      'Salute del contenuto pubblicato: errori che impattano il crawler (404, duplicate, thin content, missing meta), best-practice tecniche (canonical, hreflang), volume di contenuti indicizzati.',
    dataSpecifics:
      'SEMrush Site Audit segnala issues[] con `type` (error/warning/notice) e `pages_count`. Lo script aggrega solo gli "error" e calcola errorRatio = totalErrorPages / pagesCrawled. Lighthouse SEO + Best Practices aggiungono segnali su canonical, robots, viewport, console errors.',
    technology:
      'SEMrush Site Audit API (`siteaudit_overview`, auth key). PageSpeed Insights (categorie SEO + best-practices). I dati vengono uniti lato application code (no join lato API).',
    sources: [
      {
        provider: 'SEMrush',
        endpoint: 'Site Audit — issues classification',
        fields: ['issues[].type', 'issues[].pages_count', '_meta.pages_crawled'],
      },
      {
        provider: 'Google PageSpeed Insights',
        endpoint: 'Lighthouse SEO + Best Practices',
        fields: ['seo_score', 'best_practices_score'],
      },
    ],
    formula:
      'Decay esponenziale sulla errorRatio: `score = max(1, 100 × e^(-errorRatio × 1.0))`. Pochissimi errori → score alto. Molti errori → score precipita.',
    formulaExample:
      '50 pagine totali, 5 con errori → errorRatio=0.1 → score = 100 × e^(-0.1) = 90. 50/50 con errori → errorRatio=1 → score = 100 × e^(-1) = 37. errorRatio=2 → score = 13.',
    scoring: '0-100. La curva è severa: 1 errore ogni 10 pagine pesa tanto quanto 5 errori ogni 50.',
    scoreBands: [
      { range: '90-100', label: 'Eccellente',  meaning: 'Pochissimi errori sulle pagine analizzate.',  color: BAND_HIGH },
      { range: '70-89',  label: 'Buono',       meaning: 'Alcune pagine con errori da sistemare.',       color: BAND_MID },
      { range: '40-69',  label: 'Da migliorare', meaning: 'Troppi 404/duplicates penalizzano il crawling.', color: BAND_LOW },
      { range: '0-39',   label: 'Critico',     meaning: 'Error ratio elevato, intervento urgente.',     color: BAND_CRIT },
    ],
    considerationsLogic:
      'Le considerazioni citano le 3 categorie di errore con più pages_count (es. "12 pagine con missing meta description"). Distingue errori "easy fix" (canonical) da errori strategici (thin content). Le raccomandazioni hanno priorità in base alla volume × severity.',
    llmLayer:
      'Il driver-agent può chiedere se esiste una content strategy editoriale, la frequenza di pubblicazione, il target audience, eventuali sezioni "legacy" da deprezzare.',
  },

  accessibility: {
    whatItMeasures:
      'Conformità WCAG agli aspetti automaticamente verificabili: alt text immagini, contrast ratio testo/sfondo, struttura semantica HTML, label per i form, focus order, ARIA attributes.',
    dataSpecifics:
      'Lighthouse Accessibility audita ~50 criteri WCAG 2.1 misurabili automaticamente (~30% del totale WCAG). Restituisce un punteggio aggregato 0-1 ponderato sulla criticità degli audit falliti.',
    technology:
      'Google PageSpeed Insights API v5 (`runPagespeed?strategy=mobile&category=accessibility`, auth API key). Single run lab-based.',
    sources: [
      {
        provider: 'Google PageSpeed Insights',
        endpoint: 'Lighthouse Accessibility (mobile)',
        fields: ['accessibility_score', 'failing_audits[]'],
      },
    ],
    formula:
      '`accessibility_score` di Lighthouse direttamente. Se in scala 0-1 → moltiplicato per 100, poi clampato a 0-100. Nessuna riponderazione.',
    formulaExample:
      'Lighthouse ritorna accessibility_score=0.88 → score=88. Audit falliti tipici: 4 immagini senza alt, 2 elementi con contrast ratio <4.5:1, 1 form senza label.',
    scoring: '0-100. Google considera "Good" ≥90.',
    scoreBands: [
      { range: '95-100', label: 'Eccellente', meaning: 'Tutti i check automatici WCAG superati.',     color: BAND_HIGH },
      { range: '80-94',  label: 'Buono',      meaning: 'Qualche aria-label/contrasto residuo.',       color: BAND_MID },
      { range: '60-79',  label: 'Media',      meaning: 'Rischio compliance, manca alt-text e label.', color: BAND_LOW },
      { range: '0-59',   label: 'Critico',    meaning: 'Problemi gravi: contrasto, semantica, alt.',   color: BAND_CRIT },
    ],
    considerationsLogic:
      'Le raccomandazioni elencano gli audit falliti più impattanti (alt mancanti, contrasti). Sottolinea che Lighthouse copre solo ~30% del WCAG: per compliance reale serve audit umano. Se il target è AGID/EAA viene suggerito un audit manuale.',
    llmLayer:
      'Il driver-agent può chiedere se esiste un target normativo (AGID, ADA, EAA Europeo 2025), se ci sono audit WCAG già fatti, qual è la quota stimata di utenti con disabilità.',
  },

  authority: {
    whatItMeasures:
      'Autorevolezza del dominio agli occhi dei motori di ricerca, basata sulla quantità + qualità dei backlink in entrata e sulla diversità dei domini referenti.',
    dataSpecifics:
      'Ahrefs Domain Rating (DR) è un punteggio proprietario 0-100 calcolato da Ahrefs analizzando: numero di domini referenti unici, qualità di ciascun referente (DR del referente), naturalezza degli anchor text, crescita nel tempo. La scala è logaritmica: DR 60 vs DR 30 = ordine di grandezza in backlink quality.',
    technology:
      'Ahrefs API v3 (endpoint `/v3/site-explorer/domain-rating`, auth Bearer token, rate limit 100 req/min). Se Ahrefs ritorna 403/429 il sistema fa fallback a un mock DR=50 e flagga `_meta.is_mock=true`.',
    sources: [
      {
        provider: 'Ahrefs',
        endpoint: 'Domain Rating + Refdomains History',
        fields: ['domain_rating (0-100)', 'ahrefs_rank', 'refdomains over time'],
      },
    ],
    formula:
      '`domain_rating` Ahrefs direttamente clampato a 0-100. Il refdomains history (serie 6 mesi) viene mostrato nel raw_data per il driver-agent.',
    formulaExample:
      'Ahrefs ritorna domain_rating=68 → score=68 (banda "alta"). Refdomains history mostra crescita da 1200 → 1450 negli ultimi 6 mesi.',
    scoring: '0-100, scala logaritmica. DR 30 è raggiungibile in qualche mese, DR 70+ richiede anni di link-building.',
    scoreBands: [
      { range: '70-100', label: 'Molto alta', meaning: 'Profilo backlink robusto e diversificato.',  color: BAND_HIGH },
      { range: '50-69',  label: 'Solida',     meaning: 'Link building costante in atto.',             color: BAND_MID },
      { range: '30-49',  label: 'Media',      meaning: 'Serve outreach mirato per scalare.',          color: BAND_LOW },
      { range: '0-29',   label: 'Bassa',      meaning: 'Profilo backlink limita il ranking potenziale.', color: BAND_CRIT },
    ],
    considerationsLogic:
      'Le considerazioni guardano sia il valore assoluto che il trend (refdomains_history). Se trend in calo → suggerisce audit per backlink persi. Se valore basso ma costante → suggerisce link-building outreach. Confronta col DR dei competitor quando disponibili.',
    llmLayer:
      'Il driver-agent può chiedere se è in corso una campagna di link-building, se ci sono backlink tossici noti da disavow, eventi PR o partnership recenti che dovrebbero aver mosso il DR.',
  },

  aso_visibility: {
    whatItMeasures:
      'Presenza del dominio nelle ricerche a pagamento (Google Ads): numero di keyword acquistate, traffico paid stimato, costo equivalente. Proxy della copertura SEM del cliente.',
    dataSpecifics:
      'SEMrush Domain Overview espone 3 campi adwords specifici nella stessa riga del rank organico: adwordsKeywords (Ad), adwordsTraffic (At), adwordsCost (Ac). Dato cumulativo nel database del paese selezionato. Non distingue tra brand bidding e generic.',
    technology:
      'SEMrush API v3 (`type=domain_rank`, stessi endpoint del Discoverability driver). Output CSV unificato.',
    sources: [
      {
        provider: 'SEMrush',
        endpoint: 'Domain Overview — Adwords metrics',
        fields: ['Ad (adwordsKeywords)', 'At (adwordsTraffic)', 'Ac (adwordsCost)'],
      },
    ],
    formula:
      'Se ci sono adwords data → media di kw_part = (log10(adwordsKeywords)/5) × 100 e traffic_part = (log10(adwordsTraffic)/7) × 100. Fallback (no adwords): rank-based ×0.6 (indicatore indiretto, moltiplicato per affidabilità minore).',
    formulaExample:
      'adwordsKeywords=500, adwordsTraffic=12000 → kw_part = (log10(500)/5)*100 = 54, traffic_part = (log10(12000)/7)*100 = 58 → score = 56. No adwords + rank=5000 → score = (100 - log10(5000)*20)*0.6 = (100-74)*0.6 = 16.',
    scoring: '0-100. Score >50 implica investimento SEM significativo. Score <30 = quasi nessuna campagna attiva o solo brand defense.',
    scoreBands: [
      { range: '70-100', label: 'Forte',  meaning: 'Campagne ads ampie e ben distribuite.',   color: BAND_HIGH },
      { range: '40-69',  label: 'Media',  meaning: 'Campagne attive ma copertura limitata.',  color: BAND_MID },
      { range: '15-39',  label: 'Bassa',  meaning: 'Poche keyword acquistate.',               color: BAND_LOW },
      { range: '0-14',   label: 'Assente', meaning: 'Nessun investimento SEM rilevato.',      color: BAND_CRIT },
    ],
    considerationsLogic:
      'Le considerazioni distinguono campagne attive (adwords>0) da fallback rank-based. Suggerisce gap-analysis tra organico e paid: keyword dove organic_rank>10 ma adwords_position<3 (opportunità di paid mentre si lavora sull\'organico).',
    llmLayer:
      'Il driver-agent può chiedere se SEM è una leva attivamente usata, se ci sono campagne stagionali, se il dato adwords vede solo il paese principale o multi-mercato.',
  },

  ai_relevance: {
    whatItMeasures:
      'Presenza del dominio dentro i blocchi generativi delle SERP: AI Overview di Google, Featured Snippets, People Also Ask. Proxy della "GEO" (Generative Engine Optimization) — quanto i contenuti vengono citati dalle AI search.',
    dataSpecifics:
      'Sorgente prioritaria DataForSEO SERP API: esegue scan SERP live su top 100 keyword del cliente e flagga la presenza di blocchi `ai_overview`, `featured_snippet`, `people_also_ask`. Ritorna `aiOverviewPercentage` = (kw con AI Overview / kw scansionate) × 100. Sorgente fallback Ahrefs: SERP features aggregati statici da organic-keywords (meno preciso, ma 0-cost extra).',
    technology:
      'DataForSEO SERP API v3 (`/v3/serp/google/organic/live/regular`, auth Basic, costo ~$0.001 per keyword). Ahrefs organic-keywords (Bearer auth, già cablato in Phase 4). Selezione runtime via flag `USE_DATAFORSEO_AI_RELEVANCE`.',
    sources: [
      {
        provider: 'DataForSEO (preferito)',
        endpoint: 'SERP live scan su top N keyword',
        fields: ['aiOverviewPercentage', 'aiOverviewCount', 'featuredSnippetCount', 'peopleAlsoAskCount', 'successCount', 'totalKeywords'],
      },
      {
        provider: 'Ahrefs (fallback)',
        endpoint: 'organic-keywords SERP features',
        fields: ['ai_relevance_score', 'ai_overview_keywords', 'featured_snippet_keywords', 'total_keywords'],
      },
    ],
    formula:
      'Se DataForSEO attivo: score = aiOverviewPercentage (già 0-100). Altrimenti Ahrefs: score = ((aiOverviewCount + featuredSnippetCount) / totalKeywords) × 100.',
    formulaExample:
      'DataForSEO scan 50 keyword → 12 con AI Overview, 8 con Featured Snippet → score = (12/50)*100 = 24. Ahrefs fallback: 200 keyword tot, 6 con AI Overview, 14 con FS → score = (6+14)/200*100 = 10.',
    scoring: '0-100. Sopra 30 è raro per qualunque dominio. Sopra 50 = forte presenza nelle risposte generative.',
    scoreBands: [
      { range: '50-100', label: 'Forte',   meaning: 'Dominio citato frequentemente in AI Overview / Featured Snippet.', color: BAND_HIGH },
      { range: '25-49',  label: 'Media',   meaning: 'Presenza intermittente, margini di ottimizzazione GEO.',          color: BAND_MID },
      { range: '10-24',  label: 'Debole',  meaning: 'Citazioni occasionali, lavoro strutturato richiesto.',            color: BAND_LOW },
      { range: '0-9',    label: 'Assente', meaning: 'Mai citato dalle AI search — opportunità GEO da zero.',           color: BAND_CRIT },
    ],
    considerationsLogic:
      'Le considerazioni distinguono: (1) score alto + DataForSEO source = stato di salute confermato, suggerisce mantenimento + monitoraggio; (2) score basso + alto traffic organico = i contenuti rankan ma non sono GEO-friendly (schema markup, FAQ, contenuti recenti); (3) sorgente Ahrefs ha confidenza media — DataForSEO suggested per insight high-stakes.',
    llmLayer:
      'Il driver-agent può chiedere se i contenuti sono stati ottimizzati per LLM (schema markup esteso, FAQ pages, contenuti aggiornati negli ultimi 6 mesi), se ci sono pagine specifiche da spingere, se DataForSEO è già stato attivato in produzione.',
  },

  awareness: {
    whatItMeasures:
      'Brand awareness derivata dal trend del traffico organico nel tempo + volume delle keyword brand-related. Proxy di quanto il brand è cercato e ricordato dagli utenti.',
    dataSpecifics:
      'SEMrush domain_rank_history restituisce serie storica 6 mesi: per ogni snapshot mensile (date, rank, organicKeywords, organicTraffic). Branded keywords endpoint filtra le keyword che contengono il nome del brand (count + totalBrandedTraffic).',
    technology:
      'SEMrush API v3 (`type=domain_rank_history` + `type=phrase_kdi` per branded). Auth `key` query param. Dataset country-specific.',
    sources: [
      {
        provider: 'SEMrush',
        endpoint: 'domain_rank_history (6 mesi)',
        fields: ['date', 'rank', 'organicKeywords', 'organicTraffic', 'latestRank', 'average', 'latest'],
      },
      {
        provider: 'SEMrush',
        endpoint: 'Branded keywords',
        fields: ['count', 'totalBrandedTraffic'],
      },
    ],
    formula:
      'Primario rank-based: `score = 100 - min(90, log10(latestRank) × 20)`. Fallback (no rank, solo traffic): `score = min(100, log10(traffic) × 10)` usando average o latest.',
    formulaExample:
      'latestRank=5000 → score = 100 - min(90, 3.7*20) = 26. average_traffic=80000 → score = log10(80000)*10 = 49. (Senza rank fa cadere su questa formula.)',
    scoring: '0-100. Per essere significativo deve essere letto insieme al trend (rank in calo nel tempo = awareness in crescita).',
    scoreBands: [
      { range: '70-100', label: 'Alta',  meaning: 'Brand ben presente nei motori di ricerca.',  color: BAND_HIGH },
      { range: '40-69',  label: 'Media', meaning: 'Visibilità consistente ma migliorabile.',     color: BAND_MID },
      { range: '20-39',  label: 'Bassa', meaning: 'Poco riconoscimento dal traffico organico.', color: BAND_LOW },
      { range: '0-19',   label: 'Critica', meaning: 'Brand quasi invisibile, awareness da costruire.', color: BAND_CRIT },
    ],
    considerationsLogic:
      'Le considerazioni guardano sia valore assoluto che trend storico. Score alto + trend stabile → awareness consolidata. Score basso + trend positivo → awareness in costruzione, suggerisce di non rompere il momentum. Score alto + trend negativo → red flag, possibili problemi di reputation o concorrenza.',
    llmLayer:
      'Il driver-agent può chiedere se ci sono campagne offline in corso (TV, podcast, eventi), lanci di prodotto recenti, target geografico del brand, eventi PR negativi che potrebbero spiegare cali.',
  },
};
