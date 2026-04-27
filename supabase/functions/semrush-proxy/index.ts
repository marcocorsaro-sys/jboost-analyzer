import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SEMRUSH_API_KEY = Deno.env.get('SEMRUSH_API_KEY') ?? '';
const BASE_URL = 'https://api.semrush.com/';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function parseSemrushCsv(csv: string): Record<string, string>[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(';').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(';').map(v => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { domain, database = 'us', action, projectId } = await req.json();

    if (!domain || !action) {
      return new Response(JSON.stringify({ error: 'Missing domain or action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!SEMRUSH_API_KEY) {
      return new Response(JSON.stringify({ error: 'SEMRUSH_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let url: string;
    let parseAsCsv = true;

    switch (action) {
      case 'domain_rank':
        url = `${BASE_URL}?type=domain_rank&key=${SEMRUSH_API_KEY}&export_columns=Rk,Or,Ot,Oc,Ad,At,Ac&domain=${domain}&database=${database}`;
        break;
      case 'domain_organic':
        url = `${BASE_URL}?type=domain_organic&key=${SEMRUSH_API_KEY}&export_columns=Ph,Po,Nq,Cp,Co,Tr,Tc&domain=${domain}&database=${database}&display_limit=100`;
        break;
      case 'rank_history':
        url = `${BASE_URL}?type=domain_rank_history&key=${SEMRUSH_API_KEY}&export_columns=Dt,Rk,Or,Ot&domain=${domain}&database=${database}&display_limit=12`;
        break;
      case 'site_health':
        if (!projectId) {
          return new Response(JSON.stringify({ error: 'projectId required for site_health' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        url = `https://api.semrush.com/management/v1/projects/${projectId}/siteaudit/info?key=${SEMRUSH_API_KEY}`;
        parseAsCsv = false;
        break;
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const response = await fetch(url);
    const text = await response.text();

    if (!response.ok) {
      return new Response(JSON.stringify({ error: text, status: response.status }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let data: unknown;
    if (parseAsCsv) {
      const rows = parseSemrushCsv(text);
      data = action === 'domain_rank' ? (rows[0] ?? null) : rows;
    } else {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
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
