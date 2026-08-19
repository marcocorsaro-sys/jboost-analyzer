"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { useOrg, switchOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { num } from "@/lib/gps";

type Org = { id: string; name: string; slug: string; created_at: string };

export default function Saloni() {
  const ctx = useOrg();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [stats, setStats] = useState<Record<string, { invites: number; claimed: number }>>({});
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState({
    name: "", owner_email: "", monthly_total: 10000, coefficient: 1.0, opening_time: "08:30",
  });

  const load = async () => {
    const { data } = await supabase.from("organizations").select("id,name,slug,created_at").order("created_at");
    setOrgs((data ?? []) as any);
    const { data: inv } = await supabase.from("org_invites").select("organization_id,claimed_at");
    const acc: Record<string, { invites: number; claimed: number }> = {};
    for (const i of (inv ?? []) as any[]) {
      acc[i.organization_id] = acc[i.organization_id] || { invites: 0, claimed: 0 };
      acc[i.organization_id].invites++;
      if (i.claimed_at) acc[i.organization_id].claimed++;
    }
    setStats(acc);
  };
  useEffect(() => { if (ctx.orgId && ctx.isAdmin) load(); }, [ctx.orgId, ctx.isAdmin]);

  const create = async () => {
    if (!d.name || !d.owner_email) { setMsg({ t: "err", m: "Nome salone ed email del titolare sono obbligatori." }); return; }
    setBusy(true); setMsg(null);
    try {
      const slug = d.name.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 40) + "-" + Math.random().toString(36).slice(2, 6);
      const { data: org, error: e1 } = await supabase.from("organizations")
        .insert({ name: d.name, slug, opening_time: d.opening_time }).select().single();
      if (e1) throw e1;
      // il consulente GPS che crea il salone ne diventa membro subito
      const { error: e2 } = await supabase.from("memberships").insert({ organization_id: org.id, user_id: ctx.userId, role: "consulente" });
      if (e2) throw e2;
      // invito titolare (si collega da solo al primo login)
      const { error: e3 } = await supabase.from("org_invites").insert({ organization_id: org.id, email: d.owner_email.toLowerCase().trim(), role: "titolare" });
      if (e3) throw e3;
      // piano economico iniziale del mese corrente
      const month = new Date().toISOString().slice(0, 7) + "-01";
      const { error: e4 } = await supabase.from("business_plans").insert({
        organization_id: org.id, month, status: "active",
        monthly_total: d.monthly_total, productive_coefficient: d.coefficient,
        notes: "Piano iniziale creato in onboarding — completare turni operatori in Pianificazione.",
      });
      if (e4) throw e4;
      setMsg({ t: "ok", m: `Salone "${d.name}" creato. Invito inviato a ${d.owner_email}: al primo login con quella email sarà collegato come titolare. Ora entra nel salone e completa la checklist.` });
      setD({ ...d, name: "", owner_email: "" });
      load();
    } catch (e: any) {
      setMsg({ t: "err", m: "Creazione fallita: " + (e?.message ?? String(e)) });
    } finally { setBusy(false); }
  };

  if (!ctx.loading && !ctx.isAdmin) return <Shell ctx={ctx}><h1>Area riservata</h1><p className="sub">Solo gli admin GPS possono gestire i saloni.</p></Shell>;

  return (
    <Shell ctx={ctx}>
      <div className="page-head">
        <div>
          <h1>Saloni GPS</h1>
          <p className="sub">{num(orgs.length)} clienti attivi · onboarding assistito dal consulente GPS</p>
        </div>
      </div>
      {msg && <div className={"alert" + (msg.t === "err" ? " err" : "")} style={msg.t === "ok" ? { background: "#d9e9dd", borderColor: "#9cc5a9", color: "#1e5c38" } : {}}>{msg.m}</div>}

      <div className="two-col">
        <div className="card">
          <div className="section-title"><h2>Nuovo salone</h2></div>
          <label className="fld">Nome salone</label>
          <input style={{ width: "100%", marginBottom: 10 }} value={d.name} onChange={e => setD({ ...d, name: e.target.value })} placeholder="es. Barberia Rossi" />
          <label className="fld">Email del titolare</label>
          <input style={{ width: "100%", marginBottom: 10 }} type="email" value={d.owner_email} onChange={e => setD({ ...d, owner_email: e.target.value })} placeholder="titolare@salone.it" />
          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1 }}><label className="fld">Totale mensile da coprire €</label><input type="number" style={{ width: "100%" }} value={d.monthly_total} onChange={e => setD({ ...d, monthly_total: Number(e.target.value) })} /></div>
            <div><label className="fld">Coeff.</label><input type="number" step="0.05" style={{ width: 80 }} value={d.coefficient} onChange={e => setD({ ...d, coefficient: Number(e.target.value) })} /></div>
            <div><label className="fld">Apertura</label><input type="time" value={d.opening_time} onChange={e => setD({ ...d, opening_time: e.target.value })} /></div>
          </div>
          <button className="btn" onClick={create} disabled={busy}>{busy ? "Creo…" : "Crea salone + invito"}</button>
        </div>

        <div className="card">
          <div className="section-title"><h2>Checklist onboarding</h2><span className="sub">il metodo, replicabile</span></div>
          <div className="step"><span className="n">1</span> Crea il salone con email del titolare e totale mensile dal questionario costi.</div>
          <div className="step"><span className="n">2</span> Seleziona il salone dal menu in alto → <b>Team</b>: aggiungi gli operatori con costi e obiettivi.</div>
          <div className="step"><span className="n">3</span> <b>Pianificazione</b>: turni settimanali → il CAM si calcola da solo.</div>
          <div className="step"><span className="n">4</span> <b>Import</b>: carica storico clienti, anagrafica, catalogo e transazioni (qualunque export Excel/CSV).</div>
          <div className="step"><span className="n">5</span> <b>Agenda</b>: collega il calendario (Wix, Calendly o feed ICS).</div>
          <div className="step"><span className="n">6</span> Sessione di consegna col titolare: Dashboard + lista riattivazione.</div>
          <p className="sub" style={{ marginTop: 10 }}>Il titolare entra con la sua email al primo accesso e trova tutto pronto. Le righe ambigue degli import restano in quarantena, mai trasformate in dati certi.</p>
        </div>
      </div>

      <div className="section">
        <table className="tbl">
          <thead><tr><th>Salone</th><th>Slug</th><th>Creato</th><th>Inviti</th><th></th></tr></thead>
          <tbody>
            {orgs.map(o => (
              <tr key={o.id}>
                <td><b>{o.name}</b></td>
                <td className="mono">{o.slug}</td>
                <td>{new Date(o.created_at).toLocaleDateString("it-IT")}</td>
                <td>{stats[o.id] ? `${stats[o.id].claimed}/${stats[o.id].invites} attivati` : "—"}</td>
                <td><button className="btn sm secondary" onClick={() => switchOrg(o.id)}>Entra →</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
