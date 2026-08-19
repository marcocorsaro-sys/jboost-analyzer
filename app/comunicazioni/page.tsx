"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";

type Comm = { id: string; title: string; body: string | null; active: boolean; created_at: string };

export default function Comunicazioni() {
  const ctx = useOrg();
  const [comms, setComms] = useState<Comm[]>([]);
  const [tab, setTab] = useState<"attive" | "archiviate">("attive");
  const [draft, setDraft] = useState({ title: "", body: "", requires_ack: true });
  const [showNew, setShowNew] = useState(false);
  const [ackCounts, setAckCounts] = useState<Record<string, number>>({});
  const [staffCount, setStaffCount] = useState(0);

  const load = async () => {
    const { data } = await supabase.from("communications").select("*").eq("organization_id", ctx.orgId).order("created_at", { ascending: false });
    setComms((data ?? []) as any);
    const { data: acks } = await supabase.from("communication_acks").select("communication_id").eq("organization_id", ctx.orgId);
    const cnt: Record<string, number> = {};
    for (const a of (acks ?? []) as any[]) cnt[a.communication_id] = (cnt[a.communication_id] ?? 0) + 1;
    setAckCounts(cnt);
    const { count } = await supabase.from("staff_members").select("id", { count: "exact", head: true }).eq("organization_id", ctx.orgId).eq("active", true);
    setStaffCount(count ?? 0);
  };
  useEffect(() => { if (ctx.orgId) load(); }, [ctx.orgId]);

  const add = async () => {
    if (!draft.title) return;
    await supabase.from("communications").insert({ organization_id: ctx.orgId, title: draft.title, body: draft.body || null, requires_ack: draft.requires_ack, created_by: ctx.userId });
    setDraft({ title: "", body: "", requires_ack: true }); setShowNew(false); load();
  };
  const toggle = async (c: Comm) => {
    await supabase.from("communications").update({ active: !c.active }).eq("id", c.id);
    load();
  };

  const view = comms.filter(c => tab === "attive" ? c.active : !c.active);

  return (
    <Shell ctx={ctx}>
      <div className="page-head">
        <div>
          <h1>Comunicazioni Ufficiali</h1>
          <p className="sub">Messaggi del titolare al team — supporto al metodo operativo, non un social interno.</p>
        </div>
        <button className="btn" onClick={() => setShowNew(!showNew)}>+ Nuova</button>
      </div>

      {showNew && (
        <div className="card" style={{ marginBottom: 16 }}>
          <label className="fld">Titolo</label>
          <input style={{ width: "100%", marginBottom: 10 }} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
          <label className="fld">Testo</label>
          <textarea rows={4} style={{ width: "100%", marginBottom: 12 }} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} />
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, fontSize: 14 }}>
            <input type="checkbox" checked={draft.requires_ack} onChange={e => setDraft({ ...draft, requires_ack: e.target.checked })} />
            Richiedi presa visione obbligatoria agli operatori (protocolli, regole, ferie…)
          </label>
          <button className="btn" onClick={add}>Pubblica</button>
        </div>
      )}

      <div className="filters" style={{ marginBottom: 16 }}>
        <button className={"chip" + (tab === "attive" ? " on" : "")} onClick={() => setTab("attive")}>Attive ({comms.filter(c => c.active).length})</button>
        <button className={"chip" + (tab === "archiviate" ? " on" : "")} onClick={() => setTab("archiviate")}>Archiviate ({comms.filter(c => !c.active).length})</button>
      </div>

      {view.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 46 }}>
          <p className="serif" style={{ fontSize: 19, margin: 0 }}>🔔 Nessuna comunicazione {tab === "attive" ? "attiva" : "archiviata"}</p>
        </div>
      )}
      {view.map(c => (
        <div className="card" key={c.id} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 10 }}>
            <div>
              <b className="serif" style={{ fontSize: 17 }}>{c.title}</b>
              {(c as any).requires_ack && (
                <span className={"badge " + ((ackCounts[c.id] ?? 0) >= staffCount && staffCount > 0 ? "b-ok" : "b-warn")} style={{ marginLeft: 8 }}>
                  presa visione {ackCounts[c.id] ?? 0}/{staffCount}
                </span>
              )}
              <p style={{ margin: "6px 0 0", fontSize: 14, whiteSpace: "pre-wrap" }}>{c.body}</p>
              <p className="sub" style={{ marginTop: 6 }}>{new Date(c.created_at).toLocaleString("it-IT")}</p>
            </div>
            <button className="btn sm secondary" onClick={() => toggle(c)}>{c.active ? "Archivia" : "Riattiva"}</button>
          </div>
        </div>
      ))}
    </Shell>
  );
}
