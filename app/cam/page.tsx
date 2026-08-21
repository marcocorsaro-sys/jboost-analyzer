"use client";
// CAM CHECK — seconda landing di lead generation (brief Dimitar).
// "Il servizio che vendi di più ti fa davvero guadagnare?"
// Flusso: costi → capacità → CAM → servizio più erogato → calcolo → gate lead → report completo → CTA libro.
// Nessun costo prodotto richiesto nella fase servizio: prodotti e fornitori sono già nei costi mensili (mai doppio conteggio).
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

const BOOK_URL = "https://amzn.eu/d/031LSxMT";
const BLU = "#0D47A1", NAVY = "#0A1D3D", BG = "#F2F4F7", ROSSO = "#b3402a", VERDE = "#1e7a4f";

const track = (kind: string, lead_id?: string | null, meta?: any) =>
  supabase.rpc("track_event", { p_kind: kind, p_lead: lead_id ?? null, p_meta: meta ?? { tool: "cam_check" } }).then(() => {});

const VOCI: { k: string; l: string; hint?: string }[] = [
  { k: "affitto", l: "Affitto e costi di struttura" },
  { k: "utenze", l: "Utenze" },
  { k: "personale", l: "Personale e collaboratori" },
  { k: "fornitori", l: "Fornitori e prodotti" },
  { k: "marketing", l: "Marketing" },
  { k: "servizi", l: "Software, commercialista, consulenze, assicurazioni" },
  { k: "leasing", l: "Leasing, rate e impegni ricorrenti" },
  { k: "tasse", l: "Tasse" },
  { k: "contributi", l: "Contributi" },
  { k: "stipendio", l: "Stipendio che vuoi per te", hint: "Non ciò che avanza a fine mese: quello che l'azienda deve produrre per pagarti." },
  { k: "accantonamenti", l: "Accantonamenti mensili", hint: "Imprevisti, manutenzioni, investimenti futuri." },
  { k: "utile", l: "Utile desiderato dall'impresa" },
  { k: "altro", l: "Altri costi" },
];

const eur = (n: number, d = 2) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: d, maximumFractionDigits: d }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("it-IT").format(Math.round(n || 0));

type Stage = "intro" | "costi" | "capacita" | "servizio" | "gate" | "report";

export default function CamCheck() {
  const [stage, setStage] = useState<Stage>("intro");
  const [costs, setCosts] = useState<Record<string, number>>({});
  const [cap, setCap] = useState({ operators: 2, hours: 160, occKnown: true, occ: 70 });
  const [svc, setSvc] = useState({ name: "", price: 0, minutes: 45, count: 100 });
  const [form, setForm] = useState({ name: "", email: "", consent: false });
  const [leadId, setLeadId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { track("visit"); }, []);

  const R = useMemo(() => {
    const goal = VOCI.reduce((a, v) => a + (Number(costs[v.k]) || 0), 0);
    const availableMinutes = (Number(cap.operators) || 0) * (Number(cap.hours) || 0) * 60;
    const occ = cap.occKnown ? Math.min(100, Math.max(1, Number(cap.occ) || 0)) / 100 : null;
    const soldMinutes = occ != null ? availableMinutes * occ : null;
    // CAM sui minuti realmente vendibili quando l'occupazione è nota (prudenziale e più vero)
    const camBase = soldMinutes && soldMinutes > 0 ? soldMinutes : availableMinutes;
    const cam = camBase > 0 ? goal / camBase : 0;
    const cost = cam * (Number(svc.minutes) || 0);
    const margin = (Number(svc.price) || 0) - cost;
    const marginPct = Number(svc.price) > 0 ? (margin / Number(svc.price)) * 100 : 0;
    const impact = margin * (Number(svc.count) || 0);
    return { goal, availableMinutes, occ, soldMinutes, cam, cost, margin, marginPct, impact, minPrice: cost };
  }, [costs, cap, svc]);

  const saveLead = async () => {
    setErr(null);
    if (!form.name.trim() || !/.+@.+\..+/.test(form.email)) { setErr("Inserisci nome ed email validi."); return; }
    if (!form.consent) { setErr("Serve il consenso per inviarti il report."); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("submit_cam_lead", { p: {
      name: form.name.trim(), email: form.email.trim().toLowerCase(), consent: true,
      costs, monthly_goal: R.goal,
      operators: cap.operators, hours_per_operator: cap.hours,
      occupancy_pct: cap.occKnown ? cap.occ : null,
      available_minutes: R.availableMinutes, sold_minutes: R.soldMinutes,
      cam: R.cam, service_name: svc.name || null, service_price: svc.price,
      service_minutes: svc.minutes, service_count: svc.count,
      service_cost: R.cost, margin_per_unit: R.margin, margin_pct: R.marginPct,
      monthly_impact: R.impact, min_price: R.minPrice,
    }});
    setBusy(false);
    if (error) { setErr("Qualcosa non ha funzionato, riprova."); return; }
    setLeadId(data as string);
    track("lead_captured", data as string, { tool: "cam_check", margin: R.margin });
    setStage("report");
  };

  const box: React.CSSProperties = { maxWidth: 640, margin: "0 auto", padding: "0 18px" };
  const card: React.CSSProperties = { background: "#fff", border: "1px solid #dfe4ec", borderRadius: 14, padding: 20, boxShadow: "0 2px 10px rgba(10,29,61,.07)" };
  const btn: React.CSSProperties = { background: BLU, color: "#fff", border: "none", borderRadius: 10, padding: "14px 22px", fontSize: 16, fontWeight: 700, cursor: "pointer", width: "100%" };
  const inp: React.CSSProperties = { width: "100%", padding: "12px 13px", fontSize: 16, borderRadius: 10, border: "1.5px solid #c7d0de", boxSizing: "border-box", background: "#fff" };
  const lab: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: "#3a4351", display: "block", marginBottom: 5 };

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'Montserrat', Verdana, sans-serif", color: "#2B2F36", paddingBottom: 60 }}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ background: NAVY, color: "#dfe6f2", padding: "14px 18px", textAlign: "center", letterSpacing: ".12em", fontSize: 13, fontWeight: 700 }}>
        <a href="/sito" style={{ color: "#dfe6f2", textDecoration: "none" }}>GPS · GROWTH PERFORMANCE SYSTEM</a>
      </div>

      {stage === "intro" && (
        <div style={{ ...box, paddingTop: 44, textAlign: "center" }}>
          <div style={{ fontSize: 42 }}>⏱️</div>
          <h1 style={{ fontSize: 32, margin: "10px 0", color: NAVY, fontFamily: "'Cinzel', serif", lineHeight: 1.25 }}>
            Il servizio che vendi di più<br />ti fa davvero guadagnare?
          </h1>
          <p style={{ fontSize: 17.5, lineHeight: 1.55 }}>
            Calcola il tuo <b>CAM — Costo Aziendale al Minuto</b>: quanto costa un minuto del tuo salone.
            Poi scopri se il servizio che eroghi più spesso produce margine o lascia un buco da coprire con qualcos'altro.
          </p>
          <p style={{ fontSize: 14.5, color: "#5c6673" }}>Gratuito · circa 4 minuti · nessun dato richiesto prima del calcolo</p>
          <div style={{ marginTop: 22 }}>
            <button style={{ ...btn, maxWidth: 400 }} onClick={() => { track("test_started"); setStage("costi"); }}>Calcola il mio CAM →</button>
          </div>
          <p style={{ fontSize: 13, color: "#7b8798", marginTop: 26 }}>
            Il calcolo usa la logica del metodo GPS: obiettivo economico, capacità produttiva reale e valore del tempo.
          </p>
        </div>
      )}

      {stage === "costi" && (
        <div style={{ ...box, paddingTop: 26 }}>
          <div style={card}>
            <p style={{ fontSize: 12.5, letterSpacing: ".1em", color: "#7b8798", margin: 0 }}>PASSO 1 DI 3</p>
            <h2 style={{ fontFamily: "'Cinzel', serif", color: NAVY, fontSize: 23, margin: "6px 0 6px" }}>Quanto deve produrre il tuo salone ogni mese?</h2>
            <p style={{ fontSize: 14.5, color: "#5c6673" }}>
              Inserisci gli importi mensili. Lascia a zero ciò che non ti riguarda. Stipendio, accantonamenti e utile fanno parte
              dell'obiettivo: non sono ciò che eventualmente avanza.
            </p>
            {VOCI.map(v => (
              <div key={v.k} style={{ margin: "12px 0" }}>
                <label style={lab}>{v.l}</label>
                {v.hint && <p style={{ fontSize: 12.5, color: "#7b8798", margin: "0 0 5px" }}>{v.hint}</p>}
                <input type="number" inputMode="decimal" min={0} placeholder="0" style={inp}
                  value={costs[v.k] ?? ""} onChange={e => setCosts({ ...costs, [v.k]: Number(e.target.value) })} />
              </div>
            ))}
            <div style={{ background: "#eef2f9", borderRadius: 10, padding: "14px 16px", margin: "16px 0" }}>
              <p style={{ margin: 0, fontSize: 13, color: "#5c6673" }}>Obiettivo economico mensile</p>
              <b style={{ fontSize: 26, color: NAVY }}>{eur(R.goal, 0)}</b>
            </div>
            <button style={btn} disabled={R.goal <= 0} onClick={() => setStage("capacita")}>Continua →</button>
          </div>
        </div>
      )}

      {stage === "capacita" && (
        <div style={{ ...box, paddingTop: 26 }}>
          <div style={card}>
            <p style={{ fontSize: 12.5, letterSpacing: ".1em", color: "#7b8798", margin: 0 }}>PASSO 2 DI 3</p>
            <h2 style={{ fontFamily: "'Cinzel', serif", color: NAVY, fontSize: 23, margin: "6px 0 6px" }}>Quanta capacità produttiva hai?</h2>
            <p style={{ fontSize: 14.5, color: "#5c6673" }}>Conta le ore realmente vendibili, non le ore di presenza in salone.</p>

            <div style={{ margin: "14px 0" }}>
              <label style={lab}>Operatori produttivi</label>
              <input type="number" min={1} style={inp} value={cap.operators || ""} onChange={e => setCap({ ...cap, operators: Number(e.target.value) })} />
            </div>
            <div style={{ margin: "14px 0" }}>
              <label style={lab}>Ore produttive al mese, per ciascun operatore</label>
              <input type="number" min={1} style={inp} value={cap.hours || ""} onChange={e => setCap({ ...cap, hours: Number(e.target.value) })} />
              <p style={{ fontSize: 12.5, color: "#7b8798", margin: "5px 0 0" }}>Indicativamente: ore al giorno × giorni di apertura al mese.</p>
            </div>
            <div style={{ margin: "14px 0" }}>
              <label style={lab}>Tasso medio di occupazione</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input type="number" min={1} max={100} disabled={!cap.occKnown} style={{ ...inp, width: 110, opacity: cap.occKnown ? 1 : .5 }}
                  value={cap.occKnown ? (cap.occ || "") : ""} onChange={e => setCap({ ...cap, occ: Number(e.target.value) })} />
                <span style={{ fontSize: 15 }}>%</span>
                <label style={{ fontSize: 14, marginLeft: 6 }}>
                  <input type="checkbox" checked={!cap.occKnown} onChange={e => setCap({ ...cap, occKnown: !e.target.checked })} /> Non lo conosco
                </label>
              </div>
              {!cap.occKnown && <p style={{ fontSize: 12.5, color: "#7b8798", margin: "6px 0 0" }}>Nessun problema: calcoleremo il CAM sulla capacità disponibile. È il primo numero che GPS ti aiuta a misurare davvero.</p>}
            </div>

            <div style={{ background: "#eef2f9", borderRadius: 10, padding: "14px 16px", margin: "16px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "3px 0" }}>
                <span>Minuti produttivi disponibili</span><b>{num(R.availableMinutes)}′</b>
              </div>
              {R.soldMinutes != null && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "3px 0" }}>
                  <span>Minuti realmente venduti</span><b>{num(R.soldMinutes)}′</b>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, padding: "6px 0 0", borderTop: "1px solid #d9e0ec", marginTop: 6 }}>
                <span><b>Il tuo CAM</b></span><b style={{ color: BLU, fontSize: 20 }}>{eur(R.cam, 2)}/min</b>
              </div>
            </div>
            <button style={btn} disabled={R.cam <= 0} onClick={() => setStage("servizio")}>Ora analizziamo un servizio →</button>
            <button style={{ background: "none", border: "none", color: "#7b8798", marginTop: 10, cursor: "pointer", width: "100%" }} onClick={() => setStage("costi")}>← torna ai costi</button>
          </div>
        </div>
      )}

      {stage === "servizio" && (
        <div style={{ ...box, paddingTop: 26 }}>
          <div style={card}>
            <p style={{ fontSize: 12.5, letterSpacing: ".1em", color: "#7b8798", margin: 0 }}>PASSO 3 DI 3</p>
            <h2 style={{ fontFamily: "'Cinzel', serif", color: NAVY, fontSize: 23, margin: "6px 0 6px" }}>Il servizio che eroghi più spesso</h2>
            <p style={{ fontSize: 14.5, color: "#5c6673" }}>
              Non serve indicare il costo dei prodotti usati: fornitori e prodotti sono già dentro i costi mensili del passo 1.
              Contarli di nuovo qui significherebbe pagarli due volte.
            </p>
            <div style={{ margin: "14px 0" }}><label style={lab}>Nome del servizio</label>
              <input style={inp} placeholder="es. Taglio uomo" value={svc.name} onChange={e => setSvc({ ...svc, name: e.target.value })} /></div>
            <div style={{ margin: "14px 0" }}><label style={lab}>Prezzo di vendita €</label>
              <input type="number" min={0} style={inp} value={svc.price || ""} onChange={e => setSvc({ ...svc, price: Number(e.target.value) })} /></div>
            <div style={{ margin: "14px 0" }}><label style={lab}>Durata in minuti</label>
              <input type="number" min={1} style={inp} value={svc.minutes || ""} onChange={e => setSvc({ ...svc, minutes: Number(e.target.value) })} />
              <p style={{ fontSize: 12.5, color: "#7b8798", margin: "5px 0 0" }}>Il tempo che occupa davvero la poltrona, dall'inizio alla fine.</p></div>
            <div style={{ margin: "14px 0" }}><label style={lab}>Quante volte lo eroghi in un mese</label>
              <input type="number" min={1} style={inp} value={svc.count || ""} onChange={e => setSvc({ ...svc, count: Number(e.target.value) })} /></div>
            <button style={btn} disabled={!(svc.price > 0 && svc.minutes > 0 && svc.count > 0)} onClick={() => { track("test_completed"); setStage("gate"); }}>
              Calcola il risultato →
            </button>
            <button style={{ background: "none", border: "none", color: "#7b8798", marginTop: 10, cursor: "pointer", width: "100%" }} onClick={() => setStage("capacita")}>← torna alla capacità</button>
          </div>
        </div>
      )}

      {stage === "gate" && (
        <div style={{ ...box, paddingTop: 26 }}>
          {/* anteprima onesta: il verdetto sul servizio si vede subito, il report completo dopo i dati */}
          <div style={{ ...card, marginBottom: 14, borderTop: "5px solid " + (R.margin < 0 ? ROSSO : VERDE), textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 12.5, letterSpacing: ".1em", color: "#7b8798" }}>IL CALCOLO È PRONTO</p>
            <p style={{ fontSize: 15.5, margin: "10px 0 4px" }}>Il tuo CAM è <b style={{ color: BLU }}>{eur(R.cam, 2)} al minuto</b>.</p>
            <h2 style={{ fontFamily: "'Cinzel', serif", color: R.margin < 0 ? ROSSO : VERDE, fontSize: 24, margin: "10px 0 6px", lineHeight: 1.3 }}>
              {R.margin < 0
                ? `Ogni volta che eroghi ${svc.name || "questo servizio"} perdi ${eur(Math.abs(R.margin))}`
                : `Ogni erogazione di ${svc.name || "questo servizio"} produce ${eur(R.margin)} oltre il costo del tempo`}
            </h2>
            <p style={{ fontSize: 14.5, color: "#5c6673", margin: 0 }}>
              {R.margin < 0
                ? "Nel report completo trovi quanto pesa ogni mese, il prezzo minimo coerente col tuo obiettivo e su cosa puoi intervenire."
                : "Nel report completo trovi l'impatto mensile, il prezzo minimo di equilibrio e le leve per migliorare ancora."}
            </p>
          </div>
          <div style={{ ...card, textAlign: "center" }}>
            <h3 style={{ color: BLU, margin: "4px 0", fontSize: 20 }}>Dove ti mandiamo il report?</h3>
            <p style={{ fontSize: 14.5, color: "#5c6673" }}>Te lo mostriamo subito e te ne lasciamo copia via email.</p>
            <input placeholder="Il tuo nome" style={{ ...inp, margin: "6px 0" }} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input placeholder="La tua email" type="email" style={{ ...inp, margin: "6px 0" }} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            <label style={{ display: "block", fontSize: 12.5, color: "#5c6673", textAlign: "left", margin: "8px 0 14px" }}>
              <input type="checkbox" checked={form.consent} onChange={e => setForm({ ...form, consent: e.target.checked })} />
              {" "}Acconsento al trattamento dei dati e a ricevere il report e i contenuti GPS. Niente spam, disiscrizione quando vuoi.
            </label>
            {err && <p style={{ color: ROSSO, fontSize: 14 }}>{err}</p>}
            <button style={btn} disabled={busy} onClick={saveLead}>{busy ? "Un attimo…" : "Mostrami il report completo →"}</button>
          </div>
        </div>
      )}

      {stage === "report" && (
        <div style={{ ...box, paddingTop: 26 }}>
          <div style={{ ...card, borderTop: "5px solid " + (R.margin < 0 ? ROSSO : VERDE) }}>
            <p style={{ margin: 0, fontSize: 12.5, letterSpacing: ".1em", color: "#7b8798" }}>REPORT CAM · {form.name.split(" ")[0].toUpperCase()}</p>
            <h2 style={{ fontFamily: "'Cinzel', serif", color: NAVY, fontSize: 24, margin: "8px 0 14px" }}>La tua fotografia economica</h2>

            {[
              ["Obiettivo economico mensile", eur(R.goal, 0)],
              ["Minuti produttivi disponibili", num(R.availableMinutes) + "′"],
              ...(R.soldMinutes != null ? [["Minuti realmente venduti", num(R.soldMinutes) + "′ (" + Math.round((R.occ ?? 0) * 100) + "%)"]] as [string, string][] : []),
              ["Il tuo CAM", eur(R.cam, 2) + " al minuto"],
            ].map(([k, v]) => (
              <div key={k as string} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid #eef1f6", fontSize: 15 }}>
                <span>{k}</span><b>{v}</b>
              </div>
            ))}

            <h3 style={{ fontFamily: "'Cinzel', serif", color: NAVY, fontSize: 19, margin: "20px 0 8px" }}>{svc.name || "Il servizio analizzato"}</h3>
            {[
              ["Prezzo attuale", eur(svc.price)],
              ["Durata", num(svc.minutes) + " minuti"],
              ["Costo economico del tempo", eur(R.cost)],
              [R.margin < 0 ? "Perdita per erogazione" : "Margine per erogazione", (R.margin < 0 ? "−" : "+") + eur(Math.abs(R.margin))],
              [R.margin < 0 ? "Perdita in percentuale" : "Margine in percentuale", Math.round(Math.abs(R.marginPct)) + "%"],
              ["Erogazioni al mese", num(svc.count)],
            ].map(([k, v]) => (
              <div key={k as string} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid #eef1f6", fontSize: 15 }}>
                <span>{k}</span><b style={{ color: (k as string).includes("Perdita") ? ROSSO : (k as string).includes("Margine") ? VERDE : undefined }}>{v}</b>
              </div>
            ))}

            <div style={{ background: R.margin < 0 ? "#fdf0ec" : "#eef7f1", border: "1px solid " + (R.margin < 0 ? "#f0c7bb" : "#c2e0cf"), borderRadius: 12, padding: "16px 18px", margin: "18px 0" }}>
              <p style={{ margin: 0, fontSize: 13, letterSpacing: ".08em", color: R.margin < 0 ? ROSSO : VERDE, fontWeight: 700 }}>
                {R.margin < 0 ? "IMPATTO MENSILE" : "CONTRIBUTO MENSILE"}
              </p>
              <p style={{ fontSize: 26, fontWeight: 700, color: R.margin < 0 ? ROSSO : VERDE, margin: "6px 0" }}>
                {(R.margin < 0 ? "−" : "+") + eur(Math.abs(R.impact), 0)}
              </p>
              <p style={{ fontSize: 15, margin: 0, lineHeight: 1.55 }}>
                {R.margin < 0 ? (
                  <>
                    {eur(Math.abs(R.margin))} × {num(svc.count)} erogazioni. Questi {eur(Math.abs(R.impact), 0)} devono essere prodotti da altri servizi
                    o da altre vendite: altrimenti vengono sottratti all'utile dell'impresa, al tuo stipendio o agli accantonamenti.
                    Più vendi questo servizio, più la perdita si accumula.
                  </>
                ) : (
                  <>
                    {eur(R.margin)} × {num(svc.count)} erogazioni. È il valore che questo servizio produce ogni mese <b>oltre</b> il costo
                    del tempo che occupa: la parte che alimenta utile, stipendio e accantonamenti.
                  </>
                )}
              </p>
            </div>

            <div style={{ background: "#eef2f9", borderRadius: 12, padding: "16px 18px" }}>
              <p style={{ margin: 0, fontSize: 13, letterSpacing: ".08em", color: "#5c6673", fontWeight: 700 }}>PREZZO MINIMO COERENTE CON IL TUO OBIETTIVO</p>
              <p style={{ fontSize: 26, fontWeight: 700, color: NAVY, margin: "6px 0" }}>{eur(R.minPrice)}</p>
              <p style={{ fontSize: 14, margin: 0, color: "#4c5661" }}>
                Non è un prezzo consigliato da noi: è il punto in cui il servizio copre esattamente il tempo che occupa,
                calcolato sui tuoi costi, sul tuo obiettivo e sulla tua capacità produttiva.
              </p>
            </div>

            <h3 style={{ fontFamily: "'Cinzel', serif", color: NAVY, fontSize: 18, margin: "22px 0 8px" }}>Su cosa puoi intervenire</h3>
            <p style={{ fontSize: 14.5, color: "#5c6673", marginTop: 0 }}>Aumentare il prezzo è solo una delle leve — spesso non la prima.</p>
            {[
              ["Prezzo", "Allinearlo al valore e al tempo reale del servizio, anche con varianti diverse per durata."],
              ["Durata", "Ridurre i minuti improduttivi dentro il servizio vale quanto un aumento di prezzo."],
              ["Capacità produttiva", "Più ore realmente vendibili abbassano il costo di ogni minuto."],
              ["Tasso di occupazione", "Riempire i buchi già esistenti è la leva più economica di tutte."],
              ["Struttura dei costi", "Ogni costo che scende riduce l'obiettivo mensile — e quindi il CAM."],
            ].map(([k, v]) => (
              <div key={k} style={{ padding: "10px 0", borderBottom: "1px solid #eef1f6" }}>
                <b style={{ fontSize: 15, color: BLU }}>{k}</b>
                <p style={{ fontSize: 14.5, margin: "3px 0 0" }}>{v}</p>
              </div>
            ))}
            <p style={{ fontSize: 13, color: "#7b8798", marginTop: 14 }}>
              Il calcolo si basa sui dati che hai inserito ed è indicativo: serve a farti vedere il meccanismo, non a sostituire l'analisi completa del tuo salone.
            </p>
          </div>

          <div style={{ ...card, marginTop: 16, textAlign: "center", background: NAVY, color: "#dfe6f2", border: "none" }}>
            <p style={{ fontSize: 12.5, letterSpacing: ".1em", margin: 0, opacity: .8 }}>IL PASSO SUCCESSIVO</p>
            <h3 style={{ fontSize: 21, margin: "8px 0", fontFamily: "'Cinzel', serif", color: "#fff" }}>📖 L'azienda chiamata salone</h3>
            <p style={{ fontSize: 15, lineHeight: 1.55, opacity: .95 }}>
              Il CAM è una delle metriche del metodo GPS. Il libro spiega il sistema economico e gestionale nel suo insieme:
              come costruire l'obiettivo, leggere la capacità, capire quali clienti e quali servizi ti fanno davvero guadagnare.
            </p>
            <a href={BOOK_URL} target="_blank" rel="noreferrer" onClick={() => track("cta_book", leadId)}
              style={{ display: "inline-block", background: "#fff", color: BLU, fontWeight: 800, borderRadius: 10, padding: "14px 26px", fontSize: 16, textDecoration: "none", marginTop: 6 }}>
              Scopri il libro →
            </a>
          </div>

          <p style={{ textAlign: "center", fontSize: 13.5, marginTop: 18 }}>
            <a href="/check" style={{ color: BLU }}>Fai anche il Salon Check →</a>
          </p>
        </div>
      )}
    </div>
  );
}
