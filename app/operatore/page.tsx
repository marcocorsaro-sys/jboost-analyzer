"use client";
import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { eur, num, SEGMENT_LABEL } from "@/lib/gps";
import { normKey } from "@/lib/importer";

type Staff = { id: string; display_name: string; color: string | null; operator_code: string | null; monthly_target: number; active: boolean };
type Appt = { id: string; starts_at: string; client_name: string | null; staff_id: string | null; current_staff_id: string | null; service_name: string | null; status: string };
type Seg = { id: string; appointment_id: string; staff_id: string; status: string; started_at: string };
type CatItem = { id: string; name: string; price: number; kind: string };

export default function Operatore() {
  const ctx = useOrg();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [me, setMe] = useState<Staff | null>(null);
  const [code, setCode] = useState("");
  const [tab, setTab] = useState<"cliente" | "risultati" | "comunicazioni">("cliente");
  const [appts, setAppts] = useState<Appt[]>([]);
  const [segs, setSegs] = useState<Seg[]>([]);
  const [clientsByKey, setClientsByKey] = useState<Record<string, any>>({});
  const [nextByKey, setNextByKey] = useState<Record<string, string>>({});
  const [catalog, setCatalog] = useState<CatItem[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  // chiusura scheda
  const [closing, setClosing] = useState<Appt | null>(null);
  const [done, setDone] = useState<{ name: string; price: number; kind: string }[]>([]);
  const [form, setForm] = useState({ tech: "", pers: "", prods: "", rebook: "" });
  const [passTarget, setPassTarget] = useState("");
  // risultati
  const [myTx, setMyTx] = useState<{ services: number; products: number }>({ services: 0, products: 0 });
  const [salonAvg, setSalonAvg] = useState<number>(0);
  // comunicazioni
  const [comms, setComms] = useState<any[]>([]);
  const [acks, setAcks] = useState<Set<string>>(new Set());

  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  useEffect(() => {
    if (!ctx.orgId) return;
    supabase.from("staff_members").select("*").eq("organization_id", ctx.orgId).eq("active", true)
      .then(({ data }) => {
        setStaff((data ?? []) as any);
        try {
          const saved = sessionStorage.getItem("gps_staff");
          const found = (data ?? []).find((s: any) => s.id === saved);
          if (found) setMe(found as any);
        } catch {}
      });
    supabase.from("catalog_items").select("id,name,price,kind").eq("organization_id", ctx.orgId).eq("active", true)
      .then(({ data }) => setCatalog((data ?? []) as any));
  }, [ctx.orgId]);

  const loadDay = async () => {
    const { data: ap } = await supabase.from("appointments").select("id,starts_at,client_name,staff_id,current_staff_id,service_name,status")
      .eq("organization_id", ctx.orgId).gte("starts_at", today + "T00:00:00").lte("starts_at", today + "T23:59:59").order("starts_at");
    const list = (ap ?? []) as Appt[];
    setAppts(list);
    const { data: sg } = await supabase.from("visit_segments").select("id,appointment_id,staff_id,status,started_at")
      .eq("organization_id", ctx.orgId).in("status", ["active", "paused"]);
    setSegs((sg ?? []) as any);
    // schede cliente per i nomi di oggi
    const keys = Array.from(new Set(list.map(a => a.client_name).filter(Boolean).map(n => normKey(n!))));
    if (keys.length) {
      const { data: cls } = await supabase.from("clients")
        .select("id,full_name,normalized_key,segment,at_risk,visits_count,total_value,avg_ticket,last_visit,recency_days,privacy_consent")
        .eq("organization_id", ctx.orgId).in("normalized_key", keys.slice(0, 100));
      setClientsByKey(Object.fromEntries((cls ?? []).map((c: any) => [c.normalized_key, c])));
      const { data: fut } = await supabase.from("appointments").select("client_name,starts_at")
        .eq("organization_id", ctx.orgId).gt("starts_at", today + "T23:59:59").eq("status", "confirmed").order("starts_at").limit(300);
      const nb: Record<string, string> = {};
      for (const f of (fut ?? []) as any[]) {
        const k = f.client_name ? normKey(f.client_name) : null;
        if (k && !nb[k]) nb[k] = f.starts_at;
      }
      setNextByKey(nb);
    }
  };

  const loadResults = async () => {
    if (!me) return;
    const { data: tx } = await supabase.from("transactions").select("worked_value,kind")
      .eq("organization_id", ctx.orgId).eq("staff_id", me.id).eq("status", "completed").gte("tx_date", month + "-01");
    let s = 0, p = 0;
    for (const t of (tx ?? []) as any[]) (t.kind === "product" ? (p += Number(t.worked_value)) : (s += Number(t.worked_value)));
    setMyTx({ services: s, products: p });
    const { data: all } = await supabase.from("transactions").select("worked_value")
      .eq("organization_id", ctx.orgId).eq("status", "completed").gte("tx_date", month + "-01");
    const tot = (all ?? []).reduce((a: number, t: any) => a + Number(t.worked_value), 0);
    setSalonAvg(staff.length ? tot / staff.length : 0);
  };

  const loadComms = async () => {
    const { data } = await supabase.from("communications").select("*").eq("organization_id", ctx.orgId).eq("active", true).order("created_at", { ascending: false });
    setComms(data ?? []);
    if (me) {
      const { data: a } = await supabase.from("communication_acks").select("communication_id").eq("staff_id", me.id);
      setAcks(new Set((a ?? []).map((x: any) => x.communication_id)));
    }
  };

  useEffect(() => { if (ctx.orgId && me) { loadDay(); loadResults(); loadComms(); try { sessionStorage.setItem("gps_staff", me.id); } catch {} } }, [ctx.orgId, me?.id]);

  const mySeg = useMemo(() => segs.find(s => s.staff_id === me?.id && s.status === "active") ?? null, [segs, me]);
  const myPaused = useMemo(() => segs.filter(s => s.staff_id === me?.id && s.status === "paused"), [segs, me]);
  const current = useMemo(() => mySeg ? appts.find(a => a.id === mySeg.appointment_id) ?? null : null, [mySeg, appts]);
  const myQueue = useMemo(() => appts.filter(a => a.status === "checked_in" && (a.staff_id === me?.id || !a.staff_id)), [appts, me]);

  const clientOf = (a: Appt | null) => (a?.client_name ? clientsByKey[normKey(a.client_name)] ?? null : null);
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

  const suggestFor = (c: any): string => {
    if (!c) return "Cliente nuovo o senza storico: raccogli contatto e consenso privacy, proponi il prossimo appuntamento prima che esca.";
    const out: string[] = [];
    if (c.at_risk) out.push("Era fermo da " + c.recency_days + " giorni: proponi SUBITO il riappuntamento prima del pagamento.");
    if (c.segment === "premium") out.push("Cliente Premium (" + eur(Number(c.total_value), 0) + " storico): candidato ideale per un trattamento aggiuntivo o un upgrade.");
    if (Number(c.avg_ticket ?? 0) < 30) out.push("Fiche media " + eur(c.avg_ticket) + ": prova un servizio extra mirato (trattamento cute, barba).");
    if (!nextByKey[c.normalized_key]) out.push("Nessun prossimo appuntamento in agenda: chiudi il rebooking oggi.");
    else out.push("Ha già il prossimo appuntamento il " + new Date(nextByKey[c.normalized_key]).toLocaleDateString("it-IT") + ": confermaglielo, niente prompt di rebooking (regola INV-14).");
    return out.slice(0, 3).join(" ");
  };

  // ---- azioni workflow ----
  const inizia = async (a: Appt) => {
    if (!me) return;
    setMsg(null);
    const { error } = await supabase.from("visit_segments").insert({ organization_id: ctx.orgId, appointment_id: a.id, staff_id: me.id });
    if (error) { setMsg(error.message.includes("one_active_segment") ? "Hai già un cliente in lavorazione: mettilo in pausa o invialo alla reception." : error.message); return; }
    await supabase.from("appointments").update({ status: "in_service", current_staff_id: me.id, staff_id: a.staff_id ?? me.id }).eq("id", a.id);
    loadDay();
  };
  const pausa = async () => {
    if (!mySeg || !current) return;
    await supabase.from("visit_segments").update({ status: "paused" }).eq("id", mySeg.id);
    await supabase.from("appointments").update({ status: "paused" }).eq("id", current.id);
    loadDay();
  };
  const riprendi = async (seg: Seg) => {
    setMsg(null);
    const { error } = await supabase.from("visit_segments").update({ status: "active" }).eq("id", seg.id);
    if (error) { setMsg("Hai già un cliente attivo: chiudi o metti in pausa prima."); return; }
    await supabase.from("appointments").update({ status: "in_service", current_staff_id: me!.id }).eq("id", seg.appointment_id);
    loadDay();
  };
  const passa = async () => {
    if (!mySeg || !current || !passTarget) return;
    const mins = Math.round((Date.now() - new Date(mySeg.started_at).getTime()) / 60000);
    await supabase.from("visit_segments").update({ status: "done", ended_at: new Date().toISOString(), active_minutes: mins }).eq("id", mySeg.id);
    await supabase.from("appointments").update({ status: "checked_in", staff_id: passTarget, current_staff_id: null }).eq("id", current.id);
    setPassTarget("");
    loadDay();
  };
  const openInvia = () => {
    if (!current) return;
    const pre = catalog.find(c => c.kind === "service" && current.service_name && normKey(c.name) === normKey(current.service_name));
    setDone(pre ? [{ name: pre.name, price: Number(pre.price), kind: "service" }] : []);
    setForm({ tech: "", pers: "", prods: "", rebook: "" });
    setClosing(current);
  };
  const invia = async () => {
    if (!closing || !mySeg || !me) return;
    const mins = Math.round((Date.now() - new Date(mySeg.started_at).getTime()) / 60000);
    await supabase.from("visit_segments").update({ status: "done", ended_at: new Date().toISOString(), active_minutes: mins }).eq("id", mySeg.id);
    await supabase.from("appointments").update({
      status: "ready",
      services_done: done.map(d => ({ ...d, staff_id: me.id })),
      tech_notes: form.tech || null, personal_notes: form.pers || null,
      suggested_products: form.prods || null, rebook_note: form.rebook || null,
      current_staff_id: null,
    }).eq("id", closing.id);
    setClosing(null);
    loadDay();
  };
  const ack = async (commId: string) => {
    if (!me) return;
    await supabase.from("communication_acks").insert({ organization_id: ctx.orgId, communication_id: commId, staff_id: me.id });
    setAcks(new Set([...Array.from(acks), commId]));
  };

  // ---- selezione operatore (codice su iPad condiviso) ----
  if (!ctx.loading && ctx.orgId && !me) {
    return (
      <Shell ctx={ctx}>
        <div className="card" style={{ maxWidth: 460, margin: "60px auto", textAlign: "center", padding: 34 }}>
          <h1 style={{ fontSize: 24 }}>Workspace Operatore</h1>
          <p className="sub">Inserisci il tuo codice operatore{ctx.role !== "operatore" ? " oppure selezionati dall'elenco" : ""}.</p>
          <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="CODICE" style={{ textAlign: "center", fontSize: 20, letterSpacing: ".2em", width: 220, margin: "14px 0" }} />
          <div>
            <button className="btn" onClick={() => {
              const f = staff.find(s => s.operator_code && s.operator_code === code.trim());
              if (f) setMe(f); else setMsg("Codice non riconosciuto.");
            }}>Entra</button>
          </div>
          {msg && <div className="alert err" style={{ marginTop: 12 }}>{msg}</div>}
          {ctx.role !== "operatore" && (
            <div style={{ marginTop: 18, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {staff.map(s => <button key={s.id} className="chip" onClick={() => setMe(s)}>{s.display_name}</button>)}
            </div>
          )}
        </div>
      </Shell>
    );
  }

  const c = clientOf(current);
  const target = Number(me?.monthly_target ?? 0);
  const tot = myTx.services + myTx.products;
  const pct = target > 0 ? Math.min(1, tot / target) : 0;
  const reached = target > 0 && tot >= target;
  const bonus = reached ? 0.15 * (tot - target) + 0.10 * myTx.products : 0;
  const bonusPotential = target > 0 && !reached ? 0.10 * myTx.products : 0;

  return (
    <Shell ctx={ctx}>
      <div className="page-head">
        <div>
          <h1>Ciao, {me?.display_name.split(" ")[0]}</h1>
          <p className="sub">
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: me?.color ?? "#888", marginRight: 6 }} />
            {mySeg ? "Occupato con " + (current?.client_name ?? "cliente") : myPaused.length ? "Libero · " + myPaused.length + " in posa" : "Libero"}
          </p>
        </div>
        <button className="btn sm secondary" onClick={() => { setMe(null); try { sessionStorage.removeItem("gps_staff"); } catch {} }}>Cambia operatore</button>
      </div>

      <div className="filters" style={{ marginBottom: 18 }}>
        <button className={"chip" + (tab === "cliente" ? " on" : "")} onClick={() => setTab("cliente")}>✂ Il mio cliente</button>
        <button className={"chip" + (tab === "risultati" ? " on" : "")} onClick={() => { setTab("risultati"); loadResults(); }}>📊 I miei risultati</button>
        <button className={"chip" + (tab === "comunicazioni" ? " on" : "")} onClick={() => { setTab("comunicazioni"); loadComms(); }}>
          🔔 Comunicazioni {comms.filter(x => x.requires_ack && !acks.has(x.id)).length > 0 && <span className="badge b-risk" style={{ marginLeft: 4 }}>{comms.filter(x => x.requires_ack && !acks.has(x.id)).length}</span>}
        </button>
      </div>
      {msg && <div className="alert err">{msg}</div>}

      {tab === "cliente" && !closing && (
        <>
          {current ? (
            <div className="card" style={{ borderColor: me?.color ?? "#c9a227", borderWidth: 2 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <h2 className="serif" style={{ margin: 0, fontSize: 24 }}>{current.client_name ?? "Cliente"}</h2>
                  <p style={{ margin: "6px 0" }}>
                    {c && <span className={"badge b-" + (c.segment ?? "base")}>{SEGMENT_LABEL[c.segment ?? "base"]}</span>}
                    {c?.at_risk && <span className="badge b-risk" style={{ marginLeft: 6 }}>era a rischio</span>}
                    <span className="sub" style={{ marginLeft: 8 }}>{current.service_name ?? "servizio da definire"} · arrivo {hhmm(current.starts_at)}</span>
                  </p>
                </div>
                <span className="badge b-warn">IN LAVORAZIONE</span>
              </div>
              {c ? (
                <div className="grid kpis" style={{ marginTop: 8 }}>
                  <div><div className="kpi-label">Passaggi</div><div className="kpi-value" style={{ fontSize: 22 }}>{num(c.visits_count)}</div></div>
                  <div><div className="kpi-label">Valore storico</div><div className="kpi-value" style={{ fontSize: 22 }}>{eur(Number(c.total_value), 0)}</div></div>
                  <div><div className="kpi-label">Fiche media</div><div className="kpi-value" style={{ fontSize: 22 }}>{eur(c.avg_ticket)}</div></div>
                  <div><div className="kpi-label">Ultima visita</div><div className="kpi-value" style={{ fontSize: 22 }}>{c.last_visit ?? "—"}</div></div>
                  <div><div className="kpi-label">Prossimo app.</div><div className="kpi-value" style={{ fontSize: 22 }}>{nextByKey[c.normalized_key] ? new Date(nextByKey[c.normalized_key]).toLocaleDateString("it-IT") : "—"}</div></div>
                </div>
              ) : <p className="sub">Nessuna scheda storica per questo nome — verrà creata alla chiusura.</p>}
              <div className="alert" style={{ marginTop: 12 }}>💡 {suggestFor(c)}</div>
              <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                <button className="btn secondary" onClick={pausa}>⏸ Metti in pausa / posa</button>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <select value={passTarget} onChange={e => setPassTarget(e.target.value)}>
                    <option value="">Passa a un collega…</option>
                    {staff.filter(s => s.id !== me?.id).map(s => <option key={s.id} value={s.id}>{s.display_name}</option>)}
                  </select>
                  <button className="btn dark" onClick={passa} disabled={!passTarget}>→ Passa</button>
                </span>
                <button className="btn" onClick={openInvia}>✓ Invia alla reception</button>
              </div>
            </div>
          ) : (
            <div className="card" style={{ textAlign: "center", padding: 30 }}>
              <p className="serif" style={{ fontSize: 19, margin: 0 }}>Nessun cliente in lavorazione</p>
              <p className="sub">Prendi in carico un cliente dalla coda qui sotto.</p>
            </div>
          )}

          {myPaused.length > 0 && (
            <div className="section">
              <div className="section-title"><h2>In posa / pausa</h2></div>
              {myPaused.map(sg => {
                const a = appts.find(x => x.id === sg.appointment_id);
                return (
                  <div className="card row" key={sg.id} style={{ marginBottom: 8 }}>
                    <span><b>{a?.client_name ?? "Cliente"}</b> <span className="sub">{a?.service_name ?? ""} · in posa da {Math.round((Date.now() - new Date(sg.started_at).getTime()) / 60000)} min</span></span>
                    <button className="btn sm" onClick={() => riprendi(sg)}>▶ Riprendi</button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="section">
            <div className="section-title"><h2>La mia coda ({myQueue.length})</h2><span className="sub">check-in fatti, in attesa</span></div>
            {myQueue.length === 0 && <p className="sub">Nessun cliente in attesa per te.</p>}
            {myQueue.map(a => {
              const cc = clientOf(a);
              return (
                <div className="card row" key={a.id} style={{ marginBottom: 8 }}>
                  <span>
                    <b>{hhmm(a.starts_at)} {a.client_name ?? "—"}</b>
                    {cc && <span className={"badge b-" + (cc.segment ?? "base")} style={{ marginLeft: 8 }}>{SEGMENT_LABEL[cc.segment ?? "base"]}</span>}
                    <span className="sub" style={{ marginLeft: 8 }}>{a.service_name ?? ""}{!a.staff_id ? " · non assegnato" : ""}</span>
                  </span>
                  <button className="btn sm" onClick={() => inizia(a)}>▶ Inizia lavoro</button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === "cliente" && closing && (
        <div className="card">
          <div className="section-title"><h2>Chiudi scheda — {closing.client_name}</h2><button className="btn sm secondary" onClick={() => setClosing(null)}>Annulla</button></div>
          <label className="fld">Servizi e prodotti effettivamente eseguiti/venduti</label>
          {done.map((d, i) => (
            <div className="row" key={i}>
              <span>{d.kind === "product" ? "🧴" : "✂"} {d.name}</span>
              <span><b>{eur(d.price)}</b> <button className="btn sm secondary" onClick={() => setDone(done.filter((_, j) => j !== i))}>✕</button></span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, margin: "10px 0 16px", flexWrap: "wrap" }}>
            <select id="addsvc" onChange={e => {
              const it = catalog.find(x => x.id === e.target.value);
              if (it) setDone([...done, { name: it.name, price: Number(it.price), kind: it.kind }]);
              e.target.value = "";
            }}>
              <option value="">+ Aggiungi dal catalogo…</option>
              <optgroup label="Servizi">{catalog.filter(x => x.kind === "service").map(x => <option key={x.id} value={x.id}>{x.name} — {eur(Number(x.price))}</option>)}</optgroup>
              <optgroup label="Prodotti">{catalog.filter(x => x.kind === "product").map(x => <option key={x.id} value={x.id}>{x.name} — {eur(Number(x.price))}</option>)}</optgroup>
            </select>
            <b style={{ alignSelf: "center" }}>Totale: {eur(done.reduce((a, d) => a + d.price, 0))}</b>
          </div>
          <div className="two-col">
            <div><label className="fld">Note tecniche (ricetta colore, tecniche…)</label><textarea rows={3} style={{ width: "100%" }} value={form.tech} onChange={e => setForm({ ...form, tech: e.target.value })} /></div>
            <div><label className="fld">Note personali (conversazioni da riprendere…)</label><textarea rows={3} style={{ width: "100%" }} value={form.pers} onChange={e => setForm({ ...form, pers: e.target.value })} /></div>
            <div><label className="fld">Prodotti suggeriti</label><input style={{ width: "100%" }} value={form.prods} onChange={e => setForm({ ...form, prods: e.target.value })} /></div>
            <div><label className="fld">Suggerimento riappuntamento</label><input style={{ width: "100%" }} value={form.rebook} onChange={e => setForm({ ...form, rebook: e.target.value })} placeholder="es. fra 4 settimane, taglio + barba" /></div>
          </div>
          <button className="btn" style={{ marginTop: 16 }} onClick={invia} disabled={done.length === 0}>✓ Invia alla reception</button>
        </div>
      )}

      {tab === "risultati" && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="section-title"><h2>Obiettivo {month}</h2><b style={{ color: reached ? "#1e7a4f" : "#b3402a", fontSize: 20 }}>{target > 0 ? Math.round(pct * 100) + "%" : "non impostato"}</b></div>
            <div className="bar-track" style={{ height: 14 }}><div className="bar-fill" style={{ width: pct * 100 + "%", background: reached ? "#1e7a4f" : "var(--gold)" }} /></div>
            <p className="sub" style={{ marginTop: 6 }}>{eur(tot, 0)} su {eur(target, 0)}{target > 0 && !reached ? " · mancano " + eur(target - tot, 0) : ""}</p>
          </div>
          <div className="grid kpis">
            <div className="card"><div className="kpi-label">Servizi lavorati</div><div className="kpi-value">{eur(myTx.services, 0)}</div></div>
            <div className="card"><div className="kpi-label">Prodotti venduti</div><div className="kpi-value">{eur(myTx.products, 0)}</div></div>
            <div className="card gold"><div className="kpi-label">Bonus {reached ? "incassabile" : "potenziale"}</div><div className="kpi-value">{eur(reached ? bonus : bonusPotential)}</div><div className="kpi-note">{reached ? "15% oltre target + 10% prodotti" : "si sblocca al 100% del target"}</div></div>
            <div className="card dark"><div className="kpi-label">Media salone</div><div className="kpi-value">{eur(salonAvg, 0)}</div><div className="kpi-note">lavorato medio per operatore</div></div>
          </div>
          <div className="card section">
            <div className="section-title"><h2>Suggerimenti GPS</h2><span className="sub">basati sui tuoi numeri del mese</span></div>
            {(() => {
              const tips: string[] = [];
              const prodShare = tot > 0 ? myTx.products / tot : 0;
              if (prodShare < 0.08) tips.push("I prodotti sono solo il " + Math.round(prodShare * 100) + "% del tuo lavorato: proponi 1 prodotto mirato a fine servizio (chi compra prodotti torna più spesso). Con il bonus al 10%, ogni 100 € di prodotti sono 10 € in più per te.");
              if (target > 0 && !reached) {
                const daysLeft = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate();
                if (daysLeft > 0) tips.push("Per centrare l'obiettivo servono " + eur((target - tot) / daysLeft, 0) + " al giorno nei prossimi " + daysLeft + " giorni: un servizio aggiuntivo o un upgrade al giorno bastano.");
              }
              if (tot > 0 && salonAvg > 0 && tot < salonAvg * 0.8) tips.push("Sei sotto la media salone: chiedi alla reception di indirizzarti i walk-in e proponi il riappuntamento a ogni cliente prima del pagamento.");
              tips.push("Ai clienti Premium proponi l'upgrade (trattamento cute, foot care); ai clienti che erano fermi da mesi chiudi il riappuntamento in poltrona, non in cassa.");
              return tips.map((t, i) => <div className="alert" key={i}>💡 {t}</div>);
            })()}
            <p className="sub">Suggerimenti deterministici v1 — con più storico transazioni arriveranno raccomandazioni AI personalizzate per cliente.</p>
          </div>
        </>
      )}

      {tab === "comunicazioni" && (
        <>
          {comms.length === 0 && <div className="card" style={{ textAlign: "center", padding: 40 }}><p className="serif" style={{ fontSize: 18 }}>🔔 Nessuna comunicazione attiva</p></div>}
          {comms.map(cm => (
            <div className="card" key={cm.id} style={{ marginBottom: 12, borderColor: cm.requires_ack && !acks.has(cm.id) ? "#b3402a" : undefined }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start" }}>
                <div>
                  <b className="serif" style={{ fontSize: 17 }}>{cm.title}</b>
                  {cm.requires_ack && <span className={"badge " + (acks.has(cm.id) ? "b-ok" : "b-risk")} style={{ marginLeft: 8 }}>{acks.has(cm.id) ? "presa visione ✓" : "richiede presa visione"}</span>}
                  <p style={{ margin: "6px 0 0", fontSize: 14, whiteSpace: "pre-wrap" }}>{cm.body}</p>
                  <p className="sub" style={{ marginTop: 6 }}>{new Date(cm.created_at).toLocaleString("it-IT")}</p>
                </div>
                {cm.requires_ack && !acks.has(cm.id) && <button className="btn" onClick={() => ack(cm.id)}>Confermo presa visione</button>}
              </div>
            </div>
          ))}
        </>
      )}
    </Shell>
  );
}
