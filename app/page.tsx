"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { fetchAllClients, ClientRow } from "@/lib/data";
import { planCapacity, eur, num, SEGMENT_LABEL, Plan, PlanStaff } from "@/lib/gps";
import { fetchWhale12m, WhaleData } from "@/lib/whale";

export default function Dashboard() {
  const ctx = useOrg();
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [cam, setCam] = useState<number | null>(null);
  const [planMonth, setPlanMonth] = useState<string | null>(null);
  const [debito, setDebito] = useState<number | null>(null);
  const [band, setBand] = useState<number | null>(null); // decile whale selezionato
  const [lettura, setLettura] = useState<string[] | null>(null);
  const [whale, setWhale] = useState<WhaleData | null>(null);
  const [subsDebt, setSubsDebt] = useState(0);

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
        // §6-12: Whale economica sui 12 mesi mobili (margine = valore − minuti×CAM)
        if (cap.cam > 0) fetchWhale12m(ctx.orgId!, cap.cam).then(setWhale).catch(console.error);
      }
      const { data: wm } = await supabase.from("wallet_movements").select("amount").eq("organization_id", ctx.orgId);
      setDebito((wm ?? []).reduce((x: number, m: any) => x + Number(m.amount), 0));
      // §27: il debito operativo include anche i diritti abbonamento ancora da erogare
      const { data: sb } = await supabase.from("subscriptions").select("sessions_total,sessions_used,unit_value,price").eq("organization_id", ctx.orgId).eq("status", "active");
      setSubsDebt((sb ?? []).reduce((x: number, s: any) => {
        const left = Math.max(0, Number(s.sessions_total) - Number(s.sessions_used));
        const unit = s.unit_value != null ? Number(s.unit_value) : (Number(s.sessions_total) > 0 ? Number(s.price) / Number(s.sessions_total) : 0);
        return x + left * unit;
      }, 0));

      // Lettura GPS (§11): mese in corso vs mese scorso alla stessa data, in frasi
      const now = new Date(); const day = now.getDate();
      const mStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const pStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
      const pEnd = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(day, new Date(now.getFullYear(), now.getMonth(), 0).getDate())).toISOString().slice(0, 10);
      const { data: cur } = await supabase.from("transactions").select("worked_value,cash_value,kind,client_id").eq("organization_id", ctx.orgId).eq("status", "completed").gte("tx_date", mStart);
      const { data: pre } = await supabase.from("transactions").select("worked_value,cash_value,kind,client_id").eq("organization_id", ctx.orgId).eq("status", "completed").gte("tx_date", pStart).lte("tx_date", pEnd);
      const sum = (l: any[], f: string) => (l ?? []).reduce((x, t) => x + Number(t[f]), 0);
      const svc = (l: any[]) => (l ?? []).filter(t => t.kind === "service");
      const cw = sum(cur ?? [], "worked_value"), pw = sum(pre ?? [], "worked_value");
      const frasi: string[] = [];
      if ((cur ?? []).length >= 5 && (pre ?? []).length >= 5) {
        const dW = pw > 0 ? Math.round((cw - pw) / pw * 100) : null;
        const ct = svc(cur ?? []).length ? sum(svc(cur ?? []), "worked_value") / svc(cur ?? []).length : 0;
        const pt = svc(pre ?? []).length ? sum(svc(pre ?? []), "worked_value") / svc(pre ?? []).length : 0;
        const dT = pt > 0 ? Math.round((ct - pt) / pt * 100) : null;
        const dN = (pre ?? []).length > 0 ? (cur ?? []).length - (pre ?? []).length : 0;
        if (dW != null) frasi.push(`Questo mese hai lavorato ${dW >= 0 ? "il " + dW + "% in più" : "il " + Math.abs(dW) + "% in meno"} rispetto al mese scorso alla stessa data (${eur(cw, 0)} vs ${eur(pw, 0)}).`);
        if (dT != null && Math.abs(dT) >= 5) frasi.push(`Lo scontrino medio dei servizi è ${dT >= 0 ? "salito" : "sceso"} del ${Math.abs(dT)}% (${eur(ct)} vs ${eur(pt)}): ${dT < 0 ? "stai lavorando di più per lo stesso risultato — guarda mix e prezzi." : "il mix servizi sta migliorando."}`);
        if (Math.abs(dN) >= 5) frasi.push(`Hai registrato ${Math.abs(dN)} transazioni in ${dN >= 0 ? "più" : "meno"}: ${dN >= 0 && dT != null && dT < 0 ? "più volume ma margine unitario in calo — la crescita non è proporzionale." : "volume e valore si muovono insieme."}`);
        setLettura(frasi);
      } else setLettura([]);
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
            <div className="card" style={{ borderColor: (debito ?? 0) + subsDebt > 0 ? "#b3402a" : undefined }}>
              <div className="kpi-label">Debito operativo</div>
              <div className="kpi-value" style={{ color: (debito ?? 0) + subsDebt > 0 ? "#b3402a" : undefined }}>{eur((debito ?? 0) + subsDebt, 0)}</div>
              <div className="kpi-note">credito {eur(debito ?? 0, 0)} + abbonamenti da erogare {eur(subsDebt, 0)}</div>
            </div>
          </div>

          <div className="two-col section">
            <div className="card">
              <div className="section-title"><h2>Whale Curve economica</h2><span className="sub">ultimi 12 mesi · ranking per MARGINE (valore − minuti×CAM)</span></div>
              {whale && whale.ranked.length >= 3 ? (<>
                <WhaleCurve2 whale={whale} onPick={f => setBand(Math.min(9, Math.floor(f * 10)))} />
                <p className="sub" style={{ marginTop: 4 }}>
                  {num(whale.totals.active)} clienti attivi 12m · margine totale <b style={{ color: "#1e7a4f" }}>{eur(whale.totals.margin, 0)}</b> · costo assorbito <b style={{ color: "#b3402a" }}>{eur(whale.totals.cost, 0)}</b> · i clienti senza attività 12m sono fuori curva (margine 0)
                </p>
                {band != null && (() => {
                  const n = whale.ranked.length;
                  const from = Math.floor(band * n / 10), to = Math.min(n, Math.ceil((band + 1) * n / 10));
                  const slice = whale.ranked.slice(from, to);
                  const m = slice.reduce((x, c) => x + c.margin, 0);
                  const nameOf = (id: string) => (clients ?? []).find(c => c.id === id)?.full_name ?? "cliente";
                  return (
                    <div style={{ marginTop: 8 }}>
                      <div className="row"><span><b>Fascia {band * 10}–{(band + 1) * 10}%</b> · {num(slice.length)} clienti · margine {eur(m, 0)}</span><button className="btn sm secondary" onClick={() => setBand(null)}>✕</button></div>
                      {slice.slice(0, 8).map(c => (
                        <div className="row" key={c.client_id} style={{ fontSize: 12.5 }}>
                          <span>{nameOf(c.client_id)} <span className="sub">{eur(c.revenue, 0)} in {num(Math.round(c.minutes))}′</span></span>
                          <b style={{ color: c.margin >= 0 ? "#1e7a4f" : "#b3402a" }}>{eur(c.margin, 0)}</b>
                        </div>
                      ))}
                      {slice.length > 8 && <p className="sub">…e altri {num(slice.length - 8)}.</p>}
                    </div>
                  );
                })()}
              </>) : (
                <p className="sub" style={{ padding: "20px 0" }}>La curva economica si costruisce con le transazioni GPS degli ultimi 12 mesi (servono valore E minuti per calcolare il margine). Si popola da sola man mano che le chiusure passano dalla Reception. Il valore storico lifetime resta nella scheda di ogni cliente.</p>
              )}
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

          {lettura && lettura.length > 0 && (
            <div className="card section" style={{ borderColor: "#c9a227", borderWidth: 2 }}>
              <div className="section-title"><h2>Lettura GPS</h2><span className="sub">i numeri, tradotti — mese in corso vs mese scorso alla stessa data</span></div>
              {lettura.map((f, i) => <p key={i} style={{ margin: "6px 0", fontSize: 14.5 }}>→ {f}</p>)}
              <p className="sub">Le decisioni restano tue: GPS mostra situazione e cause, non sceglie al posto tuo.</p>
            </div>
          )}

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

// §10: due linee — LINEA 1 margine cumulato (contributo), LINEA 2 costo cumulato (capacità assorbita)
function WhaleCurve2({ whale, onPick }: { whale: WhaleData; onPick?: (frac: number) => void }) {
  const W = 520, H = 240, P = 34;
  const N = whale.ranked.length;
  const step = Math.max(1, Math.floor(N / 120));
  let cm = 0, cc = 0;
  const mPts: [number, number][] = [], cPts: [number, number][] = [];
  whale.ranked.forEach((c, i) => {
    cm += c.margin; cc += c.cost;
    if (i % step === 0 || i === N - 1) { const f = (i + 1) / N; mPts.push([f, cm]); cPts.push([f, cc]); }
  });
  const peak = Math.max(...mPts.map(p => p[1]), cc, 1);
  const x = (v: number) => P + v * (W - P - 10);
  const y = (v: number) => H - P - (v / peak) * (H - P - 20);
  const line = (pts: [number, number][]) => pts.map((p, i) => (i === 0 ? "M" : "L") + x(p[0]).toFixed(1) + "," + y(p[1]).toFixed(1)).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", cursor: onPick ? "pointer" : "default" }}
      onClick={e => {
        if (!onPick) return;
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const frac = ((e.clientX - rect.left) / rect.width * W - P) / (W - P - 10);
        if (frac >= 0 && frac <= 1) onPick(frac);
      }}>
      <line x1={P} y1={y(0)} x2={W - 10} y2={y(0)} stroke="#d8cfba" />
      <line x1={P} y1={y(0)} x2={P} y2={14} stroke="#d8cfba" />
      {[0.25, 0.5, 0.75, 1].map(g => (
        <line key={g} x1={P} y1={y(peak * g)} x2={W - 10} y2={y(peak * g)} stroke="#eee5d2" strokeDasharray="4 4" />
      ))}
      <path d={line(cPts)} fill="none" stroke="#b3402a" strokeWidth="2" strokeDasharray="6 3" />
      <path d={line(mPts)} fill="none" stroke="#1e7a4f" strokeWidth="3" />
      <g fontSize="11">
        <rect x={P + 6} y={18} width={12} height={3} fill="#1e7a4f" /><text x={P + 22} y={23} fill="#1e5c38">margine cumulato</text>
        <rect x={P + 150} y={18} width={12} height={3} fill="#b3402a" /><text x={P + 166} y={23} fill="#8a2f1d">costo cumulato</text>
      </g>
      <text x={W / 2} y={H - 6} fontSize="10" fill="#6d7a72" textAnchor="middle">clienti ordinati per margine 12 mesi (clicca una fascia)</text>
    </svg>
  );
}

function WhaleCurve({ pts, onPick }: { pts: [number, number][]; onPick?: (frac: number) => void }) {
  const W = 520, H = 240, P = 34;
  const x = (v: number) => P + v * (W - P - 10);
  const y = (v: number) => H - P + -v * (H - P - 14);
  const path = pts.map((p, i) => (i === 0 ? "M" : "L") + x(p[0]).toFixed(1) + "," + y(p[1]).toFixed(1)).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", cursor: onPick ? "pointer" : "default" }}
      onClick={e => {
        if (!onPick) return;
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const frac = ((e.clientX - rect.left) / rect.width * W - P) / (W - P - 10);
        if (frac >= 0 && frac <= 1) onPick(frac);
      }}>
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
