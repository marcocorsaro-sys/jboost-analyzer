// Logica economica GPS — formule dal Blueprint v1.0 (§19-21)
export type PlanStaff = {
  id?: string;
  staff_id: string;
  display_name?: string;
  monthly_cost: number;
  include_capacity: boolean;
  include_cost: boolean;
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
  const rawMinutes = staff.filter(s => s.include_capacity)
    .reduce((acc, s) => acc + staffMonthlyMinutes(s, plan.month), 0);
  const productiveMinutes = Math.round(rawMinutes * (Number(plan.productive_coefficient) || 1));
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

export const eur = (n: number | null | undefined, dec = 2) =>
  n == null ? "—" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: dec, maximumFractionDigits: dec }).format(Number(n));

export const num = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("it-IT").format(Number(n));

export const SEGMENT_LABEL: Record<string, string> = {
  premium: "Premium", fidelizzato: "Fidelizzato", intermittente: "Intermittente",
  base: "Base", anonimo: "Anonimo", nuovo: "Nuovo",
};
