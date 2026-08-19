"use client";
import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { eur, num } from "@/lib/gps";

type Tx = { id: string; tx_date: string; description: string | null; worked_value: number; cash_value: number; kind: string; status: string; staff_id: string | null; data_quality: string };

export default function Registro() {
  const ctx = useOrg();
  const today = new Date().toISOString().slice(0, 10);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [txs, setTxs] = useState<Tx[]>([]);
  const [staff, setStaff] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState({ tx_date: today, description: "", worked_value: 0, cash_value: 0, kind: "service", staff_id: "" });

  const load = async () => {
    const from = month + "-01";
    const d = new Date(from); d.setMonth(d.getMonth() + 1);
    const to = d.toISOString().slice(0, 10);
    const { data } = await supabase.from("transactions").select("*")
      .eq("organization_id", ctx.orgId).gte("tx_date", from).lt("tx_date", to)
      .order("tx_date", { ascending: false }).limit(500);
    setTxs((data ?? []) as any);
  };

  useEffect(() => {
    if (!ctx.orgId) return;
    load();
    supabase.from("staff_members").select("id,display_name").eq("organization_id", ctx.orgId)
      .then(({ data }) => setStaff(Object.fromEntries((data ?? []).map((s: any) => [s.id, s.display_name]))));
  }, [ctx.orgId, month]);

  const tot = useMemo(() => ({
    worked: txs.filter(t => t.status === "completed").reduce((a, t) => a + Number(t.worked_value), 0),
    cash: txs.filter(t => t.status === "completed").reduce((a, t) => a + Number(t.cash_value), 0),
    n: txs.filter(t => t.status === "completed").length,
  }), [txs]);

  const add = async () => {
    await supabase.from("transactions").insert({
      organization_id: ctx.orgId, tx_date: draft.tx_date, description: draft.description || null,
      worked_value: draft.worked_value, cash_value: draft.cash_value, kind: draft.kind,
      staff_id: draft.staff_id || null, data_quality: "observed",
    });
    setDraft({ ...draft, description: "", worked_value: 0, cash_value: 0 });
    load();
  };

  return (
    <Shell ctx={ctx}>
      <div className="page-head">
        <div>
          <h1>Registro Economico</h1>
          <p className="sub">Lavorato e incassato sono grandezze diverse (Blueprint §16) — qui restano separate sempre.</p>
        </div>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
      </div>

      <div className="grid kpis">
        <div className="card dark"><div className="kpi-label">Transazioni</div><div className="kpi-value">{num(tot.n)}</div></div>
        <div className="card"><div className="kpi-label">Lavorato</div><div className="kpi-value" style={{ color: "#1e7a4f" }}>{eur(tot.worked, 0)}</div></div>
        <div className="card"><div className="kpi-label">Incassato</div><div className="kpi-value" style={{ color: "#2456c6" }}>{eur(tot.cash, 0)}</div></div>
        <div className="card"><div className="kpi-label">Scostamento</div><div className="kpi-value" style={{ color: tot.cash - tot.worked >= 0 ? "#1e7a4f" : "#b3402a" }}>{eur(tot.cash - tot.worked, 0)}</div><div className="kpi-note">incassato − lavorato</div></div>
        <div className="card"><div className="kpi-label">Scontrino medio</div><div className="kpi-value">{tot.n ? eur(tot.worked / tot.n) : "—"}</div></div>
      </div>

      <div className="card section" style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <div><label className="fld">Data</label><input type="date" value={draft.tx_date} onChange={e => setDraft({ ...draft, tx_date: e.target.value })} /></div>
        <div style={{ flex: 1, minWidth: 160 }}><label className="fld">Descrizione</label><input style={{ width: "100%" }} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="es. Taglio + Barba — Rossi" /></div>
        <div><label className="fld">Tipo</label>
          <select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value })}>
            <option value="service">Servizio</option><option value="product">Prodotto</option>
            <option value="recharge">Ricarica prepagata</option><option value="other">Altro</option>
          </select>
        </div>
        <div><label className="fld">Operatore</label>
          <select value={draft.staff_id} onChange={e => setDraft({ ...draft, staff_id: e.target.value })}>
            <option value="">—</option>
            {Object.entries(staff).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        </div>
        <div><label className="fld">Lavorato €</label><input type="number" style={{ width: 100 }} value={draft.worked_value} onChange={e => setDraft({ ...draft, worked_value: Number(e.target.value) })} /></div>
        <div><label className="fld">Incassato €</label><input type="number" style={{ width: 100 }} value={draft.cash_value} onChange={e => setDraft({ ...draft, cash_value: Number(e.target.value) })} /></div>
        <button className="btn" onClick={add}>+ Registra</button>
      </div>
      {draft.kind === "recharge" && <div className="alert">Regola INV-01: una ricarica prepagata genera <b>incassato</b>, mai lavorato. Lascia Lavorato a 0.</div>}

      <div className="section">
        <table className="tbl">
          <thead><tr><th>Data</th><th>Descrizione</th><th>Tipo</th><th>Operatore</th><th className="num">Lavorato</th><th className="num">Incassato</th><th>Qualità</th></tr></thead>
          <tbody>
            {txs.map(t => (
              <tr key={t.id}>
                <td>{t.tx_date}</td><td>{t.description ?? "—"}</td><td>{t.kind}</td>
                <td>{t.staff_id ? staff[t.staff_id] : "—"}</td>
                <td className="num">{eur(Number(t.worked_value))}</td>
                <td className="num">{eur(Number(t.cash_value))}</td>
                <td className="tag-quality">{t.data_quality}</td>
              </tr>
            ))}
            {txs.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "#6d7a72", padding: 24 }}>Nessuna transazione nel mese — importale dal gestionale con “Import dati” o registrale qui.</td></tr>}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
