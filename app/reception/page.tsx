"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { planCapacity, staffMonthlyMinutes, weekdayCounts, eur, num, Plan, PlanStaff } from "@/lib/gps";

type Appt = { id: string; starts_at: string; client_name: string | null; staff_id: string | null; service_name: string | null; status: string };

export default function Reception() {
  const ctx = useOrg();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planStaff, setPlanStaff] = useState<PlanStaff[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [appts, setAppts] = useState<Appt[]>([]);
  const [txToday, setTxToday] = useState<{ worked: number; cash: number; n: number; products: number }>({ worked: 0, cash: 0, n: 0, products: 0 });
  const [opening, setOpening] = useState("08:30");
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!ctx.orgId) return;
    (async () => {
      const { data: org } = await supabase.from("organizations").select("opening_time").eq("id", ctx.orgId).single();
      if (org?.opening_time) setOpening(org.opening_time);
      const { data: p } = await supabase.from("business_plans").select("*").eq("organization_id", ctx.orgId).eq("status", "active").order("month", { ascending: false }).limit(1).maybeSingle();
      if (p) {
        setPlan(p as Plan);
        const { data: ps } = await supabase.from("plan_staff").select("*").eq("plan_id", p.id);
        setPlanStaff((ps ?? []) as any);
      }
      const { data: st } = await supabase.from("staff_members").select("*").eq("organization_id", ctx.orgId).eq("active", true);
      setStaff(st ?? []);
      const { data: ap } = await supabase.from("appointments").select("id,starts_at,client_name,staff_id,service_name,status")
        .eq("organization_id", ctx.orgId).gte("starts_at", today + "T00:00:00").lte("starts_at", today + "T23:59:59").order("starts_at");
      setAppts((ap ?? []) as any);
      const { data: tx } = await supabase.from("transactions").select("worked_value,cash_value,kind,status").eq("organization_id", ctx.orgId).eq("tx_date", today);
      const done = (tx ?? []).filter((t: any) => t.status === "completed");
      setTxToday({
        worked: done.reduce((a: number, t: any) => a + Number(t.worked_value), 0),
        cash: done.reduce((a: number, t: any) => a + Number(t.cash_value), 0),
        n: done.length,
        products: done.filter((t: any) => t.kind === "product").length,
      });
    })();
  }, [ctx.orgId]);

  const K = useMemo(() => {
    if (!plan) return null;
    const cap = planCapacity(plan, planStaff);
    // minuti produttivi trascorsi oggi (Blueprint INV-13): per operatore, dall'apertura, max ore di oggi
    const now = new Date();
    const dow = now.getDay();
    const DAY_KEYS = ["hours_sun","hours_mon","hours_tue","hours_wed","hours_thu","hours_fri","hours_sat"] as const;
    const [oh, om] = opening.split(":").map(Number);
    const open = new Date(now); open.setHours(oh || 8, om || 30, 0, 0);
    const elapsedClock = Math.max(0, (now.getTime() - open.getTime()) / 60000);
    let elapsedProductive = 0;
    for (const s of planStaff.filter(s => s.include_capacity)) {
      const todayHours = Number(s[DAY_KEYS[dow]]) || 0;
      elapsedProductive += Math.min(elapsedClock, todayHours * 60);
    }
    elapsedProductive *= Number(plan.productive_coefficient) || 1;
    const accrued = cap.cam * elapsedProductive;
    return {
      cam: cap.cam,
      accrued,
      elapsedProductive: Math.round(elapsedProductive),
      marginGps: txToday.worked - accrued,     // Margine GPS corrente (Blueprint §21)
      cashNet: txToday.cash - accrued,          // Cassa netta oggi (non è un margine contabile)
      gap: txToday.cash - txToday.worked,
    };
  }, [plan, planStaff, txToday, opening]);

  const setStatus = async (id: string, status: string) => {
    await supabase.from("appointments").update({ status }).eq("id", id);
    setAppts(appts.map(a => a.id === id ? { ...a, status } : a));
  };

  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const arriving = appts.filter(a => a.status === "confirmed");
  const inSala = appts.filter(a => a.status === "checked_in" || a.status === "in_service");
  const done = appts.filter(a => a.status === "completed");
  const noShow = appts.filter(a => a.status === "no_show");

  return (
    <Shell ctx={ctx}>
      <div className="page-head">
        <div>
          <h1>Reception — Torre di Controllo</h1>
          <p className="sub">{new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · apertura {opening}</p>
        </div>
        <Link href="/agenda" className="btn secondary">Apri agenda</Link>
      </div>

      {K ? (
        <div className="grid kpis">
          <div className="card"><div className="kpi-label">Costo al minuto</div><div className="kpi-value">{eur(K.cam, 2)}</div><div className="kpi-note">/min produttivo</div></div>
          <div className="card"><div className="kpi-label">Costo accumulato</div><div className="kpi-value" style={{ color: "#b3402a" }}>{eur(K.accrued, 0)}</div><div className="kpi-note">{num(K.elapsedProductive)} min produttivi trascorsi</div></div>
          <div className="card"><div className="kpi-label">Lavorato oggi</div><div className="kpi-value" style={{ color: "#1e7a4f" }}>{eur(txToday.worked, 0)}</div><div className="kpi-note">{num(txToday.n)} transazioni</div></div>
          <div className="card"><div className="kpi-label">Incassato oggi</div><div className="kpi-value" style={{ color: "#2456c6" }}>{eur(txToday.cash, 0)}</div></div>
          <div className="card gold"><div className="kpi-label">Margine GPS corrente</div><div className="kpi-value">{K.marginGps >= 0 ? "+" : ""}{eur(K.marginGps, 0)}</div><div className="kpi-note">lavorato − costo accumulato</div></div>
          <div className="card"><div className="kpi-label">Cassa netta oggi</div><div className="kpi-value">{K.cashNet >= 0 ? "+" : ""}{eur(K.cashNet, 0)}</div><div className="kpi-note">incassato − costo (non è margine)</div></div>
        </div>
      ) : <div className="alert">Nessun piano attivo: crea o attiva il piano in Pianificazione per vedere CAM e costo accumulato.</div>}

      <div className="two-col section">
        <div className="card">
          <div className="section-title"><h2>In arrivo ({arriving.length})</h2><span className="sub">appuntamenti confermati di oggi</span></div>
          {arriving.length === 0 && <p className="sub">Nessun appuntamento in arrivo.</p>}
          {arriving.map(a => (
            <div className="row" key={a.id}>
              <span><b>{hhmm(a.starts_at)}</b> {a.client_name ?? "—"} <span className="sub">{a.service_name ?? ""}{a.staff_id ? " · " + (staff.find(s => s.id === a.staff_id)?.display_name ?? "") : ""}</span></span>
              <span style={{ display: "flex", gap: 6 }}>
                <button className="btn sm" onClick={() => setStatus(a.id, "checked_in")}>Check-in</button>
                <button className="btn sm secondary" onClick={() => setStatus(a.id, "no_show")}>No-show</button>
              </span>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="section-title"><h2>In sala ({inSala.length})</h2><span className="sub">clienti con check-in</span></div>
          {inSala.length === 0 && <p className="sub">Nessun cliente in sala.</p>}
          {inSala.map(a => (
            <div className="row" key={a.id}>
              <span><b>{hhmm(a.starts_at)}</b> {a.client_name ?? "—"} <span className="sub">{a.staff_id ? staff.find(s => s.id === a.staff_id)?.display_name : "non assegnato"}</span></span>
              <button className="btn sm" onClick={() => setStatus(a.id, "completed")}>Completa ✓</button>
            </div>
          ))}
        </div>
      </div>

      <div className="section card">
        <div className="section-title"><h2>Riepilogo giornata</h2><span className="sub">flusso {done.length}/{appts.length}{noShow.length ? " · " + noShow.length + " no-show" : ""}</span></div>
        <div className="grid kpis">
          <div><div className="kpi-label">Clienti serviti</div><div className="kpi-value" style={{ fontSize: 24 }}>{num(done.length)}</div></div>
          <div><div className="kpi-label">Ticket medio</div><div className="kpi-value" style={{ fontSize: 24 }}>{txToday.n ? eur(txToday.worked / txToday.n, 0) : "—"}</div></div>
          <div><div className="kpi-label">Prodotti venduti</div><div className="kpi-value" style={{ fontSize: 24 }}>{num(txToday.products)}</div></div>
          <div><div className="kpi-label">Scostamento</div><div className="kpi-value" style={{ fontSize: 24, color: (K?.gap ?? 0) >= 0 ? "#1e7a4f" : "#b3402a" }}>{eur(K?.gap ?? 0, 0)}</div><div className="kpi-note">incassato − lavorato</div></div>
        </div>
        <p className="sub" style={{ marginTop: 12 }}>Operatori: {staff.map(s => s.display_name.split(" ")[0]).join(" · ") || "—"} · Le transazioni si registrano nel Registro; il basket operativo per cliente arriva in v2 col workspace operatore.</p>
      </div>
    </Shell>
  );
}
