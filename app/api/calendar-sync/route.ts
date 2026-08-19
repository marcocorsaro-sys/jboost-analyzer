import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parseIcs } from "@/lib/ics";

const SUPABASE_URL = "https://ignlxrdfhtjnpthlzpeq.supabase.co";
const SUPABASE_KEY = "sb_publishable_TL40C5EqF-Nnk_qAn5KzVQ_4zWbkCFd";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Appt = {
  organization_id: string; source_system: string; external_id: string;
  starts_at: string; ends_at: string | null; client_name: string | null;
  staff_id: string | null; service_name: string | null; status: string; raw: any;
  last_synced_at: string;
};

async function syncIcs(conn: any): Promise<Appt[]> {
  const url = conn.config?.ics_url;
  if (!url) throw new Error("URL ICS mancante nella connessione");
  const res = await fetch(url, { headers: { "User-Agent": "GPS-Connector/1.0" } });
  if (!res.ok) throw new Error("Feed ICS non raggiungibile (HTTP " + res.status + ")");
  const text = await res.text();
  const events = parseIcs(text);
  const cutoff = Date.now() - 30 * 86400000; // ultimi 30 giorni + futuro
  return events
    .filter(e => e.start && new Date(e.start).getTime() > cutoff)
    .map(e => ({
      organization_id: conn.organization_id,
      source_system: "ics:" + conn.id.slice(0, 8),
      external_id: e.uid,
      starts_at: e.start!,
      ends_at: e.end,
      client_name: e.attendee ?? e.summary,
      staff_id: conn.staff_id ?? null,
      service_name: e.summary,
      status: e.status === "CANCELLED" ? "cancelled" : "confirmed",
      raw: e as any,
      last_synced_at: new Date().toISOString(),
    }));
}

async function syncCalendly(conn: any): Promise<Appt[]> {
  const token = conn.config?.token;
  if (!token) throw new Error("Token Calendly mancante");
  const h = { Authorization: "Bearer " + token };
  const me = await fetch("https://api.calendly.com/users/me", { headers: h });
  if (!me.ok) throw new Error("Token Calendly non valido (HTTP " + me.status + ")");
  const meJson = await me.json();
  const userUri = meJson.resource?.uri;
  const minStart = new Date(Date.now() - 30 * 86400000).toISOString();
  const evRes = await fetch(`https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&min_start_time=${encodeURIComponent(minStart)}&count=100`, { headers: h });
  if (!evRes.ok) throw new Error("Errore lettura eventi Calendly (HTTP " + evRes.status + ")");
  const evJson = await evRes.json();
  const events = evJson.collection ?? [];
  const out: Appt[] = [];
  for (const e of events.slice(0, 100)) {
    let clientName: string | null = null;
    try {
      const uuid = String(e.uri).split("/").pop();
      const inv = await fetch(`https://api.calendly.com/scheduled_events/${uuid}/invitees?count=1`, { headers: h });
      if (inv.ok) clientName = (await inv.json()).collection?.[0]?.name ?? null;
    } catch { /* nome invitato opzionale */ }
    out.push({
      organization_id: conn.organization_id,
      source_system: "calendly",
      external_id: String(e.uri).split("/").pop()!,
      starts_at: e.start_time,
      ends_at: e.end_time ?? null,
      client_name: clientName,
      staff_id: conn.staff_id ?? null,
      service_name: e.name ?? null,
      status: e.status === "canceled" ? "cancelled" : "confirmed",
      raw: e,
      last_synced_at: new Date().toISOString(),
    });
  }
  return out;
}

async function syncWix(conn: any): Promise<Appt[]> {
  const { api_key, site_id } = conn.config ?? {};
  if (!api_key || !site_id) throw new Error("API key o Site ID Wix mancanti");
  const res = await fetch("https://www.wixapis.com/bookings/v2/bookings/query", {
    method: "POST",
    headers: { Authorization: api_key, "wix-site-id": site_id, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { sort: [{ fieldName: "startDate", order: "DESC" }], cursorPaging: { limit: 100 } } }),
  });
  if (!res.ok) throw new Error("Wix Bookings API: HTTP " + res.status + " — verifica API key e Site ID");
  const json = await res.json();
  const bookings = json.bookings ?? json.extendedBookings ?? [];
  return bookings.map((b: any) => {
    const slot = b.bookedEntity?.slot ?? b.slot ?? {};
    return {
      organization_id: conn.organization_id,
      source_system: "wix",
      external_id: b.id,
      starts_at: slot.startDate ?? b.startDate ?? b.createdDate,
      ends_at: slot.endDate ?? b.endDate ?? null,
      client_name: b.contactDetails ? [b.contactDetails.firstName, b.contactDetails.lastName].filter(Boolean).join(" ") : null,
      staff_id: conn.staff_id ?? null,
      service_name: b.bookedEntity?.title ?? b.bookedEntity?.slot?.serviceName ?? null,
      status: ["CANCELED", "DECLINED"].includes(b.status) ? "cancelled" : "confirmed",
      raw: b,
      last_synced_at: new Date().toISOString(),
    } as Appt;
  }).filter((a: Appt) => a.starts_at);
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { global: { headers: { Authorization: auth } } });

  const { connection_id } = await req.json();
  const { data: conn, error } = await supabase.from("calendar_connections").select("*").eq("id", connection_id).single();
  if (error || !conn) return NextResponse.json({ error: "Connessione non trovata" }, { status: 404 });

  try {
    let rows: Appt[] = [];
    if (conn.provider === "ics") rows = await syncIcs(conn);
    else if (conn.provider === "calendly") rows = await syncCalendly(conn);
    else if (conn.provider === "wix") rows = await syncWix(conn);

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const { error: upErr } = await supabase.from("appointments")
        .upsert(rows.slice(i, i + 200), { onConflict: "organization_id,source_system,external_id" });
      if (upErr) throw new Error(upErr.message);
      upserted += Math.min(200, rows.length - i);
    }
    await supabase.from("calendar_connections").update({
      status: "active", last_sync_at: new Date().toISOString(),
      last_result: `OK: ${upserted} appuntamenti sincronizzati`,
    }).eq("id", conn.id);
    return NextResponse.json({ ok: true, count: upserted });
  } catch (e: any) {
    await supabase.from("calendar_connections").update({
      status: "error", last_sync_at: new Date().toISOString(), last_result: String(e?.message ?? e),
    }).eq("id", conn.id);
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 502 });
  }
}
