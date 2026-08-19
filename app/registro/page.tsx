"use client";
import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { eur, num } from "@/lib/gps";

type Tx = { id: string; tx_date: string; description: string | null; worked_value: number; cash_value: number; kind: string; status: string; staff_id: string | null; data_quality: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
function rangeFor(preset: string): { from: string; to: string } {
  const now = new Date(); const t = iso(now);
  const y = now.getFullYear(), m = now.getMonth();
  switch (preset) {
    case "oggi": return { from: t, to: t };
    case "settimana": { const d = new Date(now); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return { from: iso(d), to: t }; }
    case "mese": return { from: iso(new Date(y, m, 1)), to: t };
    case "mese-scorso": return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "30gg": { const d = new Date(now); d.setDate(d.getDate() - 29); return { from: iso(d), to: t }; }
    case "anno": return { from: iso(new Date(y, 0, 1)), to: t };
    default: return { from: iso(new Date(y, m, 1)), to: t };
  }
}
// periodo precedente equivalente (stessa durata, o stesso periodo del ciclo precedente)
function prevRange(preset: string, r: { from: string; to: string }): { from: string; to: string; label: string } {
  const f = new Date(r.from), tt = new Date(r.to);
  if (preset === "mese") { const pf = new Date(f.getFullYear(), f.getMonth() - 1, 1); const pt = new Date(pf.getFullYear(), pf.getMonth(), Math.min(tt.getDate(), new Date(pf.getFullYear(), pf.getMonth() + 1, 0).getDate())); return { from: iso(pf), to: iso(pt), label: "mese scorso alla stessa data" }; }
  if (preset === "anno") { const pf = new Date(f.getFullYear() - 1, 0, 1); const pt = new Date(tt.getFullYear() - 1, tt.getMonth(), tt.getDate()); return { from: iso(pf), to: iso(pt), label: "anno scorso alla stessa data" }; }
  const days = Math.round((tt.getTime() - f.getTime()) / 86400000) + 1;
  const pt = new Date(f); pt.setDate(pt.getDate() - 1);
  const pf = new Date(pt); pf.setDate(pf.getDate() - days + 1);
  return { from: iso(pf), to: iso(pt), label: "periodo precedente equivalente" };
}

const PRESETS = [["oggi", "Oggi"], ["settimana", "Settimana"], ["mese", "Mese in corso"], ["mese-scorso", "Mese scorso"], ["30gg", "Ultimi 30 gg"], ["anno", "Anno in corso"], ["custom", "Personalizzato"]];

export default function Registro() {
  const ctx = useOrg();
  const today = new Date().toISOString().slice(0, 10);
  const [preset, setPreset] = useState("mese");
  const [custom, setCustom] = useState({ from: today.slice(0, 8) + "01", to: today });
  const [txs, setTxs] = useState<Tx[]>([]);
  const [prev, setPrev] = useState<Tx[]>([]);
  const [prevLabel, setPrevLabel] = useState("");
  const [staff, setStaff] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState({ tx_date: today, description: "", worked_value: 0, cash_value: 0, kind: "service", staff_id: "" });

  const range = preset === "custom" ? custom : rangeFor(preset);

  const load = async () => {
    const { data } = await supabase.from("transactions").select("*")
      .eq("organization_id", ctx.orgId).gte("tx_date", range.from).lte("tx_date", range.to)
      .order("tx_date", { ascending: false }).limit(1000);
    setTxs((data ?? []) as any);
    const pr = prevRange(preset === "custom" ? "x" : preset, range);
    setPrevLabel(pr.label);
    const { data: pd } = await supabase.from("transactions").select("worked_value,cash_value,kind,status,tx_date")
      .eq("organization_id", ctx.orgId).gte("tx_date", pr.from).lte("tx_date", pr.to).limit(2000);
    setPrev((pd ?? []) as any);
  };

  useEffect(() => {
    if (!ctx.orgId) return;
    load();
    supabase.from("staff_members").select("id,display_name").eq("organization_id", ctx.orgId)
      .then(({ data }) => setStaff(Object.fromEntries((data ?? []).map((s: any) => [s.id, s.display_name]))));
  }, [ctx.orgId, preset, custom.from, custom.to]);

  const agg = (list: Tx[]) => {
    const done = list.filter(t => t.status === "completed");
    const by = (k: string) => done.filter(t => t.kind === k);
    return {
      n: done.length,
      worked: done.reduce((a, t) => a + Number(t.worked_value), 0),
      cash: done.reduce((a, t) => a + Number(t.cash_value), 0),
      wServices: by("service").reduce((a, t) => a + Number(t.worked_value), 0),
      wProducts: by("product").reduce((a, t) => a + Number(t.worked_value), 0),
      cServices: by("service").reduce((a, t) => a + Number(t.cash_value), 0),
      cProducts: by("product").reduce((a, t) => a + Number(t.cash_value), 0),
      cRecharge: by("recharge").reduce((a, t) => a + Number(t.cash_value), 0),
      ticket: by("service").length ? by("service").reduce((a, t) => a + Number(t.worked_value), 0) / by("service").length : 0,
    };
  };
  const A = useMemo(() => agg(txs), [txs]);
  const P = useMemo(() => agg(prev), [prev]);
  const delta = (a: number, b: number) => b > 0 ? Math.round((a - b) / b * 100) : null;
  const D = ({ a, b }: { a: number; b: number }) => {
    const d = delta(a, b);
    if (d == null) return <span className="sub">—</span>;
    return <b style={{ color: d >= 0 ? "#1e7a4f" : "#b3402a", fontSize: 12.5 }}>{d >= 0 ? "▲ +" : "▼ "}{d}%</b>;
  };

  const add = async () => {
    await supabase.from("transactions").insert({
      organization_id: ctx.orgId, tx_date: draft.tx_date, description: draft.description || null,
      worked_value: draft.kind === "recharge" ? 0 : draft.worked_value, cash_value: draft.cash_value, kind: draft.kind,
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
          <p className="sub">{range.from} → {range.to} · confronto vs {prevLabel}</p>
        </div>
      </div>

      <div className="filters" style={{ marginBottom: 10 }}>
        {PRESETS.map(([k, l]) => <button key={k} className={"chip" + (preset === k ? " on" : "")} onClick={() => setPreset(k)}>{l}</button>)}
        {preset === "custom" && (<>
          <input type="date" value={custom.from} onChange={e => setCustom({ ...custom, from: e.target.value })} />
          <input type="date" value={custom.to} onChange={e => setCustom({ ...custom, to: e.target.value })} />
        </>)}
      </div>

      <div className="grid kpis">
        <div className="card"><div className="kpi-label">Lavorato</div><div className="kpi-value" style={{ color: "#1e7a4f" }}>{eur(A.worked, 0)}</div><div className="kpi-note"><D a={A.worked} b={P.worked} /> vs {eur(P.worked, 0)}</div></div>
        <div className="card"><div className="kpi-label">Incassato</div><div className="kpi-value" style={{ color: "#2456c6" }}>{eur(A.cash, 0)}</div><div className="kpi-note"><D a={A.cash} b={P.cash} /> vs {eur(P.cash, 0)}</div></div>
        <div className="card"><div className="kpi-label">Scostamento</div><div className="kpi-value" style={{ color: A.cash - A.worked >= 0 ? "#1e7a4f" : "#b3402a" }}>{eur(A.cash - A.worked, 0)}</div><div className="kpi-note">incassato − lavorato</div></div>
        <div className="card"><div className="kpi-label">Scontrino medio</div><div className="kpi-value">{A.ticket ? eur(A.ticket) : "—"}</div><div className="kpi-note"><D a={A.ticket} b={P.ticket} /> vs {P.ticket ? eur(P.ticket) : "—"}</div></div>
        <div className="card dark"><div className="kpi-label">Transazioni</div><div className="kpi-value">{num(A.n)}</div><div className="kpi-note"><D a={A.n} b={P.n} /> vs {num(P.n)}</div></div>
      </div>

      <div className="grid kpis section">
        <div className="card"><div className="kpi-label">Lavorato servizi</div><div className="kpi-value" style={{ fontSize: 22 }}>{eur(A.wServices, 0)}</div></div>
        <div className="card"><div className="kpi-label">Lavorato prodotti</div><div className="kpi-value" style={{ fontSize: 22 }}>{eur(A.wProducts, 0)}</div></div>
        <div className="card"><div className="kpi-label">Incasso servizi</div><div className="kpi-value" style={{ fontSize: 22 }}>{eur(A.cServices, 0)}</div></div>
        <div className="card"><div className="kpi-label">Incasso prodotti</div><div className="kpi-value" style={{ fontSize: 22 }}>{eur(A.cProducts, 0)}</div></div>
        <div className="card" style={{ borderColor: "#c9a227" }}><div className="kpi-label">Incasso ricariche prepagate</div><div className="kpi-value" style={{ fontSize: 22 }}>{eur(A.cRecharge, 0)}</div><div className="kpi-note">vendita credito ≠ erogazione: il lavorato arriverà all'uso (INV-01/02)</div></div>
      </div>

      <div className="card section" style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <div><label className="fld">Data</label><input type="date" value={draft.tx_date} onChange={e => setDraft({ ...draft, tx_date: e.target.value })} /></div>
        <div style={{ flex: 1, minWidth: 160 }}><label className="fld">Descrizione</label><input style={{ width: "100%" }} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></div>
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
        <div><label className="fld">Lavorato €</label><input type="number" style={{ width: 96 }} disabled={draft.kind === "recharge"} value={draft.kind === "recharge" ? 0 : draft.worked_value} onChange={e => setDraft({ ...draft, worked_value: Number(e.target.value) })} /></div>
        <div><label className="fld">Incassato €</label><input type="number" style={{ width: 96 }} value={draft.cash_value} onChange={e => setDraft({ ...draft, cash_value: Number(e.target.value) })} /></div>
        <button className="btn" onClick={add}>+ Registra</button>
      </div>

      <div className="section">
        <table className="tbl">
          <thead><tr><th>Data</th><th>Descrizione</th><th>Tipo</th><th>Operatore</th><th className="num">Lavorato</th><th className="num">Incassato</th><th>Qualità</th></tr></thead>
          <tbody>
            {txs.slice(0, 200).map(t => (
              <tr key={t.id}>
                <td>{t.tx_date}</td><td>{t.description ?? "—"}</td><td>{t.kind}</td>
                <td>{t.staff_id ? staff[t.staff_id] : "—"}</td>
                <td className="num">{eur(Number(t.worked_value))}</td>
                <td className="num">{eur(Number(t.cash_value))}</td>
                <td className="tag-quality">{t.data_quality}</td>
              </tr>
            ))}
            {txs.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "#6d7a72", padding: 24 }}>Nessuna transazione nel periodo.</td></tr>}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
