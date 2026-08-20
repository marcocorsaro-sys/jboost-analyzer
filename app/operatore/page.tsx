"use client";
import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { eur, num, SEGMENT_LABEL, staffAvailabilitySplit, buildOccupancy, occupiedMinutesFor, Occupancy } from "@/lib/gps";
import { normKey } from "@/lib/importer";
import { startAutoSync } from "@/lib/autosync";
import { loadSchedule } from "@/lib/schedule";

type Staff = { id: string; display_name: string; color: string | null; operator_code: string | null; monthly_target: number; active: boolean };
type Appt = { id: string; starts_at: string; client_name: string | null; staff_id: string | null; current_staff_id: string | null; service_name: string | null; status: string };
type Seg = { id: string; appointment_id: string; staff_id: string; status: string; started_at: string };
type CatItem = { id: string; name: string; price: number; kind: string; category?: string | null; stock_qty?: number | null };

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
  // Modulo 1 — servizi erogati: prenotato ≠ erogato ≠ valore aggiuntivo (spec Dimitar §1-7)
  const [done, setDone] = useState<any[]>([]);
  // Modulo 2 — prodotti PROPOSTI (mai venduti qui: conferma solo in Reception, §8-10)
  const [props, setProps] = useState<any[]>([]);
  // Modulo 3 — rebooking suggerito (§13)
  const [rebookDays, setRebookDays] = useState<number | "altro" | "none" | null>(null);
  const [rebookCustom, setRebookCustom] = useState(30);
  const [svcQ, setSvcQ] = useState("");
  const [prodQ, setProdQ] = useState("");
  const [replacing, setReplacing] = useState<number | null>(null);
  const [form, setForm] = useState({ tech: "", pers: "", prods: "", rebook: "" });
  const [passTarget, setPassTarget] = useState("");
  // risultati
  const [myTx, setMyTx] = useState<{ services: number; products: number }>({ services: 0, products: 0 });
  const [salonAvg, setSalonAvg] = useState<number>(0);
  const [occ, setOcc] = useState<Occupancy | null>(null);
  const [myKpi, setMyKpi] = useState<{ upsell: number; prodOp: number; rbSugg: number; rbConf: number } | null>(null);
  // comunicazioni
  const [comms, setComms] = useState<any[]>([]);
  const [acks, setAcks] = useState<Set<string>>(new Set());

  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  // tick ogni 30s per aggiornare il conto alla rovescia "arriva tra X minuti"
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 30000); return () => clearInterval(t); }, []);

  useEffect(() => {
    if (!ctx.orgId) return;
    supabase.from("staff_members").select("*").eq("organization_id", ctx.orgId).eq("active", true)
      .then(({ data }) => {
        setStaff((data ?? []) as any);
        // §1 spec Dimitar: identità operatore dedotta dal LOGIN (email account → collaboratore).
        // Nessun codice richiesto: se l'account è collegato a una scheda, entra diretto.
        const own = (data ?? []).find((s: any) => s.user_id && s.user_id === ctx.userId);
        if (own) { setMe(own as any); return; }
        try {
          const saved = sessionStorage.getItem("gps_staff");
          const found = (data ?? []).find((s: any) => s.id === saved);
          if (found) setMe(found as any);
        } catch {}
      });
    supabase.from("catalog_items").select("id,name,price,kind,category,stock_qty").eq("organization_id", ctx.orgId).eq("active", true).order("name")
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

    // Occupazione individuale (richiesta Dimitar): minuti disponibili / trascorsi / mancanti / occupati
    const { data: plan } = await supabase.from("business_plans").select("id,month")
      .eq("organization_id", ctx.orgId).order("month", { ascending: false }).limit(1).maybeSingle();
    if (plan) {
      const { data: ps } = await supabase.from("plan_staff").select("*").eq("plan_id", plan.id).eq("staff_id", me.id).maybeSingle();
      if (ps) {
        const schedule = await loadSchedule(ctx.orgId!);
        const split = schedule.configured ? schedule.staffMonth(me.id, plan.month) : staffAvailabilitySplit(ps as any, plan.month);
        const { data: sg } = await supabase.from("visit_segments").select("staff_id,status,started_at,ended_at,active_minutes")
          .eq("organization_id", ctx.orgId).eq("staff_id", me.id).gte("started_at", month + "-01T00:00:00");
        const { data: txi } = await supabase.from("transactions").select("staff_id,catalog_item_id,kind")
          .eq("organization_id", ctx.orgId).eq("staff_id", me.id).eq("status", "completed").gte("tx_date", month + "-01");
        const { data: cat } = await supabase.from("catalog_items").select("id,duration_min").eq("organization_id", ctx.orgId);
        const durByItem = Object.fromEntries((cat ?? []).map((c: any) => [c.id, Number(c.duration_min) || 0]));
        const occupied = occupiedMinutesFor(me.id, (sg ?? []) as any, (txi ?? []) as any, durByItem);
        setOcc(buildOccupancy(split, occupied));
      } else setOcc(null);
    }

    // KPI commerciali del mese (§5/§15 spec chiusura): up-sell, prodotti su proposta, conversione rebooking
    const { data: apk } = await supabase.from("appointments")
      .select("commercial,rebook_days,rebook_status,status")
      .eq("organization_id", ctx.orgId).eq("staff_id", me.id)
      .gte("starts_at", month + "-01T00:00:00");
    let upsell = 0, prodOp = 0, rbSugg = 0, rbConf = 0;
    for (const a of (apk ?? []) as any[]) {
      if (a.commercial?.upsell > 0) upsell += Number(a.commercial.upsell);
      if (a.commercial?.prod_operator) prodOp += Number(a.commercial.prod_operator);
      if (a.rebook_days != null) {
        rbSugg++;
        if (a.rebook_status === "confirmed") rbConf++;
      }
    }
    setMyKpi({ upsell, prodOp, rbSugg, rbConf });
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
  // §5: agenda sempre fresca senza pulsanti — sync automatico all'apertura e ogni 5 minuti
  useEffect(() => { if (ctx.orgId) return startAutoSync(ctx.orgId, () => loadDay()); }, [ctx.orgId, me?.id]);
  // e la giornata si ricarica da sola ogni 2 minuti (nuovi appuntamenti, cambi della reception)
  useEffect(() => {
    if (!ctx.orgId || !me) return;
    const t = setInterval(() => loadDay(), 120000);
    return () => clearInterval(t);
  }, [ctx.orgId, me?.id]);

  const mySeg = useMemo(() => segs.find(s => s.staff_id === me?.id && s.status === "active") ?? null, [segs, me]);
  const myPaused = useMemo(() => segs.filter(s => s.staff_id === me?.id && s.status === "paused"), [segs, me]);
  const current = useMemo(() => mySeg ? appts.find(a => a.id === mySeg.appointment_id) ?? null : null, [mySeg, appts]);
  // Arrivo automatico: i prenotati del giorno compaiono da soli all'operatore assegnato, senza check-in della reception
  const myQueue = useMemo(() => appts
    .filter(a => ["confirmed", "checked_in"].includes(a.status) && (a.staff_id === me?.id || !a.staff_id))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at)), [appts, me]);

  const clientOf = (a: Appt | null) => (a?.client_name ? clientsByKey[normKey(a.client_name)] ?? null : null);
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

  // Prossimo cliente: la sua scheda compare da sola quando chiudi quella attuale (richiesta Dimitar)
  const nextUp = !current ? myQueue[0] ?? null : null;
  const minsTo = (iso: string) => Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  const arrivalLabel = (m: number, name: string) =>
    m > 1 ? name + " arriva tra " + m + " minuti"
      : m >= -1 ? name + " sta arrivando adesso"
      : name + " è in ritardo di " + Math.abs(m) + " minuti";
  // Suggerimenti tempo-morto generici v1 — in futuro ogni titolare potrà personalizzarli
  const idleTip = (m: number) => {
    if (m > 20) return "Hai tempo: sistema lo scaffale dei prodotti, controlla le giacenze o riordina la postazione.";
    if (m > 5) return "Dai un'occhiata veloce al suo storico qui sopra e prepara una proposta: un upgrade di servizio o un prodotto mirato.";
    if (m >= -1) return "Sta per entrare: postazione pronta e proposta già in mente.";
    return "Se la postazione è pronta, segnala il ritardo alla reception: un walk-in può riempire questo buco.";
  };

  // Nota: nessun dato economico del cliente in vista operatore (richiesta Dimitar)
  const suggestFor = (c: any): string => {
    if (!c) return "Cliente nuovo o senza storico: raccogli contatto e consenso privacy, proponi il prossimo appuntamento prima che esca.";
    const out: string[] = [];
    if (c.at_risk) out.push("Era fermo da " + c.recency_days + " giorni: proponi SUBITO il riappuntamento prima del pagamento.");
    if (c.segment === "premium") out.push("Cliente Premium: candidato ideale per un trattamento aggiuntivo o un upgrade.");
    if (c.segment === "fidelizzato") out.push("Cliente fidelizzato: un prodotto mirato a fine servizio è la proposta giusta.");
    if (!nextByKey[c.normalized_key]) out.push("Nessun prossimo appuntamento in agenda: chiudi il rebooking oggi.");
    else out.push("Ha già il prossimo appuntamento il " + new Date(nextByKey[c.normalized_key]).toLocaleDateString("it-IT") + ": confermaglielo, niente prompt di rebooking.");
    return out.slice(0, 3).join(" ");
  };

  // ---- azioni workflow ----
  const inizia = async (a: Appt) => {
    if (!me) return;
    setMsg(null);
    // IDEMPOTENZA (bug fix): presa in carico condizionale — se la visita non è più
    // in attesa (già in lavorazione, chiusa o no-show), non succede nulla.
    const { data: claimed } = await supabase.from("appointments")
      .update({ status: "in_service", current_staff_id: me.id, staff_id: a.staff_id ?? me.id })
      .eq("id", a.id).in("status", ["confirmed", "checked_in"]).select("id");
    if (!claimed || claimed.length === 0) {
      setMsg("Questo cliente risulta già preso in carico o chiuso — aggiorno la giornata.");
      loadDay();
      return;
    }
    const { error } = await supabase.from("visit_segments").insert({ organization_id: ctx.orgId, appointment_id: a.id, staff_id: me.id });
    if (error) {
      // hai già un cliente attivo: rilascio la presa in carico
      await supabase.from("appointments").update({ status: a.status, current_staff_id: null }).eq("id", a.id).eq("status", "in_service");
      setMsg(error.message.includes("one_active_segment") ? "Hai già un cliente in lavorazione: mettilo in pausa o invialo alla reception." : error.message);
      loadDay();
      return;
    }
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
    // i servizi PRENOTATI compaiono da soli, come booked/unchanged
    setDone(pre
      ? [{ name: pre.name, price: Number(pre.price), kind: "service", change_type: "unchanged", origin: "booked" }]
      : current.service_name
        ? [{ name: current.service_name, price: 0, kind: "service", change_type: "unchanged", origin: "booked" }]
        : []);
    setProps([]);
    setRebookDays(null); setRebookCustom(30);
    setSvcQ(""); setProdQ(""); setReplacing(null);
    setForm({ tech: "", pers: "", prods: "", rebook: "" });
    setClosing(current);
  };

  // §2-6: contabilità del confronto — SOLO i servizi finali entrano nel conto,
  // il prenotato resta come base per l'up-sell
  const bookedValue = done.reduce((a, d) =>
    a + (d.change_type === "replaced" ? Number(d.replaced_price || 0)
      : d.origin === "booked" ? Number(d.price || 0) : 0), 0);
  const finalServices = done.filter(d => d.change_type !== "removed").reduce((a, d) => a + Number(d.price || 0), 0);
  const upsell = finalServices - bookedValue;

  const invia = async () => {
    if (!closing || !mySeg || !me) return;
    const mins = Math.round((Date.now() - new Date(mySeg.started_at).getTime()) / 60000);
    await supabase.from("visit_segments").update({ status: "done", ended_at: new Date().toISOString(), active_minutes: mins }).eq("id", mySeg.id);
    const rebook = rebookDays === "none" || rebookDays == null ? null : rebookDays === "altro" ? rebookCustom : rebookDays;
    const items = [
      // servizi: anche i rimossi restano nella scheda come storico, ma flaggati removed
      ...done.map(d => ({ ...d, staff_id: me.id, removed: d.change_type === "removed" })),
      // prodotti: SOLO proposte, origin operatore — la vendita la conferma la Reception
      ...props.map(p => ({ ...p, staff_id: me.id, proposed: true, origin: "operator_proposal" })),
    ];
    await supabase.from("appointments").update({
      status: "ready",
      services_done: items,
      booked_value: bookedValue,
      commercial: { booked_value: bookedValue, final_services: finalServices, upsell },
      rebook_days: rebook,
      rebook_status: rebook != null ? "suggested" : "none",
      tech_notes: form.tech || null, personal_notes: form.pers || null,
      suggested_products: props.length ? props.map(p => p.name).join(", ") : (form.prods || null),
      rebook_note: rebook != null ? "Rivederlo tra " + rebook + " giorni" : (form.rebook || null),
      current_staff_id: null,
    }).eq("id", closing.id).in("status", ["in_service", "paused", "checked_in", "confirmed"]); // mai riaprire una visita chiusa
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
    // Un account con ruolo operatore ma senza scheda collegata: niente codici, va collegato dal Team
    if (ctx.role === "operatore") {
      return (
        <Shell ctx={ctx}>
          <div className="card" style={{ maxWidth: 520, margin: "60px auto", textAlign: "center", padding: 34 }}>
            <h1 style={{ fontSize: 24 }}>Account non collegato</h1>
            <p className="sub">Il tuo accesso funziona ma non è ancora collegato a una scheda collaboratore. Chiedi al titolare di creare il tuo accesso dalla tua scheda in Team: da quel momento entrerai direttamente nella tua giornata, senza codici.</p>
          </div>
        </Shell>
      );
    }
    return (
      <Shell ctx={ctx}>
        <div className="card" style={{ maxWidth: 460, margin: "60px auto", textAlign: "center", padding: 34 }}>
          <h1 style={{ fontSize: 24 }}>Workspace Operatore</h1>
          <p className="sub">Vista di servizio per titolare/manager/reception (iPad condiviso): scegli l'operatore da impersonare. Gli operatori con account entrano qui in automatico.</p>
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
        {ctx.role !== "operatore" && <button className="btn sm secondary" onClick={() => { setMe(null); try { sessionStorage.removeItem("gps_staff"); } catch {} }}>Cambia operatore</button>}
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
          ) : nextUp ? (() => {
            const nc = clientOf(nextUp);
            const m = minsTo(nextUp.starts_at);
            const firstName = (nextUp.client_name ?? "Il prossimo cliente").split(" ")[0];
            return (
              <div className="card" style={{ borderColor: "#c9a227", borderWidth: 2 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <div className="kpi-label" style={{ marginBottom: 4 }}>Prossimo cliente</div>
                    <h2 className="serif" style={{ margin: 0, fontSize: 24 }}>{nextUp.client_name ?? "Cliente"}</h2>
                    <p style={{ margin: "6px 0" }}>
                      {nc && <span className={"badge b-" + (nc.segment ?? "base")}>{SEGMENT_LABEL[nc.segment ?? "base"]}</span>}
                      {nc?.at_risk && <span className="badge b-risk" style={{ marginLeft: 6 }}>era a rischio</span>}
                      <span className="sub" style={{ marginLeft: nc ? 8 : 0 }}>{nextUp.service_name ?? "servizio da definire"} · appuntamento {hhmm(nextUp.starts_at)}</span>
                    </p>
                  </div>
                  <span className="badge" style={{ background: m < 0 ? "#f3d9d3" : "#eee4c8", color: m < 0 ? "#8a2f1d" : "#6b5310", fontSize: 14, padding: "6px 12px" }}>
                    ⏱ {arrivalLabel(m, firstName)}
                  </span>
                </div>
                {nc ? (
                  <div className="grid kpis" style={{ marginTop: 8 }}>
                    <div><div className="kpi-label">Passaggi</div><div className="kpi-value" style={{ fontSize: 22 }}>{num(nc.visits_count)}</div></div>
                    <div><div className="kpi-label">Ultima visita</div><div className="kpi-value" style={{ fontSize: 22 }}>{nc.last_visit ?? "—"}</div></div>
                    <div><div className="kpi-label">Prossimo app.</div><div className="kpi-value" style={{ fontSize: 22 }}>{nextByKey[nc.normalized_key] ? new Date(nextByKey[nc.normalized_key]).toLocaleDateString("it-IT") : "—"}</div></div>
                  </div>
                ) : <p className="sub">Nessuna scheda storica per questo nome — verrà creata alla chiusura.</p>}
                <div className="alert" style={{ marginTop: 12 }}>💡 {suggestFor(nc)}</div>
                <div className="alert" style={{ background: "#f0ede4", borderColor: "#d3cbb4" }}>🕐 {idleTip(m)} <span className="sub">(suggerimento generico — presto personalizzabile dal titolare)</span></div>
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn" onClick={() => inizia(nextUp)}>▶ Inizia lavoro</button>
                </div>
              </div>
            );
          })() : (
            <div className="card" style={{ textAlign: "center", padding: 30 }}>
              <p className="serif" style={{ fontSize: 19, margin: 0 }}>Nessun cliente in lavorazione né in arrivo</p>
              <p className="sub">Quando la reception aggiunge un appuntamento per te, la scheda comparirà qui da sola.</p>
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
            <div className="section-title"><h2>{nextUp ? "In arrivo dopo (" + Math.max(0, myQueue.length - 1) + ")" : "La mia coda (" + myQueue.length + ")"}</h2><span className="sub">appuntamenti di oggi in sequenza</span></div>
            {(nextUp ? myQueue.slice(1) : myQueue).length === 0 && <p className="sub">Nessun altro cliente in attesa per te.</p>}
            {(nextUp ? myQueue.slice(1) : myQueue).map(a => {
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

      {tab === "cliente" && closing && (() => {
        const services = catalog.filter(x => x.kind === "service").sort((a, b) => a.name.localeCompare(b.name, "it"));
        const products = catalog.filter(x => x.kind === "product").sort((a, b) => a.name.localeCompare(b.name, "it"));
        const svcHits = svcQ.trim().length >= 1 ? services.filter(s => s.name.toLowerCase().includes(svcQ.toLowerCase())).slice(0, 8) : [];
        const prodHits = prodQ.trim().length >= 1 ? products.filter(p => p.name.toLowerCase().includes(prodQ.toLowerCase())).slice(0, 8) : [];
        const pickService = (it: any) => {
          if (replacing != null) {
            // §2: sostituzione — l'originale resta SOLO come storico/KPI, mai nel conto
            setDone(done.map((d, j) => j === replacing ? {
              name: it.name, price: Number(it.price), kind: "service",
              change_type: d.origin === "booked" || d.change_type === "replaced" ? "replaced" : "added",
              replaced_name: d.change_type === "replaced" ? d.replaced_name : d.name,
              replaced_price: d.change_type === "replaced" ? d.replaced_price : d.price,
              origin: d.origin,
            } : d));
            setReplacing(null);
          } else {
            setDone([...done, { name: it.name, price: Number(it.price), kind: "service", change_type: "added", origin: "operator_proposal" }]);
          }
          setSvcQ("");
        };
        return (
        <div className="card">
          <div className="section-title"><h2>Concludi e passa alla Reception — {closing.client_name}</h2><button className="btn sm secondary" onClick={() => setClosing(null)}>Annulla</button></div>

          {/* MODULO 1 — SERVIZI EROGATI */}
          <div className="kpi-label" style={{ marginBottom: 6 }}>✂ Servizi erogati</div>
          {done.map((d, i) => (
            <div className="row" key={i} style={{ opacity: d.change_type === "removed" ? .5 : 1 }}>
              <span style={{ textDecoration: d.change_type === "removed" ? "line-through" : "none" }}>
                ✂ {d.name}
                {d.change_type === "replaced" && <span className="sub" style={{ marginLeft: 6 }}>al posto di {d.replaced_name} ({eur(Number(d.replaced_price), 0)})</span>}
                {d.change_type === "added" && <span className="badge b-ok" style={{ marginLeft: 6 }}>aggiunto</span>}
                {d.change_type === "removed" && <span className="badge b-warn" style={{ marginLeft: 6 }}>eliminato</span>}
              </span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <b>{eur(d.price)}</b>
                {d.change_type !== "removed" && <button className="btn sm secondary" title="Sostituisci con un altro servizio" onClick={() => { setReplacing(i); setSvcQ(" "); setSvcQ(""); document.getElementById("svcsearch")?.focus(); }}>⇄</button>}
                {d.change_type !== "removed" && <button className="btn sm secondary" onClick={() => {
                  if (d.origin === "booked" || d.change_type === "replaced") setDone(done.map((x, j) => j === i ? { ...x, change_type: "removed" } : x));
                  else setDone(done.filter((_, j) => j !== i));
                }}>✕</button>}
                {d.change_type === "removed" && <button className="btn sm secondary" onClick={() => setDone(done.map((x, j) => j === i ? { ...x, change_type: "unchanged" } : x))}>↩</button>}
              </span>
            </div>
          ))}
          <div style={{ position: "relative", margin: "8px 0 4px" }}>
            <input id="svcsearch" style={{ width: "100%" }} value={svcQ} onChange={e => setSvcQ(e.target.value)}
              placeholder={replacing != null ? "⇄ Cerca il servizio SOSTITUTIVO…" : "🔍 Cerca servizio da aggiungere…"} />
            {replacing != null && <p className="sub" style={{ margin: "3px 0 0" }}>Stai sostituendo "{done[replacing]?.name}" — scegli il nuovo servizio <button className="btn sm secondary" onClick={() => setReplacing(null)}>annulla</button></p>}
            {svcHits.length > 0 && (
              <div className="card" style={{ position: "absolute", zIndex: 6, width: "100%", maxHeight: 240, overflow: "auto", padding: 6 }}>
                {svcHits.map(s => (
                  <div className="row" key={s.id} style={{ cursor: "pointer" }} onClick={() => pickService(s)}>
                    <span>✂ {s.name}</span><b>{eur(Number(s.price))}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, background: "#f0ede4", borderRadius: 8, padding: "8px 12px", margin: "8px 0 14px" }}>
            <span>Prenotato: <b>{eur(bookedValue, 0)}</b></span>
            <span>Erogato (nel conto): <b style={{ color: "#1e7a4f" }}>{eur(finalServices, 0)}</b></span>
            <span>{upsell >= 0 ? "Up-sell generato" : "Differenza"}: <b style={{ color: upsell >= 0 ? "#1e7a4f" : "#b3402a" }}>{upsell >= 0 ? "+" : ""}{eur(upsell, 0)}</b></span>
          </div>

          {/* MODULO 2 — PRODOTTI PROPOSTI */}
          <div className="kpi-label" style={{ margin: "10px 0 6px" }}>🧴 Prodotti proposti al cliente <span className="sub">(la vendita la conferma la Reception)</span></div>
          {props.map((p, i) => (
            <div className="row" key={i}>
              <span>🧴 {p.name} <span className="badge b-warn" style={{ marginLeft: 6 }}>proposto</span></span>
              <span><b>{eur(p.price)}</b> <button className="btn sm secondary" onClick={() => setProps(props.filter((_, j) => j !== i))}>✕</button></span>
            </div>
          ))}
          <div style={{ position: "relative", margin: "8px 0 14px" }}>
            <input style={{ width: "100%" }} value={prodQ} onChange={e => setProdQ(e.target.value)} placeholder="🔍 Cerca prodotto…" />
            {prodHits.length > 0 && (
              <div className="card" style={{ position: "absolute", zIndex: 6, width: "100%", maxHeight: 240, overflow: "auto", padding: 6 }}>
                {prodHits.map(p => (
                  <div className="row" key={p.id} style={{ cursor: "pointer" }} onClick={() => { setProps([...props, { name: p.name, price: Number(p.price), kind: "product" }]); setProdQ(""); }}>
                    <span>🧴 {p.name}{p.category ? <span className="sub"> · {p.category}</span> : null}{Number(p.stock_qty) <= 0 ? <span className="badge b-warn" style={{ marginLeft: 6 }}>esaurito</span> : <span className="sub"> · disp. {num(Number(p.stock_qty ?? 0))}</span>}</span>
                    <b>{eur(Number(p.price))}</b>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* MODULO 3 — REBOOKING */}
          <div className="kpi-label" style={{ margin: "10px 0 6px" }}>📅 Rivederlo tra <span className="sub">(suggerimento — la conferma è della Reception)</span></div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {[15, 20, 30, 45, 60, 90].map(d => (
              <button key={d} className={"chip" + (rebookDays === d ? " on" : "")} onClick={() => setRebookDays(rebookDays === d ? null : d)}>{d} gg</button>
            ))}
            <button className={"chip" + (rebookDays === "altro" ? " on" : "")} onClick={() => setRebookDays("altro")}>altro</button>
            <button className={"chip" + (rebookDays === "none" ? " on" : "")} onClick={() => setRebookDays("none")}>non necessario</button>
            {rebookDays === "altro" && <input type="number" min={1} value={rebookCustom} style={{ width: 70 }} onChange={e => setRebookCustom(Number(e.target.value))} />}
          </div>

          <div className="two-col">
            <div><label className="fld">Note tecniche (ricetta colore, tecniche…)</label><textarea rows={3} style={{ width: "100%" }} value={form.tech} onChange={e => setForm({ ...form, tech: e.target.value })} /></div>
            <div><label className="fld">Note personali (conversazioni da riprendere…)</label><textarea rows={3} style={{ width: "100%" }} value={form.pers} onChange={e => setForm({ ...form, pers: e.target.value })} /></div>
          </div>
          <button className="btn" style={{ marginTop: 16 }} onClick={invia} disabled={done.filter(d => d.change_type !== "removed").length === 0}>✓ Invia alla reception</button>
        </div>
        );
      })()}

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
          {myKpi && (myKpi.upsell > 0 || myKpi.prodOp > 0 || myKpi.rbSugg > 0) && (
            <div className="grid kpis section">
              <div className="card"><div className="kpi-label">Up-sell servizi generato</div><div className="kpi-value" style={{ color: "#1e7a4f" }}>{eur(myKpi.upsell, 0)}</div><div className="kpi-note">valore oltre il prenotato (base bonus)</div></div>
              <div className="card"><div className="kpi-label">Prodotti su tua proposta</div><div className="kpi-value">{eur(myKpi.prodOp, 0)}</div><div className="kpi-note">confermati dalla reception</div></div>
              <div className="card"><div className="kpi-label">Rebooking</div><div className="kpi-value">{myKpi.rbSugg > 0 ? Math.round(myKpi.rbConf / myKpi.rbSugg * 100) + "%" : "—"}</div><div className="kpi-note">{myKpi.rbConf} confermati su {myKpi.rbSugg} suggeriti</div></div>
            </div>
          )}
          {occ && occ.total > 0 && (
            <div className="card section" style={{ borderColor: "#c9a227", borderWidth: 2 }}>
              <div className="section-title">
                <h2>La mia occupazione</h2>
                <b style={{ fontSize: 22, color: occ.pct >= 0.75 ? "#1e7a4f" : occ.pct >= 0.5 ? "#b8860b" : "#b3402a" }}>{Math.round(occ.pct * 100)}%</b>
              </div>
              <div className="bar-track" style={{ height: 14 }}>
                <div className="bar-fill" style={{ width: Math.min(100, occ.pct * 100) + "%", background: occ.pct >= 0.75 ? "#1e7a4f" : "var(--gold)" }} />
              </div>
              <p className="sub" style={{ marginTop: 6 }}>minuti occupati sui minuti già trascorsi del mese</p>
              <div className="grid kpis" style={{ marginTop: 10 }}>
                <div className="card"><div className="kpi-label">Minuti disponibili nel mese</div><div className="kpi-value">{num(occ.total)}</div><div className="kpi-note">{num(Math.round(occ.total / 60))} ore dai tuoi turni</div></div>
                <div className="card"><div className="kpi-label">Minuti trascorsi</div><div className="kpi-value">{num(occ.elapsed)}</div><div className="kpi-note">da inizio mese a oggi</div></div>
                <div className="card"><div className="kpi-label">Minuti mancanti</div><div className="kpi-value">{num(occ.remaining)}</div><div className="kpi-note">alla fine del mese</div></div>
                <div className="card gold"><div className="kpi-label">Minuti occupati</div><div className="kpi-value">{num(occ.occupied)}</div><div className="kpi-note">lavoro in poltrona fino a ora</div></div>
              </div>
            </div>
          )}
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
              if (occ && occ.elapsed > 600) {
                if (occ.pct >= 0.75 && salonAvg > 0 && tot < salonAvg * 0.85) tips.push("Sei molto occupato (" + Math.round(occ.pct * 100) + "%) ma il lavorato non segue: il limite è il mix di servizi. Punta su servizi a valore più alto e upgrade, non su più clienti.");
                if (occ.pct < 0.5) tips.push("La tua agenda è occupata solo al " + Math.round(occ.pct * 100) + "%: ogni riappuntamento chiuso in poltrona riempie i " + num(occ.remaining) + " minuti che mancano a fine mese.");
              }
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
