"use client";
// GPS SALON CHECK — landing pubblica di lead generation (spec Dimitar).
// Funnel: contenuto/social → Salon Check → lead segmentato → follow-up → libro → formazione → cliente GPS.
// Pagina SENZA login, mobile-first. I punteggi restano invisibili all'utente fino alla diagnosi.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AREAS, QUESTIONS, OBSERVATIONS, computeScores } from "@/lib/saloncheck";

// CTA principale del funnel: il libro "L'azienda chiamata salone" su Amazon
const BOOK_URL = "https://amzn.eu/d/031LSxMT";

const track = (kind: string, lead_id?: string | null, meta?: any) => {
  supabase.from("lead_events").insert({ kind, lead_id: lead_id ?? null, meta: meta ?? null }).then(() => {});
};

type Stage = "intro" | "quiz" | "qualify" | "gate" | "result";

export default function SalonCheck() {
  const [stage, setStage] = useState<Stage>("intro");
  const [qi, setQi] = useState(0);
  const [answers, setAnswers] = useState<{ q: number; opt: number; s: number; area: string }[]>([]);
  const [qual, setQual] = useState({ team_size: "", years: "", urgency: "", support_pref: "" });
  const [form, setForm] = useState({ name: "", email: "", consent: false });
  const [leadId, setLeadId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { track("visit"); }, []);

  const res = useMemo(() => computeScores(answers), [answers]);

  const answer = (opt: number) => {
    const q = QUESTIONS[qi];
    const next = [...answers.filter(a => a.q !== qi), { q: qi, opt, s: q.opts[opt].s, area: q.area }];
    setAnswers(next);
    if (qi + 1 < QUESTIONS.length) setQi(qi + 1);
    else { track("test_completed"); setStage("qualify"); }
  };

  const saveLead = async () => {
    setErr(null);
    if (!form.name.trim() || !/.+@.+\..+/.test(form.email)) { setErr("Inserisci nome ed email validi."); return; }
    if (!form.consent) { setErr("Serve il consenso per inviarti la diagnosi e i contenuti successivi."); return; }
    setBusy(true);
    const { data, error } = await supabase.from("leads").insert({
      name: form.name.trim(), email: form.email.trim().toLowerCase(), consent: true,
      team_size: qual.team_size || null, years: qual.years || null,
      urgency: qual.urgency || null, support_pref: qual.support_pref || null,
      answers, scores: res.scores, primary_area: res.primary, secondary_area: res.secondary,
    }).select("id").single();
    setBusy(false);
    if (error) { setErr("Qualcosa non ha funzionato, riprova."); return; }
    setLeadId(data.id);
    track("lead_captured", data.id, { primary: res.primary, urgency: qual.urgency });
    setStage("result");
  };

  // Identità GPS blu (brief brand): blu #0D47A1, navy #0A1D3D, neutri freddi
  const G = "#0D47A1", GOLD = "#0A1D3D", BG = "#F2F4F7";
  const box: React.CSSProperties = { maxWidth: 640, margin: "0 auto", padding: "0 18px" };
  const card: React.CSSProperties = { background: "#fff", border: "1px solid #dfe4ec", borderRadius: 14, padding: 20, boxShadow: "0 2px 10px rgba(10,29,61,.07)" };
  const btn: React.CSSProperties = { background: G, color: "#fff", border: "none", borderRadius: 10, padding: "14px 22px", fontSize: 16, fontWeight: 700, cursor: "pointer", width: "100%" };

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'Montserrat', Verdana, sans-serif", color: "#2B2F36", paddingBottom: 60 }}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ background: "#0A1D3D", color: "#dfe6f2", padding: "14px 18px", textAlign: "center", letterSpacing: ".12em", fontSize: 13, fontWeight: 700 }}>
        <a href="/sito" style={{ color: "#dfe6f2", textDecoration: "none" }}>GPS · GROWTH PERFORMANCE SYSTEM</a>
      </div>

      {stage === "intro" && (
        <div style={{ ...box, paddingTop: 40, textAlign: "center" }}>
          <div style={{ fontSize: 44 }}>💈</div>
          <h1 style={{ fontSize: 34, margin: "10px 0", color: "#0A1D3D", fontFamily: "'Cinzel', serif" }}>GPS Salon Check</h1>
          <p style={{ fontSize: 18, lineHeight: 1.5 }}>
            Il tuo salone lavora tanto — ma <b>dove</b> sta perdendo margine?<br />
            18 domande, 3 minuti: scopri quali aree della tua azienda-salone hanno più bisogno di attenzione, tra numeri, agenda, clienti, vendita, marketing e team.
          </p>
          <p style={{ fontSize: 14.5, color: "#5c6b58" }}>Gratuito · risultato immediato · pensato per titolari di barbershop e saloni</p>
          <div style={{ marginTop: 22 }}>
            <button style={{ ...btn, maxWidth: 380 }} onClick={() => { track("test_started"); setStage("quiz"); }}>Inizia il check →</button>
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 14, flexWrap: "wrap", marginTop: 34, fontSize: 13.5, color: "#4c5a48" }}>
            {Object.values(AREAS).map(a => <span key={a.label}>{a.icon} {a.label}</span>)}
          </div>
        </div>
      )}

      {stage === "quiz" && (() => {
        const q = QUESTIONS[qi];
        const done = answers.filter(a => a.q < qi).length;
        return (
          <div style={{ ...box, paddingTop: 26 }}>
            <div style={{ background: "#dde3ec", borderRadius: 6, height: 8, marginBottom: 6 }}>
              <div style={{ width: ((qi) / QUESTIONS.length * 100) + "%", height: 8, background: GOLD, borderRadius: 6, transition: "width .3s" }} />
            </div>
            <p style={{ fontSize: 12.5, color: "#77826f", margin: "0 0 14px" }}>
              Domanda {qi + 1} di {QUESTIONS.length} · {AREAS[q.area].icon} {AREAS[q.area].label}
            </p>
            <div style={card}>
              <h2 style={{ fontSize: 21, margin: "0 0 16px", color: "#22301f" }}>{q.text}</h2>
              {q.opts.map((o, i) => (
                <button key={i} onClick={() => answer(i)}
                  style={{ display: "block", width: "100%", textAlign: "left", margin: "8px 0", padding: "13px 14px", fontSize: 15.5, borderRadius: 10, border: "1.5px solid #c7d0de", background: "#f7f9fc", cursor: "pointer" }}>
                  {o.t}
                </button>
              ))}
            </div>
            {qi > 0 && <button style={{ background: "none", border: "none", color: "#77826f", marginTop: 12, cursor: "pointer" }} onClick={() => setQi(qi - 1)}>← domanda precedente</button>}
          </div>
        );
      })()}

      {stage === "qualify" && (
        <div style={{ ...box, paddingTop: 26 }}>
          <div style={card}>
            <h2 style={{ color: G, marginTop: 0 }}>Ultime 4 domande sul tuo salone</h2>
            <p style={{ fontSize: 14.5, color: "#5c6b58" }}>Servono a rendere la diagnosi più precisa.</p>
            {[
              { k: "team_size", label: "Quante persone lavorano nel salone?", opts: ["Solo io", "2–3", "4–6", "7 o più"] },
              { k: "years", label: "Da quanto esiste l'attività?", opts: ["Meno di 2 anni", "2–5 anni", "5–10 anni", "Più di 10 anni"] },
              { k: "urgency", label: "Quanto senti urgente sistemare le cose?", opts: ["Poco: curiosità", "Abbastanza: qualcosa non torna", "Molto: voglio agire subito"] },
              { k: "support_pref", label: "Che tipo di supporto preferiresti?", opts: ["Approfondire da solo", "Formazione", "Un percorso completo", "Strumenti di misurazione"] },
            ].map(f => (
              <div key={f.k} style={{ margin: "14px 0" }}>
                <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 15 }}>{f.label}</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {f.opts.map(o => (
                    <button key={o} onClick={() => setQual({ ...qual, [f.k]: o })}
                      style={{ padding: "9px 14px", borderRadius: 20, fontSize: 14, cursor: "pointer", border: "1.5px solid " + ((qual as any)[f.k] === o ? G : "#c7d0de"), background: (qual as any)[f.k] === o ? "#e4ecf9" : "#f7f9fc", fontWeight: (qual as any)[f.k] === o ? 700 : 400 }}>
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button style={{ ...btn, marginTop: 8 }} disabled={!qual.team_size || !qual.years || !qual.urgency || !qual.support_pref}
              onClick={() => setStage("gate")}>Vedi la diagnosi →</button>
          </div>
        </div>
      )}

      {stage === "gate" && (
        <div style={{ ...box, paddingTop: 26 }}>
          <div style={{ ...card, textAlign: "center" }}>
            <div style={{ fontSize: 34 }}>🔎</div>
            <h2 style={{ color: G, margin: "8px 0" }}>La tua diagnosi è pronta</h2>
            <p style={{ fontSize: 15, color: "#4c5a48" }}>Abbiamo analizzato le 6 aree del tuo salone e individuato dove concentrare l'attenzione. Dicci dove inviarla e la vedi subito.</p>
            <input placeholder="Il tuo nome" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              style={{ width: "100%", padding: "13px 14px", fontSize: 16, borderRadius: 10, border: "1.5px solid #c7d0de", margin: "6px 0", boxSizing: "border-box" }} />
            <input placeholder="La tua email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
              style={{ width: "100%", padding: "13px 14px", fontSize: 16, borderRadius: 10, border: "1.5px solid #c7d0de", margin: "6px 0", boxSizing: "border-box" }} />
            <label style={{ display: "block", fontSize: 12.5, color: "#5c6b58", textAlign: "left", margin: "8px 0 14px" }}>
              <input type="checkbox" checked={form.consent} onChange={e => setForm({ ...form, consent: e.target.checked })} />
              {" "}Acconsento al trattamento dei dati e a ricevere la diagnosi e i contenuti GPS su come far crescere il mio salone. Niente spam, disiscrizione quando vuoi.
            </label>
            {err && <p style={{ color: "#a33a25", fontSize: 14 }}>{err}</p>}
            <button style={btn} disabled={busy} onClick={saveLead}>{busy ? "Un attimo…" : "Mostrami la diagnosi →"}</button>
          </div>
        </div>
      )}

      {stage === "result" && (() => {
        const p = AREAS[res.primary], s = AREAS[res.secondary];
        const band = (v: number) => (v > 66 ? "alta" : v >= 34 ? "media" : "bassa");
        const col = (v: number) => (v > 66 ? "#b3402a" : v >= 34 ? "#b8860b" : "#1e7a4f");
        return (
          <div style={{ ...box, paddingTop: 26 }}>
            <div style={{ ...card, borderTop: "5px solid " + GOLD }}>
              <p style={{ margin: 0, fontSize: 13, letterSpacing: ".1em", color: "#77826f" }}>DIAGNOSI GPS · {form.name.split(" ")[0].toUpperCase()}</p>
              <h2 style={{ color: G, margin: "6px 0 2px", fontSize: 26 }}>{p.icon} La tua priorità: {p.label}</h2>
              <p style={{ fontSize: 15.5, lineHeight: 1.55 }}>{(OBSERVATIONS as any)[res.primary][band(res.scores[res.primary])]}</p>
              <p style={{ fontSize: 14.5, color: "#4c5a48" }}><b>Seconda area da tenere d'occhio: {s.icon} {s.label}.</b> {(OBSERVATIONS as any)[res.secondary][band(res.scores[res.secondary])]}</p>

              <div style={{ margin: "18px 0" }}>
                <p style={{ fontSize: 13, letterSpacing: ".08em", color: "#77826f", margin: "0 0 8px" }}>IL QUADRO COMPLETO — INDICE DI CRITICITÀ PER AREA</p>
                {Object.entries(AREAS).map(([k, a]) => (
                  <div key={k} style={{ margin: "7px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
                      <span>{a.icon} {a.label}{k === res.primary ? " ★" : ""}</span>
                      <b style={{ color: col(res.scores[k]) }}>{res.scores[k] > 66 ? "critica" : res.scores[k] >= 34 ? "da migliorare" : "solida"}</b>
                    </div>
                    <div style={{ background: "#dde3ec", borderRadius: 5, height: 9 }}>
                      <div style={{ width: Math.max(4, res.scores[k]) + "%", height: 9, borderRadius: 5, background: col(res.scores[k]) }} />
                    </div>
                  </div>
                ))}
              </div>

              <p style={{ fontSize: 14, color: "#4c5a48", lineHeight: 1.5 }}>
                Cosa significa: l'indice misura quanto ogni area è governata dai numeri invece che dall'abitudine. Non è una pagella — è la mappa di dove il tuo tempo da titolare rende di più. Riceverai la diagnosi anche via email, con i primi passi per l'area {p.label}.
              </p>
            </div>

            <div style={{ ...card, marginTop: 16, textAlign: "center", background: "#0A1D3D", color: "#dfe6f2", border: "none" }}>
              <p style={{ fontSize: 13, letterSpacing: ".1em", margin: 0, opacity: .8 }}>IL PRIMO PASSO DEL METODO GPS</p>
              <h3 style={{ fontSize: 22, margin: "8px 0" }}>📖 "L'azienda chiamata salone"</h3>
              <p style={{ fontSize: 15, lineHeight: 1.5, opacity: .95 }}>
                GPS, il metodo dietro questa diagnosi: trasformare il salone in azienda, il titolare in imprenditore e i collaboratori in un vero team — partendo esattamente da aree come <b>{p.label}</b>.
              </p>
              <a href={BOOK_URL} target="_blank" rel="noreferrer" onClick={() => track("cta_book", leadId)}
                style={{ display: "inline-block", background: "#fff", color: "#0D47A1", fontWeight: 800, borderRadius: 10, padding: "14px 26px", fontSize: 16, textDecoration: "none", marginTop: 6 }}>
                Scopri il libro →
              </a>
            </div>
            <p style={{ textAlign: "center", fontSize: 12, color: "#8a927f", marginTop: 18 }}>GPS · Growth Performance System — la diagnosi è indicativa e basata sulle tue risposte.</p>
          </div>
        );
      })()}
    </div>
  );
}
