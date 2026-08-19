"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { fetchAllClients, ClientRow } from "@/lib/data";
import { eur, num, SEGMENT_LABEL } from "@/lib/gps";

const FILTERS = [
  { key: "tutti", label: "Tutti" },
  { key: "premium", label: "Premium" },
  { key: "fidelizzato", label: "Fidelizzati" },
  { key: "intermittente", label: "Intermittenti" },
  { key: "base", label: "Base" },
  { key: "rischio", label: "A rischio" },
  { key: "riattivazione", label: "Riattivazione (contattabili)" },
  { key: "duplicati", label: "Possibili duplicati" },
  { key: "senza-storico", label: "Senza storico" },
];

function ClientiInner() {
  const ctx = useOrg();
  const params = useSearchParams();
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState(params.get("f") ?? "tutti");
  const [sel, setSel] = useState<ClientRow | null>(null);

  useEffect(() => { if (ctx.orgId) fetchAllClients(ctx.orgId).then(setClients).catch(console.error); }, [ctx.orgId]);

  const view = useMemo(() => {
    if (!clients) return [];
    let v = clients.filter(c => !c.is_anonymous);
    if (filter === "rischio") v = v.filter(c => c.at_risk);
    else if (filter === "riattivazione") v = v.filter(c => c.at_risk && (c.phone || c.email) && c.privacy_consent);
    else if (filter === "duplicati") v = v.filter(c => c.duplicate_group).sort((a, b) => (a.duplicate_group! < b.duplicate_group! ? -1 : 1));
    else if (filter === "senza-storico") v = v.filter(c => c.visits_count === 0);
    else if (filter !== "tutti") v = v.filter(c => c.segment === filter);
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      v = v.filter(c => c.full_name.toLowerCase().includes(t) || (c.phone ?? "").includes(t) || (c.email ?? "").toLowerCase().includes(t));
    }
    return v.slice(0, 400);
  }, [clients, filter, q]);

  const totalShown = view.reduce((a, c) => a + Number(c.total_value), 0);

  return (
    <Shell ctx={ctx}>
      <div className="page-head">
        <div>
          <h1>Clienti</h1>
          <p className="sub">{clients ? num(clients.length - 1) + " schede reali + 1 flusso anonimo" : "…"} · vista: {num(view.length)} clienti · valore {eur(totalShown, 0)}</p>
        </div>
        <input placeholder="Cerca nome, telefono, email…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 300 }} />
      </div>

      <div className="filters" style={{ marginBottom: 16 }}>
        {FILTERS.map(f => (
          <button key={f.key} className={"chip" + (filter === f.key ? " on" : "")} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>

      {filter === "riattivazione" && (
        <div className="alert">Lista pronta per il contatto: clienti a rischio con telefono/email e consenso privacy. Esportala e assegnala alla reception. I clienti senza consenso non compaiono qui.</div>
      )}

      <table className="tbl">
        <thead><tr><th>Cliente</th><th>Segmento</th><th className="num">Passaggi</th><th className="num">Valore</th><th className="num">Fiche</th><th>Ultima visita</th><th className="num">Fermo da</th><th>Contatto</th><th></th></tr></thead>
        <tbody>
          {view.map(c => (
            <tr key={c.id} onClick={() => setSel(c)} style={{ cursor: "pointer" }}>
              <td><b>{c.full_name}</b>{c.duplicate_group && <span className="badge b-dup" style={{ marginLeft: 6 }}>dup {c.duplicate_group}</span>}</td>
              <td><span className={"badge b-" + (c.segment ?? "base")}>{SEGMENT_LABEL[c.segment ?? "base"]}</span></td>
              <td className="num">{num(c.visits_count)}</td>
              <td className="num"><b>{eur(Number(c.total_value), 0)}</b></td>
              <td className="num">{eur(c.avg_ticket)}</td>
              <td>{c.last_visit ?? "—"}</td>
              <td className="num">{c.recency_days != null ? c.recency_days + " gg" : "—"}</td>
              <td style={{ fontSize: 12.5 }}>{c.phone ?? c.email ?? <span className="badge b-warn">nessuno</span>}{c.privacy_consent === false && <span className="badge b-warn" style={{ marginLeft: 5 }}>no consenso</span>}</td>
              <td>{c.at_risk && <span className="badge b-risk">a rischio</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {view.length === 400 && <p className="sub" style={{ marginTop: 8 }}>Mostrati i primi 400 — affina la ricerca.</p>}

      {sel && (
        <div className="drawer">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
            <h2 className="serif" style={{ margin: 0 }}>{sel.full_name}</h2>
            <button className="btn sm secondary" onClick={() => setSel(null)}>Chiudi ✕</button>
          </div>
          <p style={{ marginTop: 6 }}>
            <span className={"badge b-" + (sel.segment ?? "base")}>{SEGMENT_LABEL[sel.segment ?? "base"]}</span>
            {sel.at_risk && <span className="badge b-risk" style={{ marginLeft: 6 }}>a rischio</span>}
            {sel.duplicate_group && <span className="badge b-dup" style={{ marginLeft: 6 }}>possibile duplicato</span>}
          </p>
          <div className="row"><span>Passaggi totali</span><b>{num(sel.visits_count)}</b></div>
          <div className="row"><span>Valore storico</span><b>{eur(Number(sel.total_value))}</b></div>
          <div className="row"><span>Fiche media</span><b>{eur(sel.avg_ticket)}</b></div>
          <div className="row"><span>Ultima visita</span><b>{sel.last_visit ?? "—"}</b></div>
          <div className="row"><span>Fermo da</span><b>{sel.recency_days != null ? sel.recency_days + " giorni" : "—"}</b></div>
          <div className="row"><span>Telefono</span><b>{sel.phone ?? "—"}</b></div>
          <div className="row"><span>Email</span><b style={{ fontSize: 12.5 }}>{sel.email ?? "—"}</b></div>
          <div className="row"><span>Data di nascita</span><b>{sel.birth_date ?? "—"}</b></div>
          <div className="row"><span>Consenso privacy</span><b>{sel.privacy_consent == null ? "—" : sel.privacy_consent ? "Sì" : "No"}</b></div>
          <div className="row"><span>Qualità dato</span><b className="tag-quality">{sel.data_quality}</b></div>
          <p className="sub" style={{ marginTop: 14 }}>Metriche ricostruite dallo storico del gestionale (2020 → oggi). Con l'arrivo delle transazioni live diventeranno <i>observed</i>.</p>
        </div>
      )}
    </Shell>
  );
}

export default function Clienti() {
  return <Suspense><ClientiInner /></Suspense>;
}
