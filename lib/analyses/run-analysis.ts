import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface RunAnalysisResult {
  success: boolean;
  analysisId: string;
  error?: string;
  runtime_ms: number;
}

// Global timeout guard: 140s (Vercel maxDuration is 300s on Pro, but we keep
// the original Supabase ceiling as a defensive cap for the orchestration body).
const MAX_RUNTIME_MS = 140_000;

/**
 * Orchestrates the 9-driver analysis for a given analysis row.
 * Idempotent on `analysisId`: callable multiple times safely (status will
 * end up `completed` or `failed`, never stuck in `running`).
 *
 * Replaces the Supabase Edge Function `run-analysis` (Deno). Same 8 phases,
 * same DB writes, same external API calls. Three behavioral changes vs the
 * edge function:
 *  1. Race fix: the top-level catch marks failed ONLY this analysisId,
 *     not "any running analysis older than 3 min" (which used to clobber
 *     concurrent runs).
 *  2. Single Supabase client created once at the top, reused everywhere.
 *  3. Reads env via process.env (Node), not the edge-runtime env API.
 */
export async function runAnalysis(analysisId: string): Promise<RunAnalysisResult> {
  const startTime = Date.now();
  function timeLeft(): number { return MAX_RUNTIME_MS - (Date.now() - startTime); }
  function hasTime(minMs = 5000): boolean { return timeLeft() > minMs; }

  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase: SupabaseClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    // Load API keys from DB (app_config table), with env fallback
    async function getApiKeysFromDb(): Promise<Record<string, string>> {
      try {
        const { data } = await supabase.from('app_config').select('key, value');
        const map: Record<string, string> = {};
        if (data) {
          for (const row of data) { map[row.key] = row.value; }
        }
        return map;
      } catch (e) {
        console.warn('[getApiKeysFromDb] Failed to load keys from DB:', e);
        return {};
      }
    }
    const dbKeys = await getApiKeysFromDb();

    const { data: analysis, error: fetchErr } = await supabase
      .from('analyses').select('*').eq('id', analysisId).single();

    if (fetchErr || !analysis) {
      // The route handler already verified access; reaching here would be a race.
      throw new Error('Analysis not found: ' + analysisId);
    }

    const domain = analysis.domain;
    const country = analysis.country || 'us';
    const competitors: string[] = analysis.competitors || [];
    const targetTopic = analysis.target_topic || '';

    async function updatePhase(phase: string, detail?: string) {
      await supabase.from('analyses')
        .update({ current_phase: phase, phase_detail: detail || null, updated_at: new Date().toISOString() })
        .eq('id', analysisId);
    }

    async function markFailed(errorMsg: string) {
      await supabase.from('analyses').update({
        status: 'failed', error_message: errorMsg, current_phase: 'failed',
        updated_at: new Date().toISOString(),
      }).eq('id', analysisId);
    }

    await supabase.from('analyses')
      .update({ status: 'running', started_at: new Date().toISOString(), current_phase: 'initializing' })
      .eq('id', analysisId);

    // ============================
    // PHASE 1: Fetch all API data
    // ============================
    await updatePhase('fetching_apis', 'Fetching SEO data from multiple sources...');

    const SEMRUSH_API_KEY = dbKeys['SEMRUSH_API_KEY'] || process.env.SEMRUSH_API_KEY || '';
    const AHREFS_API_KEY = dbKeys['AHREFS_API_KEY'] || process.env.AHREFS_API_KEY || '';
    const GOOGLE_PSI_API_KEY = dbKeys['GOOGLE_PSI_API_KEY'] || process.env.GOOGLE_PSI_API_KEY || '';
    const hasAnyApiKey = !!(SEMRUSH_API_KEY || AHREFS_API_KEY || GOOGLE_PSI_API_KEY);

    const apiNames = [
      'semrush_domain_overview', 'semrush_site_health', 'semrush_organic_losing',
      'semrush_branded_keywords', 'semrush_brand_awareness',
      'ahrefs_domain_rating', 'ahrefs_ai_relevance', 'ahrefs_broken_backlinks', 'ahrefs_refdomains_history',
      'pagespeed_mobile', 'pagespeed_failed_audits', 'company_context',
    ];

    const apiDataMap: Record<string, any> = {};

    if (hasAnyApiKey) {
      const apiResults = await Promise.allSettled([
        fetchSemrushDomainRank(domain, country, SEMRUSH_API_KEY),
        fetchSemrushSiteHealth(domain, SEMRUSH_API_KEY),
        fetchSemrushOrganicLosing(domain, country, SEMRUSH_API_KEY),
        fetchSemrushBrandedKeywords(domain, extractBrand(domain), country, SEMRUSH_API_KEY),
        fetchSemrushBrandAwareness(domain, country, SEMRUSH_API_KEY),
        fetchAhrefsDomainRating(domain, AHREFS_API_KEY),
        fetchAhrefsAiRelevance(domain, country, AHREFS_API_KEY),
        fetchAhrefsBrokenBacklinks(domain, AHREFS_API_KEY),
        fetchAhrefsRefdomainsHistory(domain, AHREFS_API_KEY),
        fetchPageSpeed(domain, GOOGLE_PSI_API_KEY),
        fetchPageSpeedFailedAudits(domain, GOOGLE_PSI_API_KEY),
        fetchCompanyContext(domain, competitors, targetTopic, dbKeys, dbKeys['PPLX_API_KEY'] || process.env.PPLX_API_KEY || '', dbKeys['ANTHROPIC_API_KEY'] || process.env.ANTHROPIC_API_KEY || ''),
      ]);
      for (let i = 0; i < apiResults.length; i++) {
        const result = apiResults[i];
        const name = apiNames[i];
        const data = result.status === 'fulfilled' ? result.value : null;
        const isMock = !data || (data as any)?._meta?.is_mock === true;
        apiDataMap[name] = (data as any)?.data || data || null;
        await supabase.from('api_data').upsert({
          analysis_id: analysisId, source_name: name, data: data || {}, is_mock: isMock, fetched_at: new Date().toISOString(),
        }, { onConflict: 'analysis_id,source_name' });
      }
    } else {
      await updatePhase('fetching_apis', 'Generating demo data (no API keys configured)...');
      const mockData = generateRealisticMockData(domain, country);
      for (const name of apiNames) {
        apiDataMap[name] = mockData[name] ?? null;
        await supabase.from('api_data').upsert({
          analysis_id: analysisId, source_name: name, data: mockData[name] || {}, is_mock: true, fetched_at: new Date().toISOString(),
        }, { onConflict: 'analysis_id,source_name' });
      }
    }

    if (apiDataMap.company_context) {
      await supabase.from('analyses').update({ company_context: apiDataMap.company_context }).eq('id', analysisId);
    }

    // Time check after Phase 1
    if (!hasTime(20000)) {
      await markFailed('Timeout: API data fetching took too long');
      return { success: false, analysisId, error: 'Timeout after API fetching', runtime_ms: Date.now() - startTime };
    }

    // ============================
    // PHASE 2: Calculate scores
    // ============================
    await updatePhase('calculating_scores', 'Computing driver scores...');
    const driverInputs = {
      semrush_domain_rank: apiDataMap.semrush_domain_overview,
      semrush_site_health: apiDataMap.semrush_site_health,
      ahrefs_domain_rating: apiDataMap.ahrefs_domain_rating,
      ahrefs_ai_relevance: apiDataMap.ahrefs_ai_relevance,
      psi_mobile: apiDataMap.pagespeed_mobile,
      trends_brand_awareness: apiDataMap.semrush_brand_awareness,
    };
    const driverScores = calculateAllDrivers(driverInputs);

    // ============================
    // PHASE 3: Generate issues
    // ============================
    await updatePhase('generating_issues', 'Identifying problems...');
    const allIssues = generateAllDriverIssues(apiDataMap);

    for (const [driverName, result] of Object.entries(driverScores)) {
      const issues = allIssues[driverName] || allIssues[driverName.replace('_', '-')] || [];
      await supabase.from('driver_results').upsert({
        analysis_id: analysisId, driver_name: driverName, score: result.score, status: result.status,
        issues: issues, solutions: [], raw_data: result.details || {},
      }, { onConflict: 'analysis_id,driver_name' });
    }

    // ============================
    // PHASE 4: Generate solutions
    // ============================
    await updatePhase('generating_solutions', 'Generating AI-powered solutions...');
    const OPENAI_API_KEY = dbKeys['OPENAI_API_KEY'] || process.env.OPENAI_API_KEY || process.env.OPEN_AI_API_KEY || '';
    const ANTHROPIC_API_KEY_VAL = dbKeys['ANTHROPIC_API_KEY'] || process.env.ANTHROPIC_API_KEY || '';
    const PPLX_API_KEY = dbKeys['PPLX_API_KEY'] || process.env.PPLX_API_KEY || '';
    const hasLLMKey = !!(OPENAI_API_KEY || PPLX_API_KEY || ANTHROPIC_API_KEY_VAL);

    for (const [driverName, result] of Object.entries(driverScores)) {
      if (!hasTime(15000)) { console.warn('[solutions] Skipping remaining drivers - running low on time'); break; }
      const issues = allIssues[driverName] || allIssues[driverName.replace('_', '-')] || [];
      if (issues.length === 0 || result.score === null) continue;
      await updatePhase('generating_solutions', `Generating solutions for ${driverName}...`);
      try {
        const numSolutions = Math.min(issues.length, 3);
        let solutions: any[];
        if (hasLLMKey) {
          solutions = await generateDriverSolutions(driverName, domain, result.score, issues, numSolutions, OPENAI_API_KEY, PPLX_API_KEY, ANTHROPIC_API_KEY_VAL);
        } else {
          solutions = generateMockSolutions(driverName, domain, result.score, issues, numSolutions);
        }
        await supabase.from('driver_results').update({ solutions }).eq('analysis_id', analysisId).eq('driver_name', driverName);
      } catch (err) { console.error(`[solutions:${driverName}]`, err); }
    }

    // ============================
    // PHASE 5: Competitor analysis (PARALLEL)
    // ============================
    if (competitors.length > 0 && hasTime(20000)) {
      await updatePhase('analyzing_competitors', `Analyzing ${competitors.length} competitors in parallel...`);

      // Run ALL competitors in parallel instead of serial
      const competitorPromises = competitors.map(async (competitor) => {
        try {
          let compScores: Record<string, number | null>;
          if (hasAnyApiKey) {
            // Add per-competitor timeout of 25s
            compScores = await Promise.race([
              analyzeCompetitor(competitor, country, SEMRUSH_API_KEY, AHREFS_API_KEY, GOOGLE_PSI_API_KEY),
              new Promise<Record<string, number | null>>((_, reject) =>
                setTimeout(() => reject(new Error(`Competitor ${competitor} timeout`)), 25000)
              ),
            ]);
          } else {
            compScores = analyzeCompetitorMock(competitor, country);
          }
          await supabase.from('competitor_results').upsert({
            analysis_id: analysisId, competitor_domain: competitor, scores: compScores,
          }, { onConflict: 'analysis_id,competitor_domain' });
          return { competitor, success: true };
        } catch (err) {
          console.error(`[competitor:${competitor}]`, err);
          return { competitor, success: false };
        }
      });

      const competitorResults = await Promise.allSettled(competitorPromises);
      const completed = competitorResults.filter(r => r.status === 'fulfilled' && (r.value as any).success).length;
      console.log(`[competitors] ${completed}/${competitors.length} analyzed successfully`);
    } else if (competitors.length > 0) {
      console.warn('[competitors] Skipped - running low on time');
      await updatePhase('analyzing_competitors', 'Skipped competitors (time constraint)');
    }

    // ============================
    // PHASE 6: Priority matrix
    // ============================
    if (hasTime(15000)) {
      await updatePhase('generating_matrix', 'Classifying solutions into priority matrix...');
      try {
        const { data: driverResultsRows } = await supabase
          .from('driver_results').select('driver_name, score, solutions').eq('analysis_id', analysisId);

        const allSolutions: any[] = [];
        let driverIdx = 1;
        for (const row of (driverResultsRows || [])) {
          const solutions = row.solutions || [];
          let solIdx = 0;
          for (const sol of solutions) {
            const letter = String.fromCharCode(65 + solIdx);
            allSolutions.push({
              reference: `${driverIdx}.${letter}`,
              driver: row.driver_name,
              title: sol.title || 'Untitled Solution',
              description: sol.description || '',
              impact: sol.impact || 'medium',
              effort_level: sol.effort_level || 'medium',
              estimated_improvement: sol.estimated_improvement || 5,
              timeframe: sol.timeframe || 'medium_term',
            });
            solIdx++;
          }
          driverIdx++;
        }

        if (allSolutions.length > 0) {
          let matrix: any;
          if (hasLLMKey) {
            matrix = await generatePriorityMatrix(allSolutions, OPENAI_API_KEY, PPLX_API_KEY, ANTHROPIC_API_KEY_VAL);
          } else {
            matrix = generateMockPriorityMatrix(allSolutions);
          }

          const solMap = new Map(allSolutions.map(s => [s.reference, s]));
          for (const quadrant of ['opportunities', 'issues', 'improvements', 'suggestions']) {
            if (matrix[quadrant]) {
              matrix[quadrant] = matrix[quadrant].map((item: any) => {
                const sol = solMap.get(item.reference);
                if (sol) {
                  return {
                    title: sol.title,
                    driver: sol.driver,
                    description: sol.description,
                    impact_score: sol.impact === 'high' ? 9 : sol.impact === 'medium' ? 6 : 3,
                    effort_score: sol.effort_level === 'high' ? 8 : sol.effort_level === 'medium' ? 5 : 2,
                    reference: item.reference,
                    timeframe: sol.timeframe,
                    estimated_improvement: sol.estimated_improvement,
                  };
                }
                return item;
              });
            }
          }

          await supabase.from('priority_matrix').upsert({
            analysis_id: analysisId, ...matrix,
          }, { onConflict: 'analysis_id' });
        }
      } catch (err) { console.error('[priority_matrix]', err); }
    } else {
      console.warn('[priority_matrix] Skipped - running low on time');
    }

    // ============================
    // PHASE 7: Finalize
    // ============================
    await updatePhase('finalizing', 'Calculating final scores...');
    await supabase.rpc('recalculate_overall_score', { p_analysis_id: analysisId });
    await supabase.from('analyses').update({
      status: 'completed', current_phase: 'completed', phase_detail: null, completed_at: new Date().toISOString(),
    }).eq('id', analysisId);
    await supabase.from('analysis_audit_log').insert({
      analysis_id: analysisId, action: 'analysis_completed', details: { domain, competitors_count: competitors.length, runtime_ms: Date.now() - startTime },
    });

    console.log(`[run-analysis] Completed in ${Date.now() - startTime}ms for ${domain} with ${competitors.length} competitors`);

    return { success: true, analysisId, runtime_ms: Date.now() - startTime };

  } catch (error) {
    console.error('[runAnalysis] Fatal error for', analysisId, ':', error);
    try {
      await supabase.from('analyses')
        .update({
          status: 'failed',
          error_message: `Run failed: ${String(error).substring(0, 500)}`,
          current_phase: 'failed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', analysisId);
    } catch (markErr) {
      console.error('[runAnalysis] Failed to mark analysis as failed:', markErr);
    }
    return { success: false, analysisId, error: String(error), runtime_ms: Date.now() - startTime };
  }
}

// ============================================================
// REALISTIC MOCK DATA GENERATOR
// ============================================================
function generateRealisticMockData(domain: string, country: string): Record<string, any> {
  function hashSeed(str: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  let seed = hashSeed(domain + ':' + country);
  function rand(): number { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed = seed >>> 0; return seed / 4294967296; }
  function randInt(min: number, max: number): number { return Math.floor(rand() * (max - min + 1)) + min; }
  function randFloat(min: number, max: number, decimals: number = 2): number { return parseFloat((rand() * (max - min) + min).toFixed(decimals)); }
  function pick<T>(arr: T[]): T { return arr[Math.floor(rand() * arr.length)]; }

  const domainName = domain.replace(/^www\./, '').split('.')[0];
  const tier = seed % 3;

  const rankMin = tier === 2 ? 1000 : tier === 1 ? 50000 : 150000;
  const rankMax = tier === 2 ? 50000 : tier === 1 ? 200000 : 500000;
  const rank = randInt(rankMin, rankMax);
  const organicKeywords = randInt(tier === 2 ? 10000 : tier === 1 ? 2000 : 500, tier === 2 ? 50000 : tier === 1 ? 15000 : 5000);
  const organicTraffic = randInt(tier === 2 ? 40000 : tier === 1 ? 5000 : 1000, tier === 2 ? 200000 : tier === 1 ? 60000 : 15000);
  const organicCost = randFloat(organicTraffic * 0.3, organicTraffic * 1.2, 0);
  const adwordsKeywords = randInt(0, tier === 2 ? 500 : tier === 1 ? 150 : 30);
  const adwordsTraffic = randInt(0, tier === 2 ? 5000 : tier === 1 ? 1500 : 300);
  const adwordsCost = randFloat(adwordsTraffic * 0.5, adwordsTraffic * 2.5, 0);
  const semrush_domain_overview = { rank, organicKeywords, organicTraffic, organicCost, adwordsKeywords, adwordsTraffic, adwordsCost };

  const siteHealthScoreBase = tier === 2 ? 70 : tier === 1 ? 58 : 50;
  const site_health_score = randInt(siteHealthScoreBase, Math.min(95, siteHealthScoreBase + 25));
  const pages_crawled = randInt(100, 5000);
  const allSiteIssues = [
    { id: 'missing_meta_description', title: 'Missing meta description', type: 'warning' },
    { id: 'duplicate_meta_description', title: 'Duplicate meta description', type: 'warning' },
    { id: 'missing_title_tag', title: 'Missing title tag', type: 'error' },
    { id: 'duplicate_title_tag', title: 'Duplicate title tag', type: 'warning' },
    { id: 'broken_links', title: 'Links are not crawlable', type: 'error' },
    { id: 'missing_alt_attributes', title: 'Image elements do not have [alt] attributes', type: 'warning' },
    { id: 'http_page', title: 'Page is served over HTTP', type: 'error' },
    { id: 'slow_page', title: 'Page loading speed is too slow', type: 'warning' },
    { id: 'redirect_chain', title: 'Too many on-page redirects', type: 'warning' },
    { id: 'broken_images', title: 'Broken images found on page', type: 'error' },
    { id: 'low_word_count', title: 'Pages have low word count', type: 'notice' },
    { id: 'missing_h1', title: 'Missing H1 heading tag', type: 'warning' },
    { id: 'mixed_content', title: 'HTTPS page contains HTTP resources', type: 'error' },
  ];
  const shuffledIssues = [...allSiteIssues].sort(() => rand() - 0.5);
  const issues = shuffledIssues.slice(0, randInt(5, 8)).map(issue => ({ ...issue, pages_count: randInt(1, Math.floor(pages_crawled * 0.3)) }));
  const semrush_site_health = { site_health_score, issues, pages_crawled };

  const genericKeywordPrefixes = [`${domainName} `, 'best ', 'buy ', 'how to ', '', 'top ', 'cheap '];
  const genericKeywordSuffixes = ['online', 'reviews', 'price', 'service', 'near me', 'guide', '2024', 'comparison'];
  function makeKeyword(): string { return pick(genericKeywordPrefixes) + domainName + ' ' + pick(genericKeywordSuffixes); }
  const semrush_organic_losing = Array.from({ length: 5 }, () => {
    const previousPosition = randInt(1, 15); const drop = randInt(1, 12);
    return { keyword: makeKeyword(), position: previousPosition + drop, previousPosition, positionDifference: -drop, traffic: randInt(10, 2000), searchVolume: randInt(200, 20000) };
  });

  const brandedCount = randInt(5, 50);
  const semrush_branded_keywords = { count: brandedCount, totalBrandedTraffic: randInt(brandedCount * 50, brandedCount * 500) };

  const baseDate = new Date(2025, 9, 1);
  let rollingRank = rank, rollingKeywords = organicKeywords, rollingTraffic = organicTraffic;
  const semrush_brand_awareness = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(baseDate); d.setMonth(d.getMonth() - (5 - i));
    rollingRank = Math.max(1000, rollingRank + randInt(-20000, 20000));
    rollingKeywords = Math.max(100, rollingKeywords + randInt(-500, 500));
    rollingTraffic = Math.max(200, rollingTraffic + randInt(-3000, 3000));
    return { date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, rank: rollingRank, organicKeywords: rollingKeywords, organicTraffic: rollingTraffic };
  });

  const drBase = tier === 2 ? 50 : tier === 1 ? 30 : 20;
  const ahrefs_domain_rating = { domain_rating: randInt(drBase, Math.min(80, drBase + 30)), ahrefs_rank: randInt(500000, 20000000) };

  const total_kw_ai = randInt(100, 1000);
  const ahrefs_ai_relevance = { ai_relevance_score: randInt(5, 40), ai_overview_keywords: randInt(2, Math.floor(total_kw_ai * 0.12)), featured_snippet_keywords: randInt(1, Math.floor(total_kw_ai * 0.1)), people_also_ask_keywords: randInt(5, Math.floor(total_kw_ai * 0.25)), total_keywords: total_kw_ai };

  const externalDomains = ['techcrunch.com', 'forbes.com', 'medium.com', 'reddit.com', 'linkedin.com', 'wired.com', 'theverge.com'];
  const deadPaths = ['/old-page', '/deprecated-product', '/2019/blog-post', '/resources/white-paper', '/about/team-member'];
  const ahrefs_broken_backlinks = Array.from({ length: randInt(2, 3) }, () => ({ url_from: `https://${pick(externalDomains)}${pick(deadPaths)}-review`, url_to: `https://${domain}${pick(deadPaths)}`, domain_rating_source: randInt(30, 85), http_code: 404 }));

  const refBase = tier === 2 ? 2000 : tier === 1 ? 500 : 80;
  let rollingRefdomains = refBase + randInt(-100, 100);
  const ahrefs_refdomains_history = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(baseDate); d.setMonth(d.getMonth() - (5 - i));
    rollingRefdomains = Math.max(10, rollingRefdomains + randInt(-50, 80));
    return { date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, refdomains: rollingRefdomains };
  });

  const perfBase = tier === 2 ? 55 : tier === 1 ? 40 : 30;
  const a11yBase = tier === 2 ? 75 : tier === 1 ? 65 : 60;
  const pagespeed_mobile = { performance_score: randInt(perfBase, Math.min(85, perfBase + 30)), accessibility_score: randInt(a11yBase, Math.min(95, a11yBase + 20)) };

  const allFailedAudits = [
    { id: 'largest-contentful-paint', title: 'Largest Contentful Paint', description: 'Largest Contentful Paint marks the time at which the largest text or image is painted.', score: randFloat(0.1, 0.45), displayValue: `${randFloat(2.5, 8.0, 1)} s` },
    { id: 'total-blocking-time', title: 'Total Blocking Time', description: 'Sum of all time periods between FCP and Time to Interactive.', score: randFloat(0.0, 0.49), displayValue: `${randInt(300, 1800)} ms` },
    { id: 'cumulative-layout-shift', title: 'Cumulative Layout Shift', description: 'Cumulative Layout Shift measures the movement of visible elements.', score: randFloat(0.05, 0.49), displayValue: randFloat(0.05, 0.4, 2).toString() },
    { id: 'render-blocking-resources', title: 'Eliminate render-blocking resources', description: 'Resources are blocking the first paint of your page.', score: randFloat(0.1, 0.5), displayValue: `Potential savings of ${randInt(300, 1500)} ms` },
    { id: 'unused-javascript', title: 'Reduce unused JavaScript', description: 'Reduce unused JavaScript and defer loading scripts.', score: randFloat(0.1, 0.6), displayValue: `Potential savings of ${randInt(50, 400)} KiB` },
    { id: 'unused-css-rules', title: 'Reduce unused CSS', description: 'Reduce unused rules from stylesheets.', score: randFloat(0.1, 0.6), displayValue: `Potential savings of ${randInt(20, 200)} KiB` },
    { id: 'uses-optimized-images', title: 'Efficiently encode images', description: 'Optimized images load faster.', score: randFloat(0.2, 0.7), displayValue: `Potential savings of ${randInt(100, 800)} KiB` },
    { id: 'uses-text-compression', title: 'Enable text compression', description: 'Text-based resources should be served with compression.', score: randFloat(0.0, 0.5), displayValue: `Potential savings of ${randInt(20, 300)} KiB` },
    { id: 'first-contentful-paint', title: 'First Contentful Paint', description: 'First Contentful Paint marks the time at which the first text or image is painted.', score: randFloat(0.2, 0.6), displayValue: `${randFloat(1.5, 5.0, 1)} s` },
  ];
  const pagespeed_failed_audits = [...allFailedAudits].sort(() => rand() - 0.5).slice(0, randInt(4, 6)).sort((a, b) => a.score - b.score);

  const company_context = {
    company_profile: `${domainName.charAt(0).toUpperCase() + domainName.slice(1)} is a digital-first company operating in the ${country.toUpperCase()} market with a growing digital footprint and focus on user experience and modern web standards.`,
    market_scenario: `The ${country.toUpperCase()} market is competitive with growing digital adoption. Key trends include mobile-first behavior, AI-driven personalization, and increasing emphasis on data privacy.`,
    business_challenges: `Primary challenges include maintaining organic search visibility amid algorithm changes, improving technical website performance, and building authoritative backlink profiles.`,
    last_news: [
      { title: `${domainName.charAt(0).toUpperCase() + domainName.slice(1)} launches new digital platform`, link: `https://${domain}/news/1`, source: 'Company Blog', snippet: 'New features for improving engagement.' },
      { title: `Industry analysis: ${domainName} sector trends`, link: `https://example.com/report`, source: 'Industry Report', snippet: 'Growth outlook positive.' },
    ]
  };

  return { semrush_domain_overview, semrush_site_health, semrush_organic_losing, semrush_branded_keywords, semrush_brand_awareness, ahrefs_domain_rating, ahrefs_ai_relevance, ahrefs_broken_backlinks, ahrefs_refdomains_history, pagespeed_mobile, pagespeed_failed_audits, company_context };
}

// ============================================================
// MOCK SOLUTIONS GENERATOR
// ============================================================
function generateMockSolutions(driverName: string, domain: string, score: number, issues: any[], numSolutions: number): any[] {
  const solutionTemplates: Record<string, any[]> = {
    compliance: [
      { title: 'Fix critical Site Audit issues', description: `Address the top critical and error-level issues identified in the site audit for ${domain}. Start by resolving broken links and crawl errors, then move to missing meta tags and duplicate content issues. Implement a regular audit schedule to catch new issues early.`, impact: 'high', effort_level: 'medium', estimated_improvement: 15, timeframe: 'short_term' },
      { title: 'Implement structured data markup', description: `Add Schema.org structured data to key pages on ${domain} including products, articles, FAQs, and organization info. This improves search engine understanding and can unlock rich results.`, impact: 'medium', effort_level: 'medium', estimated_improvement: 10, timeframe: 'medium_term' },
      { title: 'Resolve HTTP/HTTPS mixed content', description: `Audit all pages for mixed content warnings where HTTPS pages load HTTP resources. Update internal references and third-party scripts to use HTTPS.`, impact: 'high', effort_level: 'low', estimated_improvement: 8, timeframe: 'quick_win' },
    ],
    experience: [
      { title: 'Optimize Largest Contentful Paint', description: `Reduce LCP to under 2.5s on ${domain} by optimizing hero images with modern formats (WebP/AVIF), implementing lazy loading, and using a CDN for static assets. Preload critical resources.`, impact: 'high', effort_level: 'medium', estimated_improvement: 18, timeframe: 'short_term' },
      { title: 'Reduce Total Blocking Time', description: `Minimize TBT by code-splitting JavaScript bundles, deferring non-critical scripts, and using web workers for heavy computations. Target TBT under 200ms.`, impact: 'high', effort_level: 'high', estimated_improvement: 15, timeframe: 'medium_term' },
      { title: 'Minimize Cumulative Layout Shift', description: `Fix CLS issues by setting explicit dimensions on images and videos, reserving space for dynamic content, and avoiding inserting content above existing content.`, impact: 'medium', effort_level: 'low', estimated_improvement: 10, timeframe: 'quick_win' },
    ],
    discoverability: [
      { title: 'Recover lost keyword positions', description: `Analyze the keywords losing positions on ${domain} and create targeted content refresh strategies. Update page titles, meta descriptions, and body content to better match search intent.`, impact: 'high', effort_level: 'medium', estimated_improvement: 15, timeframe: 'short_term' },
      { title: 'Expand keyword portfolio', description: `Identify new keyword opportunities in adjacent topics and long-tail variations. Create comprehensive content hubs around core topics using pillar pages.`, impact: 'high', effort_level: 'high', estimated_improvement: 12, timeframe: 'medium_term' },
      { title: 'Improve internal linking structure', description: `Audit and optimize the internal linking architecture to distribute page authority more effectively. Link from high-authority pages to strategic targets.`, impact: 'medium', effort_level: 'low', estimated_improvement: 8, timeframe: 'quick_win' },
    ],
    content: [
      { title: 'Fix crawl errors and broken content', description: `Resolve all error-level issues on ${domain} including broken links, missing pages, and server errors. Implement proper 301 redirects for moved content.`, impact: 'high', effort_level: 'medium', estimated_improvement: 14, timeframe: 'short_term' },
      { title: 'Enhance content depth and quality', description: `Audit thin content pages and either expand them with substantive information or consolidate with related pages.`, impact: 'medium', effort_level: 'high', estimated_improvement: 10, timeframe: 'medium_term' },
      { title: 'Add missing meta tags and headings', description: `Complete all missing title tags, meta descriptions, and H1 headings across the site. Ensure each page has unique, descriptive metadata.`, impact: 'medium', effort_level: 'low', estimated_improvement: 7, timeframe: 'quick_win' },
    ],
    accessibility: [
      { title: 'Add missing alt attributes', description: `Audit all images on ${domain} and add descriptive alt text. Prioritize hero images, product images, and informational graphics.`, impact: 'high', effort_level: 'low', estimated_improvement: 12, timeframe: 'quick_win' },
      { title: 'Improve color contrast ratios', description: `Review all text-background color combinations for WCAG 2.1 AA compliance (4.5:1 for normal text, 3:1 for large text).`, impact: 'medium', effort_level: 'medium', estimated_improvement: 10, timeframe: 'short_term' },
      { title: 'Implement ARIA labels and roles', description: `Add proper ARIA landmarks, labels, and roles to interactive elements. Ensure form inputs have associated labels.`, impact: 'medium', effort_level: 'medium', estimated_improvement: 8, timeframe: 'short_term' },
    ],
    authority: [
      { title: 'Reclaim lost backlinks', description: `Identify broken backlinks pointing to ${domain} and implement 301 redirects to relevant live pages. Contact referring domains to update outdated links.`, impact: 'high', effort_level: 'medium', estimated_improvement: 12, timeframe: 'short_term' },
      { title: 'Build strategic link partnerships', description: `Develop relationships with authoritative domains through guest posting, expert roundups, and collaborative content. Focus on quality over quantity.`, impact: 'high', effort_level: 'high', estimated_improvement: 15, timeframe: 'long_term' },
      { title: 'Create linkable asset content', description: `Develop original research, data studies, or comprehensive guides that naturally attract backlinks. Promote through PR outreach.`, impact: 'medium', effort_level: 'high', estimated_improvement: 10, timeframe: 'medium_term' },
    ],
    ai_relevance: [
      { title: 'Optimize for AI Overview inclusion', description: `Structure content to be directly answerable by AI systems. Use clear question-answer formats and well-organized information. Add FAQ sections with concise answers.`, impact: 'high', effort_level: 'medium', estimated_improvement: 15, timeframe: 'medium_term' },
      { title: 'Target Featured Snippet positions', description: `Identify keywords where Featured Snippets appear and optimize content format. Use paragraph snippets (40-60 words), lists, and tables.`, impact: 'high', effort_level: 'medium', estimated_improvement: 12, timeframe: 'short_term' },
      { title: 'Expand People Also Ask coverage', description: `Research PAA questions in your niche and create comprehensive FAQ content addressing them. Use H2/H3 headers matching exact PAA questions.`, impact: 'medium', effort_level: 'low', estimated_improvement: 8, timeframe: 'quick_win' },
    ],
    awareness: [
      { title: 'Strengthen branded search presence', description: `Build brand awareness through consistent content marketing, social media engagement, and PR activities for ${domain}.`, impact: 'high', effort_level: 'high', estimated_improvement: 12, timeframe: 'long_term' },
      { title: 'Optimize for brand SERP features', description: `Claim and optimize all brand-related search features including Knowledge Panel, site links, and branded featured snippets.`, impact: 'medium', effort_level: 'medium', estimated_improvement: 10, timeframe: 'short_term' },
      { title: 'Reverse organic traffic decline', description: `Analyze traffic decline patterns and identify affected pages. Refresh outdated content, improve page speed, and strengthen internal linking.`, impact: 'high', effort_level: 'medium', estimated_improvement: 14, timeframe: 'short_term' },
    ],
    aso_visibility: [
      { title: 'Launch strategic paid search campaign', description: `Develop a targeted Google Ads strategy for ${domain} focusing on high-intent keywords. Start with branded terms for protection.`, impact: 'high', effort_level: 'high', estimated_improvement: 15, timeframe: 'short_term' },
      { title: 'Optimize paid-organic synergy', description: `Identify keywords where organic rankings are strong but CTR is low. Use paid ads to dominate SERPs for these terms.`, impact: 'medium', effort_level: 'medium', estimated_improvement: 10, timeframe: 'medium_term' },
      { title: 'Implement remarketing campaigns', description: `Set up remarketing audiences from organic visitors and create targeted campaigns to re-engage them.`, impact: 'medium', effort_level: 'medium', estimated_improvement: 8, timeframe: 'short_term' },
    ],
  };
  return (solutionTemplates[driverName] || solutionTemplates.compliance).slice(0, numSolutions);
}

// ============================================================
// MOCK PRIORITY MATRIX
// ============================================================
function generateMockPriorityMatrix(allSolutions: any[]): Record<string, any[]> {
  const opportunities: any[] = [];
  const issuesList: any[] = [];
  const improvements: any[] = [];
  const suggestions: any[] = [];

  for (const sol of allSolutions) {
    const impact = sol.impact || 'medium';
    const effort = sol.effort_level || 'medium';
    const tf = sol.timeframe || 'medium_term';
    if (impact === 'high' && (tf === 'quick_win' || tf === 'short_term')) {
      opportunities.push({ reference: sol.reference });
    } else if (impact === 'high' && effort === 'high') {
      improvements.push({ reference: sol.reference });
    } else if (impact === 'medium' || impact === 'high') {
      issuesList.push({ reference: sol.reference });
    } else {
      suggestions.push({ reference: sol.reference });
    }
  }
  if (opportunities.length === 0 && issuesList.length > 1) opportunities.push(issuesList.shift()!);
  if (improvements.length === 0 && issuesList.length > 1) improvements.push(issuesList.shift()!);
  if (suggestions.length === 0 && issuesList.length > 1) suggestions.push(issuesList.shift()!);
  return { opportunities, issues: issuesList, improvements, suggestions };
}

// ============================================================
// MOCK COMPETITOR ANALYSIS
// ============================================================
function analyzeCompetitorMock(competitorDomain: string, country: string): Record<string, number | null> {
  const mockData = generateRealisticMockData(competitorDomain, country);
  const driverInputs = {
    semrush_domain_rank: mockData.semrush_domain_overview,
    semrush_site_health: mockData.semrush_site_health,
    ahrefs_domain_rating: mockData.ahrefs_domain_rating,
    ahrefs_ai_relevance: mockData.ahrefs_ai_relevance,
    psi_mobile: mockData.pagespeed_mobile,
    trends_brand_awareness: mockData.semrush_brand_awareness,
  };
  const scores = calculateAllDrivers(driverInputs);
  const result: Record<string, number | null> = {};
  for (const [name, dr] of Object.entries(scores)) { result[name] = dr.score; }
  return result;
}

// ============================================================
// API CLIENT FUNCTIONS
// ============================================================
function extractBrand(domain: string): string { return domain.replace(/\.(com|org|net|io|co|it|de|fr|es|uk|us)$/i, '').replace(/\./g, ' '); }

function parseSemrushCsv(csv: string): Record<string, string>[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(';');
  return lines.slice(1).map(line => { const values = line.split(';'); const obj: Record<string, string> = {}; headers.forEach((h, i) => { obj[h.trim()] = (values[i] || '').trim(); }); return obj; });
}

async function fetchSemrushDomainRank(domain: string, country: string, apiKey: string) {
  if (!apiKey) return { data: null, _meta: { is_mock: true } };
  try {
    const res = await fetch(`https://api.semrush.com/?type=domain_rank&key=${apiKey}&export_columns=Rk,Or,Ot,Oc,Ad,At,Ac&domain=${domain}&database=${country}`);
    if (!res.ok) throw new Error(`${res.status}`);
    const rows = parseSemrushCsv(await res.text());
    if (rows.length === 0) return { data: null, _meta: { is_mock: true } };
    const r = rows[0];
    return { data: { rank: parseInt(r['Rank']||r['Rk']||'0'), organicKeywords: parseInt(r['Organic Keywords']||r['Or']||'0'), organicTraffic: parseInt(r['Organic Traffic']||r['Ot']||'0'), organicCost: parseFloat(r['Organic Cost']||r['Oc']||'0'), adwordsKeywords: parseInt(r['Adwords Keywords']||r['Ad']||'0'), adwordsTraffic: parseInt(r['Adwords Traffic']||r['At']||'0'), adwordsCost: parseFloat(r['Adwords Cost']||r['Ac']||'0') }, _meta: { is_mock: false } };
  } catch (e) { console.error('[semrush_domain_rank]', e); return { data: null, _meta: { is_mock: true } }; }
}

async function fetchSemrushSiteHealth(domain: string, apiKey: string) {
  if (!apiKey) return { data: { site_health_score: null, issues: [], pages_crawled: 0 }, _meta: { is_mock: true } };
  try {
    const listRes = await fetch(`https://api.semrush.com/management/v1/projects?key=${apiKey}`);
    if (!listRes.ok) throw new Error(`${listRes.status}`);
    const projects = await listRes.json();
    const project = projects.find((p: any) => p.project_url?.includes(domain));
    if (!project) return { data: { site_health_score: null, issues: [], pages_crawled: 0 }, _meta: { is_mock: true } };
    const auditRes = await fetch(`https://api.semrush.com/management/v1/projects/${project.project_id}/siteaudit/info?key=${apiKey}`);
    if (!auditRes.ok) throw new Error(`audit ${auditRes.status}`);
    const audit = await auditRes.json();
    const issuesRes = await fetch(`https://api.semrush.com/management/v1/projects/${project.project_id}/siteaudit/issues?key=${apiKey}&limit=50`);
    let siteIssues: any[] = [];
    if (issuesRes.ok) { const d = await issuesRes.json(); siteIssues = (d.issues || d || []).map((i: any) => ({ id: String(i.id||''), title: String(i.title||i.name||''), type: String(i.type||i.severity||'warning'), pages_count: Number(i.pages_count||i.count||0) })); }
    return { data: { site_health_score: audit.quality?.value ?? audit.site_health_score ?? null, issues: siteIssues, pages_crawled: audit.pages_crawled ?? audit.checked_pages ?? 0 }, _meta: { is_mock: false } };
  } catch (e) { console.error('[semrush_site_health]', e); return { data: { site_health_score: null, issues: [], pages_crawled: 0 }, _meta: { is_mock: true } }; }
}

async function fetchSemrushOrganicLosing(domain: string, country: string, apiKey: string) {
  if (!apiKey) return { data: [], _meta: { is_mock: true } };
  try {
    const res = await fetch(`https://api.semrush.com/?type=domain_organic&key=${apiKey}&export_columns=Ph,Po,Pp,Pd,Tr,Nq&domain=${domain}&database=${country}&display_sort=tr_desc&display_filter=%2B%7CPd%7CLt%7C0&display_limit=20`);
    if (!res.ok) throw new Error(`${res.status}`);
    const rows = parseSemrushCsv(await res.text());
    return { data: rows.map(r => ({ keyword: r['Keyword']||r['Ph']||'', position: parseInt(r['Position']||r['Po']||'0'), previousPosition: parseInt(r['Previous Position']||r['Pp']||'0'), positionDifference: parseInt(r['Position Difference']||r['Pd']||'0'), traffic: parseFloat(r['Traffic (%)']||r['Tr']||'0'), searchVolume: parseInt(r['Search Volume']||r['Nq']||'0') })), _meta: { is_mock: false } };
  } catch (e) { return { data: [], _meta: { is_mock: true } }; }
}

async function fetchSemrushBrandedKeywords(domain: string, brand: string, country: string, apiKey: string) {
  if (!apiKey) return { data: { count: 0, totalBrandedTraffic: 0 }, _meta: { is_mock: true } };
  try {
    const res = await fetch(`https://api.semrush.com/?type=domain_organic&key=${apiKey}&export_columns=Ph,Tr&domain=${domain}&database=${country}&display_filter=%2B%7CPh%7CCo%7C${encodeURIComponent(brand)}&display_limit=100`);
    if (!res.ok) throw new Error(`${res.status}`);
    const rows = parseSemrushCsv(await res.text());
    return { data: { count: rows.length, totalBrandedTraffic: rows.reduce((s, r) => s + parseFloat(r['Traffic (%)']||r['Tr']||'0'), 0) }, _meta: { is_mock: false } };
  } catch (e) { return { data: { count: 0, totalBrandedTraffic: 0 }, _meta: { is_mock: true } }; }
}

async function fetchSemrushBrandAwareness(domain: string, country: string, apiKey: string) {
  if (!apiKey) return { data: [], _meta: { is_mock: true } };
  try {
    const res = await fetch(`https://api.semrush.com/?type=domain_rank_history&key=${apiKey}&export_columns=Dt,Rk,Or,Ot&domain=${domain}&database=${country}&display_limit=12`);
    if (!res.ok) throw new Error(`${res.status}`);
    const rows = parseSemrushCsv(await res.text());
    return { data: rows.map(r => ({ date: r['Date']||r['Dt']||'', rank: parseInt(r['Rank']||r['Rk']||'0'), organicKeywords: parseInt(r['Organic Keywords']||r['Or']||'0'), organicTraffic: parseInt(r['Organic Traffic']||r['Ot']||'0') })), _meta: { is_mock: false } };
  } catch (e) { return { data: [], _meta: { is_mock: true } }; }
}

async function fetchAhrefsDomainRating(domain: string, apiKey: string) {
  if (!apiKey) return { data: { domain_rating: 50, ahrefs_rank: 0 }, _meta: { is_mock: true } };
  try {
    const today = new Date().toISOString().split('T')[0];
    const res = await fetch(`https://api.ahrefs.com/v3/site-explorer/domain-rating?target=${encodeURIComponent(domain)}&date=${today}&output=json`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status}`);
    const d = await res.json();
    const dr = d.domain_rating && typeof d.domain_rating === 'object' ? d.domain_rating : d;
    return { data: { domain_rating: Math.round(dr.domain_rating ?? 0), ahrefs_rank: dr.ahrefs_rank ?? 0 }, _meta: { is_mock: false } };
  } catch (e) { return { data: { domain_rating: 50, ahrefs_rank: 0 }, _meta: { is_mock: true } }; }
}

async function fetchAhrefsAiRelevance(domain: string, country: string, apiKey: string) {
  if (!apiKey) return { data: { ai_relevance_score: 0, ai_overview_keywords: 0, featured_snippet_keywords: 0, people_also_ask_keywords: 0, total_keywords: 0 }, _meta: { is_mock: true } };
  try {
    const today = new Date().toISOString().split('T')[0];
    const res = await fetch(`https://api.ahrefs.com/v3/site-explorer/organic-keywords?target=${encodeURIComponent(domain)}&country=${country}&select=keyword,volume,serp_features&limit=1000&date=${today}&output=json`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status}`);
    const d = await res.json(); const keywords = d.keywords || d.organic_keywords || []; const total = keywords.length;
    let ai = 0, fs = 0, paa = 0;
    for (const kw of keywords) { const features = Array.isArray(kw.serp_features) ? kw.serp_features : []; for (const f of features) { const n = (typeof f === 'string' ? f : String(f?.name||f?.type||'')).toLowerCase(); if (n.includes('ai_overview')||n.includes('sgr')) { ai++; break; } } for (const f of features) { const n = (typeof f === 'string' ? f : String(f?.name||f?.type||'')).toLowerCase(); if (n.includes('featured_snippet')) { fs++; break; } } for (const f of features) { const n = (typeof f === 'string' ? f : String(f?.name||f?.type||'')).toLowerCase(); if (n.includes('people_also_ask')) { paa++; break; } } }
    const score = total > 0 ? Math.round(((ai + fs) / total) * 100) : 0;
    return { data: { ai_relevance_score: score, ai_overview_keywords: ai, featured_snippet_keywords: fs, people_also_ask_keywords: paa, total_keywords: total }, _meta: { is_mock: false } };
  } catch (e) { return { data: { ai_relevance_score: 0, ai_overview_keywords: 0, featured_snippet_keywords: 0, people_also_ask_keywords: 0, total_keywords: 0 }, _meta: { is_mock: true } }; }
}

async function fetchAhrefsBrokenBacklinks(domain: string, apiKey: string) {
  if (!apiKey) return { data: [], _meta: { is_mock: true } };
  try {
    const today = new Date().toISOString().split('T')[0];
    const res = await fetch(`https://api.ahrefs.com/v3/site-explorer/broken-backlinks?target=${encodeURIComponent(domain)}&select=url_from,url_to,domain_rating_source,http_code&limit=10&order_by=domain_rating_source:desc&date=${today}&output=json`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status}`);
    const d = await res.json();
    return { data: (d.backlinks||d.broken_backlinks||[]).map((b: any) => ({ url_from: b.url_from||'', url_to: b.url_to||'', domain_rating_source: Number(b.domain_rating_source||0), http_code: Number(b.http_code||0) })), _meta: { is_mock: false } };
  } catch (e) { return { data: [], _meta: { is_mock: true } }; }
}

async function fetchAhrefsRefdomainsHistory(domain: string, apiKey: string) {
  if (!apiKey) return { data: [], _meta: { is_mock: true } };
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const dateFrom = sixMonthsAgo.toISOString().split('T')[0];
    const res = await fetch(`https://api.ahrefs.com/v3/site-explorer/refdomains-history?target=${encodeURIComponent(domain)}&date_from=${dateFrom}&output=json`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status}`);
    const d = await res.json();
    return { data: (d.refdomains||d.history||[]).map((h: any) => ({ date: h.date||'', refdomains: Number(h.refdomains||h.value||0) })), _meta: { is_mock: false } };
  } catch (e) { return { data: [], _meta: { is_mock: true } }; }
}

async function fetchPageSpeed(domain: string, apiKey: string) {
  if (!apiKey) return { data: { performance_score: 0, accessibility_score: 0, seo_score: 0, best_practices_score: 0 }, _meta: { is_mock: true } };
  try {
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://${domain}&key=${apiKey}&strategy=mobile&category=performance&category=accessibility&category=seo&category=best-practices`);
    if (!res.ok) throw new Error(`${res.status}`);
    const d = await res.json(); const cats = d.lighthouseResult?.categories || {};
    return { data: { performance_score: Math.round((cats.performance?.score??0)*100), accessibility_score: Math.round((cats.accessibility?.score??0)*100), seo_score: Math.round((cats.seo?.score??0)*100), best_practices_score: Math.round((cats['best-practices']?.score??0)*100) }, _meta: { is_mock: false } };
  } catch (e) { return { data: { performance_score: 0, accessibility_score: 0, seo_score: 0, best_practices_score: 0 }, _meta: { is_mock: true } }; }
}

async function fetchPageSpeedFailedAudits(domain: string, apiKey: string) {
  if (!apiKey) return { data: [], _meta: { is_mock: true } };
  try {
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://${domain}&key=${apiKey}&strategy=mobile&category=performance&category=accessibility&category=seo&category=best-practices`);
    if (!res.ok) throw new Error(`${res.status}`);
    const d = await res.json(); const audits = d.lighthouseResult?.audits || {};
    const failed: any[] = [];
    for (const [id, audit] of Object.entries(audits)) { const a = audit as any; if (a.score !== null && a.score < 1 && a.title) { failed.push({ id, title: a.title, description: a.description||'', score: a.score, displayValue: a.displayValue }); } }
    failed.sort((a, b) => a.score - b.score);
    return { data: failed, _meta: { is_mock: false } };
  } catch (e) { return { data: [], _meta: { is_mock: true } }; }
}

async function fetchCompanyContext(domain: string, competitors: string[], targetTopic: string, dbKeysMap: Record<string, string>, pplxKey: string, anthropicKey: string) {
  const OPENAI_KEY = dbKeysMap['OPENAI_API_KEY'] || process.env.OPENAI_API_KEY || process.env.OPEN_AI_API_KEY || '';
  const prompt = `As a market analyst, research "${domain}".${competitors.length > 0 ? ` Competitors: ${competitors.join(', ')}.` : ''}${targetTopic ? ` Topic: "${targetTopic}".` : ''}\nGenerate JSON: { company_profile: string, market_scenario: string, business_challenges: string, last_news: [{title, link, source, snippet}] }`;

  if (OPENAI_KEY) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: 'gpt-4o', temperature: 0.3, messages: [{ role: 'system', content: 'You are a market analyst. Output only valid JSON.' }, { role: 'user', content: prompt }], response_format: { type: 'json_object' } }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}`);
      const d = await res.json();
      const parsed = JSON.parse(d.choices?.[0]?.message?.content || '{}');
      if (parsed.company_profile) return { data: parsed, _meta: { is_mock: false } };
    } catch (e) { console.warn('[company_context] OpenAI failed:', e); }
  }

  if (pplxKey) {
    try {
      const res = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pplxKey}` },
        body: JSON.stringify({ model: 'sonar-pro', temperature: 0.3, messages: [{ role: 'system', content: 'You are a market analyst. Output only valid JSON.' }, { role: 'user', content: prompt }] }),
      });
      if (!res.ok) throw new Error(`Perplexity ${res.status}`);
      const d = await res.json();
      let content = d.choices?.[0]?.message?.content || '{}';
      content = content.trim();
      if (content.startsWith('```')) content = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      const parsed = JSON.parse(content);
      if (parsed.company_profile) return { data: parsed, _meta: { is_mock: false } };
    } catch (e) { console.warn('[company_context] Perplexity failed:', e); }
  }

  if (anthropicKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: `You are a market analyst. Output only valid JSON.\n\n${prompt}` }] }),
      });
      if (!res.ok) throw new Error(`Anthropic ${res.status}`);
      const d = await res.json();
      let content = d.content?.[0]?.text || '{}';
      content = content.trim();
      if (content.startsWith('```')) content = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      const parsed = JSON.parse(content);
      if (parsed.company_profile) return { data: parsed, _meta: { is_mock: false } };
    } catch (e) { console.warn('[company_context] Anthropic failed:', e); }
  }

  return { data: null, _meta: { is_mock: true } };
}

// --- Driver Scoring ---
function clampScore(value: unknown, fallback: number | null = null): number | null {
  if (value === null || value === undefined) return fallback;
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num)) return fallback;
  return Math.round(Math.max(0, Math.min(100, num)));
}
interface DriverResult { score: number | null; status: 'ok' | 'no_results' | 'failed'; details?: Record<string, unknown>; }

function calculateAllDrivers(apiData: Record<string, any>): Record<string, DriverResult> {
  return {
    compliance: calcCompliance(apiData.semrush_site_health, apiData.psi_mobile),
    experience: calcExperience(apiData.psi_mobile),
    discoverability: calcDiscoverability(apiData.semrush_domain_rank),
    content: calcContent(apiData.semrush_site_health, apiData.psi_mobile, apiData.semrush_domain_rank),
    accessibility: calcAccessibility(apiData.psi_mobile),
    authority: calcAuthority(apiData.ahrefs_domain_rating),
    aso_visibility: calcAso(apiData.semrush_domain_rank),
    ai_relevance: calcAiRelevance(apiData.ahrefs_ai_relevance),
    awareness: calcAwareness(apiData.trends_brand_awareness),
  };
}
function calcCompliance(siteHealth: any, psiData: any): DriverResult {
  if (psiData && psiData.seo_score > 0) {
    const s = clampScore(psiData.seo_score);
    if (s !== null) return { score: s, status: 'ok', details: { source: 'pagespeed_seo', seo_score: psiData.seo_score } };
  }
  if (siteHealth) {
    const s = clampScore(siteHealth.site_health_score);
    if (s !== null) return { score: s, status: 'ok', details: { source: 'semrush_site_health' } };
  }
  return { score: null, status: 'no_results' };
}
function calcExperience(data: any): DriverResult { if (!data) return { score: null, status: 'failed' }; let s = data.performance_score; if (typeof s === 'number' && s > 0 && s <= 1) s = s * 100; const score = clampScore(s); return score !== null ? { score, status: 'ok' } : { score: null, status: 'no_results' }; }
function calcDiscoverability(data: any): DriverResult {
  if (!data) return { score: null, status: 'failed' };
  const rank = Number(data.rank||data.Rk||0); const traffic = Number(data.organicTraffic||data.Ot||0); const keywords = Number(data.organicKeywords||data.Or||0);
  if (rank > 0) { const s = clampScore(100 - Math.min(90, Math.log10(rank) * 20)); return s !== null ? { score: s, status: 'ok', details: { method: 'rank', rank } } : { score: null, status: 'no_results' }; }
  const parts: number[] = []; if (traffic > 0) parts.push((Math.log10(traffic)/8)*100); if (keywords > 0) parts.push((Math.log10(keywords)/7)*100);
  if (parts.length === 0) return { score: null, status: 'no_results' };
  const s = clampScore(parts.reduce((a,b)=>a+b,0)/parts.length); return s !== null ? { score: s, status: 'ok', details: { method: 'fallback' } } : { score: null, status: 'no_results' };
}
function calcContent(siteHealth: any, psiData: any, semrushData: any): DriverResult {
  const signals: number[] = [];
  const details: Record<string, unknown> = {};
  if (psiData && psiData.best_practices_score > 0) {
    signals.push(psiData.best_practices_score);
    details.best_practices_score = psiData.best_practices_score;
  }
  if (siteHealth) {
    const iss = siteHealth.issues || []; const pc = Number(siteHealth.pages_crawled||0);
    if (pc > 0) {
      const errorPages = iss.filter((i: any) => i.type==='error'||i.type==='critical').reduce((s: number, i: any) => s + Number(i.pages_count||0), 0);
      const ratio = errorPages / pc; const errorScore = Math.max(1, 100 * Math.exp(-ratio * 1.0));
      signals.push(errorScore);
      details.errorPages = errorPages; details.pagesCrawled = pc; details.errorRatio = ratio;
    }
  }
  if (semrushData) {
    const kw = Number(semrushData.organicKeywords||semrushData.Or||0);
    if (kw > 0) {
      const kwScore = Math.min(100, Math.log10(kw) * 20);
      signals.push(kwScore);
      details.organicKeywords = kw; details.keywordsScore = Math.round(kwScore);
    }
  }
  if (signals.length === 0) return { score: null, status: 'no_results' };
  const avg = signals.reduce((a, b) => a + b, 0) / signals.length;
  const s = clampScore(avg);
  details.source = 'combined'; details.signalCount = signals.length;
  return s !== null ? { score: s, status: 'ok', details } : { score: null, status: 'no_results' };
}
function calcAccessibility(data: any): DriverResult { if (!data) return { score: null, status: 'failed' }; let s = data.accessibility_score; if (typeof s === 'number' && s > 0 && s <= 1) s = s * 100; const score = clampScore(s); return score !== null ? { score, status: 'ok' } : { score: null, status: 'no_results' }; }
function calcAuthority(data: any): DriverResult { if (!data) return { score: null, status: 'failed' }; const s = clampScore(data.domain_rating); return s !== null ? { score: s, status: 'ok' } : { score: null, status: 'no_results' }; }
function calcAso(data: any): DriverResult {
  if (!data) return { score: null, status: 'failed' };
  const adKw = Number(data.adwordsKeywords||data.Ad||0); const adTr = Number(data.adwordsTraffic||data.At||0); const rank = Number(data.rank||data.Rk||0);
  if (adKw > 0 || adTr > 0) { const parts: number[] = []; if (adKw > 0) parts.push((Math.log10(adKw)/5)*100); if (adTr > 0) parts.push((Math.log10(adTr)/7)*100); const s = clampScore(parts.reduce((a,b)=>a+b,0)/parts.length); return s !== null ? { score: s, status: 'ok' } : { score: null, status: 'no_results' }; }
  if (rank > 0) { const s = clampScore((100 - Math.min(90, Math.log10(rank) * 20)) * 0.6); return s !== null ? { score: s, status: 'ok', details: { method: 'rank_fallback' } } : { score: null, status: 'no_results' }; }
  return { score: null, status: 'no_results' };
}
function calcAiRelevance(data: any): DriverResult { if (!data) return { score: null, status: 'failed' }; const s = clampScore(data.ai_relevance_score); return s !== null ? { score: s, status: 'ok', details: { ai_overview: data.ai_overview_keywords, featured_snippet: data.featured_snippet_keywords, paa: data.people_also_ask_keywords, total: data.total_keywords } } : { score: null, status: 'no_results' }; }
function calcAwareness(data: any): DriverResult {
  if (!data || (Array.isArray(data) && data.length === 0)) return { score: null, status: 'no_results' };
  const items = Array.isArray(data) ? data : [data]; const latest = items[items.length - 1];
  const latestRank = Number(latest?.rank||0);
  if (latestRank > 0) { const s = clampScore(100 - Math.min(90, Math.log10(latestRank) * 20)); return s !== null ? { score: s, status: 'ok' } : { score: null, status: 'no_results' }; }
  const traffic = Number(latest?.organicTraffic||latest?.average||latest?.latest||0);
  if (traffic > 0) { const s = clampScore(Math.min(100, Math.log10(traffic) * 10)); return s !== null ? { score: s, status: 'ok' } : { score: null, status: 'no_results' }; }
  return { score: 0, status: 'no_results' };
}

function generateAllDriverIssues(apiDataMap: Record<string, any>): Record<string, any[]> {
  const MAX = 3; const result: Record<string, any[]> = {};
  const sh = apiDataMap.semrush_site_health;
  const psi = apiDataMap.pagespeed_mobile;
  const fa = apiDataMap.pagespeed_failed_audits || [];
  const compIssues: any[] = [];
  const seoAudits = fa.filter((a: any) => { const id = String(a.id||''); return id.includes('meta')||id.includes('robots')||id.includes('canonical')||id.includes('hreflang')||id.includes('crawl')||id.includes('http-status')||id.includes('structured')||id.includes('document-title')||id.includes('viewport')||id.includes('font-size')||id.includes('tap-targets')||id.includes('link-text')||id.includes('is-crawlable'); });
  for (const a of seoAudits.slice(0, MAX)) { compIssues.push({ title: a.title||'SEO Issue', description: a.displayValue || a.description?.substring(0,100) || '', severity: (a.score||0)<0.5?'high':'medium', source: 'Lighthouse SEO' }); }
  if (compIssues.length < MAX && sh?.issues) {
    const sorted = [...sh.issues].sort((a: any, b: any) => { const order: Record<string, number> = { error: 0, critical: 0, warning: 1, notice: 2 }; return (order[a.type]??2) - (order[b.type]??2) || (Number(b.pages_count||0) - Number(a.pages_count||0)); });
    for (const i of sorted.slice(0, MAX - compIssues.length)) { compIssues.push({ title: i.title||'Site Issue', description: `Affects ${i.pages_count||0} pages`, severity: i.type==='error'?'high':i.type==='warning'?'medium':'low', source: 'SEMrush' }); }
  }
  if (psi && psi.seo_score > 0 && psi.seo_score < 80 && compIssues.length < MAX) { compIssues.push({ title: 'Low Lighthouse SEO Score', description: `Score: ${psi.seo_score}/100`, severity: psi.seo_score < 50 ? 'high':'medium', source: 'PageSpeed' }); }
  result.compliance = compIssues.slice(0, MAX);
  result.experience = fa.slice(0, MAX).map((a: any) => ({ title: a.title||'Performance Issue', description: a.displayValue||`Score: ${Math.round((a.score||0)*100)}/100`, severity: (a.score||0)<0.5?'high':'medium', source: 'PageSpeed' }));
  const losing = apiDataMap.semrush_organic_losing || [];
  const sortedLosing = [...losing].sort((a: any, b: any) => Math.abs(Number(b.positionDifference||0))*Number(b.traffic||0) - Math.abs(Number(a.positionDifference||0))*Number(a.traffic||0));
  result.discoverability = sortedLosing.slice(0, MAX).map((kw: any) => { const drop = Math.abs(Number(kw.positionDifference||0)); return { title: `"${kw.keyword}" dropped ${drop} positions`, description: `Now at #${kw.position}`, severity: drop > 10 ? 'high':'medium', source: 'SEMrush' }; });
  const contentIssues: any[] = [];
  const bpAudits = fa.filter((a: any) => { const id = String(a.id||''); return id.includes('image')||id.includes('js-libraries')||id.includes('deprecat')||id.includes('errors-in-console')||id.includes('inspector')||id.includes('doctype')||id.includes('charset')||id.includes('csp')||id.includes('paste-preventing')||id.includes('notification'); });
  for (const a of bpAudits.slice(0, MAX)) { contentIssues.push({ title: a.title||'Best Practice Issue', description: a.displayValue || a.description?.substring(0,100) || '', severity: (a.score||0)<0.5?'high':'medium', source: 'Lighthouse' }); }
  if (contentIssues.length < MAX && sh?.issues && sh.pages_crawled > 0) { const errors = sh.issues.filter((i: any) => i.type==='error'||i.type==='critical').sort((a: any, b: any) => Number(b.pages_count||0)-Number(a.pages_count||0)); for (const i of errors.slice(0, MAX - contentIssues.length)) { contentIssues.push({ title: i.title||'Content Error', description: `Affects ${i.pages_count||0} pages`, severity: Number(i.pages_count||0) > sh.pages_crawled * 0.1 ? 'high':'medium', source: 'SEMrush' }); } }
  if (psi && psi.best_practices_score > 0 && psi.best_practices_score < 80 && contentIssues.length < MAX) { contentIssues.push({ title: 'Low Best Practices Score', description: `Score: ${psi.best_practices_score}/100`, severity: psi.best_practices_score < 50 ? 'high':'medium', source: 'PageSpeed' }); }
  result.content = contentIssues;
  result.accessibility = fa.filter((a: any) => { const id = String(a.id||''); return id.includes('aria')||id.includes('color')||id.includes('alt')||id.includes('label')||id.includes('heading'); }).slice(0, MAX).map((a: any) => ({ title: a.title, description: a.description||'', severity: (a.score||0)<0.5?'high':'medium', source: 'Lighthouse' }));
  const broken = apiDataMap.ahrefs_broken_backlinks || [];
  result.authority = broken.sort((a: any, b: any) => Number(b.domain_rating_source||0)-Number(a.domain_rating_source||0)).slice(0, 2).map((bl: any) => ({ title: `Lost backlink from DR${bl.domain_rating_source} domain`, description: `${bl.url_from} -> ${bl.url_to}`, severity: bl.domain_rating_source > 50 ? 'high':'medium', source: 'Ahrefs' }));
  const aiData = apiDataMap.ahrefs_ai_relevance; const aiIssues: any[] = [];
  if (aiData) { if (aiData.ai_overview_keywords === 0 && aiData.total_keywords > 0) { aiIssues.push({ title: 'Zero AI Overview Presence', description: `None of ${aiData.total_keywords} keywords trigger AI Overviews`, severity: 'high', source: 'Ahrefs' }); } if (aiData.total_keywords > 0 && aiData.featured_snippet_keywords / aiData.total_keywords < 0.1) { aiIssues.push({ title: 'Low Featured Snippet Presence', description: `Only ${aiData.featured_snippet_keywords}/${aiData.total_keywords} keywords`, severity: 'high', source: 'Ahrefs' }); } }
  result['ai_relevance'] = aiIssues.slice(0, MAX);
  const awareness: any[] = []; const branded = apiDataMap.semrush_branded_keywords;
  if (branded && Number(branded.count||0) < 10) { awareness.push({ title: 'Low Branded Keyword Coverage', description: `Only ${branded.count} branded keywords`, severity: Number(branded.count) < 5 ? 'high':'medium', source: 'SEMrush' }); }
  result.awareness = awareness.slice(0, MAX);
  const ov = apiDataMap.semrush_domain_overview; const asoIssues: any[] = [];
  if (ov && Number(ov.adwordsKeywords||0) === 0 && Number(ov.organicKeywords||0) > 0) { asoIssues.push({ title: 'No Paid Search Presence', description: `${ov.organicKeywords} organic keywords but 0 paid`, severity: 'high', source: 'SEMrush' }); }
  result.aso_visibility = asoIssues;
  return result;
}

async function callLLM(prompt: string, jsonSchema: boolean, openaiKey: string, pplxKey: string, anthropicKey: string = ''): Promise<string> {
  if (openaiKey) {
    try {
      const body: any = { model: 'gpt-4o', temperature: 0.2, top_p: 0.9, stream: false, messages: [{ role: 'system', content: 'You are an SEO expert. Output only valid JSON.' }, { role: 'user', content: prompt }] };
      if (jsonSchema) body.response_format = { type: 'json_object' };
      const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`OpenAI ${res.status}`);
      const d = await res.json(); return d.choices?.[0]?.message?.content || '{}';
    } catch (e) { console.warn('[LLM] OpenAI failed:', e); }
  }
  if (pplxKey) {
    try {
      const res = await fetch('https://api.perplexity.ai/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pplxKey}` }, body: JSON.stringify({ model: 'sonar-pro', temperature: 0.2, top_p: 0.9, stream: false, messages: [{ role: 'system', content: 'You are an SEO expert. Output only valid JSON.' }, { role: 'user', content: prompt }] }) });
      if (!res.ok) throw new Error(`Perplexity ${res.status}`);
      const d = await res.json(); return d.choices?.[0]?.message?.content || '{}';
    } catch (e) { console.warn('[LLM] Perplexity failed:', e); }
  }
  if (anthropicKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2000, messages: [{ role: 'user', content: `You are an SEO expert. Output only valid JSON.\n\n${prompt}` }] }),
      });
      if (!res.ok) throw new Error(`Anthropic ${res.status}`);
      const d = await res.json();
      return d.content?.[0]?.text || '{}';
    } catch (e) { console.warn('[LLM] Anthropic failed:', e); }
  }
  throw new Error('No LLM key');
}

async function generateDriverSolutions(driverName: string, domain: string, score: number, issues: any[], numSolutions: number, openaiKey: string, pplxKey: string, anthropicKey: string = '') {
  const issuesList = issues.map((i: any, idx: number) => `${idx+1}. [${(i.severity||'medium').toUpperCase()}] ${i.title}: ${i.description}`).join('\n');
  const prompt = `You are an SEO expert analyzing "${driverName}" for "${domain}". Score: ${score}/100.\n\nIssues:\n${issuesList}\n\nGenerate exactly ${numSolutions} solutions as JSON: { "solutions": [{ "title": string (max 50 chars), "description": string (100-200 words), "impact": "high"|"medium"|"low", "effort_level": "high"|"medium"|"low", "estimated_improvement": number 1-20, "timeframe": "quick_win"|"short_term"|"medium_term"|"long_term" }] }`;
  const content = await callLLM(prompt, true, openaiKey, pplxKey, anthropicKey);
  let cleaned = content.trim(); if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(cleaned).solutions || [];
}

async function generatePriorityMatrix(solutions: any[], openaiKey: string, pplxKey: string, anthropicKey: string = '') {
  const prompt = `Classify these ${solutions.length} solutions into 4 quadrants. Keep "reference" field.\n\nSOLUTIONS: ${JSON.stringify(solutions)}\n\n1. OPPORTUNITIES (high priority + high impact)\n2. ISSUES (high priority + lower impact)\n3. IMPROVEMENTS (medium priority + high impact)\n4. SUGGESTIONS (low priority)\n\nJSON: { "opportunities": [{"reference": "..."}], "issues": [...], "improvements": [...], "suggestions": [...] }`;
  const content = await callLLM(prompt, true, openaiKey, pplxKey, anthropicKey);
  let cleaned = content.trim(); if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(cleaned);
}

async function analyzeCompetitor(domain: string, country: string, semrushKey: string, ahrefsKey: string, psiKey: string): Promise<Record<string, number | null>> {
  const [domainRank, siteHealth, domainRating, aiRelevance, psi] = await Promise.allSettled([
    fetchSemrushDomainRank(domain, country, semrushKey), fetchSemrushSiteHealth(domain, semrushKey),
    fetchAhrefsDomainRating(domain, ahrefsKey), fetchAhrefsAiRelevance(domain, country, ahrefsKey),
    fetchPageSpeed(domain, psiKey),
  ]);
  const apiData: Record<string, any> = {
    semrush_domain_rank: domainRank.status==='fulfilled'?domainRank.value?.data:null,
    semrush_site_health: siteHealth.status==='fulfilled'?siteHealth.value?.data:null,
    ahrefs_domain_rating: domainRating.status==='fulfilled'?domainRating.value?.data:null,
    ahrefs_ai_relevance: aiRelevance.status==='fulfilled'?aiRelevance.value?.data:null,
    psi_mobile: psi.status==='fulfilled'?psi.value?.data:null,
    trends_brand_awareness: null,
  };
  const scores = calculateAllDrivers(apiData);
  const result: Record<string, number | null> = {};
  for (const [name, dr] of Object.entries(scores)) { result[name] = dr.score; }
  return result;
}
