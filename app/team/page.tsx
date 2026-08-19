"use client";
import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { eur, num, staffAvailabilitySplit, buildOccupancy, occupiedMinutesFor, occupancyAlert, Occupancy } from "@/lib/gps";

type Staff = { id: string; display_name: string; color: string | null; is_productive: boolean; active: boolean; operator_code: string | null; monthly_cost: number | null; monthly_target: number; user_id: string | null };
const ROLES = ["operatore", "reception", "manager", "titolare"];

const COLORS = ["#dc2626", "#2563eb", "#db2777", "#0d9488", "#7c3aed", "#ca8a04"];

export default function Team() {
  const ctx = useOrg();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [worked, setWorked] = useState<Record<string, { services: number; products: number }>>({});
  const [draft, setDraft] = useState({ display_name: "", color: COLORS[0], monthly_cost: 0, monthly_target: 0, operator_code: "" });
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [acc, setAcc] = useState<Record<string, { email: string; pwd: string; role: string }>>({});
  const [accMsg, setAccMsg] = useState<Record<string, string>>({});
  const [occs, setOccs] = useState<Record<string, Occupancy>>({});
  const month = new Date().toISOString().slice(0, 7);
  const canEdit = ["titolare", "manager", "consulente"].includes(ctx.role ?? "") || ctx.isAdmin;

  const load = async () => {
    const { data } = await supabase.from("staff_members").select("*").eq("organization_id", ctx.orgId).order("created_at");
    setStaff((data ?? []) as any);
    const { data: tx } = await supabase.from("transactions").select("staff_id,worked_value,kind,status")
      .eq("organization_id", ctx.orgId).gte("tx_date", month + "-01").eq("status", "completed");
    const acc: Record<string, { services: number; products: number }> = {};
    for (const t of (tx ?? []) as any[]) {
      if (!t.staff_id) continue;
      acc[t.staff_id] = acc[t.staff_id] || { services: 0, products: 0 };
      if (t.kind === "product") acc[t.staff_id].products += Number(t.worked_value);
      else acc[t.staff_id].services += Number(t.worked_value);
    }
    setWorked(acc);
    const { data: mems } = await supabase.from("memberships").select("user_id,role").eq("organization_id", ctx.orgId);
    setRoles(Object.fromEntries((mems ?? []).map((m: any) => [m.user_id, m.role])));

    // Occupazione individuale (§14bis, richiesta Dimitar): disponibili/trascorsi/mancanti/occupati per collaboratore
    const { data: plan } = await supabase.from("business_plans").select("id,month")
      .eq("organization_id", ctx.orgId).order("month", { ascending: false }).limit(1).maybeSingle();
    if (plan) {
      const { data: ps } = await supabase.from("plan_staff").select("*").eq("plan_id", plan.id);
      const { data: sg } = await supabase.from("visit_segments").select("staff_id,status,started_at,ended_at,active_minutes")
        .eq("organization_id", ctx.orgId).gte("started_at", month + "-01T00:00:00");
      const { data: txi } = await supabase.from("transactions").select("staff_id,catalog_item_id,kind")
        .eq("organization_id", ctx.orgId).eq("status", "completed").gte("tx_date", month + "-01");
      const { data: cat } = await supabase.from("catalog_items").select("id,duration_min").eq("organization_id", ctx.orgId);
      const durByItem = Object.fromEntries((cat ?? []).map((c: any) => [c.id, Number(c.duration_min) || 0]));
      const o: Record<string, Occupancy> = {};
      for (const row of (ps ?? []) as any[]) {
        if (!row.include_capacity) continue;
        const split = staffAvailabilitySplit(row, plan.month);
        if (split.total <= 0) continue;
        const occupied = occupiedMinutesFor(row.staff_id, (sg ?? []) as any, (txi ?? []) as any, durByItem);
        o[row.staff_id] = buildOccupancy(split, occupied);
      }
      setOccs(o);
    }
  };

  const createAccount = async (s: Staff) => {
    const a = acc[s.id] ?? { email: "", pwd: "", role: "operatore" };
    setAccMsg({ ...accMsg, [s.id]: "" });
    const { data, error } = await supabase.rpc("create_staff_account", { p_staff: s.id, p_email: a.email.trim(), p_password: a.pwd, p_role: a.role });
    setAccMsg({ ...accMsg, [s.id]: error ? "Errore: " + error.message : String(data) === "ok" ? "Accesso creato: comunica email e password temporanea al collaboratore." : String(data) });
    if (!error && String(data) === "ok") load();
  };

  const changeRole = async (s: Staff, role: string) => {
    const { data, error } = await supabase.rpc("set_member_role", { p_staff: s.id, p_role: role });
    setAccMsg({ ...accMsg, [s.id]: error ? "Errore: " + error.message : String(data) === "ok" ? "Ruolo aggiornato." : String(data) });
    if (!error && String(data) === "ok") load();
  };

  useEffect(() => { if (ctx.orgId) load(); }, [ctx.orgId]);

  const update = async (id: string, patch: Partial<Staff>) => {
    await supabase.from("staff_members").update(patch).eq("id", id);
    setStaff(staff.map(s => s.id === id ? { ...s, ...patch } : s));
  };
  const add = async () => {
    if (!draft.display_name) return;
    await supabase.from("staff_members").insert({ ...draft, organization_id: ctx.orgId, operator_code: draft.operator_code || null });
    setDraft({ display_name: "", color: COLORS[(staff.length + 1) % COLORS.length], monthly_cost: 0, monthly_target: 0, operator_code: "" });
    load();
  };

  const capacityIds = Object.keys(occs);
  const salonAvgWorked = capacityIds.length
    ? capacityIds.reduce((a, id) => { const w = worked[id]; return a + (w ? w.services + w.products : 0); }, 0) / capacityIds.length
    : 0;

  return (
    <Shell ctx={ctx}>
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <p className="sub">{num(staff.filter(s => s.active).length)} attivi · progressi del mese {month} (lavorato da Registro)</p>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        {staff.map(s => {
          const w = worked[s.id] ?? { services: 0, products: 0 };
          const tot = w.services + w.products;
          const target = Number(s.monthly_target) || 0;
          const pct = target > 0 ? Math.min(1, tot / target) : 0;
          const reached = target > 0 && tot >= target;
          const bonusServices = reached ? 0.15 * (tot - target) : 0;
          const bonusProducts = reached ? 0.10 * w.products : 0;
          const bonusPotServices = !reached && target > 0 ? 0.15 * Math.max(0, tot * 1.0) * 0 : 0; // potenziale mostrato solo come blocco
          return (
            <div className="card" key={s.id} style={{ opacity: s.active ? 1 : .55 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <b className="serif" style={{ fontSize: 18 }}>
                  <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 6, background: s.color ?? "#888", marginRight: 8 }} />
                  {s.display_name}
                </b>
                <span style={{ display: "flex", gap: 6 }}>
                  {s.operator_code && <span className="badge b-premium mono">{s.operator_code}</span>}
                  <button className="btn sm secondary" disabled={!canEdit} onClick={() => update(s.id, { active: !s.active })}>{s.active ? "Attivo" : "Inattivo"}</button>
                </span>
              </div>

              <div className="row" style={{ marginTop: 10 }}><span>Obiettivo {month}</span>
                <b><input type="number" disabled={!canEdit} value={s.monthly_target} style={{ width: 90, padding: "3px 6px", textAlign: "right" }} onChange={e => update(s.id, { monthly_target: Number(e.target.value) })} /> €</b>
              </div>
              <div style={{ margin: "8px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>{eur(tot, 0)} / {eur(target, 0)}</span>
                  <b style={{ color: reached ? "#1e7a4f" : "#b3402a" }}>{target > 0 ? Math.round(pct * 100) + "%" : "—"}</b>
                </div>
                <div className="bar-track"><div className="bar-fill" style={{ width: pct * 100 + "%", background: reached ? "#1e7a4f" : "var(--gold)" }} /></div>
                {target > 0 && !reached && <div className="sub" style={{ marginTop: 3 }}>Mancano {eur(target - tot, 0)}</div>}
              </div>

              <div className="row"><span>Servizi lavorati</span><b>{eur(w.services, 0)}</b></div>
              <div className="row"><span>Prodotti venduti</span><b>{eur(w.products, 0)}</b></div>
              {occs[s.id] && (() => {
                const o = occs[s.id];
                const alert = occupancyAlert(o.pct, tot, salonAvgWorked, o.elapsed);
                return (
                  <div style={{ background: "#f4f7f4", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", margin: "10px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span className="kpi-label">Occupazione mese</span>
                      <b style={{ fontSize: 18, color: o.pct >= 0.75 ? "#1e7a4f" : o.pct >= 0.5 ? "#b8860b" : "#b3402a" }}>{Math.round(o.pct * 100)}%</b>
                    </div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: Math.min(100, o.pct * 100) + "%", background: o.pct >= 0.75 ? "#1e7a4f" : "var(--gold)" }} /></div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 6, flexWrap: "wrap", gap: 4 }}>
                      <span>disponibili <b>{num(o.total)}</b>′</span>
                      <span>trascorsi <b>{num(o.elapsed)}</b>′</span>
                      <span>occupati <b>{num(o.occupied)}</b>′</span>
                      <span>mancanti <b>{num(o.remaining)}</b>′</span>
                    </div>
                    {alert && <div className="alert" style={{ marginTop: 8, background: "#fdf3e4", borderColor: "#d9a441", color: "#7a5312" }}>⚠️ {alert}</div>}
                  </div>
                );
              })()}
              <div className="row"><span>Costo €/mese</span>
                <b><input type="number" disabled={!canEdit} value={s.monthly_cost ?? 0} style={{ width: 90, padding: "3px 6px", textAlign: "right" }} onChange={e => update(s.id, { monthly_cost: Number(e.target.value) })} /> €</b>
              </div>
              <div className="row"><span>Codice operatore</span>
                <b><input disabled={!canEdit} value={s.operator_code ?? ""} style={{ width: 110, padding: "3px 6px", textAlign: "right", textTransform: "uppercase" }} onChange={e => update(s.id, { operator_code: e.target.value.toUpperCase() || null as any })} /></b>
              </div>
              <div style={{ background: "#f7f3ea", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", margin: "10px 0" }}>
                <div className="kpi-label" style={{ marginBottom: 6 }}># Accesso GPS</div>
                {s.user_id ? (
                  <>
                    <div className="row"><span>Stato account</span><b><span className="badge b-ok">attivo</span></b></div>
                    <div className="row" style={{ borderBottom: "none" }}><span>Ruolo GPS</span>
                      <b>
                        {canEdit ? (
                          <select value={roles[s.user_id] ?? "operatore"} onChange={e => changeRole(s, e.target.value)}>
                            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                        ) : <span className="badge b-premium">{roles[s.user_id] ?? "—"}</span>}
                      </b>
                    </div>
                  </>
                ) : canEdit ? (
                  <>
                    <input style={{ width: "100%", marginBottom: 6 }} type="email" placeholder="Email del collaboratore"
                      value={acc[s.id]?.email ?? ""} onChange={e => setAcc({ ...acc, [s.id]: { email: e.target.value, pwd: acc[s.id]?.pwd ?? "", role: acc[s.id]?.role ?? "operatore" } })} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <input style={{ flex: 1 }} placeholder="Password temporanea (min 8)"
                        value={acc[s.id]?.pwd ?? ""} onChange={e => setAcc({ ...acc, [s.id]: { email: acc[s.id]?.email ?? "", pwd: e.target.value, role: acc[s.id]?.role ?? "operatore" } })} />
                      <select value={acc[s.id]?.role ?? "operatore"} onChange={e => setAcc({ ...acc, [s.id]: { email: acc[s.id]?.email ?? "", pwd: acc[s.id]?.pwd ?? "", role: e.target.value } })}>
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button className="btn sm" onClick={() => createAccount(s)}>Crea</button>
                    </div>
                  </>
                ) : <div className="row" style={{ borderBottom: "none" }}><span>Stato account</span><b><span className="badge b-warn">non invitato</span></b></div>}
                {accMsg[s.id] && <p className="sub" style={{ marginTop: 6, color: accMsg[s.id].startsWith("Errore") || accMsg[s.id].startsWith("errore") ? "#b3402a" : "#1e5c38" }}>{accMsg[s.id]}</p>}
              </div>
              <div className="row" style={{ borderBottom: "none" }}>
                <span>Bonus {reached ? "incassabile" : "(bloccato fino al target)"}</span>
                <b style={{ color: reached ? "#1e7a4f" : "#b3402a" }}>{eur(bonusServices + bonusProducts)}</b>
              </div>
              <p className="sub" style={{ marginTop: 4 }}>Regola v1: al 100% del target → 15% sul lavorato oltre target + 10% sui prodotti del mese. Da validare con Dimitar (soglia secca vs rampa).</p>
            </div>
          );
        })}
      </div>

      {!canEdit && <p className="sub" style={{ marginTop: 12 }}>Come reception puoi consultare le schede, ma ruoli e dati dei collaboratori li modifica solo il titolare o un manager.</p>}
      {canEdit && <div className="card section" style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}><label className="fld">Nuovo collaboratore</label><input style={{ width: "100%" }} value={draft.display_name} onChange={e => setDraft({ ...draft, display_name: e.target.value })} placeholder="Nome e cognome" /></div>
        <div><label className="fld">Colore</label>
          <select value={draft.color} onChange={e => setDraft({ ...draft, color: e.target.value })}>
            {COLORS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div><label className="fld">Costo €/mese</label><input type="number" style={{ width: 100 }} value={draft.monthly_cost} onChange={e => setDraft({ ...draft, monthly_cost: Number(e.target.value) })} /></div>
        <div><label className="fld">Obiettivo €</label><input type="number" style={{ width: 100 }} value={draft.monthly_target} onChange={e => setDraft({ ...draft, monthly_target: Number(e.target.value) })} /></div>
        <div><label className="fld">Codice</label><input style={{ width: 110, textTransform: "uppercase" }} value={draft.operator_code} onChange={e => setDraft({ ...draft, operator_code: e.target.value.toUpperCase() })} /></div>
        <button className="btn" onClick={add}>+ Aggiungi</button>
      </div>}
      <p className="sub" style={{ marginTop: 8 }}>Ricorda: dopo aver aggiunto un collaboratore, imposta i suoi turni in Pianificazione perché entri nella capacità produttiva e nel CAM.</p>
    </Shell>
  );
}
