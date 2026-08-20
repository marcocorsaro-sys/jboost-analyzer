"use client";
import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { planCapacity, eur, num, Plan, PlanStaff } from "@/lib/gps";
import { loadSchedule, Schedule } from "@/lib/schedule";
import OrariModule from "@/components/OrariModule";

const DAYS: { k: keyof PlanStaff; l: string }[] = [
  { k: "hours_mon", l: "LUN" }, { k: "hours_tue", l: "MAR" }, { k: "hours_wed", l: "MER" },
  { k: "hours_thu", l: "GIO" }, { k: "hours_fri", l: "VEN" }, { k: "hours_sat", l: "SAB" }, { k: "hours_sun", l: "DOM" },
];

export default function Pianificazione() {
  const ctx = useOrg();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [rows, setRows] = useState<(PlanStaff & { id: string })[]>([]);
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [costs, setCosts] = useState<any[]>([]);
  const [costDraft, setCostDraft] = useState({ name: "", amount: 0, cost_type: "fisso" });
  const [sched, setSched] = useState<Schedule | null>(null);
  const [staffList, setStaffList] = useState<{ id: string; display_name: string }[]>([]);

  useEffect(() => {
    if (!ctx.orgId) return;
    (async () => {
      // stesso piano usato dalla Reception: prima il piano ATTIVO, solo in mancanza il più recente
      let { data: p } = await supabase.from("business_plans").select("*")
        .eq("organization_id", ctx.orgId).eq("status", "active")
        .order("month", { ascending: false }).limit(1).maybeSingle();
      if (!p) {
        ({ data: p } = await supabase.from("business_plans").select("*")
          .eq("organization_id", ctx.orgId).order("month", { ascending: false }).limit(1).maybeSingle());
      }
      if (!p) return;
      setPlan(p as Plan);
      const { data: ps } = await supabase.from("plan_staff").select("*").eq("plan_id", p.id);
      setRows((ps ?? []) as any);
      const { data: st } = await supabase.from("staff_members").select("id,display_name").eq("organization_id", ctx.orgId);
      setStaffNames(Object.fromEntries((st ?? []).map((s: any) => [s.id, s.display_name])));
      setStaffList((st ?? []) as any);
      setSched(await loadSchedule(ctx.orgId!));
      const { data: pc } = await supabase.from("plan_costs").select("*").eq("plan_id", p.id).order("created_at");
      setCosts(pc ?? []);
    })();
  }, [ctx.orgId]);

  // Capacità: se il modulo Orari è configurato è LUI la fonte dei minuti (spec Dimitar);
  // altrimenti si usa la vecchia griglia ore/giorno come fallback.
  const cap = useMemo(() => {
    if (!plan) return null;
    if (sched?.configured) {
      const coeff = Number(plan.productive_coefficient) || 1;
      let raw = 0, weighted = 0;
      for (const r of rows.filter(x => x.include_capacity)) {
        const t = sched.staffMonth(r.staff_id, plan.month).total;
        raw += t;
        weighted += t * ((Number((r as any).capacity_pct ?? 100)) / 100);
      }
      const productiveMinutes = Math.round(weighted * coeff);
      const cam = productiveMinutes > 0 ? Number(plan.monthly_total) / productiveMinutes : 0;
      // giorni di apertura dal calendario del salone
      const d = new Date(plan.month + "T00:00:00");
      const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      let openDays = 0;
      for (let i = 1; i <= days; i++) {
        const iso = plan.month.slice(0, 8) + String(i).padStart(2, "0");
        if (sched.salonDay(iso).length > 0) openDays++;
      }
      return { rawMinutes: Math.round(raw), productiveMinutes, cam, openDays, dailyAvg: openDays > 0 ? Number(plan.monthly_total) / openDays : 0, hourlyValue: cam * 60 };
    }
    return planCapacity(plan, rows);
  }, [plan, rows, sched]);

  // Struttura costi (§12-13): personale automatico dalle righe piano, MAI in doppio conteggio
  const staffCost = rows.filter(r => r.include_cost).reduce((a, r) => a + Number(r.monthly_cost || 0), 0);
  const fixedVar = costs.filter(c => c.cost_type !== "obiettivo").reduce((a, c) => a + Number(c.amount), 0);
  const goals = costs.filter(c => c.cost_type === "obiettivo").reduce((a, c) => a + Number(c.amount), 0);
  const breakEven = fixedVar + staffCost;
  const obiettivo = breakEven + goals;

  const addCost = async () => {
    if (!plan || !costDraft.name) return;
    await supabase.from("plan_costs").insert({ plan_id: plan.id, ...costDraft });
    setCostDraft({ name: "", amount: 0, cost_type: "fisso" });
    const { data: pc } = await supabase.from("plan_costs").select("*").eq("plan_id", plan.id).order("created_at");
    setCosts(pc ?? []);
  };
  const delCost = async (id: string) => {
    await supabase.from("plan_costs").delete().eq("id", id);
    setCosts(costs.filter(c => c.id !== id));
  };
  const applyTotal = async () => {
    if (!plan) return;
    const { data, error } = await supabase.from("business_plans").update({ monthly_total: obiettivo }).eq("id", plan.id).select("id");
    if (error || !data?.length) { setSaved("⚠️ ERRORE: obiettivo NON applicato (" + (error?.message ?? "nessuna riga") + ")"); return; }
    setPlan({ ...plan, monthly_total: obiettivo });
    setSaved("Obiettivo applicato ✓ " + eur(obiettivo, 0) + " — CAM ricalcolato, valido anche in Reception.");
  };

  // BUG FIX (Dimitar): autosalvataggio per riga — ogni campo persiste da solo su modifica,
  // senza dipendere dal pulsante "Salva piano". Gli errori non sono più silenziosi.
  const patchRow = (i: number, patch: any) =>
    setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const persistRow = async (id: string, patch: any) => {
    const { data, error } = await supabase.from("plan_staff").update(patch).eq("id", id).select("id");
    if (error || !data?.length) {
      setSaved("⚠️ ERRORE salvataggio riga: " + (error?.message ?? "nessuna riga aggiornata") + " — la modifica NON è persistita.");
      return false;
    }
    setSaved("Salvato ✓ — CAM ricalcolato con i nuovi dati (Reception aggiornata al prossimo caricamento).");
    return true;
  };

  const save = async () => {
    if (!plan) return;
    setSaved(null);
    const { data: pu, error: pe } = await supabase.from("business_plans").update({
      monthly_total: plan.monthly_total,
      productive_coefficient: plan.productive_coefficient,
      expected_occupancy: (plan as any).expected_occupancy ?? 75,
      notes: plan.notes,
    }).eq("id", plan.id).select("id");
    if (pe || !pu?.length) { setSaved("⚠️ ERRORE salvataggio piano: " + (pe?.message ?? "nessuna riga aggiornata")); return; }
    let ok = 0;
    for (const r of rows) {
      const { id, staff_id, display_name, ...fields } = r as any;
      const { data, error } = await supabase.from("plan_staff").update(fields).eq("id", id).select("id");
      if (error || !data?.length) { setSaved("⚠️ ERRORE su una riga operatore: " + (error?.message ?? "non aggiornata")); return; }
      ok++;
    }
    setSaved(`Piano salvato ✓ (${ok} operatori) — nuovo CAM: ${cap ? eur(cap.cam, 4) : "—"}, già valido anche in Reception.`);
  };

  return (
    <Shell ctx={ctx}>
      <div className="page-head">
        <div>
          <h1>Pianificazione Economica</h1>
          <p className="sub">{plan ? "Mese: " + plan.month.slice(0, 7) + " · stato: " + plan.status : "…"}</p>
        </div>
        <button className="btn" onClick={save}>Salva piano</button>
      </div>
      {saved && <div className="alert" style={{ background: "#d9e9dd", borderColor: "#9cc5a9", color: "#1e5c38" }}>{saved}</div>}

      {plan && cap && (
        <>
          <div className="grid kpis">
            <div className="card gold">
              <div className="kpi-label">Costo al minuto GPS</div>
              <div className="kpi-value">{eur(cap.cam, 4)}</div>
              <div className="kpi-note">Obiettivo mensile ÷ minuti produttivi</div>
            </div>
            <div className="card dark">
              <div className="kpi-label">Totale mensile da coprire</div>
              <div className="kpi-value">{eur(Number(plan.monthly_total), 0)}</div>
            </div>
            <div className="card dark">
              <div className="kpi-label">Minuti produttivi</div>
              <div className="kpi-value">{num(cap.productiveMinutes)}</div>
              <div className="kpi-note">{num(cap.rawMinutes)} grezzi × coeff. {plan.productive_coefficient}</div>
            </div>
            <div className="card">
              <div className="kpi-label">Requisito giornaliero medio</div>
              <div className="kpi-value">{eur(cap.dailyAvg, 0)}</div>
              <div className="kpi-note">{cap.openDays} giorni di apertura</div>
            </div>
            <div className="card">
              <div className="kpi-label">Valore orario medio</div>
              <div className="kpi-value">{eur(cap.hourlyValue)}</div>
            </div>
          </div>

          <div className="two-col section">
            <div className="card" style={{ borderColor: "#c9a227", borderWidth: 2 }}>
              <div className="section-title"><h2>Struttura dei costi</h2><span className="sub">il personale arriva da solo dalle schede — niente doppio conteggio</span></div>
              {costs.map(c => (
                <div className="row" key={c.id}>
                  <span>{c.cost_type === "obiettivo" ? "🎯" : c.cost_type === "variabile" ? "〰" : "▦"} {c.name} <span className="sub">({c.cost_type})</span></span>
                  <span><b>{eur(Number(c.amount), 0)}</b> <button className="btn sm secondary" onClick={() => delCost(c.id)}>✕</button></span>
                </div>
              ))}
              <div className="row"><span>▦ Personale/collaboratori <span className="sub">(automatico dalle righe sotto)</span></span><b>{eur(staffCost, 0)}</b></div>
              <div style={{ display: "flex", gap: 6, margin: "10px 0", flexWrap: "wrap" }}>
                <input list="voci" placeholder="Voce (affitto, luce, IVA, stipendio titolare…)" style={{ flex: 1, minWidth: 170 }} value={costDraft.name} onChange={e => setCostDraft({ ...costDraft, name: e.target.value })} />
                <datalist id="voci">{["Affitto", "Luce", "Gas", "Commercialista", "Software", "Assicurazioni", "IVA", "Imposte e tasse", "Marketing", "Materiali", "Stipendio titolare", "Utile desiderato", "Altre spese"].map(v => <option key={v} value={v} />)}</datalist>
                <input type="number" placeholder="€" style={{ width: 90 }} value={costDraft.amount || ""} onChange={e => setCostDraft({ ...costDraft, amount: Number(e.target.value) })} />
                <select value={costDraft.cost_type} onChange={e => setCostDraft({ ...costDraft, cost_type: e.target.value })}>
                  <option value="fisso">fisso</option><option value="variabile">variabile</option><option value="obiettivo">obiettivo (stipendio/utile)</option>
                </select>
                <button className="btn sm" onClick={addCost}>+</button>
              </div>
              <div className="row"><span><b>Break-even</b> <span className="sub">(costi + personale)</span></span><b>{eur(breakEven, 0)}</b></div>
              <div className="row" style={{ borderBottom: "none" }}><span><b>Obiettivo economico</b> <span className="sub">(+ stipendio titolare e utile)</span></span><b style={{ color: "#1e7a4f", fontSize: 17 }}>{eur(obiettivo, 0)}</b></div>
              {Math.abs(obiettivo - Number(plan.monthly_total)) > 1 && costs.length > 0 && (
                <button className="btn sm" style={{ marginTop: 8 }} onClick={applyTotal}>Applica {eur(obiettivo, 0)} come totale del piano → ricalcola CAM</button>
              )}
            </div>
            <div className="card">
              <label className="fld">Totale mensile da coprire (manuale, finché la struttura costi non è completa)</label>
              <input type="number" value={plan.monthly_total} onChange={e => setPlan({ ...plan, monthly_total: Number(e.target.value) })}
                onBlur={async e => { const { error } = await supabase.from("business_plans").update({ monthly_total: Number(e.target.value) }).eq("id", plan.id); setSaved(error ? "⚠️ ERRORE: totale non salvato" : "Totale salvato ✓ — CAM aggiornato ovunque."); }} style={{ width: "100%" }} />
              <label className="fld" style={{ marginTop: 14 }}>Occupazione Target del salone — OT % (obiettivo, non entra nel CAM)</label>
              <input type="number" min={10} max={100} value={(plan as any).expected_occupancy ?? 75} onChange={e => setPlan({ ...plan, expected_occupancy: Number(e.target.value) } as any)} style={{ width: "100%" }} />
              <p className="sub" style={{ marginTop: 8 }}>L'OT si imposta qui (anche per singolo collaboratore, righe sotto). L'Occupazione Reale (OR) invece la calcola GPS da solo durante la giornata e la vedi in Reception e in Team, confrontata in punti percentuali con il target.</p>
              <label className="fld" style={{ marginTop: 14 }}>Note piano</label>
              <textarea rows={4} style={{ width: "100%" }} value={plan.notes ?? ""} onChange={e => setPlan({ ...plan, notes: e.target.value })} />
            </div>
          </div>

          <OrariModule ctx={ctx} staff={staffList} />

          <div className="section">
            <div className="section-title"><h2>Personale — capacità produttiva</h2><span className="sub">{sched?.configured ? "i minuti arrivano dal modulo Orari qui sopra — la griglia ore/giorno resta solo come riferimento" : "ore per giorno della settimana (finché non configuri il modulo Orari)"}</span></div>
            {rows.map((r, i) => (
              <div className="card" key={r.id} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <b className="serif" style={{ fontSize: 17 }}>{staffNames[r.staff_id] ?? "Operatore"}</b>
                  <span style={{ display: "flex", gap: 14, alignItems: "center", fontSize: 13 }}>
                    <span>Costo €/mese <input type="number" value={r.monthly_cost} style={{ width: 90, padding: "5px 8px" }}
                      onChange={e => patchRow(i, { monthly_cost: Number(e.target.value) })}
                      onBlur={e => persistRow(r.id, { monthly_cost: Number(e.target.value) })} /></span>
                    <label><input type="checkbox" checked={r.include_capacity} onChange={e => { patchRow(i, { include_capacity: e.target.checked }); persistRow(r.id, { include_capacity: e.target.checked }); }} /> capacità</label>
                    <label><input type="checkbox" checked={r.include_cost} onChange={e => { patchRow(i, { include_cost: e.target.checked }); persistRow(r.id, { include_cost: e.target.checked }); }} /> costi</label>
                    <span>Partecipazione capacità <input type="number" min={0} max={100} value={(r as any).capacity_pct ?? 100} style={{ width: 62, padding: "5px 6px", textAlign: "right" }}
                      onChange={e => patchRow(i, { capacity_pct: Number(e.target.value) })}
                      onBlur={e => persistRow(r.id, { capacity_pct: Number(e.target.value) })} />%</span>
                    <span title="Occupazione Target individuale — l'OR reale la calcola GPS">OT <input type="number" min={0} max={100} value={(r as any).occupancy_target_pct ?? 75} style={{ width: 58, padding: "5px 6px", textAlign: "right" }}
                      onChange={e => patchRow(i, { occupancy_target_pct: Number(e.target.value) })}
                      onBlur={e => persistRow(r.id, { occupancy_target_pct: Number(e.target.value) })} />%</span>
                    <b>{num(Math.round(plan ? (sched?.configured ? sched.staffMonth(r.staff_id, plan.month).total * ((Number((r as any).capacity_pct ?? 100)) / 100) : planCapacity(plan, [r]).productiveMinutes) : 0))} min prod./mese</b>
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, marginTop: 12 }}>
                  {DAYS.map(d => (
                    <div key={d.k as string} style={{ textAlign: "center" }}>
                      <div className="fld" style={{ marginBottom: 4 }}>{d.l}</div>
                      <input type="number" min={0} max={14} step={0.5} value={Number(r[d.k]) || 0} style={{ width: "100%", textAlign: "center", padding: "6px 4px" }}
                        onChange={e => patchRow(i, { [d.k]: Number(e.target.value) })}
                        onBlur={e => persistRow(r.id, { [d.k]: Number(e.target.value) })} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Shell>
  );
}
