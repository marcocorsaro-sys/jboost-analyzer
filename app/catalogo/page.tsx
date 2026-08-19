"use client";
import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { planCapacity, eur, num, Plan, PlanStaff } from "@/lib/gps";

type Item = {
  id: string; kind: string; name: string; category: string | null; price: number;
  duration_min: number | null; direct_cost: number; active: boolean;
  list_cost: number; supplier_discount_pct: number; stock_qty: number;
};

export default function Catalogo() {
  const ctx = useOrg();
  const [items, setItems] = useState<Item[]>([]);
  const [cam, setCam] = useState<number>(0);
  const [tab, setTab] = useState<"service" | "product">("service");
  const [catFilter, setCatFilter] = useState<string>("tutte");
  const [draft, setDraft] = useState<any>({ name: "", category: "", price: 0, duration_min: 30, list_cost: 0, supplier_discount_pct: 0, stock_qty: 0 });

  const load = async () => {
    const { data } = await supabase.from("catalog_items").select("*").eq("organization_id", ctx.orgId).order("category").order("name");
    setItems((data ?? []) as any);
  };

  useEffect(() => {
    if (!ctx.orgId) return;
    load();
    (async () => {
      const { data: p } = await supabase.from("business_plans").select("*").eq("organization_id", ctx.orgId).eq("status", "active").limit(1).maybeSingle();
      if (p) {
        const { data: ps } = await supabase.from("plan_staff").select("*").eq("plan_id", p.id);
        setCam(planCapacity(p as Plan, (ps ?? []) as PlanStaff[]).cam);
      }
    })();
  }, [ctx.orgId]);

  const services = items.filter(i => i.kind === "service");
  const products = items.filter(i => i.kind === "product");
  const categories = Array.from(new Set(services.map(s => s.category || "Senza categoria")));
  const viewServices = catFilter === "tutte" ? services : services.filter(s => (s.category || "Senza categoria") === catFilter);

  const effCost = (p: Item) => Number(p.list_cost) * (1 - Number(p.supplier_discount_pct) / 100);
  const capitale = products.reduce((a, p) => a + Number(p.stock_qty) * effCost(p), 0);
  const valoreComm = products.reduce((a, p) => a + Number(p.stock_qty) * Number(p.price), 0);

  const update = async (id: string, patch: Partial<Item>) => {
    await supabase.from("catalog_items").update(patch).eq("id", id);
    setItems(items.map(i => i.id === id ? { ...i, ...patch } : i));
  };
  const add = async () => {
    if (!draft.name) return;
    await supabase.from("catalog_items").insert({
      organization_id: ctx.orgId, kind: tab, name: draft.name, category: draft.category || null,
      price: draft.price, duration_min: tab === "service" ? draft.duration_min : null,
      list_cost: tab === "product" ? draft.list_cost : 0,
      supplier_discount_pct: tab === "product" ? draft.supplier_discount_pct : 0,
      stock_qty: tab === "product" ? draft.stock_qty : 0,
    });
    setDraft({ ...draft, name: "" });
    load();
  };

  // analisi per categoria (§6): dai movimenti del registro collegati al catalogo
  const [catStats, setCatStats] = useState<Record<string, { worked: number; n: number; mins: number }>>({});
  useEffect(() => {
    if (!ctx.orgId || !items.length) return;
    (async () => {
      const { data: tx } = await supabase.from("transactions").select("catalog_item_id,worked_value,kind,status")
        .eq("organization_id", ctx.orgId).eq("status", "completed").not("catalog_item_id", "is", null).limit(2000);
      const byId = Object.fromEntries(items.map(i => [i.id, i]));
      const acc: Record<string, { worked: number; n: number; mins: number }> = {};
      for (const t of (tx ?? []) as any[]) {
        const it = byId[t.catalog_item_id];
        if (!it || it.kind !== "service") continue;
        const cat = it.category || "Senza categoria";
        acc[cat] = acc[cat] || { worked: 0, n: 0, mins: 0 };
        acc[cat].worked += Number(t.worked_value); acc[cat].n++; acc[cat].mins += Number(it.duration_min ?? 0);
      }
      setCatStats(acc);
    })();
  }, [ctx.orgId, items.length]);

  return (
    <Shell ctx={ctx}>
      <div className="page-head">
        <div>
          <h1>Catalogo</h1>
          <p className="sub">Costo servizio = durata × CAM ({eur(cam, 4)}/min) · Margine = prezzo − costo</p>
        </div>
      </div>
      <div className="filters" style={{ marginBottom: 16 }}>
        <button className={"chip" + (tab === "service" ? " on" : "")} onClick={() => setTab("service")}>✂ Servizi ({services.length})</button>
        <button className={"chip" + (tab === "product" ? " on" : "")} onClick={() => setTab("product")}>🧴 Prodotti ({products.length})</button>
      </div>

      {tab === "service" && (
        <>
          <div className="filters" style={{ marginBottom: 12 }}>
            <button className={"chip" + (catFilter === "tutte" ? " on" : "")} onClick={() => setCatFilter("tutte")}>Tutte le categorie</button>
            {categories.map(c => <button key={c} className={"chip" + (catFilter === c ? " on" : "")} onClick={() => setCatFilter(c)}>{c}</button>)}
          </div>
          <table className="tbl">
            <thead><tr><th>Servizio</th><th>Categoria</th><th className="num">Durata min</th><th className="num">Prezzo €</th><th className="num">Costo (CAM)</th><th className="num">Margine €</th><th className="num">Margine %</th><th></th></tr></thead>
            <tbody>
              {viewServices.map(i => {
                const cost = (i.duration_min ?? 0) * cam;
                const margin = Number(i.price) - cost;
                const marginPct = Number(i.price) > 0 ? margin / Number(i.price) * 100 : 0;
                return (
                  <tr key={i.id} style={{ opacity: i.active ? 1 : .5 }}>
                    <td><b>{i.name}</b></td>
                    <td><input list="cats" value={i.category ?? ""} placeholder="—" style={{ width: 150, padding: "4px 6px" }} onChange={e => update(i.id, { category: e.target.value || null })} /></td>
                    <td className="num"><input type="number" value={i.duration_min ?? 0} style={{ width: 60, padding: "4px 6px", textAlign: "right" }} onChange={e => update(i.id, { duration_min: Number(e.target.value) })} /></td>
                    <td className="num"><input type="number" value={i.price} style={{ width: 74, padding: "4px 6px", textAlign: "right" }} onChange={e => update(i.id, { price: Number(e.target.value) })} /></td>
                    <td className="num">{eur(cost)}</td>
                    <td className="num"><b style={{ color: margin >= 0 ? "#1e7a4f" : "#b3402a" }}>{margin >= 0 ? "+" : ""}{eur(margin)}</b></td>
                    <td className="num"><b style={{ color: marginPct >= 50 ? "#1e7a4f" : marginPct >= 0 ? "#8a6d0d" : "#b3402a" }}>{Math.round(marginPct)}%</b></td>
                    <td><button className="btn sm secondary" onClick={() => update(i.id, { active: !i.active })}>{i.active ? "Attivo" : "Off"}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <datalist id="cats">{["Barberia Tradizionale", "Exclusive Suite", "Wellness", "Estetica", ...categories].filter((v, i, a) => a.indexOf(v) === i).map(c => <option key={c} value={c} />)}</datalist>

          {Object.keys(catStats).length > 0 && (
            <div className="section">
              <div className="section-title"><h2>Analisi per categoria</h2><span className="sub">dalle vendite registrate (chiusure GPS)</span></div>
              <table className="tbl">
                <thead><tr><th>Categoria</th><th className="num">Servizi venduti</th><th className="num">Lavorato</th><th className="num">Minuti assorbiti</th><th className="num">Costo (CAM)</th><th className="num">Margine</th><th className="num">Marginalità</th></tr></thead>
                <tbody>
                  {Object.entries(catStats).sort((a, b) => b[1].worked - a[1].worked).map(([cat, s]) => {
                    const cost = s.mins * cam; const m = s.worked - cost;
                    return (
                      <tr key={cat}>
                        <td><b>{cat}</b></td>
                        <td className="num">{num(s.n)}</td>
                        <td className="num">{eur(s.worked, 0)}</td>
                        <td className="num">{num(s.mins)}</td>
                        <td className="num">{eur(cost, 0)}</td>
                        <td className="num"><b style={{ color: m >= 0 ? "#1e7a4f" : "#b3402a" }}>{eur(m, 0)}</b></td>
                        <td className="num">{s.worked > 0 ? Math.round(m / s.worked * 100) + "%" : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "product" && (
        <>
          <div className="grid kpis" style={{ marginBottom: 14 }}>
            <div className="card dark"><div className="kpi-label">Capitale immobilizzato</div><div className="kpi-value">{eur(capitale, 0)}</div><div className="kpi-note">giacenza × costo effettivo</div></div>
            <div className="card"><div className="kpi-label">Valore commerciale magazzino</div><div className="kpi-value">{eur(valoreComm, 0)}</div><div className="kpi-note">giacenza × prezzo al pubblico</div></div>
            <div className="card"><div className="kpi-label">Margine potenziale</div><div className="kpi-value" style={{ color: "#1e7a4f" }}>{eur(valoreComm - capitale, 0)}</div></div>
          </div>
          <table className="tbl">
            <thead><tr><th>Prodotto</th><th className="num">Prezzo €</th><th className="num">Costo listino</th><th className="num">Sconto forn. %</th><th className="num">Costo effettivo</th><th className="num">Giacenza</th><th className="num">Margine €</th><th className="num">Margine %</th><th></th></tr></thead>
            <tbody>
              {products.map(p => {
                const ec = effCost(p);
                const m = Number(p.price) - ec;
                const mp = Number(p.price) > 0 ? m / Number(p.price) * 100 : 0;
                return (
                  <tr key={p.id} style={{ opacity: p.active ? 1 : .5 }}>
                    <td><b>{p.name}</b>{Number(p.stock_qty) <= 2 && <span className="badge b-warn" style={{ marginLeft: 6 }}>scorta bassa</span>}</td>
                    <td className="num"><input type="number" value={p.price} style={{ width: 70, padding: "4px 6px", textAlign: "right" }} onChange={e => update(p.id, { price: Number(e.target.value) })} /></td>
                    <td className="num"><input type="number" value={p.list_cost} style={{ width: 70, padding: "4px 6px", textAlign: "right" }} onChange={e => update(p.id, { list_cost: Number(e.target.value) })} /></td>
                    <td className="num"><input type="number" value={p.supplier_discount_pct} style={{ width: 56, padding: "4px 6px", textAlign: "right" }} onChange={e => update(p.id, { supplier_discount_pct: Number(e.target.value) })} /></td>
                    <td className="num">{eur(ec)}</td>
                    <td className="num"><input type="number" value={p.stock_qty} style={{ width: 60, padding: "4px 6px", textAlign: "right" }} onChange={e => update(p.id, { stock_qty: Number(e.target.value) })} /></td>
                    <td className="num"><b style={{ color: m >= 0 ? "#1e7a4f" : "#b3402a" }}>{eur(m)}</b></td>
                    <td className="num">{Math.round(mp)}%</td>
                    <td><button className="btn sm secondary" onClick={() => update(p.id, { active: !p.active })}>{p.active ? "Attivo" : "Off"}</button></td>
                  </tr>
                );
              })}
              {products.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>Nessun prodotto — aggiungili qui sotto o importali da Excel (Import → Catalogo).</td></tr>}
            </tbody>
          </table>
          <p className="sub" style={{ marginTop: 8 }}>Ogni vendita confermata in Reception scarica automaticamente 1 pezzo dalla giacenza e aggiorna i KPI.</p>
        </>
      )}

      <div className="card section" style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 160 }}><label className="fld">Nuovo {tab === "service" ? "servizio" : "prodotto"}</label><input style={{ width: "100%" }} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></div>
        {tab === "service" && <div><label className="fld">Categoria</label><input list="cats" style={{ width: 160 }} value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} /></div>}
        <div><label className="fld">Prezzo €</label><input type="number" style={{ width: 84 }} value={draft.price} onChange={e => setDraft({ ...draft, price: Number(e.target.value) })} /></div>
        {tab === "service" && <div><label className="fld">Durata min</label><input type="number" style={{ width: 84 }} value={draft.duration_min} onChange={e => setDraft({ ...draft, duration_min: Number(e.target.value) })} /></div>}
        {tab === "product" && (<>
          <div><label className="fld">Costo listino</label><input type="number" style={{ width: 84 }} value={draft.list_cost} onChange={e => setDraft({ ...draft, list_cost: Number(e.target.value) })} /></div>
          <div><label className="fld">Sconto %</label><input type="number" style={{ width: 70 }} value={draft.supplier_discount_pct} onChange={e => setDraft({ ...draft, supplier_discount_pct: Number(e.target.value) })} /></div>
          <div><label className="fld">Giacenza</label><input type="number" style={{ width: 70 }} value={draft.stock_qty} onChange={e => setDraft({ ...draft, stock_qty: Number(e.target.value) })} /></div>
        </>)}
        <button className="btn" onClick={add}>+ Aggiungi</button>
      </div>
    </Shell>
  );
}
