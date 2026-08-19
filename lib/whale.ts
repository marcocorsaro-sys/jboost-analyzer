"use client";
// Whale Curve economica — §6-14 spec Dimitar:
// ranking per MARGINE prodotto negli ultimi 12 mesi mobili (mai lifetime, mai fatturato).
// Costo prestazione = minuti utilizzati × CAM · Margine = valore − costo.
import { supabase } from "./supabase";

export type ClientEcon = {
  client_id: string;
  revenue: number;    // fatturato 12m (lavorato, ricariche escluse)
  minutes: number;    // minuti produttivi assorbiti 12m
  cost: number;       // minuti × CAM
  margin: number;     // revenue − cost
  visits: number;     // giornate distinte con transazioni
  firstTx: string | null;
  lastTx: string | null;
};

export type WhaleData = {
  ranked: ClientEcon[];              // ORDER BY margin DESC
  byId: Record<string, ClientEcon & { rank: number }>;
  totals: { revenue: number; cost: number; margin: number; active: number };
  fallbackMin: number;               // durata usata quando la transazione non ha un servizio a listino
  since: string;
};

export function whaleZone(rank: number, total: number, margin: number): { label: string; color: string } {
  if (margin <= 0) return { label: "margine zero/negativo", color: "#b3402a" };
  const f = rank / Math.max(1, total);
  if (f <= 0.2) return { label: "alto contributo", color: "#1e7a4f" };
  if (f <= 0.6) return { label: "zona intermedia", color: "#b8860b" };
  return { label: "basso contributo", color: "#c46a1f" };
}

export async function fetchWhale12m(orgId: string, cam: number): Promise<WhaleData> {
  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);
  const sinceISO = since.toISOString().slice(0, 10);

  const { data: cat } = await supabase.from("catalog_items")
    .select("id,kind,duration_min").eq("organization_id", orgId);
  const durById: Record<string, number> = {};
  const serviceDurs: number[] = [];
  for (const c of (cat ?? []) as any[]) {
    if (c.kind === "service" && Number(c.duration_min) > 0) {
      durById[c.id] = Number(c.duration_min);
      serviceDurs.push(Number(c.duration_min));
    }
  }
  serviceDurs.sort((a, b) => a - b);
  const fallbackMin = serviceDurs.length ? serviceDurs[Math.floor(serviceDurs.length / 2)] : 30;

  // paginato: fino a 20k transazioni degli ultimi 12 mesi
  const rows: any[] = [];
  for (let page = 0; page < 20; page++) {
    const { data } = await supabase.from("transactions")
      .select("client_id,worked_value,kind,catalog_item_id,tx_date")
      .eq("organization_id", orgId).eq("status", "completed")
      .neq("kind", "recharge").not("client_id", "is", null)
      .gte("tx_date", sinceISO)
      .order("tx_date").range(page * 1000, page * 1000 + 999);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const acc: Record<string, ClientEcon & { days: Set<string> }> = {};
  for (const t of rows) {
    const id = t.client_id as string;
    acc[id] = acc[id] ?? { client_id: id, revenue: 0, minutes: 0, cost: 0, margin: 0, visits: 0, firstTx: null, lastTx: null, days: new Set() };
    const a = acc[id];
    a.revenue += Number(t.worked_value) || 0;
    // i prodotti non assorbono minuti produttivi; i servizi sì (durata a listino o mediana)
    if (t.kind !== "product") a.minutes += t.catalog_item_id && durById[t.catalog_item_id] ? durById[t.catalog_item_id] : fallbackMin;
    a.days.add(t.tx_date);
    if (!a.firstTx || t.tx_date < a.firstTx) a.firstTx = t.tx_date;
    if (!a.lastTx || t.tx_date > a.lastTx) a.lastTx = t.tx_date;
  }

  const ranked: ClientEcon[] = Object.values(acc).map(a => {
    const cost = a.minutes * cam;
    return { client_id: a.client_id, revenue: a.revenue, minutes: a.minutes, cost, margin: a.revenue - cost, visits: a.days.size, firstTx: a.firstTx, lastTx: a.lastTx };
  }).sort((x, y) => y.margin - x.margin);

  const byId: WhaleData["byId"] = {};
  ranked.forEach((c, i) => { byId[c.client_id] = { ...c, rank: i + 1 }; });

  return {
    ranked, byId,
    totals: {
      revenue: ranked.reduce((x, c) => x + c.revenue, 0),
      cost: ranked.reduce((x, c) => x + c.cost, 0),
      margin: ranked.reduce((x, c) => x + c.margin, 0),
      active: ranked.length,
    },
    fallbackMin, since: sinceISO,
  };
}
