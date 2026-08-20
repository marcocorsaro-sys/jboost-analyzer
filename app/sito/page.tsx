"use client";
// HOME SITO GPS — struttura narrativa del brief §10:
// hero → problema → metodo → Guarda.Prevedi.Scegli. → software → metriche → fondatore → TGI → ecosistema → CTA
import Link from "next/link";
import SiteShell, { BLU, NAVY } from "@/components/SiteShell";

const DOLORI = [
  "Agenda piena ma cassa fragile.",
  "Incassi elevati senza chiarezza sul margine.",
  "Team occupato ma non necessariamente performante.",
  "Dati disponibili ma dispersi, o letti troppo tardi.",
  "Servizi venduti molto ma potenzialmente poco profittevoli.",
  "Decisioni prese a intuito anziché su indicatori strutturati.",
];

const AREE = [
  { t: "Controllo economico", d: "Obiettivi, costi, break-even, capacità produttiva e marginalità." },
  { t: "Performance", d: "KPI del salone e dei singoli operatori, letti rispetto a obiettivi chiari." },
  { t: "Cliente", d: "Valore, frequenza, comportamento, marginalità, rischio e potenziale." },
  { t: "Offerta e vendita", d: "Consulenza, scelta guidata, up-sell, cross-sell e coerenza della proposta." },
  { t: "Team", d: "Ruoli, standard, responsabilità, performance e sistemi premianti." },
  { t: "Marketing", d: "Azioni costruite sui segmenti e sui dati, non promozioni improvvisate." },
];

const METRICHE = ["Costo al minuto", "Lavorato vs incassato", "Break-even e obiettivo economico", "Marginalità per servizio e per cliente", "Whale Curve", "Occupazione reale vs target", "Prepagate e debito operativo", "Forecast e scostamenti"];

export default function SitoHome() {
  return (
    <SiteShell>
      {/* HERO */}
      <section className="s-hero">
        <div className="s-wrap" style={{ padding: "84px 22px 70px", textAlign: "center" }}>
          <p className="s-eyebrow">GPS · Growth Performance System</p>
          <h1 style={{ fontSize: "clamp(30px, 5.4vw, 52px)", margin: "14px auto 18px", maxWidth: 820, lineHeight: 1.18 }}>
            Smetti di gestire il salone a sensazione.
          </h1>
          <p style={{ fontSize: 18.5, maxWidth: 680, margin: "0 auto 10px", color: "#dfe6f2" }}>
            Il metodo e il gestionale evoluto che trasformano i dati del tuo salone in decisioni migliori, ogni giorno.
          </p>
          <p style={{ fontFamily: "'Cinzel', serif", fontSize: 19, letterSpacing: ".08em", color: "#9db8e8", margin: "18px 0 26px" }}>
            Guarda. Prevedi. Scegli.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/check" className="s-btn">Fai il Salon Check gratuito →</Link>
            <Link href="/sito/metodo" className="s-btn ghost">Scopri il metodo</Link>
          </div>
        </div>
      </section>

      {/* PROBLEMA */}
      <section className="s-sec">
        <div className="s-wrap">
          <p className="s-eyebrow">Il problema</p>
          <h2 style={{ fontSize: 30, margin: "8px 0 8px" }}>Un salone può essere pieno e non essere profittevole.</h2>
          <p style={{ maxWidth: 760, fontSize: 16.5 }}>
            Molti saloni hanno già agenda, cassa, storico clienti e statistiche. Eppure continuano a prendere decisioni troppo tardi,
            a leggere i numeri senza trasformarli in azioni, a gestire margini, capacità produttiva, team e clienti a sensazione.
            Un titolare non dovrebbe scoprire a fine mese cosa è successo alla propria azienda: dovrebbe poterla guardare mentre accade.
          </p>
          <div className="s-grid g3" style={{ marginTop: 26 }}>
            {DOLORI.map(d => (
              <div key={d} className="s-card" style={{ padding: 18, fontSize: 15, fontWeight: 500, borderLeft: "4px solid " + BLU }}>{d}</div>
            ))}
          </div>
        </div>
      </section>

      {/* METODO + GUARDA PREVEDI SCEGLI */}
      <section className="s-sec alt">
        <div className="s-wrap">
          <p className="s-eyebrow">Il metodo</p>
          <h2 style={{ fontSize: 30, margin: "8px 0" }}>Non più dati. Una direzione.</h2>
          <p style={{ maxWidth: 760, fontSize: 16.5 }}>
            GPS è un metodo proprietario di gestione del salone: mette in relazione controllo economico, capacità produttiva, margini,
            clienti, servizi, team, vendita e marketing — e trasforma i dati in azioni operative. Come un GPS reale: ti dice dove sei,
            ti fa impostare la destinazione e ti aiuta a correggere la rotta durante il percorso.
          </p>
          <div className="s-grid g3" style={{ marginTop: 26 }}>
            {[
              { n: "01", t: "Guarda", d: "Rende leggibile la situazione reale del salone attraverso indicatori economici e operativi. Sai dove sei oggi, in tempo reale." },
              { n: "02", t: "Prevedi", d: "Usa storico, andamento medio, obiettivi e dati correnti per stimare la traiettoria e far emergere gli scostamenti prima che diventino problemi." },
              { n: "03", t: "Scegli", d: "Aiuta te e il tuo team a decidere dove intervenire, con quali priorità e con quali azioni. Con metodo, prima degli altri." },
            ].map(x => (
              <div key={x.n} className="s-card">
                <div style={{ fontFamily: "'Cinzel', serif", color: BLU, fontSize: 15, fontWeight: 700 }}>{x.n}</div>
                <h3 style={{ fontFamily: "'Cinzel', serif", color: NAVY, fontSize: 23, margin: "6px 0 8px" }}>{x.t}</h3>
                <p style={{ fontSize: 15, margin: 0 }}>{x.d}</p>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 22 }}>
            <Link href="/sito/metodo" className="s-kicker">Le 7 aree del metodo →</Link>
          </div>
        </div>
      </section>

      {/* SOFTWARE */}
      <section className="s-sec navy">
        <div className="s-wrap s-grid g2" style={{ alignItems: "center" }}>
          <div>
            <p className="s-eyebrow" style={{ color: "#9db8e8" }}>Il software</p>
            <h2 style={{ fontSize: 30, margin: "8px 0" }}>Il direttore operativo digitale del tuo salone.</h2>
            <p style={{ fontSize: 16 }}>
              I gestionali tradizionali registrano ciò che è successo. Il software GPS è progettato per usare i dati raccolti
              per guidare ciò che deve succedere dopo: collega agenda, clienti, servizi, team, lavorato, incassato e marginalità,
              confronta tutto con gli obiettivi e mette in evidenza cosa richiede attenzione oggi — con l'AI integrata nel flusso operativo,
              non come decorazione.
            </p>
            <p style={{ fontSize: 15.5, color: "#b9c6dd" }}>
              Sostituisce il gestionale che usi oggi, con importazione dei dati esistenti e onboarding rapido.
              Ogni ruolo vede ciò che gli serve: titolare, reception, operatori.
            </p>
            <Link href="/sito/software" className="s-btn ghost" style={{ marginTop: 8 }}>Come funziona →</Link>
          </div>
          <div className="s-card" style={{ padding: 18 }}>
            {/* Whale curve come segno visuale proprietario */}
            <p style={{ fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "#9db8e8", margin: "4px 0 10px" }}>Whale Curve · contributo al margine per cliente</p>
            <svg viewBox="0 0 400 190" style={{ width: "100%" }}>
              <line x1="30" y1="150" x2="385" y2="150" stroke="rgba(255,255,255,.25)" />
              <line x1="30" y1="150" x2="30" y2="15" stroke="rgba(255,255,255,.25)" />
              <path d="M30,150 C90,30 150,25 220,55 C280,80 330,120 385,150" fill="none" stroke="#7fa4e0" strokeWidth="3" />
              <path d="M30,150 C80,120 160,100 240,110 C300,120 350,138 385,150" fill="none" stroke="#e0704f" strokeWidth="2.5" strokeDasharray="6 4" />
              <circle cx="98" cy="52" r="5" fill="#fff" />
              <text x="110" y="48" fill="#dfe6f2" fontSize="11">pochi clienti creano gran parte del margine</text>
              <text x="200" y="178" fill="#93a3bd" fontSize="10.5" textAnchor="middle">clienti ordinati per margine · linea tratteggiata = costo assorbito</text>
            </svg>
          </div>
        </div>
      </section>

      {/* METRICHE PROPRIETARIE */}
      <section className="s-sec">
        <div className="s-wrap">
          <p className="s-eyebrow">Metriche proprietarie</p>
          <h2 style={{ fontSize: 28, margin: "8px 0" }}>Il dato da solo non basta: deve produrre una decisione.</h2>
          <p style={{ maxWidth: 740, fontSize: 16 }}>
            Dietro GPS c'è una logica completa, con metriche pensate per il salone. Ogni minuto di capacità produttiva ha un valore
            economico — e il titolare deve conoscere il proprio obiettivo prima di iniziare il mese, non scoprirlo a fine mese.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
            {METRICHE.map(m => (
              <span key={m} style={{ border: "1.5px solid " + BLU, color: NAVY, fontWeight: 600, fontSize: 14, padding: "9px 16px", borderRadius: 24 }}>{m}</span>
            ))}
          </div>
          <p style={{ fontSize: 13.5, color: "#68727f", marginTop: 14 }}>Il calcolo e l'applicazione completa vengono approfonditi nei libri, nei corsi e dentro il software.</p>
        </div>
      </section>

      {/* FONDATORE + TGI */}
      <section className="s-sec alt">
        <div className="s-wrap s-grid g2" style={{ alignItems: "center" }}>
          <img src="/site/dimitar-1.jpg" alt="Dimitar A. Hristov" style={{ width: "100%", borderRadius: 16, boxShadow: "0 10px 30px rgba(10,29,61,.18)" }} />
          <div>
            <p className="s-eyebrow">La storia</p>
            <h2 style={{ fontSize: 28, margin: "8px 0" }}>Nato in un salone vero, non a tavolino.</h2>
            <p style={{ fontSize: 16 }}>
              Dimitar A. Hristov apre The Gentlemen Inn nel 2018. L'attività cresce: team, più aree di servizio, agenda piena, incassi.
              Ma proprio lì emergono i limiti della gestione a sensazione — e la scoperta che accorgersi di un problema a fine mese
              significa quasi sempre accorgersene troppo tardi.
            </p>
            <p style={{ fontSize: 16 }}>
              Dalla lettura sistematica di costi, capacità produttiva, marginalità, clienti e performance nasce prima il metodo — applicato
              sul campo con carta, penna e fogli di calcolo — poi i libri, la formazione e il software. The Gentlemen Inn resta il
              laboratorio operativo dove tutto viene provato con dati reali.
            </p>
            <Link href="/sito/storia" className="s-kicker">Leggi la storia completa →</Link>
          </div>
        </div>
      </section>

      {/* ECOSISTEMA */}
      <section className="s-sec">
        <div className="s-wrap">
          <p className="s-eyebrow">L'ecosistema</p>
          <h2 style={{ fontSize: 28, margin: "8px 0 20px" }}>Un sistema, quattro strumenti.</h2>
          <div className="s-grid g2">
            {[
              { t: "📖 I libri", d: "\"L'azienda chiamata salone\" introduce il metodo. La collana \"Le illusioni del salone\" smonta, una per una, le convinzioni che costano margine.", href: "/sito/libri", cta: "Scopri i libri" },
              { t: "🎓 GPS Academy", d: "Formazione collegata a problemi reali, indicatori misurabili e azioni applicabili: dal corso introduttivo all'installazione del metodo in salone.", href: "/sito/academy", cta: "Vedi i corsi" },
              { t: "🧭 Salon Check", d: "Il test gratuito che fotografa le 6 aree del tuo salone e ti dice dove stai navigando a vista. È il primo passo del percorso.", href: "/check", cta: "Fallo ora — 3 minuti" },
              { t: "💻 Il software", d: "Il gestionale evoluto costruito attorno al metodo: KPI automatici, forecast, alert e AI che suggerisce le priorità.", href: "/sito/software", cta: "Scopri il software" },
            ].map(x => (
              <div key={x.t} className="s-card">
                <h3 style={{ fontFamily: "'Cinzel', serif", color: NAVY, fontSize: 20, margin: "0 0 8px" }}>{x.t}</h3>
                <p style={{ fontSize: 15, margin: "0 0 12px" }}>{x.d}</p>
                <Link href={x.href} className="s-kicker">{x.cta} →</Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA FINALE */}
      <section className="s-sec navy" style={{ textAlign: "center" }}>
        <div className="s-wrap">
          <h2 style={{ fontSize: 30, margin: "0 0 10px" }}>Quanto conosci davvero la salute del tuo salone?</h2>
          <p style={{ maxWidth: 620, margin: "0 auto 24px", fontSize: 16.5 }}>
            Rispondi a 18 domande e scopri in quali aree hai il controllo, dove stai navigando a vista e quali indicatori dovresti iniziare a osservare.
          </p>
          <Link href="/check" className="s-btn" style={{ fontSize: 17 }}>Inizia il Salon Check gratuito →</Link>
        </div>
      </section>
    </SiteShell>
  );
}
