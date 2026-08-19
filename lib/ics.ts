// Parser ICS minimale (server-side) — VEVENT: UID, SUMMARY, DTSTART, DTEND, STATUS, ATTENDEE
export type IcsEvent = {
  uid: string;
  summary: string | null;
  start: string | null; // ISO
  end: string | null;
  status: string | null;
  attendee: string | null;
};

function unfold(text: string): string[] {
  const raw = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

// Offset (ore) di Europe/Rome a una certa data
function romeOffsetHours(y: number, mo: number, d: number): number {
  const probe = new Date(Date.UTC(y, mo - 1, d, 12));
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Rome", hour: "numeric", hour12: false });
  const romeHour = Number(fmt.format(probe));
  return romeHour - 12;
}

function parseIcsDate(value: string, tzid: string | null): string | null {
  // forme: 20260808T093000Z | 20260808T093000 | 20260808
  let m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (m) {
    const [_, y, mo, d, h, mi, s, z] = m;
    if (z === "Z") return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
    // naive o TZID: assumiamo timezone del salone (Europe/Rome)
    const off = romeOffsetHours(Number(y), Number(mo), Number(d));
    const sign = off >= 0 ? "+" : "-";
    const pad = String(Math.abs(off)).padStart(2, "0");
    return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${pad}:00`;
  }
  m = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T00:00:00+02:00`;
  return null;
}

export function parseIcs(text: string): IcsEvent[] {
  const lines = unfold(text);
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | null = null;
  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) { cur = {}; continue; }
    if (line.startsWith("END:VEVENT")) {
      if (cur?.uid && cur.start) events.push({
        uid: cur.uid, summary: cur.summary ?? null, start: cur.start ?? null,
        end: cur.end ?? null, status: cur.status ?? null, attendee: cur.attendee ?? null,
      });
      cur = null; continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const left = line.slice(0, idx); const value = line.slice(idx + 1).trim();
    const [prop, ...params] = left.split(";");
    const tzid = params.find(p => p.startsWith("TZID="))?.slice(5) ?? null;
    switch (prop) {
      case "UID": cur.uid = value; break;
      case "SUMMARY": cur.summary = value.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/g, " "); break;
      case "DTSTART": cur.start = parseIcsDate(value, tzid) ?? undefined; break;
      case "DTEND": cur.end = parseIcsDate(value, tzid) ?? undefined; break;
      case "STATUS": cur.status = value; break;
      case "ATTENDEE": if (!cur.attendee) cur.attendee = (params.find(p => p.startsWith("CN="))?.slice(3) ?? value.replace("mailto:", "")); break;
    }
    if (prop === "ATTENDEE" && !cur.attendee) cur.attendee = value.replace("mailto:", "");
  }
  return events;
}
