"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { fetchAllClients, ClientRow } from "@/lib/data";
import { planCapacity, eur, num, SEGMENT_LABEL, Plan, PlanStaff } from "@/lib/gps";

export default function Dashboard() {
  const ctx = useOrg();
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [cam, setCam] = useState<number | null>(null);
  const [planMonth, setPlanMonth] = useState<string | null>(null);
  const [debito, setDebito] = useState<number | null>(null);

  useEffect(() => {
    if (!ctx.orgId) return;
    fetchAllClients(ctx.orgId).then(setClients).catch(console.error);
    (async () => {
      const { data: plan } = await supabase.from("business_plans").select("*")
        .eq("organization_id", ctx.orgId).eq("status", "active")
        .order("month", { ascending: false }).limit(1).maybeSingle();
      if (plan) {
        const { data: ps } = await supabase.from("plan_staff").select("*").eq("plan_id", plan.id);
        const cap = planCapacity(plan as Plan, (ps ?? []) as PlanStaff[]);
        setCam(cap.cam); setPlanMonth(plan.month);
      }
      const { data: wm } = await supabase.from("wallet_movements").select("amount").eq("organization_id", ctx.orgId);
      setDebito((wm ?? []).reduce((x: number, m: any) => x + Number(m.amount), 0));
    })();
  }, [ctx.orgId]);

  const S = useMemo(() => {
    if (!clients) return null;
    const named = clients.filter(c => !c.is_anonymous);
    const withHistory = named.filter(c => c.visits_count > 0);
    const totalValue = clients.reduce((a, c) => a + Number(c.total_value), 0);
    const namedValue = named.reduce((a, c) => a + Number(c.total_value), 0);
    const anon = clients.find(c => c.is_anonymous);
    const active90 = named.filter(c => (c.recency_days ?? 9e9) <= 90);
    const atRisk = named.filter(c => c.at_risk);
    const atRiskValue = atRisk.reduce((a, c) => a + Number(c.total_value), 0);
    const sorted = [...withHistory].sort((a, b) => Number(b.total_value) - Number(a.total_value));
    const top10n = Math.max(1, Math.floor(sorted.length * 0.1));
    const top10share = namedValue > 0 ? sorted.slice(0, top10n).reduce((a, c) => a + Number(c.total_value), 0) / namedValue : 0;
    const segCounts: Record<string, { n: number; v: number }> = {};
    for (const c of named) {
      const s = c.segment ?? "base";
      segCounts[s] = segCounts[s] || { n: 0, v: 0 };
      segCounts[s].n++; segCounts[s].v += Number(c.total_value);
    }
    const dupGroups = new Set(named.filter(c => c.duplicate_group).map(c => c.duplicate_group)).size;
    const noContact = named.filter(c => !c.phone && !c.email).length;
    const contactableRisk = atRisk.filter(c => (c.phone || c.email) && c.privacy_consent).length;
    // whale curve points
    const pts: [number, number][] = [];
    let cum = 0;
    sorted.forEach((c, i) => { cum += Number(c.total_value); if (i % 25 === 0 || i === sorted.length - 1) pts.push([(i + 1) / sorted.length, cum / namedValue]); });
    return { totalValue, namedValue, anon, active90, atRisk, atRiskValue, top10share, top10n, segCounts, dupGroups, noContact, contactableRisk, sorted, pts };
  }, [clients]);

  return (
    <Shell ctx={ctx}>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="sub">Storico consolidato 2020 → oggi · dati <span className="tag-quality">RECONSTRUCTED</span> da import CLI003 + anagrafica CRM</p>
        </div>
        <Link href="/import" className="btn dark">+ Importa nuovi dati</Link>
      </div>

      {!S ? <p className="sub">Caricamento dati…</p> : (
        <>
          <div className="grid kpis">
            <div className="card gold">
              <div className="kpi-label">Costo al minuto GPS</div>
              <div className="kpi-value">{cam != null ? eur(cam, 4) : "—"}</div>
              <div className="kpi-note">{planMonth ? "piano attivo " + planMonth.slice(0, 7) : "nessun piano attivo"}</div>
            </div>
            <div className="card dark">
              <div className="kpi-label">Valore storico lavorato</div>
              <div className="kpi-value">{eur(S.totalValue, 0)}</div>
              <div className="kpi-note">{num(S.sorted.length)} clienti con storico</div>
            </div>
            <div className="card">
              <div className="kpi-label">Clienti attivi (90 gg)</div>
              <div className="kpi-value">{num(S.active90.length)}</div>
              <div className="kpi-note">su {num(S.sorted.length)} con storico</div>
            </div>
            <div className="card">
              <div className="kpi-label">Clienti a rischio</div>
              <div className="kpi-value">{num(S.atRisk.length)}</div>
              <div className="kpi-note">{eur(S.atRiskValue, 0)} di valore storico · {num(S.contactableRisk)} contattabili</div>
            </div>
            <div className="card">
              <div className="kpi-label">Concentrazione (whale)</div>
              <div className="kpi-value">{Math.round(S.top10share * 100)}%</div>
              <div className="kpi-note">del valore dal top 10% ({num(S.top10n)} clienti)</div>
            </div>
            <div className="card" style={{ borderColor: (debito ?? 0) > 0 ? "#b3402a" : undefined }}>
              <div className="kpi-label">Debito operativo</div>
              <div className="kpi-value" style={{ color: (debito ?? 0) > 0 ? "#b3402a" : undefined }}>{eur(debito ?? 0, 0)}</div>
              <div className="kpi-note">credito venduto e ancora da erogare (tempo reale)</div>
            </div>
          </div>

          <div className="two-col section">
            <div className="card">
              <div className="section-title"><h2>Whale Curve</h2><span className="sub">valore cumulato vs clienti (esclude anonimi)</span></div>
              <WhaleCurve pts={S.pts} />
            </div>
            <div className="card">
              <div className="section-title"><h2>Segmenti</h2><Link className="sub" href="/clienti">apri Clienti →</Link></div>
              {(["premium", "fidelizzato", "intermittente", "base"] as const).map(s => {
                const d = S.segCounts[s] || { n: 0, v: 0 };
                const pct = S.namedValue > 0 ? d.v / S.namedValue : 0;
                return (
                  <div key={s} style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: 4 }}>
                      <span><span className={"badge b-" + s}>{SEGMENT_LABEL[s]}</span> &nbsp;{num(d.n)} clienti</span>
                      <b>{eur(d.v, 0)} · {Math.round(pct * 100)}%</b>
                    </div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: (pct * 100) + "%" }} /></div>
                  </div>
                );
              })}
              <div className="alert" style={{ marginTop: 18 }}>
                ⚠ Il cliente anonimo di passaggio vale {eur(Number(S.anon?.total_value ?? 0), 0)} ({Math.round(Number(S.anon?.total_value ?? 0) / S.totalValue * 100)}% del totale): è escluso da segmenti e whale curve. Obiettivo pilota: trasformare gli anonimi in schede reali.
              </div>
            </div>
          </div>

          <div className="section">
            <div className="section-title"><h2>Top 20 clienti</h2><span className="sub">per valore storico</span></div>
            <table className="tbl">
              <thead><tr><th>Cliente</th><th>Segmento</th><th className="num">Passaggi</th><th className="num">Valore</th><th className="num">Fiche media</th><th>Ultima visita</th><th></th></tr></thead>
              <tbody>
                {S.sorted.slice(0, 20).map(c => (
                  <tr key={c.id}>
                    <td><b>{c.full_name}</b></td>
                    <td><span className={"badge b-" + (c.segment ?? "base")}>{SEGMENT_LABEL[c.segment ?? "base"]}</span></td>
                    <td className="num">{num(c.visits_count)}</td>
                    <td className="num"><b>{eur(Number(c.total_value), 0)}</b></td>
                    <td className="num">{eur(c.avg_ticket)}</td>
                    <td>{c.last_visit ?? "—"}</td>
                    <td>{c.at_risk && <span className="badge b-risk">a rischio</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid kpis section">
            <div className="card">
              <div className="kpi-label">Qualità dati</div>
              <div className="kpi-note" style={{ marginTop: 10, fontSize: 13.5 }}>
                {num(S.dupGroups)} gruppi di possibili duplicati · {num(S.noContact)} clienti senza contatti · consenso privacy presente per {num((clients ?? []).filter(c => c.privacy_consent).length)} schede
              </div>
              <Link href="/clienti?f=duplicati" className="btn sm secondary" style={{ marginTop: 10, display: "inline-block" }}>Rivedi duplicati</Link>
            </div>
            <div className="card">
              <div className="kpi-label">Azione consigliata</div>
              <div className="kpi-note" style={{ marginTop: 10, fontSize: 13.5 }}>
                {num(S.contactableRisk)} clienti a rischio sono contattabili con consenso. Valore storico in gioco: {eur(S.atRiskValue, 0)}.
              </div>
              <Link href="/clienti?f=rischio" className="btn sm" style={{ marginTop: 10, display: "inline-block" }}>Apri lista riattivazione</Link>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}

function WhaleCurve({ pts }: { pts: [number, number][] }) {
  const W = 520, H = 240, P = 34;
  const x = (v: number) => P + v * (W - P - 10);
  const y = (v: number) => H - P + -v * (H - P - 14);
  const path = pts.map((p, i) => (i === 0 ? "M" : "L") + x(p[0]).toFixed(1) + "," + y(p[1]).toFixed(1)).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      <line x1={P} y1={y(0)} x2={W - 10} y2={y(0)} stroke="#d8cfba" />
      <line x1={P} y1={y(0)} x2={P} y2={14} stroke="#d8cfba" />
      {[0.25, 0.5, 0.75, 1].map(g => (
        <g key={g}>
          <line x1={P} y1={y(g)} x2={W - 10} y2={y(g)} stroke="#eee5d2" strokeDasharray="4 4" />
          <text x={4} y={y(g) + 4} fontSize="10" fill="#6d7a72">{Math.round(g * 100)}%</text>
        </g>
      ))}
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="#b9ad90" strokeDasharray="5 5" />
      <path d={path} fill="none" stroke="#c9a227" strokeWidth="3" />
      <text x={W / 2} y={H - 6} fontSize="10" fill="#6d7a72" textAnchor="middle">% clienti (ordinati per valore)</text>
    </svg>
  );
}
