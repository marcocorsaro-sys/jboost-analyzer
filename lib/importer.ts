"use client";
// Modulo import agnostico GPS — Connector Kit modalità 3/8 (export file + caricamento assistito)
import * as XLSX from "xlsx";

export type EntityType = "clients" | "history" | "transactions" | "catalog";

export type FieldDef = { key: string; label: string; required?: boolean; synonyms: string[] };

export const FIELDS: Record<EntityType, FieldDef[]> = {
  history: [
    { key: "full_name", label: "Nominativo", required: true, synonyms: ["nominativo", "nome", "cliente", "name", "full name", "nome cliente"] },
    { key: "visits_count", label: "Passaggi/Visite", synonyms: ["passaggi", "visite", "n visite", "num visite", "visits", "frequenza"] },
    { key: "total_value", label: "Valore totale €", synonyms: ["valore", "totale", "spesa", "importo", "fatturato", "value", "speso"] },
    { key: "last_visit", label: "Ultima visita", synonyms: ["ultima visita", "ultimo passaggio", "data ultima", "last visit", "ultima"] },
    { key: "avg_ticket", label: "Fiche media €", synonyms: ["fiche", "fiche media", "ticket medio", "scontrino medio", "media"] },
    { key: "phone", label: "Cellulare", synonyms: ["cellulare", "telefono", "cell", "phone", "mobile", "tel"] },
    { key: "email", label: "Email", synonyms: ["email", "e-mail", "mail"] },
  ],
  clients: [
    { key: "full_name", label: "Nominativo", required: true, synonyms: ["nominativo", "nome", "cliente", "name"] },
    { key: "phone", label: "Cellulare", synonyms: ["cellulare", "telefono", "cell", "phone", "mobile", "tel"] },
    { key: "email", label: "Email", synonyms: ["email", "e-mail", "mail"] },
    { key: "gender", label: "Sesso", synonyms: ["sesso", "genere", "gender", "m/f"] },
    { key: "birth_date", label: "Data di nascita", synonyms: ["nascita", "data di nascita", "birth", "compleanno"] },
    { key: "privacy_consent", label: "Consenso privacy", synonyms: ["privacy", "consenso", "marketing"] },
    { key: "card_code", label: "Card", synonyms: ["card", "tessera", "fidelity"] },
  ],
  transactions: [
    { key: "tx_date", label: "Data", required: true, synonyms: ["data", "date", "giorno", "data transazione"] },
    { key: "description", label: "Descrizione", synonyms: ["descrizione", "servizio", "dettaglio", "note", "articolo"] },
    { key: "worked_value", label: "Lavorato €", synonyms: ["lavorato", "valore", "importo", "totale"] },
    { key: "cash_value", label: "Incassato €", synonyms: ["incassato", "pagato", "cassa", "incasso"] },
    { key: "staff_name", label: "Operatore", synonyms: ["operatore", "staff", "collaboratore", "barbiere"] },
    { key: "client_name", label: "Cliente", synonyms: ["cliente", "nominativo", "nome"] },
  ],
  catalog: [
    { key: "name", label: "Nome", required: true, synonyms: ["nome", "servizio", "prodotto", "articolo", "descrizione", "name"] },
    { key: "price", label: "Prezzo €", required: true, synonyms: ["prezzo", "price", "listino", "importo"] },
    { key: "duration_min", label: "Durata (min)", synonyms: ["durata", "minuti", "min", "tempo", "duration"] },
    { key: "direct_cost", label: "Costo diretto €", synonyms: ["costo", "costo diretto", "cost"] },
    { key: "kind", label: "Tipo (servizio/prodotto)", synonyms: ["tipo", "categoria", "kind"] },
  ],
};

export function parseFile(buf: ArrayBuffer, filename: string): { headers: string[]; rows: any[][] } {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null });
  // trova la riga header: prima riga con >= 2 celle testuali non vuote
  let hi = 0;
  for (let i = 0; i < Math.min(aoa.length, 12); i++) {
    const cells = (aoa[i] ?? []).filter(c => typeof c === "string" && c.trim().length > 1);
    if (cells.length >= 2) { hi = i; break; }
  }
  const headers = (aoa[hi] ?? []).map((h: any, i: number) => (h == null || String(h).trim() === "" ? `Colonna ${i + 1}` : String(h).trim()));
  const rows = aoa.slice(hi + 1).filter(r => (r ?? []).some(c => c != null && String(c).trim() !== ""));
  return { headers, rows };
}

const clean = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

export function autoMap(headers: string[], entity: EntityType): Record<string, number | null> {
  const map: Record<string, number | null> = {};
  const used = new Set<number>();
  for (const f of FIELDS[entity]) {
    let best: number | null = null;
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      const h = clean(headers[i]);
      if (f.synonyms.some(s => h === s)) { best = i; break; }
    }
    if (best == null) {
      for (let i = 0; i < headers.length; i++) {
        if (used.has(i)) continue;
        const h = clean(headers[i]);
        if (f.synonyms.some(s => h.includes(s) || s.includes(h) && h.length > 2)) { best = i; break; }
      }
    }
    map[f.key] = best;
    if (best != null) used.add(best);
  }
  return map;
}

export function normKey(name: string): string {
  return clean(name).replace(/[^a-z ]/g, "").split(" ").filter(Boolean).sort().join(" ");
}

export function parseNumber(v: any): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  let s = String(v).replace(/[€\s]/g, "");
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return isNaN(n) ? null : n;
}

export function parseDate(v: any): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0].slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function normPhone(v: any): string | null {
  if (v == null) return null;
  let d = String(v).replace(/\D/g, "");
  if (d.startsWith("0039")) d = d.slice(4);
  if (d.startsWith("39") && d.length === 12) d = d.slice(2);
  return d || null;
}

export function fixEmail(v: any): string | null {
  if (v == null) return null;
  let e = String(v).trim().toLowerCase();
  if (!e.includes("@")) return null;
  e = e.replace("@gamil.com", "@gmail.com").replace("@gmial.com", "@gmail.com").replace("@virigilio.it", "@virgilio.it");
  if (e.endsWith("@gmail.co")) e += "m";
  return e;
}

export function parseBool(v: any): boolean | null {
  if (v == null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (["true", "si", "sì", "1", "yes", "x", "ok"].includes(s)) return true;
  if (["false", "no", "0"].includes(s)) return false;
  return null;
}
