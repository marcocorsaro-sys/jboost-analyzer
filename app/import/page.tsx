"use client";
import { useMemo, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";
import { num } from "@/lib/gps";
import {
  EntityType, FIELDS, parseFile, autoMap, normKey,
  parseNumber, parseDate, normPhone, fixEmail, parseBool,
} from "@/lib/importer";

const ENTITIES: { key: EntityType; label: string; desc: string }[] = [
  { key: "history", label: "Storico clienti", desc: "Report tipo “clienti passati”: passaggi, valore, ultima visita. Aggiorna o crea le schede cliente." },
  { key: "clients", label: "Anagrafica clienti", desc: "Contatti, consensi, date di nascita. Arricchisce le schede esistenti (match sul nome)." },
  { key: "transactions", label: "Transazioni", desc: "Chiusure giornaliere: data, importi lavorato/incassato, operatore." },
  { key: "catalog", label: "Catalogo", desc: "Servizi (con durata) o prodotti di magazzino (con costo listino, sconto e giacenza): scegli tu cosa contiene l'elenco." },
];

type Stage = "pick" | "map" | "done";

export default function ImportPage() {
  const ctx = useOrg();
  const fileRef = useRef<HTMLInputElement>(null);
  const [entity, setEntity] = useState<EntityType>("history");
  const [stage, setStage] = useState<Stage>("pick");
  const [filename, setFilename] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<any[][]>([]);
  const [map, setMap] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; quarantined: number; updated: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Catalogo: cosa contiene l'elenco — mai generalizzare a "servizi" (richiesta Dimitar)
  const [catalogKind, setCatalogKind] = useState<"auto" | "service" | "product">("auto");

  const onFile = async (f: File) => {
    setErr(null);
    try {
      const buf = await f.arrayBuffer();
      const parsed = parseFile(buf, f.name);
      if (!parsed.headers.length || !parsed.rows.length) { setErr("File vuoto o non leggibile."); return; }
      setFilename(f.name);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      const m = autoMap(parsed.headers, entity);
      setMap(m);
      if (entity === "catalog") {
        // proposta intelligente: colonne magazzino → prodotti; colonna tipo → misto; durata → servizi
        if (m["stock_qty"] != null || m["supplier_discount_pct"] != null) setCatalogKind("product");
        else if (m["kind"] != null) setCatalogKind("auto");
        else if (m["duration_min"] != null) setCatalogKind("service");
        else setCatalogKind("auto");
      }
      setStage("map");
    } catch (e: any) {
      setErr("Errore di lettura: " + (e?.message ?? String(e)));
    }
  };

  const mappedPreview = useMemo(() => rows.slice(0, 8).map(r => {
    const o: Record<string, any> = {};
    for (const f of FIELDS[entity]) {
      const idx = map[f.key];
      o[f.key] = idx != null ? r[idx] : null;
    }
    return o;
  }), [rows, map, entity]);

  // Campi mostrati: per il catalogo nascondi i campi non pertinenti al tipo scelto
  const visibleFields = useMemo(() => FIELDS[entity].filter(f => {
    if (entity !== "catalog") return true;
    if (catalogKind === "product") return !["duration_min", "direct_cost"].includes(f.key);
    if (catalogKind === "service") return !["list_cost", "supplier_discount_pct", "stock_qty", "kind"].includes(f.key);
    return true;
  }), [entity, catalogKind]);

  const runImport = async () => {
    if (!ctx.orgId) return;
    setBusy(true); setErr(null);
    try {
      const { data: batch, error: bErr } = await supabase.from("import_batches").insert({
        organization_id: ctx.orgId, filename, entity_type: entity, mapping: map,
        total_rows: rows.length, status: "pending",
      }).select().single();
      if (bErr) throw bErr;

      const issues: any[] = [];
      const get = (r: any[], key: string) => { const i = map[key]; return i == null ? null : r[i]; };
      let imported = 0, updated = 0;

      if (entity === "history" || entity === "clients") {
        // mappa chiave → id dei clienti esistenti
        const existing = new Map<string, string>();
        for (let from = 0; ; from += 1000) {
          const { data } = await supabase.from("clients").select("id,normalized_key")
            .eq("organization_id", ctx.orgId).range(from, from + 999);
          (data ?? []).forEach((c: any) => { if (c.normalized_key) existing.set(c.normalized_key, c.id); });
          if (!data || data.length < 1000) break;
        }
        const inserts: any[] = [], updates: any[] = [];
        rows.forEach((r, i) => {
          const name = get(r, "full_name");
          if (!name || String(name).trim().length < 2) { issues.push({ row_number: i + 1, raw: { r }, reason: "Nominativo mancante" }); return; }
          const key = normKey(String(name));
          const base: any = { organization_id: ctx.orgId, full_name: String(name).trim(), normalized_key: key, source_batch: batch.id };
          if (entity === "history") {
            const visits = parseNumber(get(r, "visits_count"));
            const value = parseNumber(get(r, "total_value"));
            const last = parseDate(get(r, "last_visit"));
            if (visits == null && value == null && last == null) { issues.push({ row_number: i + 1, raw: { r }, reason: "Nessun dato storico interpretabile" }); return; }
            Object.assign(base, {
              visits_count: visits ?? 0, total_value: value ?? 0,
              avg_ticket: parseNumber(get(r, "avg_ticket")) ?? (visits && value ? value / visits : null),
              last_visit: last, recency_days: last ? Math.round((Date.now() - new Date(last).getTime()) / 86400000) : null,
              phone: normPhone(get(r, "phone")), email: fixEmail(get(r, "email")),
              data_quality: "reconstructed", segment: "nuovo",
            });
          } else {
            Object.assign(base, {
              phone: normPhone(get(r, "phone")), email: fixEmail(get(r, "email")),
              gender: get(r, "gender") ? String(get(r, "gender")).trim().toUpperCase().slice(0, 1) : null,
              birth_date: parseDate(get(r, "birth_date")),
              privacy_consent: parseBool(get(r, "privacy_consent")),
              card_code: get(r, "card_code") ? String(get(r, "card_code")) : null,
              data_quality: "unverified", segment: "nuovo",
            });
          }
          const id = existing.get(key);
          if (id) {
            const { organization_id, full_name, normalized_key, segment, ...patch } = base;
            const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null));
            updates.push({ id, ...cleanPatch });
          } else inserts.push(base);
        });
        for (let i = 0; i < inserts.length; i += 400) {
          const { error } = await supabase.from("clients").insert(inserts.slice(i, i + 400));
          if (error) throw error;
          imported += Math.min(400, inserts.length - i);
        }
        for (const u of updates) {
          const { id, ...patch } = u;
          const { error } = await supabase.from("clients").update(patch).eq("id", id);
          if (error) { issues.push({ row_number: null, raw: { id }, reason: "Update fallito: " + error.message }); continue; }
          updated++;
        }
      }

      if (entity === "transactions") {
        const { data: st } = await supabase.from("staff_members").select("id,display_name").eq("organization_id", ctx.orgId);
        const staffMap = (st ?? []).map((s: any) => ({ id: s.id, k: normKey(s.display_name) }));
        const inserts: any[] = [];
        rows.forEach((r, i) => {
          const d = parseDate(get(r, "tx_date"));
          const worked = parseNumber(get(r, "worked_value"));
          const cash = parseNumber(get(r, "cash_value"));
          if (!d) { issues.push({ row_number: i + 1, raw: { r }, reason: "Data non interpretabile" }); return; }
          if (worked == null && cash == null) { issues.push({ row_number: i + 1, raw: { r }, reason: "Nessun importo" }); return; }
          const sName = get(r, "staff_name");
          const sMatch = sName ? staffMap.find(s => s.k === normKey(String(sName)) || s.k.includes(normKey(String(sName)))) : null;
          inserts.push({
            organization_id: ctx.orgId, tx_date: d, description: get(r, "description") ? String(get(r, "description")).slice(0, 200) : null,
            worked_value: worked ?? cash ?? 0, cash_value: cash ?? worked ?? 0,
            staff_id: sMatch?.id ?? null, data_quality: "observed", source_batch: batch.id,
          });
        });
        for (let i = 0; i < inserts.length; i += 400) {
          const { error } = await supabase.from("transactions").insert(inserts.slice(i, i + 400));
          if (error) throw error;
          imported += Math.min(400, inserts.length - i);
        }
      }

      if (entity === "catalog") {
        const inserts: any[] = [];
        rows.forEach((r, i) => {
          const name = get(r, "name");
          const price = parseNumber(get(r, "price"));
          if (!name || price == null) { issues.push({ row_number: i + 1, raw: { r }, reason: "Nome o prezzo mancante" }); return; }
          // Tipo riga: scelta esplicita dell'utente, oppure colonna Tipo del file
          let kind: string | null = catalogKind !== "auto" ? catalogKind : null;
          if (!kind) {
            const kindRaw = get(r, "kind") ? String(get(r, "kind")).toLowerCase() : "";
            if (kindRaw.includes("prod") || kindRaw.includes("art") || kindRaw.includes("rivend")) kind = "product";
            else if (kindRaw.includes("serv") || kindRaw.includes("trattam") || kindRaw.includes("prestaz")) kind = "service";
          }
          if (!kind) { issues.push({ row_number: i + 1, raw: { r }, reason: "Tipo non determinabile: indica sopra se l'elenco è di servizi o prodotti, o collega la colonna Tipo" }); return; }
          const base: any = {
            organization_id: ctx.orgId, name: String(name).trim(), price, kind,
            category: get(r, "category") ? String(get(r, "category")).trim() : null,
            source_ref: filename,
          };
          if (kind === "service") {
            base.duration_min = parseNumber(get(r, "duration_min"));
            base.direct_cost = parseNumber(get(r, "direct_cost")) ?? 0;
          } else {
            base.duration_min = null; // i prodotti non hanno durata (richiesta Dimitar)
            base.direct_cost = 0;
            base.list_cost = parseNumber(get(r, "list_cost"));
            base.supplier_discount_pct = parseNumber(get(r, "supplier_discount_pct"));
            base.stock_qty = parseNumber(get(r, "stock_qty")) ?? 0;
          }
          inserts.push(base);
        });
        // dedup interno al file (stesso nome+tipo → vince l'ultima riga), poi upsert:
        // reimportare lo stesso file AGGIORNA le voci esistenti (prezzi, giacenze, sconti) senza duplicarle
        const byKey = new Map<string, any>();
        for (const it of inserts) byKey.set(it.name.toLowerCase().trim() + "|" + it.kind, it);
        const unique = Array.from(byKey.values());
        const { data: existing } = await supabase.from("catalog_items").select("name_key,kind").eq("organization_id", ctx.orgId);
        const existSet = new Set((existing ?? []).map((x: any) => x.name_key + "|" + x.kind));
        for (let i = 0; i < unique.length; i += 400) {
          const { error } = await supabase.from("catalog_items")
            .upsert(unique.slice(i, i + 400), { onConflict: "organization_id,name_key,kind" });
          if (error) throw error;
        }
        for (const it of unique) {
          if (existSet.has(it.name.toLowerCase().trim() + "|" + it.kind)) updated += 1; else imported += 1;
        }
      }

      if (issues.length) {
        for (let i = 0; i < issues.length; i += 200) {
          await supabase.from("import_issues").insert(issues.slice(i, i + 200).map(x => ({ ...x, batch_id: batch.id, organization_id: ctx.orgId })));
        }
      }
      await supabase.from("import_batches").update({
        status: "imported", imported_rows: imported + updated, quarantined_rows: issues.length,
      }).eq("id", batch.id);

      setResult({ imported, updated, quarantined: issues.length });
      setStage("done");
    } catch (e: any) {
      setErr("Import fallito: " + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => { setStage("pick"); setRows([]); setHeaders([]); setResult(null); setErr(null); if (fileRef.current) fileRef.current.value = ""; };

  return (
    <Shell ctx={ctx}>
      <div className="page-head">
        <div>
          <h1>Import dati</h1>
          <p className="sub">Porta dentro GPS gli export del tuo gestionale — Excel o CSV, qualunque tracciato. Le righe ambigue finiscono in quarantena, mai trasformate in dati certi (Blueprint §9.3).</p>
        </div>
      </div>

      {err && <div className="alert err">{err}</div>}

      {stage === "pick" && (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            {ENTITIES.map(e => (
              <button key={e.key} className="card" style={{ textAlign: "left", cursor: "pointer", borderColor: entity === e.key ? "#c9a227" : undefined, borderWidth: entity === e.key ? 2 : 1 }} onClick={() => setEntity(e.key)}>
                <b className="serif" style={{ fontSize: 17 }}>{e.label}</b>
                <p className="sub" style={{ marginTop: 6 }}>{e.desc}</p>
              </button>
            ))}
          </div>
          <div className="card section" style={{ textAlign: "center", padding: 40, borderStyle: "dashed" }}>
            <p className="serif" style={{ fontSize: 19, margin: 0 }}>Carica il file esportato dal gestionale</p>
            <p className="sub">Formati: .xlsx, .xls, .csv — la prima riga con intestazioni viene riconosciuta da sola</p>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ marginTop: 12 }} onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
          </div>
        </>
      )}

      {stage === "map" && (
        <>
          <div className="card">
            <div className="step"><span className="n">1</span> File: <b>{filename}</b> — {num(rows.length)} righe · tipo: <b>{ENTITIES.find(e => e.key === entity)?.label}</b></div>
            {entity === "catalog" && (
              <div style={{ background: "#f7f3ea", border: "2px solid #c9a227", borderRadius: 10, padding: "12px 14px", margin: "10px 0" }}>
                <div className="kpi-label" style={{ marginBottom: 8 }}>Cosa contiene questo elenco?</div>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 14 }}>
                  <label style={{ cursor: "pointer" }}><input type="radio" name="ckind" checked={catalogKind === "product"} onChange={() => setCatalogKind("product")} /> 🧴 Solo prodotti (magazzino)</label>
                  <label style={{ cursor: "pointer" }}><input type="radio" name="ckind" checked={catalogKind === "service"} onChange={() => setCatalogKind("service")} /> ✂️ Solo servizi</label>
                  <label style={{ cursor: "pointer" }}><input type="radio" name="ckind" checked={catalogKind === "auto"} onChange={() => setCatalogKind("auto")} /> Misto — usa la colonna “Tipo” del file</label>
                </div>
                {catalogKind === "auto" && map["kind"] == null && (
                  <p className="sub" style={{ marginTop: 8, color: "#b3402a" }}>⚠️ Nessuna colonna “Tipo” collegata: con “Misto” le righe senza tipo finiranno in quarantena. Se è un elenco di soli prodotti o soli servizi, scegli l'opzione giusta qui sopra.</p>
                )}
                {catalogKind === "product" && <p className="sub" style={{ marginTop: 8 }}>Le righe entrano nel Catalogo → Prodotti con costo listino, sconto fornitore e giacenza. Nessuna durata in minuti.</p>}
                {catalogKind === "service" && <p className="sub" style={{ marginTop: 8 }}>Le righe entrano nel Catalogo → Servizi con durata in minuti (per il costo tempo × CAM).</p>}
              </div>
            )}
            <div className="step"><span className="n">2</span> Controlla il collegamento colonne → campi GPS (proposto in automatico):</div>
            <table className="tbl maptable" style={{ marginTop: 10 }}>
              <thead><tr><th>Campo GPS</th><th>Colonna del file</th><th>Esempio</th></tr></thead>
              <tbody>
                {visibleFields.map(f => (
                  <tr key={f.key}>
                    <td><b>{f.label}</b>{f.required && <span style={{ color: "#b3402a" }}> *</span>}</td>
                    <td>
                      <select value={map[f.key] ?? ""} onChange={e => setMap({ ...map, [f.key]: e.target.value === "" ? null : Number(e.target.value) })}>
                        <option value="">— non presente —</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                      </select>
                    </td>
                    <td className="mono">{map[f.key] != null ? String(rows[0]?.[map[f.key]!] ?? "") : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="step" style={{ marginTop: 14 }}><span className="n">3</span> Anteprima (prime 8 righe interpretate):</div>
            <div className="previewbox">
              <table className="tbl">
                <thead><tr>{visibleFields.map(f => <th key={f.key}>{f.label}</th>)}</tr></thead>
                <tbody>
                  {mappedPreview.map((r, i) => (
                    <tr key={i}>{visibleFields.map(f => <td key={f.key} className="mono">{r[f.key] == null ? "" : String(r[f.key]).slice(0, 30)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button className="btn" onClick={runImport} disabled={busy}>{busy ? "Import in corso…" : "Importa " + num(rows.length) + " righe"}</button>
              <button className="btn secondary" onClick={reset} disabled={busy}>Annulla</button>
            </div>
          </div>
        </>
      )}

      {stage === "done" && result && (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <h2 className="serif">Import completato</h2>
          <p style={{ fontSize: 15 }}>
            <b style={{ color: "#1e7a4f" }}>{num(result.imported)}</b> nuove righe importate ·{" "}
            <b style={{ color: "#2456c6" }}>{num(result.updated)}</b> schede aggiornate ·{" "}
            <b style={{ color: "#b3402a" }}>{num(result.quarantined)}</b> in quarantena
          </p>
          {result.quarantined > 0 && <p className="sub">Le righe in quarantena sono conservate con il motivo dello scarto: nessun dato ambiguo è diventato un fatto certo.</p>}
          <button className="btn" onClick={reset} style={{ marginTop: 10 }}>Nuovo import</button>
        </div>
      )}
    </Shell>
  );
}
