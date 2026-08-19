"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { planCapacity, staffMonthlyMinutes, weekdayCounts, eur, num, Plan, PlanStaff } from "@/lib/gps";
import { normKey } from "@/lib/importer";

type Appt = { id: string; starts_at: string; client_name: string | null; staff_id: string | null; service_name: string | null; status: string; services_done: any[] | null; tech_notes: string | null; personal_notes: string | null; suggested_products: string | null; rebook_note: string | null };
type Seg = { id: string; appointment_id: string; staff_id: string; status: string };

export default function Reception() {
  const ctx = useOrg();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planStaff, setPlanStaff] = useState<PlanStaff[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [appts, setAppts] = useState<Appt[]>([]);
  const [segs, setSegs] = useState<Seg[]>([]);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [readyClients, setReadyClients] = useState<Record<string, { client: any; saldo: number }>>({});
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
      const { data: ap } = await supabase.from("appointments").select("id,starts_at,client_name,staff_id,service_name,status,services_done,tech_notes,personal_notes,suggested_products,rebook_note")
        .eq("organization_id", ctx.orgId).gte("starts_at", today + "T00:00:00").lte("starts_at", today + "T23:59:59").order("starts_at");
      setAppts((ap ?? []) as any);
      const { data: sg } = await supabase.from("visit_segments").select("id,appointment_id,staff_id,status")
        .eq("organization_id", ctx.orgId).in("status", ["active", "paused"]);
      setSegs((sg ?? []) as any);
      const { data: cat } = await supabase.from("catalog_items").select("id,name,price,kind").eq("organization_id", ctx.orgId).eq("active", true);
      setCatalog(cat ?? []);
      // schede + saldo credito dei clienti con scheda inviata
      const readyNames = ((ap ?? []) as Appt[]).filter(a => a.status === "ready" && a.client_name).map(a => a.client_name!);
      const keys = Array.from(new Set(readyNames.map(n => normKey(n))));
      if (keys.length) {
        const { data: cls } = await supabase.from("clients").select("id,full_name,normalized_key,visits_count,total_value,last_visit,segment")
          .eq("organization_id", ctx.orgId).in("normalized_key", keys);
        const map: Record<string, { client: any; saldo: number }> = {};
        for (const c of (cls ?? []) as any[]) {
          const { data: wm } = await supabase.from("wallet_movements").select("amount").eq("client_id", c.id);
          map[c.normalized_key] = { client: c, saldo: (wm ?? []).reduce((x: number, m: any) => x + Number(m.amount), 0) };
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

  // Chiusura vendita (Blueprint §16): lavorato pieno, incassato reale, credito separato — mai confusi
  const finalizeSale = async (a: Appt, items: any[], creditUsed: number, cashPaid: number) => {
    const sold = items.filter(it => !it.proposed); // le proposte non confermate NON diventano vendite
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
      let cashLeft = cashPaid;
      const rows = sold.map((it, i) => {
        const share = worked > 0 ? (Number(it.price) || 0) / worked : 0;
        const cash = i === sold.length - 1 ? Math.round(cashLeft * 100) / 100 : Math.round(cashPaid * share * 100) / 100;
        cashLeft -= cash;
        const catMatch = catalog.find((c: any) => normKey(c.name) === normKey(it.name ?? ""));
        return {
          organization_id: ctx.orgId, tx_date: today,
          description: (it.name ?? "Servizio") + " — " + (a.client_name ?? ""),
          worked_value: Number(it.price) || 0, cash_value: cash,
          kind: it.kind === "product" ? "product" : "service",
          staff_id: it.staff_id ?? a.staff_id ?? null, client_id: clientId,
          catalog_item_id: catMatch?.id ?? null, data_quality: "observed",
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
      await supabase.from("wallet_movements").insert({
        organization_id: ctx.orgId, client_id: clientId, kind: "use",
        amount: -creditUsed, note: "Utilizzo credito in visita", appointment_id: a.id, created_by: ctx.userId ?? null,
      });
    }
    await supabase.from("appointments").update({ status: "completed", services_done: items }).eq("id", a.id);
    window.location.reload();
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
        <div className="section-title"><h2>Collaboratori — stato operativo</h2><span className="sub">dal workspace operatore</span></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {staff.map(s => {
            const st = staffState(s.id);
            return (
              <span key={s.id} className="card" style={{ padding: "8px 14px", display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: s.color ?? "#888" }} />
                <b>{s.display_name.split(" ")[0]}</b>
                <span style={{ fontSize: 12.5, color: st.color, fontWeight: 700 }}>{st.label}</span>
              </span>
            );
          })}
        </div>
      </div>

      {ready.length > 0 && (
        <div className="section card" style={{ borderColor: "#c9a227", borderWidth: 2 }}>
          <div className="section-title"><h2>Pronti per la reception ({ready.length})</h2><span className="sub">rivedi la scheda, conferma le proposte, poi chiudi la vendita</span></div>
          {ready.map(a => (
            <CheckoutCard key={a.id} a={a} staff={staff} catalog={catalog}
              wallet={a.client_name ? readyClients[normKey(a.client_name)] ?? null : null}
              onClose={finalizeSale} />
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

function CheckoutCard({ a, staff, catalog, wallet, onClose }: {
  a: any; staff: any[]; catalog: any[];
  wallet: { client: any; saldo: number } | null;
  onClose: (a: any, items: any[], creditUsed: number, cashPaid: number) => Promise<void>;
}) {
  const [items, setItems] = useState<any[]>((a.services_done ?? []).map((it: any) => ({ ...it })));
  const [credit, setCredit] = useState(0);
  const [cash, setCash] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const soldTotal = items.filter(it => !it.proposed).reduce((x, it) => x + (Number(it.price) || 0), 0);
  const saldo = wallet?.saldo ?? 0;
  const creditOk = Math.min(Math.max(0, credit), Math.min(saldo, soldTotal));
  const cashDue = cash != null ? cash : Math.max(0, soldTotal - creditOk);
  const opName = (id: string | null) => staff.find((s: any) => s.id === id)?.display_name?.split(" ")[0] ?? "—";

  return (
    <div className="card" style={{ marginBottom: 12, background: "#faf6ea" }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <b className="serif" style={{ fontSize: 18 }}>{a.client_name ?? "Cliente"}</b>
        <span className="sub">op. {opName(a.staff_id)}{saldo > 0 ? " · credito disponibile " + eur(saldo) : ""}</span>
      </div>

      {items.map((it, i) => (
        <div className="row" key={i}>
          <span>
            {it.kind === "product" ? "🧴" : "✂"} {it.name}
            <span className="sub"> ({opName(it.staff_id)})</span>
            {it.kind === "product" && (
              <label style={{ marginLeft: 8, fontSize: 12.5 }}>
                <input type="checkbox" checked={!it.proposed}
                  onChange={e => setItems(items.map((x, j) => j === i ? { ...x, proposed: !e.target.checked } : x))} />
                {" "}venduto{it.proposed ? " (ora: solo proposto)" : ""}
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
          if (it) setItems([...items, { name: it.name, price: Number(it.price), kind: it.kind, staff_id: a.staff_id, proposed: false }]);
          e.target.value = "";
        }}>
          <option value="">+ Aggiungi servizio/prodotto…</option>
          <optgroup label="Servizi">{catalog.filter((x: any) => x.kind === "service").map((x: any) => <option key={x.id} value={x.id}>{x.name} — {eur(Number(x.price))}</option>)}</optgroup>
          <optgroup label="Prodotti">{catalog.filter((x: any) => x.kind === "product").map((x: any) => <option key={x.id} value={x.id}>{x.name} — {eur(Number(x.price))}</option>)}</optgroup>
        </select>
      </div>

      {a.rebook_note && <p style={{ margin: "4px 0", fontSize: 13.5 }}>📅 <b>Riappuntamento suggerito:</b> {a.rebook_note}</p>}
      {a.suggested_products && <p style={{ margin: "4px 0", fontSize: 13.5 }}>🧴 <b>Prodotti suggeriti dall'operatore:</b> {a.suggested_products}</p>}

      <div style={{ display: "flex", gap: 14, alignItems: "end", flexWrap: "wrap", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
        <div><div className="kpi-label">Lavorato</div><b style={{ fontSize: 19, color: "#1e7a4f" }}>{eur(soldTotal)}</b></div>
        <div>
          <label className="fld">Credito utilizzato</label>
          <input type="number" min={0} max={Math.min(saldo, soldTotal)} value={credit} disabled={saldo <= 0}
            style={{ width: 100 }} onChange={e => { setCredit(Number(e.target.value)); setCash(null); }} />
        </div>
        <div>
          <label className="fld">Incassato ora €</label>
          <input type="number" min={0} value={Math.round(cashDue * 100) / 100} style={{ width: 100 }}
            onChange={e => setCash(Number(e.target.value))} />
        </div>
        {cashDue + creditOk < soldTotal && <span className="badge b-warn">sconto {eur(soldTotal - cashDue - creditOk)}</span>}
        <span style={{ flex: 1 }} />
        <button className="btn" disabled={busy || items.filter(it => !it.proposed).length === 0}
          onClick={async () => { setBusy(true); await onClose(a, items, creditOk, cashDue); }}>
          {busy ? "Chiudo…" : "💰 Chiudi vendita"}
        </button>
      </div>
      <p className="sub" style={{ marginTop: 6 }}>Lavorato = valore pieno erogato · Incassato = denaro ricevuto ora · il credito usato scala dal saldo del cliente. Le proposte non confermate restano proposte.</p>
    </div>
  );
}
