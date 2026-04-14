# JBoost Analyzer

**Piattaforma SEO/GEO Analysis — 9 Driver Framework**

Una piattaforma Next.js + Supabase per analizzare e monitorare la performance SEO di siti web attraverso il framework dei 9 driver. Include gestione clienti, knowledge base RAG, memory v2 (profili aziendali intelligenti), monitoring automatico, e AI chat contextuale.

---

## 🎯 Caratteristiche Principali

### 1. **9 Driver Framework**
Analizza la performance tramite 9 metriche indipendenti:
- **Compliance** — Salute tecnica del sito (SEMrush Site Audit)
- **Experience** — Performance pagina (Google PageSpeed Insights)
- **Discoverability** — Visibilità organica (SEMrush ranking)
- **Content** — Qualità contenuto (densità errori audit)
- **Accessibility** — Conformità WCAG (Lighthouse accessibility)
- **Authority** — Domain authority (Ahrefs Domain Rating 0-100)
- **ASO Visibility** — Presence su paid search (SEMrush Adwords)
- **AI Relevance** — Presence in AI Overviews (Ahrefs)
- **Awareness** — Brand awareness (trend di ricerca)

Ogni driver produce un score 0-100 assoluto (NON relativo ai competitor). L'overall score è la media dei driver con status 'ok'.

### 2. **Gestione Clienti Multi-tenant**
- **Lifecycle pipeline**: prospect → active → churned → archived
- **Team & Sharing**: owner/editor/viewer roles via `client_members`
- **RLS enforced**: accesso ai clienti solo se in `client_members`
- **Monitoring**: sottoscrizioni automatiche con cron per analisi periodiche
- **MarTech detection**: scoperta automatica dello stack tecnologico del cliente

### 3. **Client Memory v2 (Phase 5)**
Profilo intelligente del cliente che si auto-aggiorna:
- **Profile**: nome azienda, industria, contatti, timeline, budget, competitors
- **Facts**: informazioni estratte da analisi, knowledge base, conversazioni, user input
- **Gaps**: domande critiche non ancora risposte (conflict resolution, business, team, budget, timeline, ecc.)
- **Answers**: storia delle risposte fornite dagli utenti
- **Refresh automation**: stato (empty → building → ready → stale → refreshing)
- **RAG-driven**: ricerca nella knowledge base durante il refresh
- **Active learning loop**: suggerimenti intelligenti di fatti mancanti

### 4. **Knowledge Base + Ingestion**
Upload di documenti (PDF, DOCX, XLSX, PPTX, transcripts Teams, TXT):
- **Parsing**: estrazione testo intelligente per ogni formato
- **Chunking**: divisione in chunk ottimali (max 1024 token)
- **Embedding**: vettorizzazione con OpenAI + pgvector
- **Search**: RAG vector search per contesto nel memory + chat
- **Batch extract**: endpoint `/api/clients/[id]/files/extract-all` per processare in massa

### 5. **Monitoring Engine (Phase 4C)**
- **Cron-driven**: refresh automatico su schedule (daily/weekly/monthly)
- **Snapshots**: ogni run genera un'analisi con source='monitoring'
- **Trends**: grafici di trend per score e facts
- **Cost tracking**: dashboard admin per monitorare usage LLM + API

### 6. **Chat Contextuale AI**
- **Mode: contextual** — include dati del cliente (memory, analisi, knowledge)
- **Mode: assistant** — chat libera
- **Context builder**: assembla profilo, fatti, gap, analisi più recente, knowledge
- **System prompts**: specifici per SEO + 9 driver framework
- **Models**: OpenAI (primary) + Perplexity fallback

### 7. **Admin Panel**
- **Users CRUD**: list, edit, reset password, soft-delete, purge
- **Activity log**: traccia azioni (create_client, run_analysis, ecc.)
- **Memory Health**: status di tutti i memory per debug
- **Cost monitoring**: spending LLM + API per data range
- **Config**: toggle features a livello tenant

### 8. **API Endpoints Principali**

#### Clients
- `GET /api/clients?stage=prospect|active|churned|archived`
- `POST /api/clients` — crea nuovo cliente
- `GET /api/clients/[id]` — dettagli + stats
- `PATCH /api/clients/[id]` — aggiorna
- `GET|POST|DELETE /api/clients/[id]/members` — team sharing

#### Memory
- `GET /api/clients/[id]/memory` — profilo + facts + gaps + answers
- `POST /api/clients/[id]/memory/refresh` — trigger refresh (async)
- `POST /api/clients/[id]/memory/answer` — salva risposta a un gap
- `GET /api/admin/memory-health` — status di tutti i memory (admin)

#### Analysis
- `POST /api/clients/[id]/analyses` — trigger nuova analisi
- `GET /api/clients/[id]/analyses` — lista analisi
- `POST /api/llm/context` — assembla context per chat
- `POST /api/llm/solutions` — genera soluzioni per issues
- `POST /api/llm/priority-matrix` — calcola matrice priorità

#### Knowledge
- `POST /api/knowledge/ingest` — upload documento
- `GET /api/knowledge/documents` — lista documenti clienti
- `POST /api/knowledge/search` — RAG vector search

#### Files
- `POST /api/clients/[id]/files` — upload file
- `POST /api/clients/[id]/files/extract-all` — batch extract text

#### Monitoring
- `GET|POST|PATCH /api/clients/[id]/monitoring` — sottoscrizioni
- `POST /api/cron/refresh-clients` — Vercel cron job

#### Chat
- `POST /api/chat` — chat endpoint (streaming)

#### Admin
- `GET /api/admin/users` — list users
- `PATCH /api/admin/users/[id]` — edit user
- `POST /api/admin/users/[id]/reset-password` — reset pw
- `DELETE /api/admin/users/[id]` — soft/hard delete
- `GET /api/admin/activity` — activity log
- `GET /api/admin/costs` — cost breakdown

---

## 🏗️ Stack Tecnologico

### Frontend
- **Next.js 14** — App Router, SSR/SSG, middleware auth
- **React 18** — UI components
- **shadcn/ui** — Radix UI + Tailwind CSS
- **Tailwind CSS** — utility-first styling
- **Recharts** — grafici (spider, priority matrix, gantt, trends)
- **Lucide React** — icons
- **next-themes** — dark mode toggle

### Backend
- **Next.js API Routes** — handler per REST API
- **Supabase** — Postgres + realtime + Auth + Storage
- **pgvector** — embedding search (Knowledge)
- **Edge Functions** (Supabase) — run-analysis, refresh cronjob
- **RLS (Row Level Security)** — enforced on all tables via client_members

### LLM & AI
- **Anthropic SDK** — per Claude (memory synthesis)
- **OpenAI SDK** — per GPT-4 (chat, solutions, priority matrix)
- **Perplexity API** — fallback per chat quando OpenAI unavailable
- **ai SDK** — wrapper unificato (generateObject, streamText)
- **gpt-tokenizer** — conteggio token per chunking

### External APIs
- **SEMrush API** — site audit, domain rank, adwords
- **Ahrefs API** — domain rating, AI relevance
- **Google PageSpeed Insights** — mobile/desktop performance
- **Google Trends API** — brand awareness trends
- **MarTech Detection** — pattern matching su HTML/HTTP headers

### Document Processing
- **pdf-parse** — estrazione testo da PDF
- **mammoth** — DOCX parsing
- **xlsx** — XLSX/CSV parsing
- **jszip** — estrazione da PPTX
- **pptx.js** — PPTX parsing avanzato

### Deployment
- **Vercel** — hosting Next.js + Postgres per edge functions
- **Supabase** — database hosting + auth + storage

---

## 📁 Struttura Cartelle

```
jboost-analyzer/
├── app/
│   ├── (auth)/                    # Auth group (login, reset-password, forgot-password)
│   ├── (dashboard)/               # Dashboard group (main app after login)
│   │   ├── admin/                 # Admin panel
│   │   ├── analyzer/              # Single analysis detail view
│   │   ├── ask-j/                 # AI chat interface
│   │   ├── clients/               # Clients list + CRUD
│   │   │   ├── [id]/              # Client detail page
│   │   │   │   ├── analyses/      # Analysis history
│   │   │   │   ├── chat/          # Chat contextuale per client
│   │   │   │   ├── knowledge/     # Knowledge base UI
│   │   │   │   ├── martech/       # MarTech stack
│   │   │   │   └── executive-summary/  # Summary view
│   │   │   └── new/               # New client form
│   │   ├── dashboard/             # Main dashboard (prospects vs active)
│   │   ├── pre-sales/             # Pre-sales pipeline (prospect management)
│   │   ├── results/               # Results list + detail
│   │   └── settings/              # User settings (locale, theme)
│   ├── api/
│   │   ├── admin/                 # Admin endpoints (users, activity, costs, memory-health)
│   │   ├── chat/                  # Chat streaming endpoint
│   │   ├── clients/               # Clients CRUD + nested routes
│   │   │   └── [id]/
│   │   │       ├── files/         # File upload + extract
│   │   │       ├── martech/       # MarTech detection
│   │   │       ├── members/       # Team sharing
│   │   │       ├── memory/        # Memory refresh + answer
│   │   │       ├── monitoring/    # Monitoring subscriptions
│   │   │       ├── executive-summary/  # Summary generation
│   │   │       ├── deactivate/    # Lifecycle transitions
│   │   │       ├── reactivate/
│   │   │       └── promote/
│   │   ├── cron/                  # Vercel cron jobs (refresh-clients)
│   │   ├── domains/               # Domain suggestion autocomplete
│   │   ├── export/                # PDF export
│   │   ├── knowledge/             # Knowledge ingest + search
│   │   │   ├── documents/
│   │   │   ├── ingest/
│   │   │   └── search/
│   │   └── llm/                   # LLM endpoints (context, solutions, priority-matrix)
│   ├── globals.css                # Global styles
│   ├── layout.tsx                 # Root layout (i18n, theme provider)
│   └── page.tsx                   # Redirect to /dashboard
├── components/
│   ├── analyzer/                  # Analysis visualizations (Driver detail, Priority matrix, Gantt, Spider chart)
│   ├── chat/                      # Chat UI components
│   ├── clients/                   # Client components (Card, Form, Martech Grid, Monitoring Panel, Team Panel, Lifecycle Actions)
│   ├── memory/                    # Memory UI (Viewer, Main card, Status card, Gaps list, Answer dialog)
│   ├── charts/                    # Recharts wrappers
│   ├── layout/                    # Layout shell (Icon rail, Command palette, Sidebar, Mobile tab bar, Nav items)
│   ├── shared/                    # Shared components
│   ├── ui/                        # shadcn/ui components (button, card, dialog, tabs, ecc.)
│   ├── theme-provider.tsx         # NextThemes wrapper
│   └── theme-toggle.tsx           # Dark mode toggle
├── lib/
│   ├── chat/                      # Chat logic (context-builder, system-prompts)
│   ├── drivers/                   # 9 driver scoring (compliance, experience, ecc.)
│   ├── files/                     # File extraction (extract-text.ts)
│   ├── i18n/                      # Internationalization (en, es, fr, it)
│   ├── knowledge/                 # Knowledge pipeline (parsers, chunking, embedding, ingest)
│   │   └── parsers/               # Document parsers (pdf, docx, xlsx, pptx, txt, transcript-teams)
│   ├── llm/                       # LLM clients (Anthropic, OpenAI wrapper)
│   ├── martech/                   # MarTech detection (patterns, categories, detect)
│   ├── memory/                    # Client Memory (assembler, refresh, knowledge-rag, prompts)
│   ├── monitoring/                # Monitoring run orchestration
│   ├── seo-apis/                  # API wrappers (SEMrush, Ahrefs, PageSpeed, Trends)
│   ├── supabase/                  # Supabase client (server, middleware)
│   ├── tracking/                  # Activity + LLM usage logging
│   ├── trends/                    # Trend calculation
│   ├── types/                     # TypeScript types (client.ts with tutte le interfacce)
│   ├── constants.ts               # 9 drivers, score bands, analysis phases
│   └── utils.ts                   # Utility functions
├── supabase/
│   └── migrations/                # SQL migrations (Phase 1-5 incremental)
│       ├── 20260412080000_phase1a_foundation_lifecycle_and_sharing.sql
│       ├── 20260412080100_phase1b_knowledge_schema_artifacts_subscriptions.sql
│       ├── 20260412081800_phase1c_advisor_fixes_indexes.sql
│       ├── 20260412090000_phase3_vector_search_rpc.sql
│       ├── 20260412100000_phase4a_clients_rls_via_members.sql
│       ├── 20260412110000_phase4b_lifecycle_state_machine.sql
│       ├── 20260412120000_phase4c_monitoring_engine.sql
│       ├── 20260412130000_phase4e_guardrails.sql
│       ├── 20260412140000_phase5a_client_memory.sql
│       ├── 20260412150000_phase5b_memory_robustness.sql
│       ├── _phase4_all_in_one.sql              # Bundled Phase 4 (manual deploy)
│       ├── _phase4_plus_5_combined.sql         # Bundled Phase 4+5
│       └── _phase5_all_in_one.sql              # Bundled Phase 5
├── scripts/
│   ├── test-ingest.ts             # Test knowledge ingestion
│   ├── test-martech.ts            # Test MarTech detection
│   └── test-memory-refresh.mjs     # Test memory refresh locally
├── middleware.ts                  # Auth session refresh middleware
├── package.json                   # Dependencies
├── tsconfig.json                  # TypeScript config
├── tailwind.config.ts             # Tailwind CSS config
├── next.config.mjs                # Next.js config
├── vercel.json                    # Vercel config (cron jobs, ecc.)
├── deploy.sh                      # Deploy script (npm install + git push + vercel deploy)
├── .env.local.example             # Environment variables template
└── README.md                       # This file
```

---

## 🚀 Setup & Sviluppo

### Prerequisites
- **Node.js 18+** e **npm** (o **pnpm**)
- **Supabase account** (https://supabase.com)
- **Vercel account** (deploy, cron jobs)
- **API keys**: OpenAI, SEMrush, Ahrefs, Google PageSpeed

### 1. Clone & Install

```bash
git clone https://github.com/marcocorsaro-sys/jboost-analyzer.git
cd jboost-analyzer
npm install
```

### 2. Environment Variables

Copia `.env.local.example` in `.env.local`:

```bash
cp .env.local.example .env.local
```

Compila i valori:

```env
# Supabase (client + server)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...           # server-only, used by /api/admin/*, /api/cron/*, /api/admin/memory-health

# LLM
OPENAI_API_KEY=sk-proj-...                     # chat + embeddings (knowledge pipeline)
ANTHROPIC_API_KEY=sk-ant-...                   # required by memory refresh (Claude Sonnet 4 synthesis)
PPLX_API_KEY=pplx-...                          # chat fallback

# Cron / monitoring
CRON_SECRET=<long-random-string>               # Vercel injects Authorization: Bearer $CRON_SECRET into the daily cron
NEXT_PUBLIC_SITE_URL=https://your-deploy.com   # used by password-recovery redirect

# SEO APIs — consumed by Supabase Edge Functions (run-analysis).
# The Next.js app itself does NOT read these, so in local dev you only
# need them if you run the edge functions locally. In production they
# live in Supabase Dashboard > Edge Functions > Secrets:
#   SEMRUSH_API_KEY
#   AHREFS_API_KEY
#   GOOGLE_PSI_API_KEY
```

> **Nota**: le env vars `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
> `CRON_SECRET` e `NEXT_PUBLIC_SITE_URL` sono referenziate dal codice
> (memory refresh, admin API, cron orchestrator, auth recovery) ma non
> compaiono ancora in `.env.local.example`. Aggiungile manualmente al
> tuo `.env.local` finché il file di esempio non viene aggiornato.

### 3. Database Setup

#### Option A: Via Supabase CLI (recommended)
```bash
# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Apply migrations
supabase migration up
```

#### Option B: Manual SQL
Accedi a **Supabase Dashboard > SQL Editor** e esegui in ordine:
1. `supabase/migrations/20260412080000_phase1a_...sql`
2. `supabase/migrations/20260412080100_phase1b_...sql`
3. Ecc. in ordine progressivo

Oppure usa i bundle all-in-one:
- `_phase4_plus_5_combined.sql` (contiene 1A + 1B + 1C + 3 + 4A-4E + 5A-5B)

### 4. Run Dev Server

```bash
npm run dev
```

Accedi a http://localhost:3000

### 5. Environment Setup on Supabase

**Edge Functions Secrets** (Supabase Dashboard > Settings > Edge Functions > Secrets):
```
SEMRUSH_API_KEY=your-key
AHREFS_API_KEY=your-key
GOOGLE_PSI_API_KEY=your-key
```

---

## 📊 Database Schema Highlights

### Core Tables

#### `clients`
```sql
id, user_id, name, domain, industry, website_url, 
contact_name, contact_email, contact_phone, notes,
lifecycle_stage (prospect|active|churned|archived),
engagement_started_at, engagement_ended_at,
created_at, updated_at
```

#### `client_members`
```sql
id, client_id, user_id, role (owner|editor|viewer),
added_by, added_at
-- Enforces multi-tenant access via RLS
```

#### `analyses`
```sql
id, client_id, user_id, domain, country, language,
target_topic, competitors, status (pending|running|completed|failed),
overall_score, completed_at, results (JSON),
source (manual|monitoring), created_at
```

#### `knowledge_documents`
```sql
id, client_id, user_id, source_type, source_name,
storage_path, metadata, raw_content,
ingestion_status (pending|parsing|chunking|embedding|ready|failed),
token_count, ingestion_error, created_at
```

#### `knowledge_chunks`
```sql
id, document_id, client_id, chunk_index, content,
content_tokens, embedding (vector), metadata, created_at
-- embedding: pgvector type per RAG search
```

#### `client_memory`
```sql
id, client_id, profile (JSONB), facts (JSONB array),
gaps (JSONB array), answers (JSONB array),
narrative, status (empty|building|ready|stale|refreshing|failed),
current_phase, completeness (0-100), source_versions (JSONB),
error_message, last_refreshed_at, created_at, updated_at
-- Singleton per client (unique on client_id), RLS via client_members
```

#### `client_memory_facts_history`
```sql
id, client_id, refresh_id, facts (JSONB), superseded_at
-- Append-only audit log: every successful refresh archives the
-- soon-to-be-replaced facts here, so the UI can later show how
-- Claude's understanding of the client has drifted over time.
```

#### `client_update_subscriptions`
```sql
id, client_id, frequency (weekly|biweekly|monthly),
frequency_days (SMALLINT, custom override 1..365),
is_active, paused_until (TIMESTAMPTZ),
last_run_at, next_run_at, enabled_drivers,
martech_scan, pagespeed_scan, created_at
```

#### `client_martech`
```sql
id, client_id, category, tool_name, tool_version,
confidence, details, detected_at
```

#### `activity_logs`
```sql
id, user_id, action, resource_type, resource_id,
details (JSON), created_at
```

---

## 🔐 Security & RLS

### Authentication
- Supabase Auth (Magic Link + Password)
- Session refresh via middleware.ts

### Row Level Security (RLS)
- **clients**: accesso solo se owner via `user_has_client_access()`
- **analyses**: eredita accesso da client
- **knowledge_documents/chunks**: RLS su client_id
- **client_memory**: RLS su client_id + role check
- Helper functions SECURITY DEFINER:
  - `user_has_client_access(client_id)`
  - `user_is_client_owner(client_id)`
  - `user_can_edit_client(client_id)`

### API Protection
- Route handlers controllano auth via `supabase.auth.getUser()`
- Errori 401/403 se non authenticated/authorized
- RLS blocca query non autorizzate a DB level

---

## 📝 Development Workflows

### Run Analysis
1. Crea client → vedi nella lista
2. Click "Analyze" → trigger `/api/clients/[id]/analyses`
3. Edge function `run-analysis` rientra il dato dalle 4 SEO APIs
4. Calcola 9 scores + issues + solutions
5. Salva in `analyses` table
6. Frontend poll via realtime listener

### Knowledge Ingestion
1. Client page → "Knowledge" tab → "Upload"
2. File POST → `/api/knowledge/ingest`
3. Parsing (pdf, docx, ecc.) → chunking → embedding
4. Chunks in `knowledge_chunks` (pgvector)
5. Usato in memory refresh (RAG) + chat context builder

### Memory Refresh
1. Client page → "Memory" card → "Refresh"
2. POST `/api/clients/[id]/memory/refresh` (async)
3. Assembler raccoglie dati da: analyses, knowledge, martech, conversazioni
4. LLM sintetizza profilo + facts + gaps
5. Salva in `client_memory` con status='ready'
6. Stale quando sources cambiano (trigger on analyses/files/martech)

### Chat Contextuale
1. Client page → "Chat" tab
2. Context builder assembla memory + ultima analisi + knowledge
3. System prompt include 9 driver framework + client context
4. Messaggio user → `/api/chat` (streaming)
5. Risposta include suggestion di facts/gaps mancanti

### Monitoring
1. Client page → "Monitoring" panel
2. Enable subscription (daily/weekly/monthly)
3. Cron job `/api/cron/refresh-clients` runs daily (Vercel)
4. Per ogni client active con subscription: trigger nuova analisi
5. Trend chart auto-aggiorna con realtime listener

---

## 🌍 Internationalization (i18n)

Support: **en**, **es**, **fr**, **it**

Locale salvato in cookie `jboost-locale`. Selezionabile da settings page.

Translations in `/lib/i18n/translations/` (en.ts, es.ts, ecc.)

Componenti UI usano `<T key="nav.home" />` per localizzazione automatica.

---

## 📈 Key Features by Phase

| Phase | Features | Status |
|-------|----------|--------|
| 1A | Lifecycle stages, client_members RLS, pgvector | ✅ |
| 1B | Knowledge schema, documents, chunks, subscriptions | ✅ |
| 1C | Advisor fixes, indexes | ✅ |
| 2  | Prospects vs active clients UI split | ✅ |
| 3  | Knowledge ingestion pipeline + vector search RPC | ✅ |
| 4A | Multi-tenant RLS via members, Team panel UI | ✅ |
| 4B | Lifecycle state machine (prospect→active→churned→archived) | ✅ |
| 4C | Monitoring engine, cron orchestrator, snapshots via analyses | ✅ |
| 4D | Admin user CRUD (list/edit/reset-pw/soft-delete/purge) | ✅ |
| 4E | DB guardrails (last owner, last admin) | ✅ |
| 5A | Client Memory foundation, stale triggers, refresh rewrite | ✅ |
| 5B | RAG-driven retrieval over knowledge_chunks | ✅ |
| 5C | Active learning, conflict-resolution gaps, save-fact API | ✅ |
| 5D | Realtime UX, memory card on main client page | ✅ |
| 5E | Facts freshness coloring, admin Memory Health tab | ✅ |
| 5C-fix | Hotfix "Not initialized" silent failure (UPSERT + owner backfill) | ✅ |
| Follow-up | Files batch extract-all endpoint + UI button | ✅ |

---

## 🧪 Testing & Scripts

### Test Knowledge Ingestion
```bash
npx tsx scripts/test-ingest.ts
```
Carica un PDF di test e verifica parsing → chunking → embedding.
Richiede un loader TypeScript (`tsx` o `ts-node`) perché il file è `.ts`.

### Test MarTech Detection
```bash
npx tsx scripts/test-martech.ts
```
Test pattern matching per MarTech stack detection.

### Test Memory Refresh Locally
```bash
node scripts/test-memory-refresh.mjs
```
Simula refresh completo (assembly + synthesis). Unico script
direttamente eseguibile con `node` perché è `.mjs` puro — 7 test che
dimostrano il bug originale `setRefreshPhase UPDATE no-op` e il fix
`UPSERT` (Phase 5C hotfix).

---

## 🚢 Deployment

### Option 1: Using Deploy Script
```bash
bash deploy.sh
```
Questo:
1. `npm install`
2. Git init + commit + push to GitHub
3. Vercel deploy (`npx vercel --yes`)

### Option 2: Manual Vercel Deploy
```bash
# Assicurati di avere Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables in Vercel dashboard:
# - NEXT_PUBLIC_SUPABASE_URL
# - NEXT_PUBLIC_SUPABASE_ANON_KEY
# - OPENAI_API_KEY
# - PPLX_API_KEY

# Production deploy
vercel --prod
```

### Edge Functions Deploy
Edge functions (run-analysis, refresh cronjob) vengono auto-deployate via Supabase quando applichi le migrations.

Altrimenti, deploy manuale:
```bash
supabase functions deploy run-analysis
supabase functions deploy refresh-clients
```

### Vercel Cron Jobs
Configurati in `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/cron/refresh-clients",
      "schedule": "0 4 * * *"
    }
  ]
}
```
Runs daily at 04:00 UTC. The schedule is intentionally compatible with
**Vercel Hobby**'s 1-daily-cron limit; per-client cadence is enforced by
the `next_run_at` column in `client_update_subscriptions` so weekly
clients are still touched only once a week.

---

## 🛠️ Troubleshooting

### "Not initialized" Memory Error
- Problema: User non in `client_members` per questo client
- Soluzione: Aggiungi user al team (Team panel)
- Check: `SELECT * FROM client_members WHERE client_id = '...'`

### Memory Refresh Fails
- Check Vercel logs: `vercel logs`
- Check Supabase function logs: Supabase Dashboard > Edge Functions > Logs
- Common: OpenAI quota, missing API keys

### Knowledge Ingest Fails
- Formato supportato? (pdf, docx, xlsx, pptx, txt, transcript Teams)
- File size > 50MB? → split e re-upload
- Check DB: `SELECT * FROM knowledge_documents WHERE client_id = '...'`

### RLS Permission Denied
- Verifica `client_members` entry
- Check role: è almeno 'viewer'?
- Supabase Dashboard > RLS > Row Security Policies

### Chat Timeout
- OpenAI API down?
- Fallback a Perplexity automatico
- Check logs: Vercel Runtime Logs

---

## 📚 API Documentation

### GET /api/clients
Elenco clienti per user (con RLS via client_members).

**Query Params:**
- `stage` — Filter by lifecycle_stage (prospect|active|churned|archived)

**Response:**
```json
{
  "clients": [
    {
      "id": "uuid",
      "name": "Acme Corp",
      "domain": "acme.com",
      "lifecycle_stage": "active",
      "latest_score": 78,
      "analyses_count": 5,
      "latest_analysis_at": "2026-04-13T10:30:00Z"
    }
  ]
}
```

### POST /api/clients
Crea nuovo cliente (default lifecycle_stage='prospect').

**Body:**
```json
{
  "name": "New Client",
  "domain": "example.com",
  "industry": "Tech",
  "website_url": "https://example.com",
  "contact_name": "John Doe",
  "contact_email": "john@example.com",
  "contact_phone": "+1234567890",
  "notes": "...",
  "lifecycle_stage": "prospect",
  "pre_sales_notes": "..."
}
```

### POST /api/clients/[id]/memory/refresh
Trigger async memory refresh.

**Response:**
```json
{
  "status": "refreshing",
  "message": "Memory refresh started"
}
```

**Polling:** GET `/api/clients/[id]/memory` per status

### POST /api/knowledge/ingest
Upload & ingest documento.

**Body:** multipart/form-data
```
file: <PDF|DOCX|XLSX|...>
clientId: uuid
sourceType: pdf|docx|xlsx|pptx|txt|transcript_teams
sourceName: "Q4 Report.pdf"
```

### POST /api/chat
Chat endpoint (streaming).

**Body:**
```json
{
  "conversationId": "uuid",
  "clientId": "uuid",
  "mode": "contextual|assistant",
  "message": "What's our current SEO status?"
}
```

**Response:** SSE stream (text/event-stream)

### GET /api/admin/memory-health
(Admin only) Status di tutti i memory per debug.

**Response:**
```json
{
  "memories": [
    {
      "client_id": "uuid",
      "client_name": "Acme Corp",
      "status": "ready",
      "completeness": 85,
      "facts_count": 12,
      "gaps_count": 3,
      "last_refreshed_at": "2026-04-13T10:00:00Z"
    }
  ]
}
```

---

## 🤝 Contributing

1. Fork the repo
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit: `git commit -m "Add amazing feature"`
4. Push: `git push origin feature/amazing-feature`
5. Open Pull Request

---

## 📄 License

Proprietary — Marco Corsaro Systems

---

## 📞 Support

Per issues, domande, o feature request: apri un GitHub issue nel repo.

---

**Last Updated:** April 2026  
**Maintained by:** Marco Corsaro Systems
