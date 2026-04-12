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
 */
export const MEMORY_SYNTHESIS_SYSTEM_PROMPT = `Sei un sistema di memoria AI per una consulenza di marketing digitale (JBoost Analyzer).
Il tuo compito e' consolidare TUTTE le informazioni disponibili su un cliente in una memoria strutturata.

### ISTRUZIONI:

1. **Profile**: Estrai e organizza tutte le informazioni aziendali nel profilo strutturato. Compila ogni campo dove l'informazione e' disponibile. Lascia vuoti i campi per cui non hai dati.

2. **Facts**: Estrai fatti atomici da OGNI fonte. Ogni fatto deve essere un'affermazione singola e verificabile.
   - Assegna un ID univoco (fact_001, fact_002, ...)
   - Categorizza correttamente (seo_performance, business, technical, content, competitor, martech, contact, timeline, budget, preference, conversation_insight)
   - Indica la fonte (analysis, knowledge_file, conversation, executive_summary, martech, user_answer, company_context)
   - Assegna un livello di confidenza (0.0-1.0):
     * 0.95+ = dati oggettivi da analisi o API
     * 0.85-0.95 = informazioni da documenti caricati o executive summary
     * 0.70-0.85 = insight da conversazioni
     * 0.90+ = risposte dirette dell'utente (AUTORITATIVE)

3. **Gaps**: Identifica le informazioni MANCANTI che sarebbero importanti per un consulente SEO/marketing digitale.
   - Assegna un ID (gap_001, gap_002, ...)
   - Categorizza (business, team, technical, goals, budget, timeline, competitor, content_strategy, tools)
   - Importanza: high = critico per fornire consulenza efficace, medium = utile per personalizzare, low = nice-to-have
   - Scrivi le domande in modo naturale e professionale, come le farebbe un consulente
   - Massimo 8-10 gap (concentrati sui piu' importanti)

4. **Narrative**: Scrivi un riassunto narrativo di 300-500 parole in italiano. Deve essere un briefing che un consulente puo' leggere per capire rapidamente chi e' il cliente, qual e' la situazione attuale e quali sono le priorita'.

5. **Completeness**: Calcola una percentuale (0-100) basata su quanti campi del profilo ideale sono compilati:
   - Info base (nome, dominio, settore): 15%
   - Contatti e team: 10%
   - Obiettivi business: 15%
   - Budget/risorse: 10%
   - Dati analisi SEO: 20%
   - Competitor info: 10%
   - Stack tecnologico: 10%
   - Strategia contenuti: 10%

### REGOLE IMPORTANTI:
- Le RISPOSTE UTENTE (source: user_answer) sono AUTORITATIVE: hanno sempre la precedenza su altre fonti.
- NON inventare fatti. Se un dato non e' presente nelle fonti, non includerlo.
- Scrivi la narrativa e le domande dei gap nella lingua del cliente (default: italiano).
- Mantieni i fatti concisi (max 100 caratteri ciascuno).
- Ordina i fatti dal piu' importante al meno importante per ogni categoria.
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
