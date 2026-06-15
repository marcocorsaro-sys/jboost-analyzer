# JBoost Analyzer — MCP Server

JBoost Analyzer espone le proprie capability come **server MCP remoto**, così
l'app diventa un "oggetto" richiamabile dall'esterno da qualunque client che
parli il [Model Context Protocol](https://modelcontextprotocol.io) (Claude
Desktop, Claude Code, IDE, agenti custom, ecc.).

## Endpoint

```
POST /api/mcp        ← Streamable HTTP transport
```

- Trasporto: **Streamable HTTP** (SSE disabilitato, non più parte dello spec).
- Implementato con [`mcp-handler`](https://www.npmjs.com/package/mcp-handler)
  in `app/api/mcp/[transport]/route.ts`.

## Autenticazione

Ogni richiesta deve portare un **bearer token = Supabase access token (JWT)**
dell'utente:

```
Authorization: Bearer <supabase_access_token>
```

Il token viene validato contro Supabase Auth (`lib/mcp/auth.ts`) e poi
propagato a ogni tool. I tool richiamano le route interne dell'app inoltrando
lo stesso token: l'intera catena gira sotto l'identità del chiamante e la
**RLS di Supabase** (incl. `client_members`) e lo **spend-limit** valgono
esattamente come per una sessione browser. **Nessuna escalation a
service-role.**

> Come si ottiene il token: dopo il login Supabase, `session.access_token`.
> Via API: `supabase.auth.signInWithPassword(...)` → `data.session.access_token`.
> I token scadono — usa il refresh token per rinnovarli.

Questo è possibile perché `lib/supabase/server.ts::createClient()` è ora
**bearer-aware**: se la richiesta porta `Authorization: Bearer`, autentica
l'utente con quel JWT invece del cookie. Effetto collaterale utile: **tutte**
le route esistenti sotto `/api/*` diventano richiamabili dall'esterno con un
bearer token, non solo l'MCP.

## Configurazione client

Client che supportano Streamable HTTP remoto:

```json
{
  "mcpServers": {
    "jboost": {
      "url": "https://your-app.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer <supabase_access_token>" }
    }
  }
}
```

Per Claude Code: `claude mcp add --transport http jboost https://your-app.vercel.app/api/mcp --header "Authorization: Bearer <token>"`.

## Variabili d'ambiente

| Variabile | Scopo |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Validazione del token (già richieste dall'app). |
| `MCP_PUBLIC_BASE_URL` | URL pubblica usata dai tool per richiamare le route interne. Default: `NEXT_PUBLIC_SITE_URL` → `VERCEL_URL` → `http://localhost:3000`. |

## Tool esposti

| Tool | Descrizione | Backing |
|---|---|---|
| `whoami` | Utente autenticato dal token | Supabase |
| `list_clients` | Lista clienti (filtro per stage) + stats | `GET /api/clients` |
| `get_client` | Dettaglio cliente | `GET /api/clients/{id}` |
| `create_client` | Crea cliente (caller = owner) | `POST /api/clients` |
| `update_client` | Aggiorna campi cliente | `PATCH /api/clients/{id}` |
| `get_client_memory` | Client Memory v2 (profilo, fatti, gap) | `GET /api/clients/{id}/memory` |
| `get_client_martech` | Stack MarTech rilevato | `GET /api/clients/{id}/martech` |
| `list_analyses` | Lista analisi (filtro per cliente) | Supabase |
| `get_analysis` | Analisi completa + driver + competitor + matrix | Supabase |
| `get_analysis_status` | Poll leggero di stato/fase | Supabase |
| `create_and_run_analysis` | Crea + avvia analisi 9-driver | Supabase + `POST /api/analyses/run` |
| `run_analysis` | Avvia analisi esistente | `POST /api/analyses/run` |
| `search_knowledge` | Ricerca semantica (RAG) | `POST /api/knowledge/search` |
| `list_knowledge_documents` | Documenti della knowledge base | `GET /api/knowledge/documents` |
| `ingest_knowledge_text` | Ingestione testo (chunk + embed) | `POST /api/knowledge/ingest` |
| `suggest_solutions` | Soluzioni prioritizzate per un driver | `POST /api/llm/solutions` |
| `priority_matrix` | Matrice impatto/sforzo | `POST /api/llm/priority-matrix` |
| `spend_status` | Stato spesa LLM/API vs limite | `GET /api/spend-status` |

I tool che consumano budget LLM (`create_and_run_analysis`, `run_analysis`,
`suggest_solutions`, `priority_matrix`) passano per lo spend-limit esistente.

## Architettura

```
MCP client ──Bearer JWT──▶ POST /api/mcp ──withMcpAuth──▶ verifySupabaseToken
                                                │
                                                ▼
                                         registerTools(server)
                                                │
                  ┌─────────────────────────────┼──────────────────────────┐
                  ▼                              ▼                          ▼
          createClient() (bearer)        apiFetch(token, ...)      lib (embed/run)
          query Supabase (RLS)           riusa route /api/*        riusa logica
```

I tool sono wrapper sottili: le letture colpiscono Supabase tramite il client
bearer-aware (RLS), mentre tutto ciò che ha side-effect, spend-limit o chiamate
LLM è inoltrato alla route esistente — **nessuna duplicazione di logica**.
