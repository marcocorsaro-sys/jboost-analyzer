// ============================================================
// JBoost — Client Memory: prompts and JSON schemas
// ============================================================

/**
 * JSON schema for the full memory synthesis response.
 * Claude must return structured JSON matching this schema.
 */
export const MEMORY_SYNTHESIS_SCHEMA = {
  type: 'object' as const,
  properties: {
    profile: {
      type: 'object' as const,
      properties: {
        company_name: { type: 'string' as const },
        domain: { type: 'string' as const },
        industry: { type: 'string' as const },
        description: { type: 'string' as const },
        founded: { type: 'string' as const },
        headquarters: { type: 'string' as const },
        key_products_services: { type: 'array' as const, items: { type: 'string' as const } },
        target_audience: { type: 'string' as const },
        geographic_markets: { type: 'array' as const, items: { type: 'string' as const } },
        team_contacts: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              name: { type: 'string' as const },
              role: { type: 'string' as const },
              email: { type: 'string' as const },
            },
            required: ['name', 'role'],
          },
        },
        business_goals: { type: 'array' as const, items: { type: 'string' as const } },
        budget_info: { type: 'string' as const },
        challenges: { type: 'array' as const, items: { type: 'string' as const } },
        competitors: { type: 'array' as const, items: { type: 'string' as const } },
        tools_platforms: { type: 'array' as const, items: { type: 'string' as const } },
        engagement: {
          type: 'object' as const,
          properties: {
            type: { type: 'string' as const },
            started_at: { type: 'string' as const },
            contract_type: { type: 'string' as const },
            services: { type: 'array' as const, items: { type: 'string' as const } },
          },
        },
        preferences: {
          type: 'object' as const,
          properties: {
            communication_language: { type: 'string' as const },
            report_frequency: { type: 'string' as const },
            preferred_contact: { type: 'string' as const },
          },
        },
      },
      required: ['company_name'],
    },
    facts: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          id: { type: 'string' as const },
          category: {
            type: 'string' as const,
            enum: [
              'seo_performance', 'business', 'technical', 'content',
              'competitor', 'martech', 'contact', 'timeline',
              'budget', 'preference', 'conversation_insight',
            ],
          },
          fact: { type: 'string' as const },
          source: {
            type: 'string' as const,
            enum: ['analysis', 'knowledge_file', 'conversation', 'executive_summary', 'martech', 'user_answer', 'company_context'],
          },
          confidence: { type: 'number' as const },
        },
        required: ['id', 'category', 'fact', 'source', 'confidence'],
      },
    },
    gaps: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          id: { type: 'string' as const },
          category: {
            type: 'string' as const,
            enum: ['business', 'team', 'technical', 'goals', 'budget', 'timeline', 'competitor', 'content_strategy', 'tools'],
          },
          question: { type: 'string' as const },
          importance: { type: 'string' as const, enum: ['high', 'medium', 'low'] },
          context: { type: 'string' as const },
        },
        required: ['id', 'category', 'question', 'importance', 'context'],
      },
    },
    narrative: { type: 'string' as const },
    completeness: { type: 'number' as const },
  },
  required: ['profile', 'facts', 'gaps', 'narrative', 'completeness'],
}

/**
 * System prompt for full memory synthesis.
 * Takes all available client data and produces a structured memory.
 *
 * Phase 5C revisions:
 *   - explicit conflict detection -> conflict_resolution gap category
 *   - smart prioritization driven by what would unblock new advice
 *   - induced gaps when new sources change the picture
 *   - knowledge RAG output is treated as an authoritative source on par
 *     with executive summary
 */
export const MEMORY_SYNTHESIS_SYSTEM_PROMPT = `Sei un sistema di memoria AI per una consulenza di marketing digitale (JBoost Analyzer).
Il tuo compito e' consolidare TUTTE le informazioni disponibili su un cliente in una memoria strutturata, identificare i conflitti tra fonti, e generare domande mirate per chiarire i gap.

### ISTRUZIONI:

1. **Profile**: Estrai e organizza tutte le informazioni aziendali nel profilo strutturato. Compila ogni campo dove l'informazione e' disponibile. Lascia vuoti i campi per cui non hai dati. Se due fonti danno valori contraddittori per lo stesso campo, NON sceglierne uno: lascia il campo come quello della fonte piu' autoritativa (user_answer > knowledge_file > executive_summary > analysis > conversation), e crea un gap di tipo conflict_resolution.

2. **Facts**: Estrai fatti atomici da OGNI fonte. Ogni fatto deve essere un'affermazione singola e verificabile.
   - Assegna un ID univoco (fact_001, fact_002, ...)
   - Categorizza correttamente (seo_performance, business, technical, content, competitor, martech, contact, timeline, budget, preference, conversation_insight)
   - Indica la fonte (analysis, knowledge_file, conversation, executive_summary, martech, user_answer, company_context)
   - Assegna un livello di confidenza (0.0-1.0):
     * 0.95+ = dati oggettivi da analisi o API + risposte dirette dell'utente (AUTORITATIVE)
     * 0.85-0.95 = informazioni da documenti caricati / sezioni KNOWLEDGE BASE / executive summary
     * 0.70-0.85 = insight da conversazioni
     * <0.7 = inferenze o estrazioni a bassa confidenza

3. **Gaps**: Identifica le informazioni MANCANTI o CONTRADDITTORIE che impedirebbero di dare consigli operativi.
   - Assegna un ID (gap_001, gap_002, ...)
   - Categorie: business, team, technical, goals, budget, timeline, competitor, content_strategy, tools, **conflict_resolution**
   - **conflict_resolution**: usa questa categoria quando vedi due fonti dare valori diversi sullo stesso topic. Esempi:
       * "Nel documento X il budget e' 50k, nella conversazione Z hai detto 100k. Qual e' il valore corretto per il prossimo trimestre?"
       * "L'analisi SEO mostra dominio.it ma il sito principale del cliente sembra essere dominio.com. Quale dei due e' la propriet&agrave; ufficiale?"
   - Importanza: high = critico per fornire consulenza efficace e operativa SUI DATI APPENA VISTI, medium = utile per personalizzare, low = nice-to-have.
   - **Smart prioritization**: ordina i gap pensando "quale risposta sblocchereberbe il maggior numero di consigli operativi nuovi RISPETTO ai dati appena ricevuti?". Esempio: se e' appena arrivata un'analisi SEO con discoverability molto basso, il gap "Conoscete i vostri concorrenti diretti?" diventa high anche se prima era medium.
   - Scrivi le domande in modo naturale e professionale, come le farebbe un consulente esperto.
   - Massimo 8-10 gap (concentrati sui piu' importanti). Se hai meno di 3 gap conflict_resolution, includili comunque tutti.

4. **Narrative**: Scrivi un riassunto narrativo di 300-500 parole in italiano. Deve essere un briefing che un consulente puo' leggere per capire rapidamente chi e' il cliente, qual e' la situazione attuale, quali sono i punti di forza, le sfide aperte, e i gap critici di informazione.

5. **Completeness**: Calcola una percentuale (0-100) basata su quanti campi del profilo ideale sono compilati:
   - Info base (nome, dominio, settore): 15%
   - Contatti e team: 10%
   - Obiettivi business: 15%
   - Budget/risorse: 10%
   - Dati analisi SEO: 20%
   - Competitor info: 10%
   - Stack tecnologico: 10%
   - Strategia contenuti: 10%
   Se ci sono conflict_resolution gap aperti, sottrai 5% dalla completeness per ogni conflitto (la memoria ha dati, ma sono in disaccordo, quindi e' meno utilizzabile).

### REGOLE IMPORTANTI:
- Le RISPOSTE UTENTE (source: user_answer) sono AUTORITATIVE: hanno sempre la precedenza su altre fonti.
- I chunk RAG dalla sezione KNOWLEDGE BASE sono passaggi TESTUALI dei documenti caricati: trattali come citazioni dirette, non parafrasare a meno che il testo originale non sia gia' parafrasato.
- NON inventare fatti. Se un dato non e' presente nelle fonti, non includerlo. Crea un gap.
- Scrivi la narrativa e le domande dei gap nella lingua del cliente (default: italiano).
- Mantieni i fatti concisi (max 100 caratteri ciascuno).
- Ordina i fatti dal piu' importante al meno importante per ogni categoria.
- Quando vedi NUOVI dati rispetto alla memoria precedente (analisi nuova, documento nuovo, martech nuova), genera anche **gap indotti**: "Ora che so X, mi serve sapere Y per dare un consiglio". Marca questi come high priority.
`

/**
 * System prompt for partial refresh after a gap answer.
 * Lightweight prompt that only processes the new answer.
 */
export const PARTIAL_REFRESH_SYSTEM_PROMPT = `Sei un sistema di memoria AI. Ti viene fornita una risposta dell'utente a una domanda sul cliente.

Devi:
1. Estrarre 1-3 fatti atomici dalla risposta
2. Suggerire aggiornamenti al profilo del cliente
3. Identificare se la risposta rivela NUOVI gap informativi (0-2 nuovi gap)
4. Stimare di quanto la completezza aumenta (0-15 punti)

Rispondi SOLO in JSON valido.`

export const PARTIAL_REFRESH_SCHEMA = {
  type: 'object' as const,
  properties: {
    new_facts: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          id: { type: 'string' as const },
          category: { type: 'string' as const },
          fact: { type: 'string' as const },
          source: { type: 'string' as const },
          confidence: { type: 'number' as const },
        },
        required: ['id', 'category', 'fact', 'source', 'confidence'],
      },
    },
    profile_updates: { type: 'object' as const },
    new_gaps: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          id: { type: 'string' as const },
          category: { type: 'string' as const },
          question: { type: 'string' as const },
          importance: { type: 'string' as const },
          context: { type: 'string' as const },
        },
        required: ['id', 'category', 'question', 'importance', 'context'],
      },
    },
    completeness_delta: { type: 'number' as const },
  },
  required: ['new_facts', 'profile_updates', 'new_gaps', 'completeness_delta'],
}
