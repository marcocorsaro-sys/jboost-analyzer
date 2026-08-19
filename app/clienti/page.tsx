"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { fetchAllClients, ClientRow } from "@/lib/data";
import { eur, num, SEGMENT_LABEL, planCapacity } from "@/lib/gps";
import { fetchWhale12m, whaleZone, WhaleData } from "@/lib/whale";

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
  const [wallet, setWallet] = useState<{ saldo: number; movs: any[] } | null>(null);
  const [ricarica, setRicarica] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [history, setHistory] = useState<any[] | null>(null);
  const [whale, setWhale] = useState<WhaleData | null>(null);
  const [subs, setSubs] = useState<any[]>([]);
  const [subDraft, setSubDraft] = useState({ name: "", price: 0, sessions: 2, months: 1, paid: 0, riporto: false, used: 0 });
  const [rechForm, setRechForm] = useState({ loaded: 0, paid: 0, method: "contanti", riporto: false, touched: false });

  useEffect(() => {
    setEditing(false); setHistory(null);
    if (!sel) { setWallet(null); return; }
    setEditForm({ phone: sel.phone ?? "", email: sel.email ?? "", birth_date: sel.birth_date ?? "", privacy_consent: sel.privacy_consent ?? false });
    supabase.from("wallet_movements").select("kind,amount,note,created_at").eq("client_id", sel.id).order("created_at", { ascending: false }).limit(10)
      .then(({ data }) => setWallet({ saldo: (data ?? []).reduce((x: number, m: any) => x + Number(m.amount), 0), movs: (data ?? []).slice(0, 5) }));
  }, [sel?.id]);

  const saveEdit = async () => {
    if (!sel) return;
    const patch = { phone: editForm.phone || null, email: editForm.email || null, birth_date: editForm.birth_date || null, privacy_consent: editForm.privacy_consent };
    await supabase.from("clients").update(patch).eq("id", sel.id);
    setClients((clients ?? []).map(c => c.id === sel.id ? { ...c, ...patch } as any : c));
    setSel({ ...sel, ...patch } as any);
    setEditing(false);
  };

  const loadHistory = async () => {
    if (!sel) return;
    const { data } = await supabase.from("transactions").select("tx_date,description,worked_value,cash_value,kind")
      .eq("client_id", sel.id).order("tx_date", { ascending: false }).limit(50);
    setHistory(data ?? []);
  };

  // §20-21: credito caricato ≠ incassato. Il "riporto saldo iniziale" carica credito con incasso ZERO.
  const doRicarica = async () => {
    if (!sel || rechForm.loaded <= 0) return;
    const paid = rechForm.riporto ? 0 : rechForm.paid;
    await supabase.from("wallet_movements").insert({
      organization_id: ctx.orgId, client_id: sel.id, kind: "recharge",
      amount: rechForm.loaded, paid_amount: paid, method: rechForm.riporto ? "riporto" : rechForm.method,
      note: rechForm.riporto ? "Riporto saldo card pre-GPS" : rechForm.loaded > paid ? "Ricarica con bonus promo " + (rechForm.loaded - paid) + "€" : "Ricarica prepagata",
      created_by: ctx.userId ?? null,
    });
    // INV-01/§20: l'incasso registrato è SOLO il pagato di oggi (0 per i riporti), mai il credito caricato
    await supabase.from("transactions").insert({
      organization_id: ctx.orgId, tx_date: new Date().toISOString().slice(0, 10),
      description: (rechForm.riporto ? "Riporto saldo card (nessun incasso)" : "Ricarica prepagata") + " — " + sel.full_name,
      worked_value: 0, cash_value: paid, kind: "recharge", client_id: sel.id, data_quality: "observed",
    });
    setRechForm({ loaded: 0, paid: 0, method: "contanti", riporto: false, touched: false });
    const { data } = await supabase.from("wallet_movements").select("kind,amount,paid_amount,note,created_at").eq("client_id", sel.id).order("created_at", { ascending: false }).limit(10);
    setWallet({ saldo: (data ?? []).reduce((x: number, m: any) => x + Number(m.amount), 0), movs: (data ?? []).slice(0, 5) });
  };

  useEffect(() => { if (ctx.orgId) fetchAllClients(ctx.orgId).then(setClients).catch(console.error); }, [ctx.orgId]);

  // Whale economica §6-14: ranking per margine 12 mesi (valore − minuti×CAM)
  useEffect(() => {
    if (!ctx.orgId) return;
    (async () => {
      const { data: p } = await supabase.from("business_plans").select("*").eq("organization_id", ctx.orgId)
        .order("month", { ascending: false }).limit(1).maybeSingle();
      if (!p) return;
      const { data: ps } = await supabase.from("plan_staff").select("*").eq("plan_id", p.id);
      const cam = planCapacity(p as any, (ps ?? []) as any).cam;
      if (cam > 0) setWhale(await fetchWhale12m(ctx.orgId!, cam));
    })();
  }, [ctx.orgId]);

  // abbonamenti del cliente selezionato
  useEffect(() => {
    if (!sel) { setSubs([]); return; }
    supabase.from("subscriptions").select("*").eq("client_id", sel.id).order("created_at", { ascending: false })
      .then(({ data }) => setSubs(data ?? []));
  }, [sel?.id]);

  const addSub = async () => {
    if (!sel || !subDraft.name) return;
    const end = new Date(); end.setMonth(end.getMonth() + subDraft.months);
    const paid = subDraft.riporto ? 0 : subDraft.paid;
    await supabase.from("subscriptions").insert({
      organization_id: ctx.orgId, client_id: sel.id, name: subDraft.name,
      price: subDraft.price, paid_now: paid,
      sessions_total: subDraft.sessions, sessions_used: subDraft.riporto ? subDraft.used : 0,
      unit_value: subDraft.sessions > 0 ? subDraft.price / subDraft.sessions : null,
      period_end: end.toISOString().slice(0, 10),
      source: subDraft.riporto ? "manual" : "manual",
      note: subDraft.riporto ? "Riporto abbonamento pre-GPS (incasso 0)" : null,
    });
    if (paid > 0) {
      // §24: il pagamento dell'abbonamento è un incasso oggi, il lavorato arriva solo all'utilizzo
      await supabase.from("transactions").insert({
        organization_id: ctx.orgId, tx_date: new Date().toISOString().slice(0, 10),
        description: "Abbonamento " + subDraft.name + " — " + sel.full_name,
        worked_value: 0, cash_value: paid, kind: "recharge", client_id: sel.id, data_quality: "observed",
      });
    }
    setSubDraft({ name: "", price: 0, sessions: 2, months: 1, paid: 0, riporto: false, used: 0 });
    const { data } = await supabase.from("subscriptions").select("*").eq("client_id", sel.id).order("created_at", { ascending: false });
    setSubs(data ?? []);
  };

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
          {/* §14: Whale Curve economica nella scheda — posizione visiva, zona, margine vs costo */}
          {whale && (() => {
            const me = whale.byId[sel.id];
            if (!me) return (
              <div style={{ background: "#f4f4f0", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", margin: "10px 0" }}>
                <div className="kpi-label">Whale Curve — ultimi 12 mesi</div>
                <p className="sub" style={{ margin: "6px 0 0" }}>Nessuna transazione GPS negli ultimi 12 mesi: fuori curva (margine ≈ 0). Il valore storico resta sotto, ma non determina la posizione.</p>
              </div>
            );
            const zone = whaleZone(me.rank, whale.totals.active, me.margin);
            // mini-curva: margine cumulato + puntino del cliente
            const N = whale.ranked.length;
            const step = Math.max(1, Math.floor(N / 60));
            let cum = 0; const pts: [number, number][] = [];
            const totPos = Math.max(1, whale.ranked.filter(c => c.margin > 0).reduce((x, c) => x + c.margin, 0));
            whale.ranked.forEach((c, i) => { cum += c.margin; if (i % step === 0 || i === N - 1) pts.push([i / (N - 1 || 1), cum / totPos]); });
            const W = 300, H = 80;
            const path = pts.map((p, i) => (i ? "L" : "M") + (p[0] * W).toFixed(1) + "," + (H - Math.max(0, Math.min(1.05, p[1])) * (H - 10)).toFixed(1)).join(" ");
            const cx = ((me.rank - 1) / (N - 1 || 1)) * W;
            let cumMe = 0; for (const c of whale.ranked) { cumMe += c.margin; if (c.client_id === sel.id) break; }
            const cy = H - Math.max(0, Math.min(1.05, cumMe / totPos)) * (H - 10);
            return (
              <div style={{ background: "#f7f6f0", border: "2px solid " + zone.color, borderRadius: 10, padding: "10px 12px", margin: "10px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div className="kpi-label">Whale Curve — ultimi 12 mesi (margine)</div>
                  <b style={{ color: zone.color }}>{zone.label}</b>
                </div>
                <svg viewBox={"0 0 " + W + " " + H} style={{ width: "100%", height: 80, marginTop: 6 }}>
                  <path d={path} fill="none" stroke="#1e5c38" strokeWidth="2" />
                  <line x1={cx} y1={0} x2={cx} y2={H} stroke={zone.color} strokeDasharray="3 3" />
                  <circle cx={cx} cy={cy} r={5} fill={zone.color} stroke="#fff" strokeWidth="1.5" />
                </svg>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, flexWrap: "wrap", gap: 6 }}>
                  <span>margine <b style={{ color: me.margin >= 0 ? "#1e7a4f" : "#b3402a" }}>{eur(me.margin, 0)}</b></span>
                  <span>costo assorbito <b>{eur(me.cost, 0)}</b></span>
                  <span>fatturato <b>{eur(me.revenue, 0)}</b></span>
                  <span className="sub">#{me.rank} di {num(whale.totals.active)}</span>
                </div>
                {/* confronto visivo contributo vs costo */}
                <div style={{ marginTop: 6 }}>
                  {(() => {
                    const mx = Math.max(me.revenue, 1);
                    return (<>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}><span style={{ width: 52 }}>valore</span><div style={{ flex: 1, background: "#e5e1d3", borderRadius: 4 }}><div style={{ width: (me.revenue / mx * 100) + "%", height: 8, background: "#1e7a4f", borderRadius: 4 }} /></div></div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, marginTop: 3 }}><span style={{ width: 52 }}>costo</span><div style={{ flex: 1, background: "#e5e1d3", borderRadius: 4 }}><div style={{ width: (Math.min(me.cost, mx) / mx * 100) + "%", height: 8, background: "#b3402a", borderRadius: 4 }} /></div></div>
                    </>);
                  })()}
                </div>
                {/* §13: KPI 12 mesi */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 14px", marginTop: 8, fontSize: 12.5 }}>
                  <span>Visite 12m: <b>{num(me.visits)}</b></span>
                  <span>Fiche media: <b>{me.visits ? eur(me.revenue / me.visits, 0) : "—"}</b></span>
                  <span>Minuti totali: <b>{num(Math.round(me.minutes))}</b></span>
                  <span>Tempo medio/visita: <b>{me.visits ? Math.round(me.minutes / me.visits) + "′" : "—"}</b></span>
                  <span>Costo medio/visita: <b>{me.visits ? eur(me.cost / me.visits, 0) : "—"}</b></span>
                  <span>Margine medio/visita: <b>{me.visits ? eur(me.margin / me.visits, 0) : "—"}</b></span>
                  <span>Margine al minuto: <b>{me.minutes ? eur(me.margin / me.minutes, 2) : "—"}</b></span>
                  <span>Frequenza: <b>{(me.visits / 12).toFixed(1)}/mese</b></span>
                </div>
              </div>
            );
          })()}
          <div className="kpi-label" style={{ marginTop: 10 }}>Storico lifetime (informativo — non determina la posizione)</div>
          <div className="row"><span>Passaggi totali</span><b>{num(sel.visits_count)}</b></div>
          <div className="row"><span>Valore storico</span><b>{eur(Number(sel.total_value))}</b></div>
          <div className="row"><span>Fiche media</span><b>{eur(sel.avg_ticket)}</b></div>
          <div className="row"><span>Ultima visita</span><b>{sel.last_visit ?? "—"}</b></div>
          <div className="row"><span>Fermo da</span><b>{sel.recency_days != null ? sel.recency_days + " giorni" : "—"}</b></div>
          {!editing ? (<>
            <div className="row"><span>Telefono</span><b>{sel.phone ?? "—"}</b></div>
            <div className="row"><span>Email</span><b style={{ fontSize: 12.5 }}>{sel.email ?? "—"}</b></div>
            <div className="row"><span>Data di nascita</span><b>{sel.birth_date ?? "—"}</b></div>
            <div className="row"><span>Consenso privacy</span><b>{sel.privacy_consent == null ? "—" : sel.privacy_consent ? "Sì" : "No"}</b></div>
            {ctx.role !== "operatore" && <button className="btn sm secondary" style={{ marginTop: 8 }} onClick={() => setEditing(true)}>✎ Modifica anagrafica</button>}
          </>) : (<>
            <div className="row"><span>Telefono</span><input value={editForm.phone} style={{ width: 150, padding: "4px 6px" }} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} /></div>
            <div className="row"><span>Email</span><input value={editForm.email} style={{ width: 190, padding: "4px 6px" }} onChange={e => setEditForm({ ...editForm, email: e.target.value })} /></div>
            <div className="row"><span>Nascita</span><input type="date" value={editForm.birth_date} style={{ padding: "4px 6px" }} onChange={e => setEditForm({ ...editForm, birth_date: e.target.value })} /></div>
            <div className="row"><span>Consenso privacy</span><input type="checkbox" checked={editForm.privacy_consent} onChange={e => setEditForm({ ...editForm, privacy_consent: e.target.checked })} /></div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn sm" onClick={saveEdit}>Salva</button>
              <button className="btn sm secondary" onClick={() => setEditing(false)}>Annulla</button>
            </div>
          </>)}
          <div className="row"><span>Qualità dato</span><b className="tag-quality">{sel.data_quality}</b></div>
          <div style={{ background: "#f7f3ea", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", marginTop: 12 }}>
            <div className="kpi-label" style={{ marginBottom: 6 }}>💳 Prepagata / credito</div>
            <div className="row"><span>Saldo disponibile</span><b style={{ color: (wallet?.saldo ?? 0) > 0 ? "#1e7a4f" : undefined }}>{eur(wallet?.saldo ?? 0)}</b></div>
            {ctx.role !== "operatore" && (
              <div style={{ margin: "8px 0" }}>
                <label style={{ fontSize: 12.5 }}><input type="checkbox" checked={rechForm.riporto} onChange={e => setRechForm({ ...rechForm, riporto: e.target.checked, paid: e.target.checked ? 0 : rechForm.paid })} /> Riporto saldo iniziale (pre-GPS → incasso 0)</label>
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "end" }}>
                  <div><label className="fld">Caricato €</label><input type="number" min={0} value={rechForm.loaded || ""} style={{ width: 84 }} onChange={e => { const v = Number(e.target.value); setRechForm({ ...rechForm, loaded: v, paid: rechForm.riporto ? 0 : (rechForm.touched ? rechForm.paid : v) }); }} /></div>
                  <div><label className="fld">Pagato €</label><input type="number" min={0} disabled={rechForm.riporto} value={rechForm.riporto ? 0 : (rechForm.paid || "")} style={{ width: 84 }} onChange={e => setRechForm({ ...rechForm, paid: Number(e.target.value), touched: true })} /></div>
                  <select value={rechForm.method} disabled={rechForm.riporto} onChange={e => setRechForm({ ...rechForm, method: e.target.value })}>
                    {["contanti", "carta", "bonifico", "altro"].map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <button className="btn sm" onClick={doRicarica} disabled={rechForm.loaded <= 0}>+ Carica</button>
                </div>
                {!rechForm.riporto && rechForm.loaded > rechForm.paid && rechForm.loaded > 0 && <span className="badge b-warn" style={{ marginTop: 4 }}>bonus promo {eur(rechForm.loaded - rechForm.paid)}</span>}
              </div>
            )}
            {(wallet?.movs ?? []).map((m: any, i: number) => (
              <div className="row" key={i} style={{ fontSize: 12.5 }}>
                <span>{new Date(m.created_at).toLocaleDateString("it-IT")} · {m.kind === "recharge" ? "ricarica" : m.kind === "use" ? "utilizzo" : "rettifica"}{m.paid_amount != null && m.kind === "recharge" ? " (pagato " + eur(Number(m.paid_amount), 0) + ")" : ""}</span>
                <b style={{ color: Number(m.amount) >= 0 ? "#1e7a4f" : "#b3402a" }}>{Number(m.amount) >= 0 ? "+" : ""}{eur(Number(m.amount))}</b>
              </div>
            ))}
            <p className="sub" style={{ marginTop: 4 }}>Incasso = solo il pagato di oggi. Credito caricato = debito operativo da erogare. Es. promo: paga 100 → caricati 110 → incasso 100, bonus 10.</p>
          </div>

          {/* §24-25: abbonamenti/pacchetti — pagamento, diritto e utilizzo sono tre eventi diversi */}
          <div style={{ background: "#eef3ee", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", marginTop: 12 }}>
            <div className="kpi-label" style={{ marginBottom: 6 }}>🎟 Abbonamenti / pacchetti</div>
            {subs.length === 0 && <p className="sub">Nessun abbonamento registrato.</p>}
            {subs.map((s: any) => {
              const left = Number(s.sessions_total) - Number(s.sessions_used);
              return (
                <div className="row" key={s.id} style={{ fontSize: 12.5 }}>
                  <span><b>{s.name}</b> <span className="sub">{s.period_end ? "fino al " + new Date(s.period_end).toLocaleDateString("it-IT") : ""}{s.note ? " · " + s.note : ""}</span></span>
                  <span>
                    <b style={{ color: left > 0 ? "#1e7a4f" : "#b3402a" }}>{left}/{s.sessions_total} residui</b>
                    {s.status === "active" && ctx.role !== "operatore" && <button className="btn sm secondary" style={{ marginLeft: 6 }} onClick={async () => { await supabase.from("subscriptions").update({ status: "cancelled" }).eq("id", s.id); setSubs(subs.map((x: any) => x.id === s.id ? { ...x, status: "cancelled" } : x)); }}>✕</button>}
                    {s.status !== "active" && <span className="badge b-warn" style={{ marginLeft: 6 }}>{s.status}</span>}
                  </span>
                </div>
              );
            })}
            {ctx.role !== "operatore" && (
              <div style={{ marginTop: 8 }}>
                <label style={{ fontSize: 12.5 }}><input type="checkbox" checked={subDraft.riporto} onChange={e => setSubDraft({ ...subDraft, riporto: e.target.checked, paid: e.target.checked ? 0 : subDraft.paid })} /> Riporto abbonamento già esistente (incasso GPS 0)</label>
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "end" }}>
                  <div style={{ flex: 1, minWidth: 130 }}><label className="fld">Nome piano</label><input style={{ width: "100%" }} placeholder="es. Gentlemen Care" value={subDraft.name} onChange={e => setSubDraft({ ...subDraft, name: e.target.value })} /></div>
                  <div><label className="fld">Prezzo €</label><input type="number" min={0} value={subDraft.price || ""} style={{ width: 74 }} onChange={e => setSubDraft({ ...subDraft, price: Number(e.target.value) })} /></div>
                  <div><label className="fld">Sessioni</label><input type="number" min={1} value={subDraft.sessions} style={{ width: 60 }} onChange={e => setSubDraft({ ...subDraft, sessions: Number(e.target.value) })} /></div>
                  <div><label className="fld">Mesi</label><input type="number" min={1} value={subDraft.months} style={{ width: 54 }} onChange={e => setSubDraft({ ...subDraft, months: Number(e.target.value) })} /></div>
                  {subDraft.riporto
                    ? <div><label className="fld">Già usate</label><input type="number" min={0} value={subDraft.used} style={{ width: 60 }} onChange={e => setSubDraft({ ...subDraft, used: Number(e.target.value) })} /></div>
                    : <div><label className="fld">Pagato oggi €</label><input type="number" min={0} value={subDraft.paid || ""} style={{ width: 84 }} onChange={e => setSubDraft({ ...subDraft, paid: Number(e.target.value) })} /></div>}
                  <button className="btn sm" onClick={addSub} disabled={!subDraft.name}>+ Attiva</button>
                </div>
                <p className="sub" style={{ marginTop: 4 }}>All'utilizzo (in Reception, spunta "abbonamento" sul servizio): lavorato pieno, incasso 0, 1 sessione scalata. Il rinnovo automatico da Wix arriverà con l'integrazione pagamenti.</p>
              </div>
            )}
          </div>
          {history === null ? (
            <button className="btn sm secondary" style={{ marginTop: 10 }} onClick={loadHistory}>📜 Storico completo</button>
          ) : (
            <div style={{ marginTop: 10 }}>
              <div className="kpi-label" style={{ marginBottom: 4 }}>Storico visite registrate in GPS</div>
              {history.length === 0 && <p className="sub">Nessuna transazione GPS ancora — lo storico pre-GPS è riassunto nelle metriche sopra.</p>}
              {history.map((h: any, i: number) => (
                <div className="row" key={i} style={{ fontSize: 12.5 }}>
                  <span>{h.tx_date} · {(h.description ?? "").split("—")[0].trim()}</span>
                  <b>{eur(Number(h.worked_value))}</b>
                </div>
              ))}
            </div>
          )}
          <p className="sub" style={{ marginTop: 14 }}>Metriche ricostruite dallo storico del gestionale (2020 → oggi). Con l'arrivo delle transazioni live diventeranno <i>observed</i>.</p>
        </div>
      )}
    </Shell>
  );
}

export default function Clienti() {
  return <Suspense><ClientiInner /></Suspense>;
}
