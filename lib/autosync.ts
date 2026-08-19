"use client";
// §5 spec Dimitar: la sincronizzazione agenda è automatica e continua, mai un pulsante.
// Ogni pagina operativa chiama ensureFreshCalendars(): se una connessione è più vecchia
// di STALE_MIN minuti parte il sync in background, senza intervento dell'utente.
import { supabase } from "./supabase";

const STALE_MIN = 5;
let inFlight: Record<string, boolean> = {};

export async function ensureFreshCalendars(orgId: string, onDone?: (synced: number) => void) {
  if (!orgId || inFlight[orgId]) return;
  inFlight[orgId] = true;
  try {
    const { data: conns } = await supabase.from("calendar_connections")
      .select("id,last_sync_at,status").eq("organization_id", orgId).neq("status", "disabled");
    const now = Date.now();
    const stale = (conns ?? []).filter((c: any) =>
      !c.last_sync_at || now - new Date(c.last_sync_at).getTime() > STALE_MIN * 60000);
    if (!stale.length) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    let tot = 0;
    for (const c of stale) {
      try {
        const res = await fetch("/api/calendar-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
          body: JSON.stringify({ connection_id: c.id }),
        });
        if (res.ok) { const j = await res.json(); tot += j.count ?? 0; }
      } catch {}
    }
    if (tot > 0 && onDone) onDone(tot);
  } finally {
    inFlight[orgId] = false;
  }
}

// Hook di comodo: sync all'apertura pagina + ogni 5 minuti finché la pagina è aperta
export function startAutoSync(orgId: string, onDone?: (n: number) => void): () => void {
  ensureFreshCalendars(orgId, onDone);
  const t = setInterval(() => ensureFreshCalendars(orgId, onDone), STALE_MIN * 60000);
  return () => clearInterval(t);
}
