"use client";
import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { num } from "@/lib/gps";
import { ensureFreshCalendars } from "@/lib/autosync";

type Appt = { id: string; starts_at: string; ends_at: string | null; client_name: string | null; staff_id: string | null; service_name: string | null; status: string; source_system: string };
type Staff = { id: string; display_name: string; color: string | null; active: boolean };
type Conn = { id: string; provider: string; label: string; config: any; staff_id: string | null; status: string; last_sync_at: string | null; last_result: string | null };

const H_START = 8, H_END = 20, PX_PER_MIN = 1.1;

export default function Agenda() {
  const ctx = useOrg();
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [appts, setAppts] = useState<Appt[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [conns, setConns] = useState<Conn[]>([]);
  const [showConn, setShowConn] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState({ time: "10:00", duration: 45, client_name: "", service_name: "", staff_id: "" });
  const [connDraft, setConnDraft] = useState({ provider: "ics", label: "", ics_url: "", token: "", api_key: "", site_id: "", staff_id: "" });

  const load = async () => {
    const from = day + "T00:00:00", to = day + "T23:59:59";
    const { data } = await supabase.from("appointments").select("*")
      .eq("organization_id", ctx.orgId).gte("starts_at", from).lte("starts_at", to)
      .order("starts_at");
    setAppts((data ?? []) as any);
  };

  useEffect(() => {
    if (!ctx.orgId) return;
    load();
    supabase.from("staff_members").select("id,display_name,color,active").eq("organization_id", ctx.orgId).eq("active", true)
      .then(({ data }) => setStaff((data ?? []) as any));
    loadConns();
  }, [ctx.orgId, day]);

  // §5 spec Dimitar: niente pulsante "Sincronizza" — l'agenda si aggiorna da sola
  // (all'apertura e ogni 5 minuti; il sync parte solo se una connessione è stantia)
  useEffect(() => {
    if (!ctx.orgId) return;
    const run = async () => {
      setSyncing(true);
      await ensureFreshCalendars(ctx.orgId!, () => { load(); loadConns(); });
      setSyncing(false);
    };
    run();
    const t = setInterval(run, 300000);
    return () => clearInterval(t);
  }, [ctx.orgId]);

  const loadConns = async () => {
    const { data } = await supabase.from("calendar_connections").select("*").eq("organization_id", ctx.orgId).order("created_at");
    setConns((data ?? []) as any);
  };

  const syncAll = async () => {
    setSyncing(true); setMsg(null);
    const { data: { session } } = await supabase.auth.getSession();
    let tot = 0; const errs: string[] = [];
    for (const c of conns.filter(c => c.status !== "disabled")) {
      try {
        const res = await fetch("/api/calendar-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + session?.access_token },
          body: JSON.stringify({ connection_id: c.id }),
        });
        const j = await res.json();
        if (res.ok) tot += j.count; else errs.push(c.label + ": " + j.error);
      } catch (e: any) { errs.push(c.label + ": " + e.message); }
    }
    setSyncing(false);
    setMsg(errs.length ? "Sync parziale (" + tot + " ok): " + errs.join(" · ") : "Sincronizzati " + tot + " appuntamenti.");
    load(); loadConns();
  };

  const addConn = async () => {
    const config = connDraft.provider === "ics" ? { ics_url: connDraft.ics_url }
      : connDraft.provider === "calendly" ? { token: connDraft.token }
      : { api_key: connDraft.api_key, site_id: connDraft.site_id };
    await supabase.from("calendar_connections").insert({
      organization_id: ctx.orgId, provider: connDraft.provider,
      label: connDraft.label || connDraft.provider.toUpperCase(),
      config, staff_id: connDraft.staff_id || null,
    });
    setConnDraft({ ...connDraft, label: "", ics_url: "", token: "", api_key: "", site_id: "" });
    loadConns();
  };

  const addManual = async () => {
    const starts = day + "T" + draft.time + ":00";
    const ends = new Date(new Date(starts).getTime() + draft.duration * 60000).toISOString();
    await supabase.from("appointments").insert({
      organization_id: ctx.orgId, starts_at: starts, ends_at: ends,
      client_name: draft.client_name || null, service_name: draft.service_name || null,
      staff_id: draft.staff_id || null, source_system: "manual",
    });
    setDraft({ ...draft, client_name: "", service_name: "" });
    load();
  };

  const setStatus = async (id: string, status: string) => {
    await supabase.from("appointments").update({ status }).eq("id", id);
    setAppts(appts.map(a => a.id === id ? { ...a, status } : a));
  };

  const cols = useMemo(() => {
    const c: { staff: Staff | null; items: Appt[] }[] = staff.map(s => ({ staff: s, items: [] as Appt[] }));
    c.push({ staff: null, items: [] });
    for (const a of appts.filter(a => a.status !== "cancelled")) {
      const col = c.find(x => x.staff?.id === a.staff_id) ?? c[c.length - 1];
      col.items.push(a);
    }
    return c;
  }, [appts, staff]);

  const timePos = (iso: string) => {
    const d = new Date(iso);
    const mins = (d.getHours() - H_START) * 60 + d.getMinutes();
    return Math.max(0, mins * PX_PER_MIN);
  };
  const blockH = (a: Appt) => {
    const start = new Date(a.starts_at).getTime();
    const end = a.ends_at ? new Date(a.ends_at).getTime() : start + 30 * 60000;
    return Math.max(28, ((end - start) / 60000) * PX_PER_MIN);
  };
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

  return (
    <Shell ctx={ctx}>
      <div className="page-head">
        <div>
          <h1>Agenda</h1>
          <p className="sub">{num(appts.filter(a => a.status !== "cancelled").length)} appuntamenti · fonti: manuale{conns.length ? " + " + conns.map(c => c.label).join(", ") : ""}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="date" value={day} onChange={e => setDay(e.target.value)} />
          {syncing && <span className="badge b-warn" style={{ alignSelf: "center" }}>⟳ sync automatico…</span>}
          <button className="btn secondary" onClick={() => setShowConn(!showConn)}>{showConn ? "Chiudi connessioni" : "Connessioni (" + conns.length + ")"}</button>
        </div>
      </div>
      {msg && <div className="alert">{msg}</div>}

      {showConn && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="section-title"><h2>Connessioni calendario</h2><span className="sub">Wix · Calendly · qualunque feed iCal/ICS (Google Calendar, Acuity, Squarespace…)</span></div>
          {conns.map(c => (
            <div key={c.id} className="row">
              <span><b>{c.label}</b> · {c.provider}{c.staff_id && staff.find(s => s.id === c.staff_id) ? " → " + staff.find(s => s.id === c.staff_id)!.display_name : ""}</span>
              <span style={{ fontSize: 12.5 }}>
                <span className={"badge " + (c.status === "active" ? "b-ok" : c.status === "error" ? "b-risk" : "b-warn")}>{c.status}</span>
                {" "}{c.last_result ?? "mai sincronizzata"}
                <button className="btn sm secondary" style={{ marginLeft: 8 }} onClick={async () => { await supabase.from("calendar_connections").delete().eq("id", c.id); loadConns(); }}>Rimuovi</button>
              </span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap", marginTop: 14 }}>
            <div><label className="fld">Piattaforma</label>
              <select value={connDraft.provider} onChange={e => setConnDraft({ ...connDraft, provider: e.target.value })}>
                <option value="ics">Feed iCal/ICS (universale)</option>
                <option value="calendly">Calendly (token)</option>
                <option value="wix">Wix Bookings (API key)</option>
              </select>
            </div>
            <div><label className="fld">Etichetta</label><input value={connDraft.label} onChange={e => setConnDraft({ ...connDraft, label: e.target.value })} placeholder="es. Calendario Dimitar" /></div>
            {connDraft.provider === "ics" && <div style={{ flex: 1, minWidth: 260 }}><label className="fld">URL feed ICS</label><input style={{ width: "100%" }} value={connDraft.ics_url} onChange={e => setConnDraft({ ...connDraft, ics_url: e.target.value })} placeholder="https://…/calendar.ics" /></div>}
            {connDraft.provider === "calendly" && <div style={{ flex: 1, minWidth: 260 }}><label className="fld">Personal Access Token</label><input style={{ width: "100%" }} value={connDraft.token} onChange={e => setConnDraft({ ...connDraft, token: e.target.value })} placeholder="eyJra…" /></div>}
            {connDraft.provider === "wix" && (<>
              <div style={{ flex: 1, minWidth: 200 }}><label className="fld">API Key</label><input style={{ width: "100%" }} value={connDraft.api_key} onChange={e => setConnDraft({ ...connDraft, api_key: e.target.value })} /></div>
              <div><label className="fld">Site ID</label><input value={connDraft.site_id} onChange={e => setConnDraft({ ...connDraft, site_id: e.target.value })} /></div>
            </>)}
            <div><label className="fld">Operatore (opz.)</label>
              <select value={connDraft.staff_id} onChange={e => setConnDraft({ ...connDraft, staff_id: e.target.value })}>
                <option value="">— non assegnato —</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.display_name}</option>)}
              </select>
            </div>
            <button className="btn" onClick={addConn}>+ Collega</button>
          </div>
          <p className="sub" style={{ marginTop: 10 }}>Suggerimento: per Wix il metodo più rapido è attivare la sincronizzazione Wix→Google Calendar e incollare qui l'indirizzo ICS segreto del Google Calendar. Il connettore Wix API diretto richiede una API key del sito.</p>
        </div>
      )}

      <div className="card" style={{ marginBottom: 18, display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <div><label className="fld">Ora</label><input type="time" value={draft.time} onChange={e => setDraft({ ...draft, time: e.target.value })} /></div>
        <div><label className="fld">Durata min</label><input type="number" style={{ width: 80 }} value={draft.duration} onChange={e => setDraft({ ...draft, duration: Number(e.target.value) })} /></div>
        <div style={{ flex: 1, minWidth: 140 }}><label className="fld">Cliente</label><input style={{ width: "100%" }} value={draft.client_name} onChange={e => setDraft({ ...draft, client_name: e.target.value })} /></div>
        <div style={{ flex: 1, minWidth: 140 }}><label className="fld">Servizio</label><input style={{ width: "100%" }} value={draft.service_name} onChange={e => setDraft({ ...draft, service_name: e.target.value })} /></div>
        <div><label className="fld">Operatore</label>
          <select value={draft.staff_id} onChange={e => setDraft({ ...draft, staff_id: e.target.value })}>
            <option value="">—</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.display_name}</option>)}
          </select>
        </div>
        <button className="btn" onClick={addManual}>+ Appuntamento</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `54px repeat(${cols.length}, 1fr)`, gap: 8, overflowX: "auto" }}>
        <div />
        {cols.map((c, i) => (
          <div key={i} style={{ borderTop: `4px solid ${c.staff?.color ?? "#8a8a8a"}`, background: "var(--card)", borderRadius: "8px 8px 0 0", padding: "8px 10px" }}>
            <b>{c.staff?.display_name ?? "Non assegnato"}</b>
            <div className="sub">{c.items.length} app.</div>
          </div>
        ))}
        <div style={{ position: "relative", height: (H_END - H_START) * 60 * PX_PER_MIN }}>
          {Array.from({ length: H_END - H_START + 1 }, (_, i) => (
            <div key={i} style={{ position: "absolute", top: i * 60 * PX_PER_MIN - 7, right: 4, fontSize: 11, color: "var(--muted)" }}>{String(H_START + i).padStart(2, "0")}:00</div>
          ))}
        </div>
        {cols.map((c, i) => (
          <div key={i} style={{ position: "relative", height: (H_END - H_START) * 60 * PX_PER_MIN, background: "var(--card)", border: "1px solid var(--line)", borderRadius: "0 0 8px 8px" }}>
            {Array.from({ length: H_END - H_START }, (_, h) => (
              <div key={h} style={{ position: "absolute", top: h * 60 * PX_PER_MIN, left: 0, right: 0, borderTop: "1px solid #eee5d2" }} />
            ))}
            {c.items.map(a => (
              <div key={a.id} title={(a.service_name ?? "") + " · " + a.source_system}
                style={{
                  position: "absolute", top: timePos(a.starts_at), left: 4, right: 4, height: blockH(a),
                  background: (c.staff?.color ?? "#8a8a8a") + "22", borderLeft: `4px solid ${c.staff?.color ?? "#8a8a8a"}`,
                  borderRadius: 7, padding: "3px 8px", fontSize: 12.5, overflow: "hidden",
                  opacity: a.status === "completed" ? .55 : 1,
                }}>
                <b>{hhmm(a.starts_at)}</b> {a.client_name ?? a.service_name ?? "—"}
                {a.status === "checked_in" && <span className="badge b-warn" style={{ marginLeft: 5 }}>in sala</span>}
                {a.status === "no_show" && <span className="badge b-risk" style={{ marginLeft: 5 }}>no-show</span>}
                <div style={{ marginTop: 2, display: "flex", gap: 4 }}>
                  {a.status === "confirmed" && <button className="btn sm secondary" onClick={() => setStatus(a.id, "checked_in")}>Check-in</button>}
                  {["confirmed", "checked_in", "in_service"].includes(a.status) && <button className="btn sm secondary" onClick={() => setStatus(a.id, "completed")}>✓</button>}
                  {a.status === "confirmed" && <button className="btn sm secondary" onClick={() => setStatus(a.id, "no_show")}>NS</button>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Shell>
  );
}
