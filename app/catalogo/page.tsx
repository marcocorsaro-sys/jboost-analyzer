"use client";
import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { planCapacity, eur, Plan, PlanStaff } from "@/lib/gps";

type Item = { id: string; kind: string; name: string; price: number; duration_min: number | null; direct_cost: number; active: boolean };

export default function Catalogo() {
  const ctx = useOrg();
  const [items, setItems] = useState<Item[]>([]);
  const [cam, setCam] = useState<number>(0);
  const [tab, setTab] = useState<"service" | "product">("service");
  const [draft, setDraft] = useState<Partial<Item>>({ kind: "service", price: 0, duration_min: 30, direct_cost: 0 });

  const load = async () => {
    const { data } = await supabase.from("catalog_items").select("*").eq("organization_id", ctx.orgId).order("name");
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

  const view = useMemo(() => items.filter(i => i.kind === tab), [items, tab]);

  const add = async () => {
    if (!draft.name) return;
    await supabase.from("catalog_items").insert({ ...draft, kind: tab, organization_id: ctx.orgId });
    setDraft({ kind: tab, price: 0, duration_min: tab === "service" ? 30 : null, direct_cost: 0, name: "" });
    load();
  };
  const update = async (id: string, patch: Partial<Item>) => {
    await supabase.from("catalog_items").update(patch).eq("id", id);
    setItems(items.map(i => i.id === id ? { ...i, ...patch } : i));
  };

  return (
    <Shell ctx={ctx}>
      <div className="page-head">
        <div>
          <h1>Catalogo</h1>
          <p className="sub">Costo GPS = minuti × CAM ({eur(cam, 4)}/min) + costi diretti · Blueprint §23</p>
        </div>
      </div>
      <div className="filters" style={{ marginBottom: 16 }}>
        <button className={"chip" + (tab === "service" ? " on" : "")} onClick={() => setTab("service")}>Servizi</button>
        <button className={"chip" + (tab === "product" ? " on" : "")} onClick={() => setTab("product")}>Prodotti</button>
      </div>

      <table className="tbl">
        <thead><tr><th>Nome</th><th className="num">Prezzo €</th><th className="num">Durata min</th><th className="num">Costo diretto €</th><th className="num">Costo GPS</th><th className="num">Differenza</th><th></th></tr></thead>
        <tbody>
          {view.map(i => {
            const gps = (i.duration_min ?? 0) * cam + Number(i.direct_cost);
            const diff = Number(i.price) - gps;
            return (
              <tr key={i.id}>
                <td><b>{i.name}</b></td>
                <td className="num"><input type="number" value={i.price} style={{ width: 80, padding: "4px 6px", textAlign: "right" }} onChange={e => update(i.id, { price: Number(e.target.value) })} /></td>
                <td className="num">{i.kind === "service" ? <input type="number" value={i.duration_min ?? 0} style={{ width: 64, padding: "4px 6px", textAlign: "right" }} onChange={e => update(i.id, { duration_min: Number(e.target.value) })} /> : "—"}</td>
                <td className="num"><input type="number" value={i.direct_cost} style={{ width: 64, padding: "4px 6px", textAlign: "right" }} onChange={e => update(i.id, { direct_cost: Number(e.target.value) })} /></td>
                <td className="num">{i.kind === "service" ? eur(gps) : eur(Number(i.direct_cost))}</td>
                <td className="num">{i.kind === "service" ? (
                  <b style={{ color: diff >= 0 ? "#1e7a4f" : "#b3402a" }}>{diff >= 0 ? "+" : ""}{eur(diff)}{gps > 0 && <span style={{ opacity: .6, fontWeight: 400 }}> · {Math.round(diff / gps * 100)}%</span>}</b>
                ) : "—"}</td>
                <td><button className="btn sm secondary" onClick={() => update(i.id, { active: !i.active })}>{i.active ? "Attivo" : "Disattivo"}</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="card section" style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <div><label className="fld">Nuovo {tab === "service" ? "servizio" : "prodotto"}</label><input value={draft.name ?? ""} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Nome…" /></div>
        <div><label className="fld">Prezzo €</label><input type="number" value={draft.price ?? 0} style={{ width: 90 }} onChange={e => setDraft({ ...draft, price: Number(e.target.value) })} /></div>
        {tab === "service" && <div><label className="fld">Durata min</label><input type="number" value={draft.duration_min ?? 30} style={{ width: 90 }} onChange={e => setDraft({ ...draft, duration_min: Number(e.target.value) })} /></div>}
        <div><label className="fld">Costo diretto €</label><input type="number" value={draft.direct_cost ?? 0} style={{ width: 90 }} onChange={e => setDraft({ ...draft, direct_cost: Number(e.target.value) })} /></div>
        <button className="btn" onClick={add}>+ Aggiungi</button>
      </div>
    </Shell>
  );
}
