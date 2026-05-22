# JAKALA Driver Intelligence Platform — Spec v3: handoff di sessione

> Documento di stato salvato per riprendere la conversazione da un'altra macchina.
> Data: 2026-05-22. Branch: `claude/compassionate-ramanujan-qQy4n`.
> Spec sorgente allegata: `docs/Driver_Intelligence_Platform_Spec_v3.xlsx`.

## 0. Come riprendere

Stavamo ragionando, **prima di scrivere codice**, sulla specifica v3 ("definitiva")
della *JAKALA Driver Intelligence Platform*. La conversazione si è fermata su **3 domande
aperte** rivolte all'utente (vedi sezione 6). Il prossimo passo è la risposta a quelle
domande, che decide se questa spec è un prodotto nuovo, un'evoluzione di jboost-analyzer,
o un motore parallelo.

Nessuna modifica al codice applicativo è stata fatta in questa sessione: solo questo
documento di stato + copia della spec.

## 1. Stato del repository (al 2026-05-22)

- Branch di lavoro `claude/compassionate-ramanujan-qQy4n` = `origin/main` = commit **#36** (`8e184b1`). Working tree pulito.
- Tutto il lavoro fino a #36 è già su `main`. (Il ref `origin/main` locale era apparso "stale" a #22 perché un fetch era abortito; dopo `git fetch origin main` risulta allineato a #36.)
- Progetto: **JBoost Analyzer** — piattaforma di analisi SEO & digital performance (Next.js + Supabase + Vercel).

### Lavoro recente già merged (sessione 19 maggio, PR #27→#36)
- **#30** — per-driver rerun + intake prospect "URL-first" (Firecrawl + Sonnet) + pilot "Eccellenza" (AI Relevance + Authority).
- **#31 / #28** — delete clienti che cancella davvero (service-role + `.select()`).
- **#29 / #32** — CWV mai vuoti (lazy PSI fetch + cache); rerun MarTech per-categoria con cache scrape.
- **#33** — metadata driver più ricca + pannello "Dettagli" a 7 sezioni.
- **#34 / #35** — rerun ri-fetcha dati live; "Suggerisci con AI" su `/analyzer`; fix degrado compliance/content + update RLS-safe.
- **#36** — `/clients/new` usa l'intake URL-first.

### Aperto / da decidere (indipendente dalla spec v3)
1. **PR #25** (MarTech LLM-native, Firecrawl+Sonnet) — draft ma **superata** (commit già in #27). Da chiudere.
2. **PR #11** (riunificazione branch, Horizon 1 Stage 2) — draft vecchia di aprile, mai mergiata.
3. **Piano "Fingerprint Bedrock"** — fatta solo la **PR A** (#26, migration `domain_fingerprint_snapshots`). Le **PR B–G** (pipeline che popola/usa la tabella) non sono mai state fatte: tabella esiste, nessuno la riempie.

## 2. Cosa dice la spec v3 (sintesi self-contained)

Web app per assessment automatico di **10 driver SEO/GEO** su un set **fisso di 5 siti**
(cliente + esattamente 4 competitor, numero fisso, no flessibilità).

### Driver e categorie
- **6 Development** (LLM): Compliance, Schema, Speed, Accessibility, Content, Authority.
- **3 Business** (LLM): Discoverability, Awareness, Traffic.
- **AI Visibility**: manuale da J-Horizon (score + commento inseriti dall'operatore), **NON** processato da LLM.

### Normalizzazione (tutti 0-100)
- **Scala assoluta** (7): Compliance, Schema, Speed, Accessibility, Content, Authority, AI Visibility.
- **Min-max competitiva** sul cluster di 5 (3): Discoverability, Awareness, Traffic. Leader=100, ultimo=0.

### Fonti dati (una sola per driver, NESSUN fallback; su errore API → blocco driver + alert)
| Driver | Fonte | Note |
|---|---|---|
| Compliance | Semrush MCP (siteaudit_research) | crawl Site Audit, errori non-structured-data / pagine |
| Content | Semrush MCP (stesso snapshot di Compliance) | issue "content" filtrati |
| Schema | Firecrawl + KB interna (foglio 6) + fallback Schema.org context | template scrape → JSON-LD → scala 0/0.25/0.5/0.75/1.0 |
| Speed | Google PageSpeed Insights | performance score medio template, mobile+desktop |
| Accessibility | Google PageSpeed Insights (stessa chiamata di Speed) | accessibility score medio |
| Discoverability | Ahrefs (site-explorer-metrics) | org_keywords top 100, min-max |
| Authority | Ahrefs (site-explorer-domain-rating) | DR 0-100, identità |
| Awareness | Ahrefs (keywords-explorer-overview) | somma SV brand cluster, min-max |
| Traffic | SimilarWeb MCP (traffic-and-engagement) | visite medie 3 mesi, min-max; null su un dominio → blocco+alert |
| AI Visibility | J-Horizon (manuale) | nessun endpoint; futuro: API |

### Formule chiave
- Compliance: `ratio = errori_totali / crawled_pages`; `score = 100*(1-ratio)`, floor 0/ceil 100.
- Content: identica a Compliance ma su issue "content" (low_word_count, duplicate, title/meta/h1, images_missing_alt; esclusi structured data).
- Speed/Accessibility: media dei `performance_score*100` / `accessibility_score*100` su tutti i (template, strategy).
- Schema: `(media_core*0.50)+(media_content_local*0.35)+(media_supporting*0.15)`, poi *100.
- Authority: `round(domain_rating)`.
- Min-max (Discoverability/Awareness/Traffic): `100*(val_cliente-min)/(max-min)`; se max==min → 50.

### Industry preset (7) per il driver Schema
retail_luxury, banking_finance, media_publishing, travel_hospitality, b2b_services, pharma_healthcare, home_appliances.
Pesi cluster **costanti**: Core 50% / Content&Local 35% / Supporting 15%. Cambia solo il *contenuto* dei cluster.

### Schema scoring (per markup type)
- 0.00 assente o non coerente · 0.25 mandatory mancante · 0.50 mandatory ok, recommended mancante · 0.75 +recommended ok, manca advanced o copertura sitewide · 1.00 completo + sitewide ≥95% + validato.
- KB di **14 markup type** (foglio 6): Product, BreadcrumbList, Organization, FAQPage, Article, NewsArticle, LocalBusiness, VideoObject, ItemList, Service, FinancialProduct, TouristTrip, AboutPage, ContactPage (mandatory/recommended/advanced ciascuno).

### Pre-fase Template Detection (condivisa Schema/Speed/Accessibility)
Firecrawl /crawl (limit `template_max_urls`, default 500, maxDepth 3) per ognuno dei 5 domini →
cluster URL per pattern (path, DOM, @type) → mappa ai template attesi dell'industry preset →
1 URL rappresentativo per template (il più linkato) → output `[{template_name, template_url}]`.

### Input web app
client_name, domain, country (ISO alpha-2), brand_keywords_cliente (max 20), industry_preset (enum),
**competitors: array di lunghezza FISSA = 4** (ognuno `{domain, brand_keywords}`),
ai_visibility_score (0-100, manuale), ai_visibility_comment (100-1500 char, manuale),
output_language ('it'|'en', default 'it'), sample_size (default 100000), template_max_urls (default 500).

### Orchestrazione LLM (foglio 7)
- Modello **`claude-opus-4-7`**, temperature 0.3 (driver) / 0.4 (executive summary), max_tokens 2500 / 4000.
- **JSON only**, niente markdown/preamble, niente em-dash, citare sempre numeri specifici, retry max 2.
- 2 varianti di system prompt: Development (con `soluzione_proposta`) e Business (qualitativo/direzionale, no soluzioni operative).
- 9 chiamate driver **sequenziali**, ordine: **Awareness → Discoverability → Traffic → Authority → Compliance → Content → Schema → Speed → Accessibility**.
- Context cumulativo cross-driver: `already_mentioned_items` (anti-ridondanza) + `other_drivers_context` (score+1 frase per correlazioni).
- 10ª chiamata = **Executive Summary** (dopo i 9 driver + inserimento manuale AI Visibility): headline, scorecard, correlazioni_chiave, priorita_strategiche (3-5, orizzonte 3/6/12 mesi), alert_critici.

### Costi / tempi per analisi (cliente + 4 competitor)
- Semrush Site Audit: **5 crawl × 100K pagine = 500.000 page-unit**; crawl 30-60 min in background.
- Firecrawl: ~2.500 crawl-unit (template detection) + 40 /scrape (Schema).
- PageSpeed: 80 chiamate (gratuite con API key). Ahrefs/SimilarWeb: costi marginali.
- LLM: 10 chiamate Opus, 3-5 min. **Totale tempo: 30-60 min/analisi**, dominato dal crawl Semrush.

## 3. Gap vs jboost-analyzer attuale

Driver attuali nel repo (9): compliance, experience, discoverability, content, accessibility, authority, aso_visibility, ai_relevance, awareness.

| Spec v3 | Stato nel repo oggi |
|---|---|
| **Schema** (driver completo + KB + preset + template detection) | assente |
| **Speed** (driver dedicato PSI performance) | parziale (oggi è dentro "experience"/CWV) |
| **Traffic** (SimilarWeb) | assente; SimilarWeb non integrato |
| **AI Visibility manuale** (J-Horizon) | oggi `ai_relevance` è automatizzato |
| `aso_visibility` | non esiste nella spec → da rimuovere |
| **Nessun fallback** (blocco+alert) | filosofia opposta: il lavoro #28–#35 era *aggiungere* fallback/mock |
| **5 siti fissi**, competitor integrati negli score Business | competitor trattati in modo lasco |
| Semrush **Site Audit** 100K pagine a progetto | i bug #34/#35 erano proprio `semrush_site_health` mock (nessun progetto Site Audit) |
| Accesso via **MCP** (Semrush, SimilarWeb) | oggi integrazioni REST dirette + DataForSEO |

Net nuovo: **Schema, Speed (formalizzato), Traffic**. Cambiati: `ai_relevance`→AI Visibility manuale, `experience`→Speed. Da togliere: `aso_visibility`.

## 4. I 5 punti critici su cui ragionare (lettura critica)

1. **"Nessun fallback" vs realtà.** Tutte le PR di maggio esistono perché su domini reali Semrush Site Audit è mock, PSI desktop manca, siti Cloudflare bloccano lo scrape. Il "blocca+alert" funziona solo se JAKALA pre-provisiona i progetti Semrush Site Audit per ogni dominio e ha copertura SimilarWeb garantita. È assunto reale o purezza di specifica?
2. **Costo/latenza cambiano la natura del prodotto.** 500K page-unit Semrush + 30-60 min = batch job, non analisi istantanea. Il piano Semrush di JAKALA regge 5 crawl Site Audit 100K per analisi?
3. **Schema è il pezzo nuovo più grosso e fuzzy.** Dipende da template detection euristica + parsing JSON-LD + detection "sitewide ≥95%" e "markup coerente col contenuto visibile". Massimo rischio di implementazione.
4. **Min-max su 5 punti è relativo.** Score Discoverability/Awareness/Traffic dipende da *quali* 4 competitor scegli e **non è confrontabile tra clienti**. Il report deve comunicarlo, o un CMO lo legge come voto assoluto.
5. **Rapporto con l'esistente.** Sostituisce il motore driver attuale, affianca un prodotto nuovo, o è evoluzione? E come si lega a Fingerprint Bedrock e alla pipeline MarTech (assenti nella spec)?

## 5. Tensione principale (one-liner)

La spec v3 assume **dati puliti single-source senza fallback**; il codebase reale ha passato l'ultimo mese a costruire fallback perché i dati single-source **non** sono puliti. Questa contraddizione va risolta a monte (provisioning dati JAKALA) prima di committare all'architettura "no fallback".

## 6. Domande aperte all'utente (la conversazione si è fermata qui)

1. **Obiettivo**: v3 è un prodotto nuovo da scrivere da zero, o un'evoluzione di jboost-analyzer riusando l'esistente?
2. **Realismo dati**: JAKALA ha davvero gli abbonamenti/MCP (Semrush Site Audit a progetto, SimilarWeb) che rendono praticabile il "no fallback"? O accettiamo un degrado controllato?
3. **Da dove partiamo**: prima la mappatura tecnica del gap contro il codice reale, oppure prima uno dei punti aperti (es. Schema, o la questione fallback)?

## 7. Possibili prossimi passi (in attesa delle risposte)

- Se "evoluzione": audit del motore driver attuale (`lib/drivers/*`, `lib/agents/drivers/*`, `lib/analyses/run-analysis.ts`) per mappare riuso vs riscrittura driver-per-driver.
- Se "da zero": definire schema DB nuovo (analisi a 5 siti, driver_results con normalizzazione doppia, template_detection cache) e impostare gli MCP Semrush/SimilarWeb.
- In ogni caso: prototipare per primo il driver **Schema** (più rischioso) e validare la **template detection** su 2-3 domini reali dei preset (es. swarovski.com retail_luxury, finecobank.com banking_finance).
- Decidere la policy fallback definitiva prima di scrivere i fetcher.
