import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const AHREFS_API_KEY = Deno.env.get('AHREFS_API_KEY') ?? '';
const BASE_URL = 'https://apiv2.ahrefs.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { domain, action } = await req.json();

    if (!domain || !action) {
      return new Response(JSON.stringify({ error: 'Missing domain or action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!AHREFS_API_KEY) {
      // Return mock data when API key not configured
      const mockData: Record<string, unknown> = {
        'domain-rating': { domain_rating: 50, ahrefs_rank: 100000, _meta: { is_mock: true } },
        'organic-keywords': { keywords: [], ai_relevance_score: 0, total_keywords: 0, _meta: { is_mock: true } },
        'broken-backlinks': { broken_backlinks: 0, _meta: { is_mock: true } },
      };
      return new Response(JSON.stringify({ data: mockData[action] ?? {}, action, domain, is_mock: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let url: string;

    switch (action) {
      case 'domain-rating':
        url = `${BASE_URL}?token=${AHREFS_API_KEY}&from=domain_rating&target=${domain}&mode=domain&output=json`;
        break;
      case 'organic-keywords':
        url = `${BASE_URL}?token=${AHREFS_API_KEY}&from=organic_keywords&target=${domain}&mode=domain&output=json&limit=200&select=keyword,volume,serp_features`;
        break;
      case 'broken-backlinks':
        url = `${BASE_URL}?token=${AHREFS_API_KEY}&from=broken_backlinks&target=${domain}&mode=domain&output=json&limit=1`;
        break;
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const response = await fetch(url);

    if (response.status === 403) {
      // Ahrefs returns 403 when API key has no access — return mock
      const mockData: Record<string, unknown> = {
        'domain-rating': { domain_rating: 50, ahrefs_rank: 100000, _meta: { is_mock: true } },
        'organic-keywords': { keywords: [], ai_relevance_score: 0, total_keywords: 0, _meta: { is_mock: true } },
        'broken-backlinks': { broken_backlinks: 0, _meta: { is_mock: true } },
      };
      return new Response(JSON.stringify({ data: mockData[action] ?? {}, action, domain, is_mock: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();

    // Post-process organic keywords for AI relevance
    if (action === 'organic-keywords' && data?.keywords) {
      let aiOverviewCount = 0;
      let featuredSnippetCount = 0;
      const keywords = data.keywords as Array<{ keyword: string; volume: number; serp_features: string[] }>;

      for (const kw of keywords) {
        const features = kw.serp_features || [];
        if (features.includes('ai_overview') || features.includes('ai_overviews')) aiOverviewCount++;
        if (features.includes('featured_snippet')) featuredSnippetCount++;
      }

      const totalKeywords = keywords.length;
      const aiRelevanceScore = totalKeywords > 0
        ? ((aiOverviewCount + featuredSnippetCount) / totalKeywords) * 100
        : 0;

      data.ai_overview_keywords = aiOverviewCount;
      data.featured_snippet_keywords = featuredSnippetCount;
      data.total_keywords = totalKeywords;
      data.ai_relevance_score = Math.round(aiRelevanceScore * 100) / 100;
    }

    return new Response(JSON.stringify({ data, action, domain }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
