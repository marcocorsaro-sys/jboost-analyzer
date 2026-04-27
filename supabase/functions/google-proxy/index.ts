import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GOOGLE_PSI_KEY = Deno.env.get('GOOGLE_PSI_KEY') ?? '';
const SERPAPI_KEY = Deno.env.get('SERPAPI_KEY') ?? '';

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
    const { domain, action, keyword } = await req.json();

    if (!action) {
      return new Response(JSON.stringify({ error: 'Missing action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'psi') {
      if (!domain) {
        return new Response(JSON.stringify({ error: 'Missing domain for PSI' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const targetUrl = domain.startsWith('http') ? domain : `https://${domain}`;
      const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(targetUrl)}&strategy=mobile${GOOGLE_PSI_KEY ? `&key=${GOOGLE_PSI_KEY}` : ''}`;

      const response = await fetch(psiUrl);
      const json = await response.json();

      if (!response.ok) {
        return new Response(JSON.stringify({ error: json.error?.message ?? 'PSI request failed', status: response.status }), {
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Extract key scores from Lighthouse
      const categories = json.lighthouseResult?.categories ?? {};
      const data = {
        performance_score: (categories.performance?.score ?? 0) * 100,
        accessibility_score: (categories.accessibility?.score ?? 0) * 100,
        best_practices_score: (categories['best-practices']?.score ?? 0) * 100,
        seo_score: (categories.seo?.score ?? 0) * 100,
        // Core Web Vitals
        lcp: json.lighthouseResult?.audits?.['largest-contentful-paint']?.numericValue,
        fid: json.lighthouseResult?.audits?.['max-potential-fid']?.numericValue,
        cls: json.lighthouseResult?.audits?.['cumulative-layout-shift']?.numericValue,
        fcp: json.lighthouseResult?.audits?.['first-contentful-paint']?.numericValue,
        ttfb: json.lighthouseResult?.audits?.['server-response-time']?.numericValue,
        si: json.lighthouseResult?.audits?.['speed-index']?.numericValue,
        tti: json.lighthouseResult?.audits?.['interactive']?.numericValue,
        tbt: json.lighthouseResult?.audits?.['total-blocking-time']?.numericValue,
        source: 'google_psi',
      };

      return new Response(JSON.stringify({ data, action, domain }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'trends') {
      const searchKeyword = keyword || domain;

      if (!SERPAPI_KEY) {
        // Return mock trend data
        return new Response(JSON.stringify({
          data: {
            interest_over_time: [],
            average_interest: 50,
            trend_direction: 'stable',
            _meta: { is_mock: true },
          },
          action,
          domain,
          is_mock: true,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const trendsUrl = `https://serpapi.com/search.json?engine=google_trends&q=${encodeURIComponent(searchKeyword)}&data_type=TIMESERIES&api_key=${SERPAPI_KEY}`;
      const response = await fetch(trendsUrl);
      const json = await response.json();

      const timelineData = json.interest_over_time?.timeline_data ?? [];
      const values = timelineData.map((d: { values: Array<{ extracted_value: number }> }) =>
        d.values?.[0]?.extracted_value ?? 0
      );

      const avgInterest = values.length > 0
        ? values.reduce((a: number, b: number) => a + b, 0) / values.length
        : 0;

      // Determine trend direction
      const recentHalf = values.slice(Math.floor(values.length / 2));
      const olderHalf = values.slice(0, Math.floor(values.length / 2));
      const recentAvg = recentHalf.length > 0 ? recentHalf.reduce((a: number, b: number) => a + b, 0) / recentHalf.length : 0;
      const olderAvg = olderHalf.length > 0 ? olderHalf.reduce((a: number, b: number) => a + b, 0) / olderHalf.length : 0;
      const trendDirection = recentAvg > olderAvg * 1.1 ? 'rising' : recentAvg < olderAvg * 0.9 ? 'declining' : 'stable';

      return new Response(JSON.stringify({
        data: {
          interest_over_time: timelineData,
          average_interest: Math.round(avgInterest),
          trend_direction: trendDirection,
          source: 'google_trends_serpapi',
        },
        action,
        domain,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
