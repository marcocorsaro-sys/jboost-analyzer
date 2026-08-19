"use client";
import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { planCapacity, eur, num, Plan, PlanStaff } from "@/lib/gps";

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

  useEffect(() => {
    if (!ctx.orgId) return;
    (async () => {
      const { data: p } = await supabase.from("business_plans").select("*")
        .eq("organization_id", ctx.orgId).order("month", { ascending: false }).limit(1).maybeSingle();
      if (!p) return;
      setPlan(p as Plan);
      const { data: ps } = await supabase.from("plan_staff").select("*").eq("plan_id", p.id);
      setRows((ps ?? []) as any);
      const { data: st } = await supabase.from("staff_members").select("id,display_name").eq("organization_id", ctx.orgId);
      setStaffNames(Object.fromEntries((st ?? []).map((s: any) => [s.id, s.display_name])));
    })();
  }, [ctx.orgId]);

  const cap = useMemo(() => (plan ? planCapacity(plan, rows) : null), [plan, rows]);

  const save = async () => {
    if (!plan) return;
    setSaved(null);
    await supabase.from("business_plans").update({
      monthly_total: plan.monthly_total,
      productive_coefficient: plan.productive_coefficient,
      notes: plan.notes,
    }).eq("id", plan.id);
    for (const r of rows) {
      const { id, staff_id, display_name, ...fields } = r as any;
      await supabase.from("plan_staff").update(fields).eq("id", id);
    }
    setSaved("Piano salvato.");
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
            <div className="card">
              <label className="fld">Totale mensile da coprire (costi + compenso titolare + utile desiderato)</label>
              <input type="number" value={plan.monthly_total} onChange={e => setPlan({ ...plan, monthly_total: Number(e.target.value) })} style={{ width: "100%" }} />
              <label className="fld" style={{ marginTop: 14 }}>Coefficiente produttivo (1,00 = minuti pieni)</label>
              <input type="number" step="0.05" min="0.1" max="1" value={plan.productive_coefficient} onChange={e => setPlan({ ...plan, productive_coefficient: Number(e.target.value) })} style={{ width: "100%" }} />
              <p className="sub" style={{ marginTop: 8 }}>Nota Blueprint §20: il CAM ufficiale usa i minuti produttivi <i>disponibili</i>, senza coefficienti fissi. Il coefficiente qui è una deroga esplicita ereditata dal prototipo: portalo a 1,00 quando dichiari i minuti realmente vendibili per operatore.</p>
            </div>
            <div className="card">
              <label className="fld">Note piano</label>
              <textarea rows={7} style={{ width: "100%" }} value={plan.notes ?? ""} onChange={e => setPlan({ ...plan, notes: e.target.value })} />
            </div>
          </div>

          <div className="section">
            <div className="section-title"><h2>Personale — capacità produttiva</h2><span className="sub">ore per giorno della settimana</span></div>
            {rows.map((r, i) => (
              <div className="card" key={r.id} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <b className="serif" style={{ fontSize: 17 }}>{staffNames[r.staff_id] ?? "Operatore"}</b>
                  <span style={{ display: "flex", gap: 14, alignItems: "center", fontSize: 13 }}>
                    <span>Costo €/mese <input type="number" value={r.monthly_cost} style={{ width: 90, padding: "5px 8px" }} onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, monthly_cost: Number(e.target.value) } : x))} /></span>
                    <label><input type="checkbox" checked={r.include_capacity} onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, include_capacity: e.target.checked } : x))} /> capacità</label>
                    <label><input type="checkbox" checked={r.include_cost} onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, include_cost: e.target.checked } : x))} /> costi</label>
                    <b>{num(Math.round((plan ? (planCapacity(plan, [r]) .rawMinutes) : 0)))} min/mese</b>
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, marginTop: 12 }}>
                  {DAYS.map(d => (
                    <div key={d.k as string} style={{ textAlign: "center" }}>
                      <div className="fld" style={{ marginBottom: 4 }}>{d.l}</div>
                      <input type="number" min={0} max={14} step={0.5} value={Number(r[d.k]) || 0} style={{ width: "100%", textAlign: "center", padding: "6px 4px" }}
                        onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, [d.k]: Number(e.target.value) } : x))} />
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
