"use client";
import { useEffect, useState } from "react";
import PlatformShell from "@/components/PlatformShell";
import { useOrg, enterSalon } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { eur, num } from "@/lib/gps";

type Org = { id: string; name: string; slug: string; created_at: string };
type OrgStats = { clients: number; value: number; invites: number; claimed: number; atRisk: number };

export default function Saloni() {
  const ctx = useOrg();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [stats, setStats] = useState<Record<string, OrgStats>>({});
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [d, setD] = useState({ name: "", owner_email: "", monthly_total: 10000, coefficient: 1.0, opening_time: "08:30" });

  const load = async () => {
    const { data } = await supabase.from("organizations").select("id,name,slug,created_at").order("created_at");
    const list = (data ?? []) as Org[];
    setOrgs(list);
    const { data: inv } = await supabase.from("org_invites").select("organization_id,claimed_at");
    const acc: Record<string, OrgStats> = {};
    for (const o of list) acc[o.id] = { clients: 0, value: 0, invites: 0, claimed: 0, atRisk: 0 };
    for (const i of (inv ?? []) as any[]) {
      if (!acc[i.organization_id]) continue;
      acc[i.organization_id].invites++;
      if (i.claimed_at) acc[i.organization_id].claimed++;
    }
    // statistiche per salone (conteggi head, leggeri)
    for (const o of list) {
      const { count: nClients } = await supabase.from("clients").select("id", { count: "exact", head: true }).eq("organization_id", o.id);
      const { count: nRisk } = await supabase.from("clients").select("id", { count: "exact", head: true }).eq("organization_id", o.id).eq("at_risk", true);
      acc[o.id].clients = nClients ?? 0;
      acc[o.id].atRisk = nRisk ?? 0;
    }
    setStats({ ...acc });
  };
  useEffect(() => { if (!ctx.loading && ctx.isAdmin) load(); }, [ctx.loading, ctx.isAdmin]);

  const create = async () => {
    if (!d.name || !d.owner_email) { setMsg({ t: "err", m: "Nome salone ed email del titolare sono obbligatori." }); return; }
    setBusy(true); setMsg(null);
    try {
      const slug = d.name.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 40) + "-" + Math.random().toString(36).slice(2, 6);
      const { data: org, error: e1 } = await supabase.from("organizations")
        .insert({ name: d.name, slug, opening_time: d.opening_time }).select().single();
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("memberships").insert({ organization_id: org.id, user_id: ctx.userId, role: "consulente" });
      if (e2) throw e2;
      const { error: e3 } = await supabase.from("org_invites").insert({ organization_id: org.id, email: d.owner_email.toLowerCase().trim(), role: "titolare" });
      if (e3) throw e3;
      const month = new Date().toISOString().slice(0, 7) + "-01";
      const { error: e4 } = await supabase.from("business_plans").insert({
        organization_id: org.id, month, status: "active",
        monthly_total: d.monthly_total, productive_coefficient: d.coefficient,
        notes: "Piano iniziale creato in onboarding — completare turni operatori in Pianificazione.",
      });
      if (e4) throw e4;
      setMsg({ t: "ok", m: `Salone "${d.name}" creato. Al primo login con ${d.owner_email} il titolare sarà collegato automaticamente. Entra nel salone per completare l'onboarding.` });
      setD({ ...d, name: "", owner_email: "" });
      setShowNew(false);
      load();
    } catch (e: any) {
      setMsg({ t: "err", m: "Creazione fallita: " + (e?.message ?? String(e)) });
    } finally { setBusy(false); }
  };

  if (!ctx.loading && !ctx.isAdmin) {
    // un utente salone non appartiene alla piattaforma: torna al suo workspace
    if (typeof window !== "undefined") window.location.href = "/";
    return null;
  }

  return (
    <PlatformShell ctx={ctx}>
      <div className="page-head">
        <div>
          <h1>I tuoi saloni</h1>
          <p className="sub">{num(orgs.length)} clienti GPS · seleziona un salone per aprire il suo workspace</p>
        </div>
        <button className="btn" onClick={() => setShowNew(!showNew)}>{showNew ? "Chiudi" : "+ Nuovo salone"}</button>
      </div>
      {msg && <div className={"alert" + (msg.t === "err" ? " err" : "")} style={msg.t === "ok" ? { background: "#d9e9dd", borderColor: "#9cc5a9", color: "#1e5c38" } : {}}>{msg.m}</div>}

      {showNew && (
        <div className="two-col" style={{ marginBottom: 20 }}>
          <div className="card" style={{ borderColor: "#c9a227", borderWidth: 2 }}>
            <div className="section-title"><h2>Nuovo salone</h2><span className="sub">passo 1 del metodo</span></div>
            <label className="fld">Nome salone</label>
            <input style={{ width: "100%", marginBottom: 10 }} value={d.name} onChange={e => setD({ ...d, name: e.target.value })} placeholder="es. Barberia Rossi" />
            <label className="fld">Email del titolare</label>
            <input style={{ width: "100%", marginBottom: 10 }} type="email" value={d.owner_email} onChange={e => setD({ ...d, owner_email: e.target.value })} placeholder="titolare@salone.it" />
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1 }}><label className="fld">Totale mensile da coprire €</label><input type="number" style={{ width: "100%" }} value={d.monthly_total} onChange={e => setD({ ...d, monthly_total: Number(e.target.value) })} /></div>
              <div><label className="fld">Coeff.</label><input type="number" step="0.05" style={{ width: 80 }} value={d.coefficient} onChange={e => setD({ ...d, coefficient: Number(e.target.value) })} /></div>
              <div><label className="fld">Apertura</label><input type="time" value={d.opening_time} onChange={e => setD({ ...d, opening_time: e.target.value })} /></div>
            </div>
            <button className="btn" onClick={create} disabled={busy}>{busy ? "Creo…" : "Crea salone + invito titolare"}</button>
          </div>
          <div className="card">
            <div className="section-title"><h2>Checklist onboarding</h2><span className="sub">il metodo del consulente GPS</span></div>
            <div className="step"><span className="n">1</span> Crea il salone qui (email titolare + totale mensile dal questionario costi).</div>
            <div className="step"><span className="n">2</span> Entra nel salone → <b>Team</b>: operatori con costi e obiettivi.</div>
            <div className="step"><span className="n">3</span> <b>Pianificazione</b>: turni settimanali → CAM automatico.</div>
            <div className="step"><span className="n">4</span> <b>Import</b>: storico clienti, anagrafica, catalogo, transazioni (Excel/CSV qualunque).</div>
            <div className="step"><span className="n">5</span> <b>Agenda</b>: collega calendario (Wix, Calendly o feed ICS).</div>
            <div className="step"><span className="n">6</span> Sessione di consegna: Dashboard + lista riattivazione col titolare.</div>
          </div>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))" }}>
        {orgs.map(o => {
          const s = stats[o.id];
          return (
            <div className="card" key={o.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <b className="serif" style={{ fontSize: 20 }}>{o.name}</b>
                <span className="sub">dal {new Date(o.created_at).toLocaleDateString("it-IT")}</span>
              </div>
              <div className="row"><span>Clienti in archivio</span><b>{s ? num(s.clients) : "…"}</b></div>
              <div className="row"><span>Clienti a rischio</span><b style={{ color: "#b3402a" }}>{s ? num(s.atRisk) : "…"}</b></div>
              <div className="row" style={{ borderBottom: "none" }}><span>Accessi attivati</span>
                <b>{s ? `${s.claimed}/${s.invites}` : "…"} {s && s.invites > 0 && s.claimed === s.invites && <span className="badge b-ok">ok</span>}{s && s.claimed < s.invites && <span className="badge b-warn">in attesa</span>}</b>
              </div>
              <button className="btn" style={{ marginTop: 8 }} onClick={() => enterSalon(o.id)}>Apri workspace →</button>
            </div>
          );
        })}
        {orgs.length === 0 && <div className="card" style={{ textAlign: "center", padding: 40 }}><p className="serif" style={{ fontSize: 18 }}>Nessun salone ancora — crea il primo.</p></div>}
      </div>
    </PlatformShell>
  );
}
