# Supabase Edge Functions

> Stato: **importate dal progetto Supabase deployato (snapshot del 2026-04-25)**
> per portare a versionamento la logica di orchestrazione e i proxy esterni.
> Prima di questo import il sorgente delle function viveva solo dentro
> Supabase Dashboard, fuori dal repo.

## Funzioni presenti

| Function | Versione import | Cosa fa |
|---|---|---|
| `run-analysis` | v12 | Orchestratore principale dell'analisi 9-driver. Invocata fire-and-forget da `analyzer/page.tsx` e `lib/monitoring/run.ts` con `{ analysisId }`. Esegue 8 fasi (initializing → fetching_apis → calculating_scores → generating_issues → generating_solutions → analyzing_competitors → generating_matrix → finalizing) in ~140s max, con `Promise.allSettled` e timeboxing per fase. Aggiorna `analyses.current_phase` in tempo reale. |
| `semrush-proxy` | v2 | Wrapper sottile su `api.semrush.com`. Azioni: `domain_rank`, `domain_organic`, `rank_history`, `site_health`. Parsing CSV interno. Path attualmente in disuso da `run-analysis` (chiama API direttamente) — convive come legacy/test browser-side. |
| `ahrefs-proxy` | v2 | Wrapper su `apiv2.ahrefs.com`. Azioni: `domain-rating`, `organic-keywords`, `broken-backlinks`. Mock data fallback su 403 / API key mancante. Post-processing AI relevance score (% keyword con `ai_overview` + `featured_snippet`). |
| `google-proxy` | v2 | Wrapper PageSpeed Insights + Google Trends via SerpAPI. Azioni: `psi`, `trends`. Estrae Lighthouse 4 categorie + Core Web Vitals (LCP/FID/CLS/FCP/TTFB/SI/TTI/TBT). |

## Prossimo passo (Phase 7 — Integration Layer)

Questa cartella esiste come **snapshot per code review e disaster recovery**.
La direzione di lavoro è migrare l'orchestrazione di `run-analysis` da
Deno a Next.js Node runtime (`app/api/analyses/run/route.ts`) per:

- avere lo stesso runtime delle altre API del progetto
- accedere alle dipendenze npm (`gpt-tokenizer`, `pdf-parse`, ecc.)
- semplificare debugging e log centralizzati
- abilitare il nuovo layer `lib/integrations/` con cache/quota/cost tracking
- chiudere il punto debole del fire-and-forget invocando in background con
  `after()` di Next 14 e/o un job processor su DB

Durante la migrazione le edge function vengono **mantenute attive** in
parallelo: si esegue un test di parità (stesso dominio, vecchio path vs
nuovo path) prima di tagliare. La rimozione delle edge function avverrà
solo dopo qualche giorno di esecuzione stabile sul nuovo path.

## Deploy / sync

Per riallineare la cartella con quanto è realmente deployato in Supabase
(o vice-versa, deployare da qui):

```bash
# Pull dal progetto Supabase (richiede supabase CLI + login)
supabase functions download run-analysis
supabase functions download semrush-proxy
supabase functions download ahrefs-proxy
supabase functions download google-proxy

# Push verso Supabase
supabase functions deploy run-analysis
```

> Nota: la versione installata in produzione potrebbe divergere da
> quella in repo se viene patchata via dashboard. Il file SHA è nel
> manifest del MCP `list_edge_functions` (campo `ezbr_sha256`).

## Secrets richiesti (Supabase Dashboard → Edge Functions → Secrets)

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (auto-iniettati dal runtime)
- `SEMRUSH_API_KEY`
- `AHREFS_API_KEY`
- `GOOGLE_PSI_KEY` (PSI v5)
- `SERPAPI_KEY` (Google Trends via SerpAPI)
- `OPENAI_API_KEY` (alias `OPEN_AI_API_KEY` accettato)
- `ANTHROPIC_API_KEY`
- `PPLX_API_KEY` (Perplexity)

`run-analysis` legge le chiavi anche dalla tabella `app_config` (key/value)
con priorità DB > env. Quando la migrazione a Next.js sarà completa, le
chiavi vivranno nelle env Vercel + nuova tabella `integration_credentials`
cifrata con pgcrypto.
