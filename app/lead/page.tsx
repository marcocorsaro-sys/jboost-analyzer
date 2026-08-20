"use client";
// LIVELLO PIATTAFORMA — Lead del GPS Salon Check: funnel, segmentazione e follow-up (solo admin GPS)
import { useEffect, useMemo, useState } from "react";
import PlatformShell from "@/components/PlatformShell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { AREAS } from "@/lib/saloncheck";
import { num } from "@/lib/gps";

const STATUSES = ["new", "contacted", "nurturing", "customer"];
const S_LABEL: Record<string, string> = { new: "nuovo", contacted: "contattato", nurturing: "in coltivazione", customer: "cliente" };

export default function LeadPage() {
  const ctx = useOrg();
  const [leads, setLeads] = useState<any[]>([]);
  const [funnel, setFunnel] = useState<Record<string, number>>({});
  const [fArea, setFArea] = useState<string>("");
  const [fUrg, setFUrg] = useState<string>("");
  const [sel, setSel] = useState<any | null>(null);

  useEffect(() => {
    if (ctx.loading || !ctx.isAdmin) return;
    (async () => {
      const { data } = await supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(500);
      setLeads(data ?? []);
      const { data: ev } = await supabase.from("lead_events").select("kind");
      const f: Record<string, number> = {};
      for (const e of (ev ?? []) as any[]) f[e.kind] = (f[e.kind] ?? 0) + 1;
      setFunnel(f);
    })();
  }, [ctx.loading, ctx.isAdmin]);

  const view = useMemo(() => leads.filter(l =>
    (!fArea || l.primary_area === fArea) && (!fUrg || (l.urgency ?? "").startsWith(fUrg))), [leads, fArea, fUrg]);

  const setStatus = async (id: string, status: string) => {
    await supabase.from("leads").update({ status }).eq("id", id);
    setLeads(leads.map(l => l.id === id ? { ...l, status } : l));
  };

  if (!ctx.loading && !ctx.isAdmin) return <PlatformShell ctx={ctx}><p className="sub">Sezione riservata agli admin GPS.</p></PlatformShell>;

  const F = (k: string) => funnel[k] ?? 0;
  const pct = (a: number, b: number) => (b > 0 ? Math.round(a / b * 100) + "%" : "—");

  return (
    <PlatformShell ctx={ctx}>
      <div className="page-head">
        <div>
          <h1>Lead — GPS Salon Check</h1>
          <p className="sub">funnel: contenuto → check → lead segmentato → follow-up → libro → formazione → cliente GPS · landing: <b>/check</b></p>
        </div>
      </div>

      <div className="grid kpis">
        <div className="card"><div className="kpi-label">Visite landing</div><div className="kpi-value">{num(F("visit"))}</div></div>
        <div className="card"><div className="kpi-label">Test iniziati</div><div className="kpi-value">{num(F("test_started"))}</div><div className="kpi-note">{pct(F("test_started"), F("visit"))} delle visite</div></div>
        <div className="card"><div className="kpi-label">Test completati</div><div className="kpi-value">{num(F("test_completed"))}</div><div className="kpi-note">{pct(F("test_completed"), F("test_started"))} degli iniziati</div></div>
        <div className="card gold"><div className="kpi-label">Lead acquisiti</div><div className="kpi-value">{num(F("lead_captured"))}</div><div className="kpi-note">{pct(F("lead_captured"), F("test_completed"))} dei completati</div></div>
        <div className="card dark"><div className="kpi-label">Click verso il libro</div><div className="kpi-value">{num(F("cta_book"))}</div><div className="kpi-note">{pct(F("cta_book"), F("lead_captured"))} dei lead</div></div>
      </div>

      <div className="filters section" style={{ marginBottom: 10 }}>
        <button className={"chip" + (!fArea ? " on" : "")} onClick={() => setFArea("")}>Tutte le aree</button>
        {Object.entries(AREAS).map(([k, a]) => (
          <button key={k} className={"chip" + (fArea === k ? " on" : "")} onClick={() => setFArea(k)}>{a.icon} {a.label} ({leads.filter(l => l.primary_area === k).length})</button>
        ))}
        <span style={{ width: 12 }} />
        <button className={"chip" + (fUrg === "Molto" ? " on" : "")} onClick={() => setFUrg(fUrg === "Molto" ? "" : "Molto")}>🔥 Urgenza alta</button>
      </div>

      <table className="tbl">
        <thead><tr><th>Lead</th><th>Criticità 1ª</th><th>2ª</th><th>Team</th><th>Urgenza</th><th>Supporto</th><th>Stato</th><th>Quando</th></tr></thead>
        <tbody>
          {view.map(l => (
            <tr key={l.id} onClick={() => setSel(l)} style={{ cursor: "pointer" }}>
              <td><b>{l.name}</b><br /><span className="sub">{l.email}</span></td>
              <td>{AREAS[l.primary_area]?.icon} {AREAS[l.primary_area]?.label ?? "—"}</td>
              <td className="sub">{AREAS[l.secondary_area]?.label ?? "—"}</td>
              <td>{l.team_size ?? "—"}</td>
              <td>{(l.urgency ?? "").startsWith("Molto") ? <span className="badge b-risk">alta</span> : (l.urgency ?? "—").split(":")[0]}</td>
              <td className="sub">{l.support_pref ?? "—"}</td>
              <td onClick={e => e.stopPropagation()}>
                <select value={l.status} onChange={e => setStatus(l.id, e.target.value)}>
                  {STATUSES.map(s => <option key={s} value={s}>{S_LABEL[s]}</option>)}
                </select>
              </td>
              <td className="sub">{new Date(l.created_at).toLocaleDateString("it-IT")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {view.length === 0 && <p className="sub" style={{ marginTop: 10 }}>Nessun lead ancora{fArea || fUrg ? " con questi filtri" : " — condividi gps-pilot.vercel.app/check sui social per iniziare a raccoglierli"}.</p>}

      {sel && (
        <div className="drawer">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <h2 className="serif" style={{ margin: 0 }}>{sel.name}</h2>
            <button className="btn sm secondary" onClick={() => setSel(null)}>Chiudi ✕</button>
          </div>
          <p className="sub">{sel.email} · {new Date(sel.created_at).toLocaleString("it-IT")}</p>
          <div className="row"><span>Criticità principale</span><b>{AREAS[sel.primary_area]?.label}</b></div>
          <div className="row"><span>Secondaria</span><b>{AREAS[sel.secondary_area]?.label}</b></div>
          <div className="row"><span>Team / anzianità</span><b>{sel.team_size ?? "—"} · {sel.years ?? "—"}</b></div>
          <div className="row"><span>Urgenza</span><b>{sel.urgency ?? "—"}</b></div>
          <div className="row"><span>Supporto preferito</span><b>{sel.support_pref ?? "—"}</b></div>
          <div className="kpi-label" style={{ margin: "12px 0 6px" }}>Indice di criticità per area</div>
          {Object.entries(AREAS).map(([k, a]) => {
            const v = Number(sel.scores?.[k] ?? 0);
            return (
              <div key={k} style={{ margin: "6px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span>{a.icon} {a.label}</span><b>{v}</b></div>
                <div className="bar-track"><div className="bar-fill" style={{ width: v + "%", background: v > 66 ? "#b3402a" : v >= 34 ? "var(--gold)" : "#1e7a4f" }} /></div>
              </div>
            );
          })}
          <p className="sub" style={{ marginTop: 12 }}>Con questi dati i follow-up si segmentano per problema rilevato: stessa criticità → stessa sequenza di contenuti.</p>
        </div>
      )}
    </PlatformShell>
  );
}
