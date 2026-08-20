"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { planCapacity, staffMonthlyMinutes, weekdayCounts, eur, num, Plan, PlanStaff, staffAvailabilitySplit, occupiedMinutesFor } from "@/lib/gps";
import { normKey } from "@/lib/importer";
import { startAutoSync } from "@/lib/autosync";
import { loadSchedule, Schedule, freezePastDays } from "@/lib/schedule";

type Appt = { id: string; starts_at: string; client_name: string | null; staff_id: string | null; service_name: string | null; status: string; services_done: any[] | null; tech_notes: string | null; personal_notes: string | null; suggested_products: string | null; rebook_note: string | null; booked_value?: number | null; commercial?: any; rebook_days?: number | null; rebook_status?: string | null; rebook_contact_by?: string | null };
type Seg = { id: string; appointment_id: string; staff_id: string; status: string };

export default function Reception() {
  const ctx = useOrg();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planStaff, setPlanStaff] = useState<PlanStaff[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [appts, setAppts] = useState<Appt[]>([]);
  const [segs, setSegs] = useState<Seg[]>([]);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [readyClients, setReadyClients] = useState<Record<string, { client: any; saldo: number; subs: any[] }>>({});
  const [txToday, setTxToday] = useState<{ worked: number; cash: number; n: number; products: number }>({ worked: 0, cash: 0, n: 0, products: 0 });
  const [opening, setOpening] = useState("08:30");
  const [orData, setOrData] = useState<{ perStaff: Record<string, { or: number | null; ot: number }>; salonOr: number | null; totalWeighted: number } | null>(null);
  const [walkin, setWalkin] = useState(false);
  const [followups, setFollowups] = useState<any[]>([]);
  const [sched, setSched] = useState<Schedule | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  const loadAll = async () => {
    if (!ctx.orgId) return;
    {
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
      // Modulo Orari: fonte unica di capacità disponibile/trascorsa; congela la fotografia dei giorni conclusi
      const schedule = await loadSchedule(ctx.orgId!);
      setSched(schedule);
      freezePastDays(ctx.orgId!, schedule, (st ?? []).map((s: any) => s.id)).catch(() => {});
      const { data: ap } = await supabase.from("appointments").select("id,starts_at,client_name,staff_id,service_name,status,services_done,tech_notes,personal_notes,suggested_products,rebook_note,booked_value,commercial,rebook_days,rebook_status,rebook_contact_by")
        .eq("organization_id", ctx.orgId).gte("starts_at", today + "T00:00:00").lte("starts_at", today + "T23:59:59").order("starts_at");
      setAppts((ap ?? []) as any);
      // §14: follow-up "da ricontattare entro" — lista operativa per la reception
      const { data: fu } = await supabase.from("appointments").select("id,client_name,rebook_contact_by,rebook_note")
        .eq("organization_id", ctx.orgId).eq("rebook_status", "followup").order("rebook_contact_by").limit(12);
      setFollowups(fu ?? []);
      const { data: sg } = await supabase.from("visit_segments").select("id,appointment_id,staff_id,status")
        .eq("organization_id", ctx.orgId).in("status", ["active", "paused"]);
      setSegs((sg ?? []) as any);
      const { data: cat } = await supabase.from("catalog_items").select("id,name,price,kind,duration_min,category,stock_qty").eq("organization_id", ctx.orgId).eq("active", true).order("name");
      setCatalog(cat ?? []);

      // §16-17: Occupazione Reale (OR) calcolata da GPS, mai inserita a mano
      if (p) {
        const { data: psRows } = await supabase.from("plan_staff").select("*").eq("plan_id", p.id);
        const { data: sgm } = await supabase.from("visit_segments").select("staff_id,status,started_at,ended_at,active_minutes")
          .eq("organization_id", ctx.orgId).gte("started_at", month + "-01T00:00:00");
        const { data: txm } = await supabase.from("transactions").select("staff_id,catalog_item_id,kind")
          .eq("organization_id", ctx.orgId).eq("status", "completed").gte("tx_date", month + "-01");
        const durByItem = Object.fromEntries((cat ?? []).map((c: any) => [c.id, Number(c.duration_min) || 0]));
        const perStaff: Record<string, { or: number | null; ot: number }> = {};
        let occTot = 0, elapsedTot = 0, totalWeighted = 0;
        for (const row of (psRows ?? []) as any[]) {
          if (!row.include_capacity) continue;
          // fonte capacità: modulo Orari se configurato (fasce reali, snapshot per i giorni chiusi), altrimenti griglia ore
          const split = schedule.configured ? schedule.staffMonth(row.staff_id, p.month) : staffAvailabilitySplit(row, p.month);
          const w = (Number(row.capacity_pct ?? 100)) / 100;
          totalWeighted += split.total * w;
          if (split.total <= 0) continue;
          const occ = occupiedMinutesFor(row.staff_id, (sgm ?? []) as any, (txm ?? []) as any, durByItem);
          perStaff[row.staff_id] = {
            or: split.elapsed > 60 ? occ / split.elapsed : null,
            ot: Number(row.occupancy_target_pct ?? 75),
          };
          occTot += occ; elapsedTot += split.elapsed * w;
        }
        setOrData({ perStaff, salonOr: elapsedTot > 60 ? occTot / elapsedTot : null, totalWeighted });
      }
      // schede + saldo credito dei clienti con scheda inviata
      const readyNames = ((ap ?? []) as Appt[]).filter(a => a.status === "ready" && a.client_name).map(a => a.client_name!);
      const keys = Array.from(new Set(readyNames.map(n => normKey(n))));
      if (keys.length) {
        const { data: cls } = await supabase.from("clients").select("id,full_name,normalized_key,visits_count,total_value,last_visit,segment")
          .eq("organization_id", ctx.orgId).in("normalized_key", keys);
        const ids = (cls ?? []).map((c: any) => c.id);
        const { data: subs } = ids.length ? await supabase.from("subscriptions")
          .select("*").eq("organization_id", ctx.orgId).in("client_id", ids).eq("status", "active") : { data: [] } as any;
        const map: Record<string, { client: any; saldo: number; subs: any[] }> = {};
        for (const c of (cls ?? []) as any[]) {
          const { data: wm } = await supabase.from("wallet_movements").select("amount").eq("client_id", c.id);
          map[c.normalized_key] = {
            client: c,
            saldo: (wm ?? []).reduce((x: number, m: any) => x + Number(m.amount), 0),
            subs: ((subs ?? []) as any[]).filter(s => s.client_id === c.id && Number(s.sessions_used) < Number(s.sessions_total)),
          };
        }
        setReadyClients(map);
      }
      const { data: tx } = await supabase.from("transactions").select("worked_value,cash_value,kind,status").eq("organization_id", ctx.orgId).eq("tx_date", today);
      const done = (tx ?? []).filter((t: any) => t.status === "completed");
      setTxToday({
        worked: done.reduce((a: number, t: any) => a + Number(t.worked_value), 0),
        cash: done.reduce((a: number, t: any) => a + Number(t.cash_value), 0),
        n: done.length,
        products: done.filter((t: any) => t.kind === "product").length,
      });
    }
  };

  useEffect(() => { loadAll(); }, [ctx.orgId]);
  // §5: agenda sempre fresca — sync automatico in background + refresh periodico della torre di controllo
  useEffect(() => { if (ctx.orgId) return startAutoSync(ctx.orgId, loadAll); }, [ctx.orgId]);
  useEffect(() => {
    if (!ctx.orgId) return;
    const t = setInterval(loadAll, 120000);
    return () => clearInterval(t);
  }, [ctx.orgId]);

  const K = useMemo(() => {
    if (!plan) return null;
    let cap = planCapacity(plan, planStaff);
    if (sched?.configured) {
      // CAM allineato al modulo Orari (stessa fonte della Pianificazione)
      const coeff = Number(plan.productive_coefficient) || 1;
      const weighted = planStaff.filter(s => s.include_capacity)
        .reduce((a, s) => a + sched.staffMonth(s.staff_id, plan.month).total * ((Number((s as any).capacity_pct ?? 100)) / 100), 0);
      const pm = Math.round(weighted * coeff);
      if (pm > 0) cap = { ...cap, productiveMinutes: pm, cam: Number(plan.monthly_total) / pm, hourlyValue: (Number(plan.monthly_total) / pm) * 60 };
    }
    // minuti produttivi trascorsi oggi (Blueprint INV-13): per operatore, dall'apertura, max ore di oggi
    const now = new Date();
    const dow = now.getDay();
    const DAY_KEYS = ["hours_sun","hours_mon","hours_tue","hours_wed","hours_thu","hours_fri","hours_sat"] as const;
    const [oh, om] = opening.split(":").map(Number);
    const open = new Date(now); open.setHours(oh || 8, om || 30, 0, 0);
    const elapsedClock = Math.max(0, (now.getTime() - open.getTime()) / 60000);
    let elapsedProductive = 0;
    if (sched?.configured) {
      // spec Dimitar: il costo accumulato dipende dai MINUTI-OPERATORE davvero disponibili
      // (fasce individuali ∩ apertura salone), non dai minuti dall'apertura del locale
      for (const s of planStaff.filter(s => s.include_capacity)) {
        elapsedProductive += sched.staffTodayElapsed(s.staff_id) * ((Number((s as any).capacity_pct ?? 100)) / 100);
      }
    } else {
      for (const s of planStaff.filter(s => s.include_capacity)) {
        const todayHours = Number(s[DAY_KEYS[dow]]) || 0;
        elapsedProductive += Math.min(elapsedClock, todayHours * 60);
      }
    }
    elapsedProductive *= Number(plan.productive_coefficient) || 1;
    const accrued = cap.cam * elapsedProductive;
    // §18: CAM real time — indicatore diagnostico (la bussola resta il CAM pianificato).
    // Proietta i minuti produttivi del mese all'occupazione reale osservata.
    const camRt = orData?.salonOr && orData.totalWeighted > 0
      ? Number(plan.monthly_total) / (orData.totalWeighted * orData.salonOr)
      : null;
    return {
      cam: cap.cam,
      camRt,
      accrued,
      elapsedProductive: Math.round(elapsedProductive),
      marginGps: txToday.worked - accrued,     // Margine GPS corrente (Blueprint §21)
      cashNet: txToday.cash - accrued,          // Cassa netta oggi (non è un margine contabile)
      gap: txToday.cash - txToday.worked,
    };
  }, [plan, planStaff, txToday, opening, orData, sched]);

  const setStatus = async (id: string, status: string) => {
    // il no-show è valido solo su un appuntamento non ancora preso in carico (idempotenza KPI)
    const q = supabase.from("appointments").update({ status }).eq("id", id);
    const { data } = await (status === "no_show" ? q.eq("status", "confirmed") : q).select("id");
    if (data && data.length) setAppts(appts.map(a => a.id === id ? { ...a, status } : a));
    else loadAll();
  };

  // Chiusura vendita (Blueprint §16 + spec §20-24): lavorato pieno, incassato reale,
  // credito e abbonamenti separati — "credito caricato" non è MAI un incasso automatico.
  const finalizeSale = async (a: Appt, items: any[], creditUsed: number, cashPaid: number,
    recharge: { loaded: number; paid: number; method: string } | null) => {
    // IDEMPOTENZA (bug fix): la chiusura "prenota" la visita con un update condizionale.
    // Se la scheda non è più "ready" (già chiusa altrove o doppio click), NESSUN movimento
    // economico viene generato: niente doppi incassi, passaggi, scarichi credito o bonus.
    const { data: claimed } = await supabase.from("appointments")
      .update({ status: "completed" }).eq("id", a.id).eq("status", "ready").select("id");
    if (!claimed || claimed.length === 0) {
      window.alert("Questa scheda risulta già chiusa: nessun movimento è stato duplicato.");
      window.location.reload();
      return;
    }
    // §5/§18: nel conto entrano SOLO i servizi finali erogati e i prodotti confermati —
    // mai i servizi sostituiti/eliminati (restano come storico per i KPI)
    const sold = items.filter(it => !it.proposed && !it.rejected && !it.removed && it.change_type !== "removed");
    const worked = sold.reduce((x, it) => x + (Number(it.price) || 0), 0);

    // cliente = asset dinamico: risolto PRIMA così le transazioni portano il suo id
    const key = a.client_name ? normKey(a.client_name) : null;
    let clientId = key ? readyClients[key]?.client?.id ?? null : null;
    if (clientId) {
      const c = readyClients[key!].client;
      await supabase.from("clients").update({
        visits_count: Number(c.visits_count) + 1,
        total_value: Number(c.total_value) + worked,
        last_visit: today, recency_days: 0, at_risk: false, data_quality: "observed",
      }).eq("id", clientId);
    } else if (a.client_name) {
      const { data: nc } = await supabase.from("clients").insert({
        organization_id: ctx.orgId, full_name: a.client_name, normalized_key: key,
        visits_count: 1, total_value: worked, last_visit: today, recency_days: 0,
        segment: "nuovo", data_quality: "observed",
      }).select().single();
      clientId = nc?.id ?? null;
    }

    if (sold.length) {
      // §23-24: gli item coperti da abbonamento valgono come lavorato ma NON generano incasso oggi
      const cashItems = sold.filter(it => !it.sub_id);
      const cashBase = cashItems.reduce((x, it) => x + (Number(it.price) || 0), 0);
      let cashLeft = cashPaid;
      const rows = sold.map(it => {
        let cash = 0;
        if (!it.sub_id && cashBase > 0) {
          const share = (Number(it.price) || 0) / cashBase;
          cash = it === cashItems[cashItems.length - 1] ? Math.round(cashLeft * 100) / 100 : Math.round(cashPaid * share * 100) / 100;
          cashLeft -= cash;
        }
        const catMatch = catalog.find((c: any) => normKey(c.name) === normKey(it.name ?? ""));
        // §11-12: una sola origine commerciale per riga — operatore o reception, mai doppia
        const origin = it.origin ?? "booked";
        const byReception = origin === "reception_addition";
        return {
          organization_id: ctx.orgId, tx_date: today,
          description: (it.name ?? "Servizio") + " — " + (a.client_name ?? "") + (it.sub_id ? " (abbonamento)" : ""),
          worked_value: Number(it.price) || 0, cash_value: cash,
          kind: it.kind === "product" ? "product" : "service",
          staff_id: byReception ? null : (it.staff_id ?? a.staff_id ?? null), client_id: clientId,
          catalog_item_id: catMatch?.id ?? null, data_quality: "observed",
          origin, sold_by_role: byReception ? "reception" : "operator",
        };
      });
      await supabase.from("transactions").insert(rows);
      // magazzino: ogni prodotto venduto scarica 1 pezzo dalla giacenza
      for (const it of sold.filter(x => x.kind === "product")) {
        const cm = catalog.find((c: any) => normKey(c.name) === normKey(it.name ?? ""));
        if (cm) {
          const { data: cur } = await supabase.from("catalog_items").select("stock_qty").eq("id", cm.id).single();
          if (cur) await supabase.from("catalog_items").update({ stock_qty: Math.max(0, Number(cur.stock_qty) - 1) }).eq("id", cm.id);
        }
      }
    }
    if (creditUsed > 0 && clientId) {
      // §23: usare la card scala credito e debito operativo, NON genera incasso oggi
      await supabase.from("wallet_movements").insert({
        organization_id: ctx.orgId, client_id: clientId, kind: "use",
        amount: -creditUsed, paid_amount: 0, note: "Utilizzo credito in visita", appointment_id: a.id, created_by: ctx.userId ?? null,
      });
    }
    // §22: nuova ricarica in chiusura — credito caricato ≠ incassato (il bonus promo è la differenza)
    if (recharge && recharge.loaded > 0 && clientId) {
      await supabase.from("wallet_movements").insert({
        organization_id: ctx.orgId, client_id: clientId, kind: "recharge",
        amount: recharge.loaded, paid_amount: recharge.paid, method: recharge.method,
        note: recharge.loaded > recharge.paid ? "Ricarica con bonus promo " + (recharge.loaded - recharge.paid) + "€" : "Ricarica card",
        appointment_id: a.id, created_by: ctx.userId ?? null,
      });
      await supabase.from("transactions").insert({
        organization_id: ctx.orgId, tx_date: today,
        description: "Ricarica card — " + (a.client_name ?? "") + " (" + recharge.method + ")",
        worked_value: 0, cash_value: recharge.paid, kind: "recharge",
        staff_id: null, client_id: clientId, data_quality: "observed",
      });
    }
    // §24: scala le sessioni degli abbonamenti usati
    const subCounts: Record<string, number> = {};
    for (const it of sold) if (it.sub_id) subCounts[it.sub_id] = (subCounts[it.sub_id] ?? 0) + 1;
    for (const [subId, n] of Object.entries(subCounts)) {
      const { data: sub } = await supabase.from("subscriptions").select("sessions_used").eq("id", subId).single();
      if (sub) await supabase.from("subscriptions").update({ sessions_used: Number(sub.sessions_used) + n }).eq("id", subId);
    }
    // KPI commerciali (§16-17): prodotti attribuiti a chi ha generato la vendita
    const prodOperator = sold.filter(it => it.kind === "product" && it.origin === "operator_proposal").reduce((x, it) => x + (Number(it.price) || 0), 0);
    const prodReception = sold.filter(it => it.kind === "product" && it.origin === "reception_addition").reduce((x, it) => x + (Number(it.price) || 0), 0);
    await supabase.from("appointments").update({
      status: "completed", services_done: items,
      commercial: { ...(a.commercial ?? {}), prod_operator: prodOperator, prod_reception: prodReception },
    }).eq("id", a.id);
    window.location.reload();
  };

  // §14: stati rebooking assegnati dalla reception
  const setRebook = async (a: Appt, status: string, contactBy?: string) => {
    await supabase.from("appointments").update({ rebook_status: status, rebook_contact_by: contactBy ?? null }).eq("id", a.id);
    setAppts(appts.map(x => x.id === a.id ? { ...x, rebook_status: status, rebook_contact_by: contactBy ?? null } : x));
  };

  const staffState = (sid: string) => {
    const act = segs.find(s => s.staff_id === sid && s.status === "active");
    if (act) { const a = appts.find(x => x.id === act.appointment_id); return { label: "Occupato · " + (a?.client_name ?? "cliente"), color: "#b3402a" }; }
    const pau = segs.filter(s => s.staff_id === sid && s.status === "paused");
    if (pau.length) return { label: "Libero · " + pau.length + " in posa", color: "#8a6d0d" };
    return { label: "Libero", color: "#1e7a4f" };
  };

  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const arriving = appts.filter(a => a.status === "confirmed");
  const inSala = appts.filter(a => ["checked_in", "in_service", "paused"].includes(a.status));
  const ready = appts.filter(a => a.status === "ready");
  const done = appts.filter(a => a.status === "completed");
  const noShow = appts.filter(a => a.status === "no_show");

  return (
    <Shell ctx={ctx}>
      <div className="page-head">
        <div>
          <h1>Reception — Torre di Controllo</h1>
          <p className="sub">{new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · apertura {opening}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => setWalkin(!walkin)}>{walkin ? "Chiudi" : "+ Walk-in / Vendita"}</button>
          <Link href="/agenda" className="btn secondary">Apri agenda</Link>
        </div>
      </div>

      {walkin && <WalkinPanel ctx={ctx} staff={staff} catalog={catalog} today={today} onDone={() => { setWalkin(false); loadAll(); }} />}

      {K ? (
        <div className="grid kpis">
          <div className="card"><div className="kpi-label">Costo al minuto</div><div className="kpi-value">{eur(K.cam, 2)}</div><div className="kpi-note">CAM pianificato (bussola){K.camRt ? " · real time " + eur(K.camRt, 2) + (K.camRt > K.cam * 1.05 ? " ⚠" : "") : ""}</div></div>
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
              <span><b>{hhmm(a.starts_at)}</b> {a.client_name ?? "—"} <span className="sub">{a.service_name ?? ""}</span></span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {/* §2: niente check-in — il cliente compare da solo all'operatore. Qui si riassegna e basta. */}
                <select value={a.staff_id ?? ""} title="Cambia operatore"
                  onChange={async e => {
                    const sid = e.target.value || null;
                    await supabase.from("appointments").update({ staff_id: sid }).eq("id", a.id);
                    setAppts(appts.map(x => x.id === a.id ? { ...x, staff_id: sid } : x));
                  }}>
                  <option value="">operatore…</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.display_name.split(" ")[0]}</option>)}
                </select>
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
              <span><b>{hhmm(a.starts_at)}</b> {a.client_name ?? "—"} <span className="sub">{a.status === "in_service" ? "in poltrona" : a.status === "paused" ? "in posa" : "in attesa"}</span></span>
              <select value={a.staff_id ?? ""} title="Cambia operatore"
                onChange={async e => {
                  const sid = e.target.value || null;
                  await supabase.from("appointments").update({ staff_id: sid }).eq("id", a.id);
                  setAppts(appts.map(x => x.id === a.id ? { ...x, staff_id: sid } : x));
                }}>
                <option value="">operatore…</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.display_name.split(" ")[0]}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>

      <div className="section card">
        <div className="section-title"><h2>Collaboratori — stato operativo</h2><span className="sub">dal workspace operatore</span></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {staff.map(s => {
            const st = staffState(s.id);
            const o = orData?.perStaff[s.id];
            const orPct = o?.or != null ? Math.round(o.or * 100) : null;
            const pp = orPct != null && o ? orPct - o.ot : null; // §16: confronto in punti percentuali
            return (
              <span key={s.id} className="card" style={{ padding: "8px 14px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: s.color ?? "#888" }} />
                <b>{s.display_name.split(" ")[0]}</b>
                <span style={{ fontSize: 12.5, color: st.color, fontWeight: 700 }}>{st.label}</span>
                {orPct != null && o && (
                  <span style={{ fontSize: 12, color: "#555" }}>
                    · OR <b>{orPct}%</b> | Target {o.ot}% |{" "}
                    <b style={{ color: (pp ?? 0) >= 0 ? "#1e7a4f" : "#b3402a" }}>{(pp ?? 0) >= 0 ? "+" : ""}{pp} p.p.</b>
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>

      {followups.length > 0 && (
        <div className="section card" style={{ borderColor: "#d9a441" }}>
          <div className="section-title"><h2>⏰ Da ricontattare ({followups.length})</h2><span className="sub">rebooking non chiusi — follow-up operativo</span></div>
          {followups.map(f => (
            <div className="row" key={f.id}>
              <span><b>{f.client_name ?? "Cliente"}</b> <span className="sub">{f.rebook_note ?? ""}</span></span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <b style={{ color: f.rebook_contact_by && f.rebook_contact_by <= today ? "#b3402a" : undefined }}>entro {f.rebook_contact_by ? new Date(f.rebook_contact_by).toLocaleDateString("it-IT") : "—"}</b>
                <button className="btn sm" onClick={async () => { await supabase.from("appointments").update({ rebook_status: "confirmed" }).eq("id", f.id); setFollowups(followups.filter(x => x.id !== f.id)); }}>✓ Prenotato</button>
                <button className="btn sm secondary" onClick={async () => { await supabase.from("appointments").update({ rebook_status: "declined" }).eq("id", f.id); setFollowups(followups.filter(x => x.id !== f.id)); }}>✕</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {ready.length > 0 && (
        <div className="section card" style={{ borderColor: "#c9a227", borderWidth: 2 }}>
          <div className="section-title"><h2>Pronti per la reception ({ready.length})</h2><span className="sub">rivedi la scheda, conferma le proposte, poi chiudi la vendita</span></div>
          {ready.map(a => (
            <CheckoutCard key={a.id} a={a} staff={staff} catalog={catalog}
              wallet={a.client_name ? readyClients[normKey(a.client_name)] ?? null : null}
              onClose={finalizeSale} onRebook={setRebook} />
          ))}
        </div>
      )}

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

function CheckoutCard({ a, staff, catalog, wallet, onClose, onRebook }: {
  a: any; staff: any[]; catalog: any[];
  wallet: { client: any; saldo: number; subs?: any[] } | null;
  onClose: (a: any, items: any[], creditUsed: number, cashPaid: number, recharge: { loaded: number; paid: number; method: string } | null) => Promise<void>;
  onRebook: (a: any, status: string, contactBy?: string) => Promise<void>;
}) {
  const [items, setItems] = useState<any[]>((a.services_done ?? []).map((it: any) => ({ ...it })));
  const [credit, setCredit] = useState(0);
  const [cash, setCash] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [rech, setRech] = useState({ loaded: 0, paid: 0, method: "contanti", touched: false });
  const subs = wallet?.subs ?? [];
  const [fuDate, setFuDate] = useState("");
  const isRemoved = (it: any) => it.removed || it.change_type === "removed";
  const sold = items.filter(it => !it.proposed && !it.rejected && !isRemoved(it));
  const soldTotal = sold.reduce((x, it) => x + (Number(it.price) || 0), 0);
  const subCovered = sold.filter(it => it.sub_id).reduce((x, it) => x + (Number(it.price) || 0), 0);
  const saldo = wallet?.saldo ?? 0;
  const creditOk = Math.min(Math.max(0, credit), Math.min(saldo, soldTotal - subCovered));
  const cashDue = cash != null ? cash : Math.max(0, soldTotal - subCovered - creditOk);
  const opName = (id: string | null) => staff.find((s: any) => s.id === id)?.display_name?.split(" ")[0] ?? "—";
  // sessioni abbonamento ancora assegnabili (residue meno quelle già scelte su altri item)
  const subLeft = (subId: string) => {
    const s = subs.find((x: any) => x.id === subId);
    if (!s) return 0;
    const chosen = items.filter(it => it.sub_id === subId && !it.rejected && !it.proposed).length;
    return Number(s.sessions_total) - Number(s.sessions_used) - chosen;
  };

  return (
    <div className="card" style={{ marginBottom: 12, background: "#faf6ea" }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <b className="serif" style={{ fontSize: 18 }}>{a.client_name ?? "Cliente"}</b>
        <span className="sub">op. {opName(a.staff_id)}{saldo > 0 ? " · credito " + eur(saldo) : ""}{subs.length ? " · " + subs.map((s: any) => s.name + " " + (Number(s.sessions_total) - Number(s.sessions_used)) + "/" + s.sessions_total).join(", ") : ""}</span>
      </div>

      {items.map((it, i) => (
        <div className="row" key={i} style={{ opacity: it.rejected || isRemoved(it) ? .5 : 1 }}>
          <span style={{ textDecoration: it.rejected || isRemoved(it) ? "line-through" : "none" }}>
            {it.kind === "product" ? "🧴" : "✂"} {it.name}
            <span className="sub"> ({it.origin === "reception_addition" ? "reception" : opName(it.staff_id)})</span>
            {it.change_type === "replaced" && <span className="sub" style={{ marginLeft: 6 }}>al posto di {it.replaced_name} ({eur(Number(it.replaced_price), 0)}) — l'originale NON entra nel conto</span>}
            {isRemoved(it) && <span className="badge b-warn" style={{ marginLeft: 6 }}>eliminato — solo storico</span>}
            {/* §4: stati proposta — proposto → venduto / rifiutato (base per i KPI di conversione) */}
            {it.proposed && !it.rejected && (
              <span style={{ marginLeft: 8 }}>
                <span className="badge b-warn">proposto</span>{" "}
                <button className="btn sm" onClick={() => setItems(items.map((x, j) => j === i ? { ...x, proposed: false } : x))}>✓ Venduto</button>{" "}
                <button className="btn sm secondary" onClick={() => setItems(items.map((x, j) => j === i ? { ...x, rejected: true } : x))}>✕ Rifiutato</button>
              </span>
            )}
            {it.rejected && (
              <span style={{ marginLeft: 8 }}>
                <span className="badge b-risk">rifiutato</span>{" "}
                <button className="btn sm secondary" onClick={() => setItems(items.map((x, j) => j === i ? { ...x, rejected: false, proposed: true } : x))}>↩</button>
              </span>
            )}
            {!it.proposed && !it.rejected && !isRemoved(it) && it.kind !== "product" && subs.length > 0 && (
              <label style={{ marginLeft: 8, fontSize: 12.5 }}>
                <input type="checkbox" checked={!!it.sub_id}
                  onChange={e => {
                    if (e.target.checked) {
                      const avail = subs.find((s: any) => subLeft(s.id) > 0);
                      if (avail) setItems(items.map((x, j) => j === i ? { ...x, sub_id: avail.id } : x));
                    } else setItems(items.map((x, j) => j === i ? { ...x, sub_id: null } : x));
                  }} /> abbonamento
              </label>
            )}
          </span>
          <span>
            <input type="number" value={it.price} style={{ width: 76, padding: "3px 6px", textAlign: "right" }}
              onChange={e => setItems(items.map((x, j) => j === i ? { ...x, price: Number(e.target.value) } : x))} />
            {" "}<button className="btn sm secondary" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>
          </span>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0", flexWrap: "wrap" }}>
        <select onChange={e => {
          const it = catalog.find((x: any) => x.id === e.target.value);
          // §11: aggiunta della reception → attribuzione commerciale RECEPTION, mai all'operatore
          if (it) setItems([...items, { name: it.name, price: Number(it.price), kind: it.kind, staff_id: null, proposed: false, origin: "reception_addition", change_type: "added" }]);
          e.target.value = "";
        }}>
          <option value="">+ Aggiungi servizio/prodotto…</option>
          <optgroup label="Servizi">{catalog.filter((x: any) => x.kind === "service").map((x: any) => <option key={x.id} value={x.id}>{x.name} — {eur(Number(x.price))}</option>)}</optgroup>
          <optgroup label="Prodotti">{catalog.filter((x: any) => x.kind === "product").map((x: any) => <option key={x.id} value={x.id}>{x.name} — {eur(Number(x.price))}</option>)}</optgroup>
        </select>
      </div>

      {/* §14: rebooking — la reception assegna lo stato */}
      {(a.rebook_days != null || a.rebook_note) && (
        <div style={{ background: "#eef1f6", border: "1px solid #ccd4e0", borderRadius: 10, padding: "8px 12px", margin: "8px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 13.5 }}>📅 <b>Rebooking suggerito:</b> {a.rebook_days != null ? "rivederlo tra " + a.rebook_days + " giorni" : a.rebook_note}</span>
            {a.rebook_status === "confirmed" && <span className="badge b-ok">confermato ✓</span>}
            {a.rebook_status === "declined" && <span className="badge b-risk">non confermato</span>}
            {a.rebook_status === "followup" && <span className="badge b-warn">ricontattare entro {a.rebook_contact_by ? new Date(a.rebook_contact_by).toLocaleDateString("it-IT") : "…"}</span>}
            {(a.rebook_status === "suggested" || !a.rebook_status) && (
              <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn sm" onClick={() => onRebook(a, "confirmed")}>✓ Confermato</button>
                <button className="btn sm secondary" onClick={() => onRebook(a, "declined")}>✕ Non confermato</button>
                <input type="date" value={fuDate} style={{ padding: "4px 6px" }} onChange={e => setFuDate(e.target.value)} />
                <button className="btn sm secondary" disabled={!fuDate} onClick={() => onRebook(a, "followup", fuDate)}>⏰ Da ricontattare</button>
              </span>
            )}
          </div>
        </div>
      )}
      {a.commercial?.upsell != null && a.commercial.upsell !== 0 && (
        <p style={{ margin: "4px 0", fontSize: 13 }}>
          📈 <b>KPI operatore:</b> prenotato {eur(Number(a.commercial.booked_value ?? 0), 0)} → erogato {eur(Number(a.commercial.final_services ?? 0), 0)} ·{" "}
          <b style={{ color: a.commercial.upsell > 0 ? "#1e7a4f" : "#b3402a" }}>{a.commercial.upsell > 0 ? "up-sell +" : ""}{eur(Number(a.commercial.upsell), 0)}</b>
          <span className="sub"> (solo KPI/bonus — il conto usa l'erogato)</span>
        </p>
      )}
      {a.suggested_products && <p style={{ margin: "4px 0", fontSize: 13.5 }}>🧴 <b>Prodotti proposti dall'operatore:</b> {a.suggested_products}</p>}

      {/* §22: ricarica card in chiusura — credito caricato e pagato sono DUE numeri distinti */}
      <details style={{ margin: "8px 0" }}>
        <summary style={{ cursor: "pointer", fontSize: 13.5 }}>💳 Ricarica card / credito {rech.loaded > 0 ? "· +" + eur(rech.loaded) + " (pagato " + eur(rech.paid) + ")" : ""}</summary>
        <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}>
          <div><label className="fld">Credito caricato €</label>
            <input type="number" min={0} value={rech.loaded || ""} style={{ width: 100 }}
              onChange={e => { const v = Number(e.target.value); setRech({ ...rech, loaded: v, paid: rech.touched ? rech.paid : v }); }} /></div>
          <div><label className="fld">Pagato oggi €</label>
            <input type="number" min={0} value={rech.paid || ""} style={{ width: 100 }}
              onChange={e => setRech({ ...rech, paid: Number(e.target.value), touched: true })} /></div>
          <div><label className="fld">Metodo</label>
            <select value={rech.method} onChange={e => setRech({ ...rech, method: e.target.value })}>
              {["contanti", "carta", "bonifico", "altro"].map(m => <option key={m} value={m}>{m}</option>)}
            </select></div>
          {rech.loaded > rech.paid && rech.loaded > 0 && <span className="badge b-warn">bonus promo {eur(rech.loaded - rech.paid)}</span>}
        </div>
        <p className="sub" style={{ marginTop: 4 }}>Incasso registrato = pagato oggi · debito operativo aumenta del credito caricato. Es. promo: paga 100, caricati 110 → incasso 100, bonus 10.</p>
      </details>

      <div style={{ display: "flex", gap: 14, alignItems: "end", flexWrap: "wrap", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
        <div><div className="kpi-label">Lavorato</div><b style={{ fontSize: 19, color: "#1e7a4f" }}>{eur(soldTotal)}</b></div>
        {subCovered > 0 && <div><div className="kpi-label">Da abbonamento</div><b style={{ fontSize: 16 }}>{eur(subCovered)}</b></div>}
        <div>
          <label className="fld">Credito utilizzato</label>
          <input type="number" min={0} max={Math.min(saldo, soldTotal - subCovered)} value={credit} disabled={saldo <= 0}
            style={{ width: 100 }} onChange={e => { setCredit(Number(e.target.value)); setCash(null); }} />
        </div>
        <div>
          <label className="fld">Incassato ora €</label>
          <input type="number" min={0} value={Math.round(cashDue * 100) / 100} style={{ width: 100 }}
            onChange={e => setCash(Number(e.target.value))} />
        </div>
        {cashDue + creditOk + subCovered < soldTotal && <span className="badge b-warn">sconto {eur(soldTotal - cashDue - creditOk - subCovered)}</span>}
        <span style={{ flex: 1 }} />
        <button className="btn" disabled={busy || (sold.length === 0 && rech.loaded <= 0)}
          onClick={async () => { setBusy(true); await onClose(a, items, creditOk, cashDue, rech.loaded > 0 ? { loaded: rech.loaded, paid: rech.paid, method: rech.method } : null); }}>
          {busy ? "Chiudo…" : "💰 Chiudi vendita"}
        </button>
      </div>
      <p className="sub" style={{ marginTop: 6 }}>Lavorato = valore pieno erogato · Incassato = denaro ricevuto ora · credito e abbonamenti scalano dai saldi del cliente, mai dall'incasso. Le proposte rifiutate restano registrate per i KPI di conversione.</p>
    </div>
  );
}

// §3 spec Dimitar: la Reception è un punto vendita, non solo la chiusura degli appuntamenti.
// A) Walk-in per servizio → entra nel flusso operatore. B) Vendita diretta senza appuntamento.
function WalkinPanel({ ctx, staff, catalog, today, onDone }: {
  ctx: any; staff: any[]; catalog: any[]; today: string; onDone: () => void;
}) {
  const [mode, setMode] = useState<"servizio" | "vendita">("servizio");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<any[]>([]);
  const [chosen, setChosen] = useState<any | null>(null);
  const [svc, setSvc] = useState("");
  const [op, setOp] = useState("");
  const [when, setWhen] = useState("adesso");
  const [time, setTime] = useState(new Date().toTimeString().slice(0, 5));
  const [items, setItems] = useState<any[]>([]);
  const [rech, setRech] = useState({ loaded: 0, paid: 0, method: "contanti", riporto: false, touched: false });
  const [cash, setCash] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const search = async (text: string) => {
    setQ(text); setChosen(null);
    if (text.trim().length < 2) { setHits([]); return; }
    const { data } = await supabase.from("clients").select("id,full_name,normalized_key,visits_count,total_value,segment")
      .eq("organization_id", ctx.orgId).ilike("full_name", "%" + text.trim() + "%").limit(8);
    setHits(data ?? []);
  };
  const clientName = chosen?.full_name ?? q.trim();

  const resolveClient = async (worked: number) => {
    if (chosen) {
      await supabase.from("clients").update({
        visits_count: Number(chosen.visits_count) + (worked > 0 ? 1 : 0),
        total_value: Number(chosen.total_value) + worked,
        last_visit: worked > 0 ? today : undefined, recency_days: worked > 0 ? 0 : undefined,
        at_risk: false, data_quality: "observed",
      } as any).eq("id", chosen.id);
      return chosen.id;
    }
    if (!clientName) return null;
    const { data: nc } = await supabase.from("clients").insert({
      organization_id: ctx.orgId, full_name: clientName, normalized_key: normKey(clientName),
      visits_count: worked > 0 ? 1 : 0, total_value: worked, last_visit: worked > 0 ? today : null,
      recency_days: 0, segment: "nuovo", data_quality: "observed",
    }).select().single();
    return nc?.id ?? null;
  };

  const createWalkin = async () => {
    if (!clientName || !op) { setMsg("Serve almeno il nome del cliente e l'operatore."); return; }
    setBusy(true); setMsg(null);
    const starts = when === "adesso" ? new Date() : new Date(today + "T" + time + ":00");
    await supabase.from("appointments").insert({
      organization_id: ctx.orgId, starts_at: starts.toISOString(),
      client_name: clientName, staff_id: op, service_name: svc || null,
      status: "confirmed", source_system: "walkin",
    });
    setBusy(false);
    onDone();
  };

  const sellTotal = items.reduce((x, it) => x + (Number(it.price) || 0), 0);
  const cashDue = cash != null ? cash : sellTotal;

  const createSale = async () => {
    const loaded = rech.riporto ? rech.loaded : rech.loaded;
    const paid = rech.riporto ? 0 : rech.paid;
    if (items.length === 0 && loaded <= 0) { setMsg("Aggiungi almeno un articolo o una ricarica."); return; }
    if (loaded > 0 && !clientName) { setMsg("Per credito/ricariche serve il cliente."); return; }
    setBusy(true); setMsg(null);
    const worked = sellTotal; // vendita diretta: tutto venduto, niente proposte
    const clientId = await resolveClient(worked);
    if (items.length) {
      let cashLeft = cashDue;
      const rows = items.map((it, i) => {
        const share = sellTotal > 0 ? (Number(it.price) || 0) / sellTotal : 0;
        const c = i === items.length - 1 ? Math.round(cashLeft * 100) / 100 : Math.round(cashDue * share * 100) / 100;
        cashLeft -= c;
        return {
          organization_id: ctx.orgId, tx_date: today,
          description: it.name + " — vendita diretta" + (clientName ? " (" + clientName + ")" : ""),
          worked_value: Number(it.price) || 0, cash_value: c,
          kind: it.kind === "product" ? "product" : "service",
          staff_id: it.staff_id || null, client_id: clientId,
          catalog_item_id: it.catalog_item_id ?? null, data_quality: "observed",
        };
      });
      await supabase.from("transactions").insert(rows);
      for (const it of items.filter(x => x.kind === "product" && x.catalog_item_id)) {
        const { data: cur } = await supabase.from("catalog_items").select("stock_qty").eq("id", it.catalog_item_id).single();
        if (cur) await supabase.from("catalog_items").update({ stock_qty: Math.max(0, Number(cur.stock_qty) - 1) }).eq("id", it.catalog_item_id);
      }
    }
    if (loaded > 0 && clientId) {
      // §20-21: caricato ≠ incassato; il "riporto saldo iniziale" incassa SEMPRE zero
      await supabase.from("wallet_movements").insert({
        organization_id: ctx.orgId, client_id: clientId, kind: "recharge",
        amount: loaded, paid_amount: paid, method: rech.riporto ? "riporto" : rech.method,
        note: rech.riporto ? "Riporto saldo card pre-GPS" : loaded > paid ? "Ricarica con bonus promo " + (loaded - paid) + "€" : "Ricarica card",
        created_by: ctx.userId ?? null,
      });
      await supabase.from("transactions").insert({
        organization_id: ctx.orgId, tx_date: today,
        description: (rech.riporto ? "Riporto saldo card (nessun incasso)" : "Ricarica card") + " — " + clientName,
        worked_value: 0, cash_value: paid, kind: "recharge",
        client_id: clientId, data_quality: "observed",
      });
    }
    setBusy(false);
    onDone();
  };

  return (
    <div className="card section" style={{ borderColor: "#c9a227", borderWidth: 2, marginBottom: 18 }}>
      <div className="section-title">
        <h2>Nuovo walk-in / vendita</h2>
        <span style={{ display: "flex", gap: 6 }}>
          <button className={"chip" + (mode === "servizio" ? " on" : "")} onClick={() => setMode("servizio")}>✂ Walk-in servizio</button>
          <button className={"chip" + (mode === "vendita" ? " on" : "")} onClick={() => setMode("vendita")}>🛍 Vendita / ricarica</button>
        </span>
      </div>
      {msg && <div className="alert err">{msg}</div>}

      <div style={{ position: "relative", marginBottom: 10 }}>
        <label className="fld">Cliente (cerca o scrivi un nome nuovo)</label>
        <input style={{ width: "100%" }} value={chosen ? chosen.full_name : q} onChange={e => search(e.target.value)} placeholder="es. Rossi…" />
        {hits.length > 0 && !chosen && (
          <div className="card" style={{ position: "absolute", zIndex: 5, width: "100%", maxHeight: 220, overflow: "auto", padding: 6 }}>
            {hits.map(h => (
              <div key={h.id} className="row" style={{ cursor: "pointer" }} onClick={() => { setChosen(h); setHits([]); }}>
                <span><b>{h.full_name}</b> <span className="sub">{num(h.visits_count)} passaggi</span></span>
                <span className={"badge b-" + (h.segment ?? "base")}>{h.segment ?? "—"}</span>
              </div>
            ))}
          </div>
        )}
        {chosen && <p className="sub" style={{ marginTop: 4 }}>Scheda esistente selezionata ✓ <button className="btn sm secondary" onClick={() => { setChosen(null); setQ(""); }}>cambia</button></p>}
        {!chosen && q.trim().length >= 2 && hits.length === 0 && <p className="sub" style={{ marginTop: 4 }}>Nessuna scheda trovata: verrà creata "{q.trim()}".</p>}
      </div>

      {mode === "servizio" ? (
        <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
          <div><label className="fld">Servizio</label>
            <select value={svc} onChange={e => setSvc(e.target.value)}>
              <option value="">da definire in poltrona</option>
              {catalog.filter((x: any) => x.kind === "service").map((x: any) => <option key={x.id} value={x.name}>{x.name}</option>)}
            </select></div>
          <div><label className="fld">Operatore</label>
            <select value={op} onChange={e => setOp(e.target.value)}>
              <option value="">scegli…</option>
              {staff.map((s: any) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
            </select></div>
          <div><label className="fld">Quando</label>
            <select value={when} onChange={e => setWhen(e.target.value)}>
              <option value="adesso">inizio immediato</option>
              <option value="orario">a un orario di oggi</option>
            </select></div>
          {when === "orario" && <div><label className="fld">Ore</label><input type="time" value={time} onChange={e => setTime(e.target.value)} /></div>}
          <button className="btn" disabled={busy} onClick={createWalkin}>{busy ? "…" : "▶ Manda in coda all'operatore"}</button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <select onChange={e => {
              const it = catalog.find((x: any) => x.id === e.target.value);
              if (it) setItems([...items, { name: it.name, price: Number(it.price), kind: it.kind, catalog_item_id: it.id, staff_id: "" }]);
              e.target.value = "";
            }}>
              <option value="">+ Aggiungi prodotto/servizio…</option>
              <optgroup label="Prodotti">{catalog.filter((x: any) => x.kind === "product").map((x: any) => <option key={x.id} value={x.id}>{x.name} — {eur(Number(x.price))}</option>)}</optgroup>
              <optgroup label="Servizi">{catalog.filter((x: any) => x.kind === "service").map((x: any) => <option key={x.id} value={x.id}>{x.name} — {eur(Number(x.price))}</option>)}</optgroup>
            </select>
          </div>
          {items.map((it, i) => (
            <div className="row" key={i}>
              <span>{it.kind === "product" ? "🧴" : "✂"} {it.name}
                <select style={{ marginLeft: 8 }} value={it.staff_id} onChange={e => setItems(items.map((x, j) => j === i ? { ...x, staff_id: e.target.value } : x))}>
                  <option value="">op. —</option>
                  {staff.map((s: any) => <option key={s.id} value={s.id}>{s.display_name.split(" ")[0]}</option>)}
                </select>
              </span>
              <span>
                <input type="number" value={it.price} style={{ width: 76, padding: "3px 6px", textAlign: "right" }}
                  onChange={e => setItems(items.map((x, j) => j === i ? { ...x, price: Number(e.target.value) } : x))} />
                {" "}<button className="btn sm secondary" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>
              </span>
            </div>
          ))}
          <div style={{ background: "#f7f3ea", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", margin: "10px 0" }}>
            <div className="kpi-label" style={{ marginBottom: 6 }}>Credito / card</div>
            <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
              <label style={{ fontSize: 13 }}><input type="checkbox" checked={rech.riporto} onChange={e => setRech({ ...rech, riporto: e.target.checked, paid: e.target.checked ? 0 : rech.paid })} /> Riporto saldo iniziale (pre-GPS, incasso 0)</label>
              <div><label className="fld">Credito caricato €</label>
                <input type="number" min={0} value={rech.loaded || ""} style={{ width: 100 }}
                  onChange={e => { const v = Number(e.target.value); setRech({ ...rech, loaded: v, paid: rech.riporto ? 0 : (rech.touched ? rech.paid : v) }); }} /></div>
              <div><label className="fld">Pagato oggi €</label>
                <input type="number" min={0} value={rech.riporto ? 0 : (rech.paid || "")} disabled={rech.riporto} style={{ width: 100 }}
                  onChange={e => setRech({ ...rech, paid: Number(e.target.value), touched: true })} /></div>
              <div><label className="fld">Metodo</label>
                <select value={rech.method} disabled={rech.riporto} onChange={e => setRech({ ...rech, method: e.target.value })}>
                  {["contanti", "carta", "bonifico", "altro"].map(m => <option key={m} value={m}>{m}</option>)}
                </select></div>
              {!rech.riporto && rech.loaded > rech.paid && rech.loaded > 0 && <span className="badge b-warn">bonus promo {eur(rech.loaded - rech.paid)}</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "end", flexWrap: "wrap" }}>
            <div><div className="kpi-label">Articoli</div><b style={{ fontSize: 18 }}>{eur(sellTotal)}</b></div>
            <div><label className="fld">Incassato articoli €</label>
              <input type="number" min={0} value={Math.round(cashDue * 100) / 100} style={{ width: 100 }} onChange={e => setCash(Number(e.target.value))} /></div>
            <div><div className="kpi-label">Incasso totale oggi</div><b style={{ fontSize: 18, color: "#2456c6" }}>{eur(cashDue + (rech.riporto ? 0 : rech.paid))}</b></div>
            <span style={{ flex: 1 }} />
            <button className="btn" disabled={busy} onClick={createSale}>{busy ? "…" : "💰 Registra vendita"}</button>
          </div>
          <p className="sub" style={{ marginTop: 6 }}>Pacchetti e abbonamenti nuovi si creano dalla scheda cliente (Clienti → drawer): qui la vendita diretta copre prodotti, servizi e ricariche.</p>
        </>
      )}
    </div>
  );
}
