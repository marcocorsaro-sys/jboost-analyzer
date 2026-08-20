"use client";
// MODULO ORARI E CAPACITÀ PRODUTTIVA (Pianificazione) — spec Dimitar
// Orario standard settimanale a fasce, periodi temporanei, eccezioni per giornata;
// orario del salone e disponibilità dei singoli operatori sono due configurazioni distinte.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Band, Rule, bandsMinutes } from "@/lib/schedule";
import { num } from "@/lib/gps";

const DOWS = [
  { d: 1, l: "Lunedì" }, { d: 2, l: "Martedì" }, { d: 3, l: "Mercoledì" },
  { d: 4, l: "Giovedì" }, { d: 5, l: "Venerdì" }, { d: 6, l: "Sabato" }, { d: 0, l: "Domenica" },
];

function BandChips({ bands, onRemove }: { bands: Band[]; onRemove: (i: number) => void }) {
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {bands.length === 0 && <span className="badge b-warn">chiuso</span>}
      {bands.map((b, i) => (
        <span key={i} className="badge b-ok" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          {b.start}–{b.end}
          <button className="btn-ghost" style={{ padding: 0, fontSize: 11 }} onClick={() => onRemove(i)}>✕</button>
        </span>
      ))}
    </span>
  );
}

function AddBand({ onAdd }: { onAdd: (b: Band) => void }) {
  const [s, setS] = useState("08:30");
  const [e, setE] = useState("13:00");
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <input type="time" value={s} style={{ padding: "2px 4px", fontSize: 12 }} onChange={ev => setS(ev.target.value)} />
      <input type="time" value={e} style={{ padding: "2px 4px", fontSize: 12 }} onChange={ev => setE(ev.target.value)} />
      <button className="btn sm" onClick={() => { if (s < e) onAdd({ start: s, end: e }); }}>+</button>
    </span>
  );
}

export default function OrariModule({ ctx, staff }: { ctx: any; staff: { id: string; display_name: string }[] }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [who, setWho] = useState<string>("salon"); // "salon" o staff_id
  const [draft, setDraft] = useState<{ kind: "period" | "exception"; label: string; date: string; date_from: string; date_to: string; bands: Band[]; closed: boolean }>({
    kind: "period", label: "", date: "", date_from: "", date_to: "", bands: [], closed: false,
  });

  const load = async () => {
    const { data } = await supabase.from("schedule_rules").select("*").eq("organization_id", ctx.orgId).order("created_at");
    setRules((data ?? []) as any);
  };
  useEffect(() => { if (ctx.orgId) load(); }, [ctx.orgId]);

  const scope = who === "salon" ? "salon" : "staff";
  const staffId = who === "salon" ? null : who;
  const mine = rules.filter(r => r.scope === scope && (scope === "salon" || r.staff_id === staffId));

  const stdFor = (dow: number) => mine.find(r => r.kind === "standard" && r.dow === dow);

  const setStandard = async (dow: number, bands: Band[]) => {
    const ex = stdFor(dow);
    if (ex) {
      await supabase.from("schedule_rules").update({ bands }).eq("id", ex.id);
    } else {
      await supabase.from("schedule_rules").insert({ organization_id: ctx.orgId, scope, staff_id: staffId, kind: "standard", dow, bands });
    }
    load();
  };

  const addRule = async () => {
    const bands = draft.closed ? [] : draft.bands;
    if (draft.kind === "exception" && !draft.date) return;
    if (draft.kind === "period" && (!draft.date_from || !draft.date_to)) return;
    if (!draft.closed && bands.length === 0) return;
    await supabase.from("schedule_rules").insert({
      organization_id: ctx.orgId, scope, staff_id: staffId, kind: draft.kind,
      date: draft.kind === "exception" ? draft.date : null,
      date_from: draft.kind === "period" ? draft.date_from : null,
      date_to: draft.kind === "period" ? draft.date_to : null,
      bands, label: draft.label || null,
    });
    setDraft({ kind: "period", label: "", date: "", date_from: "", date_to: "", bands: [], closed: false });
    load();
  };

  const specials = mine.filter(r => r.kind !== "standard")
    .sort((a, b) => ((a.date ?? a.date_from ?? "") < (b.date ?? b.date_from ?? "") ? 1 : -1));

  const copyFromSalon = async () => {
    if (scope !== "staff") return;
    for (const { d } of DOWS) {
      const sal = rules.find(r => r.scope === "salon" && r.kind === "standard" && r.dow === d);
      await setStandard(d, sal ? sal.bands : []);
    }
  };

  return (
    <div className="card section" style={{ borderColor: "#c9a227", borderWidth: 2 }}>
      <div className="section-title">
        <h2>Orari e capacità produttiva</h2>
        <span className="sub">priorità: eccezione giornata → periodo → standard · la pausa è lo spazio tra due fasce</span>
      </div>

      <div className="filters" style={{ marginBottom: 12 }}>
        <button className={"chip" + (who === "salon" ? " on" : "")} onClick={() => setWho("salon")}>🏠 Salone</button>
        {staff.map(s => (
          <button key={s.id} className={"chip" + (who === s.id ? " on" : "")} onClick={() => setWho(s.id)}>{s.display_name.split(" ")[0]}</button>
        ))}
      </div>

      {scope === "staff" && !mine.some(r => r.kind === "standard") && (
        <div className="alert" style={{ marginBottom: 10 }}>
          Questo operatore non ha ancora un orario proprio: finché resta così, GPS assume che segua l'orario del salone.
          <button className="btn sm" style={{ marginLeft: 8 }} onClick={copyFromSalon}>Copia orario salone come base</button>
        </div>
      )}

      {/* ORARIO STANDARD SETTIMANALE */}
      <div className="kpi-label" style={{ marginBottom: 6 }}>Orario standard settimanale {scope === "staff" ? "· disponibilità operatore (vale solo dentro l'apertura del salone)" : ""}</div>
      {DOWS.map(({ d, l }) => {
        const r = stdFor(d);
        const bands = r?.bands ?? [];
        return (
          <div className="row" key={d}>
            <span style={{ width: 90 }}><b>{l}</b></span>
            <span style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <BandChips bands={bands} onRemove={i => setStandard(d, bands.filter((_, j) => j !== i))} />
              <AddBand onAdd={b => setStandard(d, [...bands, b].sort((x, y) => x.start < y.start ? -1 : 1))} />
              <span className="sub">{bandsMinutes(bands) > 0 ? num(bandsMinutes(bands)) + "′" : ""}</span>
            </span>
          </div>
        );
      })}

      {/* PERIODI TEMPORANEI ED ECCEZIONI */}
      <div className="kpi-label" style={{ margin: "14px 0 6px" }}>Periodi temporanei ed eccezioni {scope === "staff" ? "· ferie, permessi, assenze, variazioni" : "· orario estivo, festivi, chiusure"}</div>
      {specials.length === 0 && <p className="sub">Nessuna variazione: vale l'orario standard.</p>}
      {specials.map(r => (
        <div className="row" key={r.id}>
          <span>
            {r.kind === "period" ? "📆 " + (r.date_from ?? "") + " → " + (r.date_to ?? "") : "📌 " + (r.date ?? "")}
            {r.label && <b style={{ marginLeft: 6 }}>{r.label}</b>}
          </span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <BandChips bands={r.bands} onRemove={async i => {
              await supabase.from("schedule_rules").update({ bands: r.bands.filter((_, j) => j !== i) }).eq("id", r.id); load();
            }} />
            <button className="btn sm secondary" onClick={async () => { await supabase.from("schedule_rules").delete().eq("id", r.id); load(); }}>✕</button>
          </span>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap", marginTop: 10, background: "#f7f3ea", borderRadius: 10, padding: "10px 12px" }}>
        <div><label className="fld">Tipo</label>
          <select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as any })}>
            <option value="period">Periodo (dal→al)</option>
            <option value="exception">Singola giornata</option>
          </select></div>
        <div style={{ minWidth: 140 }}><label className="fld">Etichetta</label>
          <input placeholder={scope === "staff" ? "Ferie, permesso…" : "Orario estivo, 24 dicembre…"} value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} /></div>
        {draft.kind === "exception"
          ? <div><label className="fld">Data</label><input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} /></div>
          : <>
            <div><label className="fld">Dal</label><input type="date" value={draft.date_from} onChange={e => setDraft({ ...draft, date_from: e.target.value })} /></div>
            <div><label className="fld">Al</label><input type="date" value={draft.date_to} onChange={e => setDraft({ ...draft, date_to: e.target.value })} /></div>
          </>}
        <label style={{ fontSize: 13, alignSelf: "center" }}>
          <input type="checkbox" checked={draft.closed} onChange={e => setDraft({ ...draft, closed: e.target.checked, bands: e.target.checked ? [] : draft.bands })} />
          {" "}{scope === "staff" ? "assente (ferie/permesso)" : "chiuso"}
        </label>
        {!draft.closed && (
          <span style={{ display: "flex", gap: 6, alignItems: "end" }}>
            <BandChips bands={draft.bands} onRemove={i => setDraft({ ...draft, bands: draft.bands.filter((_, j) => j !== i) })} />
            <AddBand onAdd={b => setDraft({ ...draft, bands: [...draft.bands, b].sort((x, y) => x.start < y.start ? -1 : 1) })} />
          </span>
        )}
        <button className="btn sm" onClick={addRule}>+ Aggiungi</button>
      </div>
      <p className="sub" style={{ marginTop: 8 }}>
        Le giornate già concluse restano fotografate con l'orario valido in quel momento: un cambio orario di oggi non ricalcola mai costo, capacità o KPI dei giorni chiusi.
      </p>
    </div>
  );
}
