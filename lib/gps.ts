// Logica economica GPS — formule dal Blueprint v1.0 (§19-21)
export type PlanStaff = {
  id?: string;
  staff_id: string;
  display_name?: string;
  monthly_cost: number;
  include_capacity: boolean;
  include_cost: boolean;
  capacity_pct?: number; // partecipazione alla capacità produttiva 0-100 (barbiere 100, reception 0, misto 25-50)
  hours_mon: number; hours_tue: number; hours_wed: number; hours_thu: number;
  hours_fri: number; hours_sat: number; hours_sun: number;
};

export type Plan = {
  id: string;
  month: string; // YYYY-MM-DD (primo del mese)
  status: string;
  monthly_total: number;
  productive_coefficient: number;
  notes: string | null;
};

const DAY_KEYS = ["hours_sun","hours_mon","hours_tue","hours_wed","hours_thu","hours_fri","hours_sat"] as const;

export function weekdayCounts(monthISO: string): number[] {
  // conteggio di ogni giorno della settimana (0=dom..6=sab) nel mese
  const d = new Date(monthISO + "T00:00:00");
  const y = d.getFullYear(), m = d.getMonth();
  const counts = [0,0,0,0,0,0,0];
  const days = new Date(y, m + 1, 0).getDate();
  for (let i = 1; i <= days; i++) counts[new Date(y, m, i).getDay()]++;
  return counts;
}

export function staffMonthlyMinutes(ps: PlanStaff, monthISO: string): number {
  const counts = weekdayCounts(monthISO);
  let minutes = 0;
  for (let dow = 0; dow < 7; dow++) minutes += (Number(ps[DAY_KEYS[dow]]) || 0) * 60 * counts[dow];
  return minutes;
}

export function planCapacity(plan: Plan, staff: PlanStaff[]) {
  // Capacità = presenza × partecipazione individuale (0-100%) — niente coefficienti fissi uguali per tutti
  const rawMinutes = staff.filter(s => s.include_capacity)
    .reduce((acc, s) => acc + staffMonthlyMinutes(s, plan.month), 0);
  const weighted = staff.filter(s => s.include_capacity)
    .reduce((acc, s) => acc + staffMonthlyMinutes(s, plan.month) * ((s.capacity_pct ?? 100) / 100), 0);
  const productiveMinutes = Math.round(weighted * (Number(plan.productive_coefficient) || 1));
  const cam = productiveMinutes > 0 ? Number(plan.monthly_total) / productiveMinutes : 0;
  // giorni di apertura = giorni con almeno un operatore in capacità
  const counts = weekdayCounts(plan.month);
  let openDays = 0;
  for (let dow = 0; dow < 7; dow++) {
    const anyone = staff.some(s => s.include_capacity && (Number(s[DAY_KEYS[dow]]) || 0) > 0);
    if (anyone) openDays += counts[dow];
  }
  return {
    rawMinutes,
    productiveMinutes,
    cam,
    openDays,
    dailyAvg: openDays > 0 ? Number(plan.monthly_total) / openDays : 0,
    hourlyValue: cam * 60,
  };
}

// §14bis — Occupazione individuale (richiesta Dimitar):
// minuti disponibili del mese, trascorsi da inizio mese, mancanti, occupati → % occupazione
export function staffAvailabilitySplit(ps: PlanStaff, monthISO: string, ref: Date = new Date()) {
  const d = new Date(monthISO + "T00:00:00");
  const y = d.getFullYear(), m = d.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  const sameMonth = ref.getFullYear() === y && ref.getMonth() === m;
  const afterMonth = ref.getTime() > new Date(y, m + 1, 0, 23, 59, 59).getTime();
  const refDay = sameMonth ? ref.getDate() : afterMonth ? days : 0;
  let total = 0, elapsed = 0;
  for (let i = 1; i <= days; i++) {
    const mins = (Number(ps[DAY_KEYS[new Date(y, m, i).getDay()]]) || 0) * 60;
    total += mins;
    if (i <= refDay) elapsed += mins;
  }
  return { total, elapsed, remaining: total - elapsed };
}

export type Occupancy = { total: number; elapsed: number; remaining: number; occupied: number; pct: number };

export function buildOccupancy(split: { total: number; elapsed: number; remaining: number }, occupiedMin: number): Occupancy {
  return {
    ...split,
    occupied: Math.round(occupiedMin),
    pct: split.elapsed > 0 ? Math.min(1.5, occupiedMin / split.elapsed) : 0,
  };
}

// Minuti occupati del mese: il meglio fra segmenti di lavoro reali (visit_segments)
// e durate a listino dei servizi transati (fallback quando il flusso poltrona non è usato)
export function occupiedMinutesFor(
  staffId: string,
  segments: { staff_id: string; status: string; started_at: string; ended_at: string | null; active_minutes: number | null }[],
  txWithItem: { staff_id: string | null; catalog_item_id: string | null; kind: string }[],
  durationByItem: Record<string, number>,
  ref: Date = new Date(),
) {
  let segMin = 0;
  for (const s of segments) {
    if (s.staff_id !== staffId) continue;
    if (s.active_minutes != null && s.active_minutes > 0) { segMin += Number(s.active_minutes); continue; }
    const start = new Date(s.started_at).getTime();
    const end = s.ended_at ? new Date(s.ended_at).getTime() : (s.status === "active" ? ref.getTime() : start);
    if (end > start) segMin += (end - start) / 60000;
  }
  let catMin = 0;
  for (const t of txWithItem) {
    if (t.staff_id !== staffId || !t.catalog_item_id || t.kind === "product") continue;
    catMin += Number(durationByItem[t.catalog_item_id] ?? 0);
  }
  return Math.max(segMin, catMin);
}

// Alert per la scheda collaboratore (titolare/manager): occupazione vs lavorato rispetto alla media salone
export function occupancyAlert(occPct: number, worked: number, salonAvgWorked: number, elapsedMin: number): string | null {
  if (elapsedMin < 600 || salonAvgWorked <= 0) return null; // troppo presto nel mese per giudicare
  const highOcc = occPct >= 0.75, lowOcc = occPct < 0.5;
  const belowAvg = worked < salonAvgWorked * 0.85, aboveAvg = worked >= salonAvgWorked;
  if (highOcc && belowAvg) return "Occupazione alta (" + Math.round(occPct * 100) + "%) ma lavorato sotto la media salone: il limite è il mix di servizi a valore troppo basso. Rivedi listino, upgrade e up-sell in poltrona.";
  if (lowOcc && belowAvg) return "Occupazione bassa (" + Math.round(occPct * 100) + "%): il limite è la domanda scarsa. Servono più prenotazioni: riappuntamenti in poltrona, walk-in indirizzati, promozione mirata.";
  if (lowOcc && aboveAvg) return "Lavorato in linea con poca occupazione (" + Math.round(occPct * 100) + "%): alto valore al minuto. C'è spazio in agenda per crescere ancora — riempirla è quasi tutto margine.";
  return null;
}

export const eur = (n: number | null | undefined, dec = 2) =>
  n == null ? "—" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: dec, maximumFractionDigits: dec }).format(Number(n));

export const num = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("it-IT").format(Number(n));

export const SEGMENT_LABEL: Record<string, string> = {
  premium: "Premium", fidelizzato: "Fidelizzato", intermittente: "Intermittente",
  base: "Base", anonimo: "Anonimo", nuovo: "Nuovo",
};
