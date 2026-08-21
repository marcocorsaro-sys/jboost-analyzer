"use client";
import Link from "next/link";
import SiteShell, { BLU, NAVY } from "@/components/SiteShell";

const DIFF = [
  "Non registra soltanto ciò che è successo: collega i dati a obiettivi, scostamenti e prossime azioni.",
  "Raccoglie i dati con una struttura pensata fin dall'origine per il metodo GPS.",
  "Integra l'intelligenza artificiale nel flusso operativo, non come funzione decorativa.",
  "Collega agenda, cliente, servizi, team, incassato, lavorato, marginalità e controllo economico.",
  "Adatta le informazioni al ruolo: titolare, reception e operatore vedono ciò che serve per decidere e agire.",
  "Automatizza KPI, forecast, alert, report e monitoraggio delle performance.",
];

const AREE = [
  "Agenda e gestione operativa della giornata",
  "Dashboard titolare e controllo economico",
  "Scheda cliente evoluta e storico",
  "Performance operatori e obiettivi individuali",
  "Lavorato, incassato, credito e debito operativo",
  "Marginalità, costo al minuto e capacità produttiva",
  "Whale Curve e analisi del valore cliente",
  "Forecast, alert e suggerimenti AI",
  "Comunicazioni interne e procedure",
  "Report e analisi periodiche",
];

export default function Software() {
  return (
    <SiteShell active="/sito/software">
      <section className="s-hero"><div className="s-wrap" style={{ padding: "60px 22px 50px" }}>
        <p className="s-eyebrow">Il software</p>
        <h1 style={{ fontSize: "clamp(28px,4.5vw,42px)", margin: "10px 0" }}>Vedere prima. Capire prima. Decidere prima.</h1>
        <p style={{ maxWidth: 720, fontSize: 17, color: "#dfe6f2" }}>
          Il tuo gestionale di oggi ti racconta ieri. Il software GPS è costruito per farti vedere la giornata mentre accade,
          la traiettoria del mese mentre puoi ancora cambiarla, e il punto esatto in cui conviene intervenire.
        </p>
      </div></section>

      <section className="s-sec"><div className="s-wrap">
        <h2 style={{ fontSize: 26, marginBottom: 6 }}>Cosa cambia, in concreto</h2>
        <div className="s-grid g3" style={{ marginBottom: 26 }}>
          {[
            { t: "Alle 11 del mattino", d: "Sai quanto è costato finora il tempo aperto e quanto valore hai prodotto: il margine della giornata è un numero, non una sensazione." },
            { t: "Il 12 del mese", d: "Vedi la traiettoria verso l'obiettivo e quanto manca al giorno — in tempo per fare qualcosa." },
            { t: "Quando un cliente esce", d: "Sai se tornerà, quanto vale davvero e se il riappuntamento è stato chiesto: non lo scopri tre mesi dopo." },
          ].map(x => (
            <div key={x.t} className="s-card" style={{ borderTop: "4px solid " + BLU }}>
              <h3 style={{ fontFamily: "'Cinzel', serif", color: NAVY, fontSize: 17, margin: "0 0 6px" }}>{x.t}</h3>
              <p style={{ fontSize: 14.5, margin: 0 }}>{x.d}</p>
            </div>
          ))}
        </div>
        <h2 style={{ fontSize: 24, marginBottom: 6 }}>Perché ci riesce</h2>
        <p style={{ maxWidth: 740, fontSize: 16 }}>
          Il confronto è semplice: i gestionali tradizionali registrano ciò che è successo; GPS usa i dati raccolti per guidare
          <b> ciò che deve succedere dopo</b>.
        </p>
        <div className="s-grid g2" style={{ marginTop: 18 }}>
          {DIFF.map(d => <div key={d} className="s-card" style={{ padding: 18, fontSize: 15, borderLeft: "4px solid " + BLU }}>{d}</div>)}
        </div>
      </div></section>

      <section className="s-sec navy"><div className="s-wrap s-grid g2" style={{ alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: 26 }}>Un direttore operativo digitale.</h2>
          <p style={{ fontSize: 16 }}>
            L'ambizione del software GPS è andare oltre la funzione di agenda o archivio: osservare ciò che accade nel salone,
            confrontarlo con gli obiettivi, segnalare le deviazioni, mettere in evidenza le opportunità e aiutare le persone
            a capire cosa richiede attenzione oggi.
          </p>
          <p style={{ fontSize: 15, color: "#b9c6dd" }}>
            L'AI non è un accessorio: legge i dati raccolti, trova pattern, anticipa criticità e propone azioni coerenti con il metodo.
            Le previsioni sono strumenti di supporto decisionale basati sui dati disponibili, non promesse di risultato.
          </p>
        </div>
        <div className="s-card">
          <p style={{ fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "#9db8e8", margin: "0 0 10px" }}>Aree principali</p>
          {AREE.map(a => (
            <div key={a} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,.08)", fontSize: 14.5 }}>· {a}</div>
          ))}
        </div>
      </div></section>

      <section className="s-sec" style={{ textAlign: "center" }}><div className="s-wrap">
        <h2 style={{ fontSize: 26 }}>Il software è in fase pilota con saloni selezionati.</h2>
        <p style={{ maxWidth: 640, margin: "0 auto 20px", fontSize: 16 }}>
          Il percorso parte dalla consapevolezza: fai il Salon Check, leggi il libro, e quando è il momento giusto ti accompagniamo
          nella demo e nell'installazione del metodo con il software.
        </p>
        <Link href="/check" className="s-btn">Parti dal Salon Check →</Link>
      </div></section>
    </SiteShell>
  );
}
