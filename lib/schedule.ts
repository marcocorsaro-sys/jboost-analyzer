"use client";
// MOTORE ORARI E CAPACITÀ PRODUTTIVA (spec Dimitar)
// - orario salone ≠ disponibilità operatore (le fasce operatore valgono solo dentro l'apertura)
// - priorità: eccezione giornata → periodo temporaneo → orario standard
// - giornate concluse: fotografia storica in day_capacity_snapshots, mai ricalcolate
import { supabase } from "./supabase";

export type Band = { start: string; end: string };            // "08:30"
export type Rule = {
  id: string; scope: "salon" | "staff"; staff_id: string | null;
  kind: "standard" | "period" | "exception";
  dow: number | null; date: string | null; date_from: string | null; date_to: string | null;
  bands: Band[]; label: string | null;
};
export type Snapshot = { day: string; staff_id: string; available_minutes: number };

const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return (h || 0) * 60 + (m || 0); };

export const bandsMinutes = (bands: Band[]) =>
  bands.reduce((a, b) => a + Math.max(0, toMin(b.end) - toMin(b.start)), 0);

// minuti già trascorsi DENTRO le fasce a un certo orario del giorno
export const bandsElapsed = (bands: Band[], nowMin: number) =>
  bands.reduce((a, b) => a + Math.max(0, Math.min(nowMin, toMin(b.end)) - toMin(b.start)), 0);

export function intersectBands(a: Band[], b: Band[]): Band[] {
  const out: Band[] = [];
  for (const x of a) for (const y of b) {
    const s = Math.max(toMin(x.start), toMin(y.start));
    const e = Math.min(toMin(x.end), toMin(y.end));
    if (e > s) out.push({ start: fmt(s), end: fmt(e) });
  }
  return out.sort((p, q) => toMin(p.start) - toMin(q.start));
}
const fmt = (m: number) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");

// Risolve le fasce per una data: eccezione → periodo → standard. null = nessuna regola per questo scope.
function resolve(rules: Rule[], scope: "salon" | "staff", staffId: string | null, dateISO: string): Band[] | null {
  const dow = new Date(dateISO + "T00:00:00").getDay();
  const mine = rules.filter(r => r.scope === scope && (scope === "salon" || r.staff_id === staffId));
  if (!mine.length) return null;
  const exc = mine.find(r => r.kind === "exception" && r.date === dateISO);
  if (exc) return exc.bands;
  const per = mine.filter(r => r.kind === "period" && r.date_from && r.date_to && r.date_from <= dateISO && dateISO <= r.date_to)
    .sort((a, b) => (b.date_from! > a.date_from! ? 1 : -1))[0];
  const hasStd = mine.some(r => r.kind === "standard");
  const std = mine.find(r => r.kind === "standard" && r.dow === dow);
  if (per) {
    // bande vuote nel periodo = chiuso/ferie a prescindere
    if (per.bands.length === 0) return [];
    // il periodo ridefinisce l'orario SOLO per i giorni normalmente aperti:
    // un giorno chiuso da standard (es. lunedì) resta chiuso anche in "orario estivo"
    const stdOpen = std ? std.bands.length > 0 : !hasStd;
    return stdOpen ? per.bands : [];
  }
  return std ? std.bands : [];
}

export class Schedule {
  rules: Rule[]; snaps: Map<string, number>; configured: boolean;
  constructor(rules: Rule[], snaps: Snapshot[]) {
    this.rules = rules;
    this.snaps = new Map(snaps.map(s => [s.day + "|" + s.staff_id, Number(s.available_minutes)]));
    this.configured = rules.some(r => r.scope === "salon" && r.kind === "standard");
  }
  salonDay(dateISO: string): Band[] {
    return resolve(this.rules, "salon", null, dateISO) ?? [];
  }
  // fasce effettive dell'operatore = disponibilità operatore ∩ apertura salone
  staffDay(staffId: string, dateISO: string): Band[] {
    const salon = this.salonDay(dateISO);
    const own = resolve(this.rules, "staff", staffId, dateISO);
    if (own == null) return salon;               // operatore senza regole proprie: segue il salone
    return intersectBands(own, salon);
  }
  // minuti disponibili di una giornata: fotografia storica se esiste, altrimenti regole
  staffDayMinutes(staffId: string, dateISO: string, todayISO: string): number {
    if (dateISO < todayISO) {
      const snap = this.snaps.get(dateISO + "|" + staffId);
      if (snap != null) return snap;
    }
    return bandsMinutes(this.staffDay(staffId, dateISO));
  }
  // mese: {total, elapsed, remaining} per un operatore (elapsed = giorni passati interi + oggi parziale)
  staffMonth(staffId: string, monthISO: string, ref: Date = new Date()) {
    const d = new Date(monthISO + "T00:00:00");
    const y = d.getFullYear(), m = d.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const todayISO = ref.toISOString().slice(0, 10);
    const nowMin = ref.getHours() * 60 + ref.getMinutes();
    let total = 0, elapsed = 0;
    for (let i = 1; i <= days; i++) {
      const iso = y + "-" + String(m + 1).padStart(2, "0") + "-" + String(i).padStart(2, "0");
      const mins = this.staffDayMinutes(staffId, iso, todayISO);
      total += mins;
      if (iso < todayISO) elapsed += mins;
      else if (iso === todayISO) elapsed += bandsElapsed(this.staffDay(staffId, iso), nowMin);
    }
    return { total, elapsed, remaining: total - elapsed };
  }
  // minuti-operatore trascorsi OGGI (per il costo accumulato: dipende dalla disponibilità reale, non dall'apertura)
  staffTodayElapsed(staffId: string, ref: Date = new Date()): number {
    const iso = ref.toISOString().slice(0, 10);
    return bandsElapsed(this.staffDay(staffId, iso), ref.getHours() * 60 + ref.getMinutes());
  }
}

export async function loadSchedule(orgId: string): Promise<Schedule> {
  const since = new Date(); since.setMonth(since.getMonth() - 1); since.setDate(1);
  const [{ data: rules }, { data: snaps }] = await Promise.all([
    supabase.from("schedule_rules").select("*").eq("organization_id", orgId),
    supabase.from("day_capacity_snapshots").select("day,staff_id,available_minutes")
      .eq("organization_id", orgId).gte("day", since.toISOString().slice(0, 10)),
  ]);
  return new Schedule((rules ?? []) as Rule[], (snaps ?? []) as Snapshot[]);
}

// Congela la fotografia dei giorni conclusi (ultimi N) che non hanno ancora uno snapshot.
// Best-effort e idempotente: onConflict ignora i giorni già fotografati.
export async function freezePastDays(orgId: string, sched: Schedule, staffIds: string[], daysBack = 7) {
  if (!sched.configured) return;
  const today = new Date().toISOString().slice(0, 10);
  const rows: any[] = [];
  for (let k = 1; k <= daysBack; k++) {
    const d = new Date(); d.setDate(d.getDate() - k);
    const iso = d.toISOString().slice(0, 10);
    if (iso >= today) continue;
    for (const sid of staffIds) {
      if (sched.snaps.has(iso + "|" + sid)) continue;
      const bands = sched.staffDay(sid, iso);
      rows.push({ organization_id: orgId, day: iso, staff_id: sid, available_minutes: bandsMinutes(bands), bands });
    }
  }
  if (rows.length) {
    await supabase.from("day_capacity_snapshots").upsert(rows, { onConflict: "organization_id,day,staff_id", ignoreDuplicates: true });
  }
}
