"use client";
import Link from "next/link";
import SiteShell, { BLU, NAVY } from "@/components/SiteShell";

const AREE = [
  { t: "Controllo economico", d: "Obiettivi, costi, break-even, capacità produttiva e marginalità. Il titolare conosce il proprio obiettivo prima di iniziare il mese, non lo scopre a fine mese." },
  { t: "Performance", d: "KPI del salone e dei singoli operatori, letti rispetto a obiettivi chiari: risultato contro obiettivo, mai numeri isolati." },
  { t: "Cliente", d: "Valore, frequenza, comportamento, marginalità, rischio e potenziale. Non tutti i clienti producono lo stesso valore." },
  { t: "Offerta e vendita", d: "La vendita come consulenza: scelta guidata, up-sell e cross-sell coerenti con il bisogno reale del cliente." },
  { t: "Team", d: "Ruoli, standard, responsabilità, performance e sistemi premianti. L'obiettivo non è controllare le persone, ma controllare il sistema." },
  { t: "Marketing", d: "Azioni costruite sui segmenti e sui dati, non promozioni improvvisate quando serve riempire." },
  { t: "Previsione", d: "Forecast e lettura della traiettoria futura sulla base di storico, andamento medio, obiettivi e dati correnti." },
];

const METRICHE = [
  { t: "Costo al minuto", d: "Collega obiettivo economico, capacità produttiva, tempo e sostenibilità dei servizi. Ogni minuto ha un valore." },
  { t: "Lavorato vs incassato", d: "Denaro ricevuto e valore erogato non coincidono sempre — prepagate, card e abbonamenti li separano. GPS li distingue sempre." },
  { t: "Whale Curve", d: "Visualizza il rapporto tra contributo al margine e costo dei clienti: chi crea valore e chi assorbe capacità produttiva." },
  { t: "Break-even e obiettivo", d: "Dalla struttura dei costi all'obiettivo economico mensile, fino al requisito giornaliero." },
  { t: "Occupazione reale vs target", d: "Quanta capacità produttiva viene davvero usata, operatore per operatore, rispetto al target." },
  { t: "Debito operativo", d: "Il valore già incassato ma ancora da erogare: credito, card e abbonamenti sotto controllo." },
];

export default function Metodo() {
  return (
    <SiteShell active="/sito/metodo">
      <section className="s-hero"><div className="s-wrap" style={{ padding: "60px 22px 50px" }}>
        <p className="s-eyebrow">Il metodo</p>
        <h1 style={{ fontSize: "clamp(28px,4.5vw,42px)", margin: "10px 0" }}>Un metodo proprietario, non un'altra dashboard.</h1>
        <p style={{ maxWidth: 720, fontSize: 17, color: "#dfe6f2" }}>
          Il metodo nasce da un principio semplice: un titolare non dovrebbe scoprire a fine mese cosa è successo alla propria attività.
          Dovrebbe capire, mentre il mese è in corso, dove si trova, che direzione sta prendendo e quali scelte possono correggere la rotta.
        </p>
      </div></section>

      <section className="s-sec"><div className="s-wrap">
        <h2 style={{ fontSize: 26, marginBottom: 18 }}>Le 7 aree del metodo</h2>
        <div className="s-grid g2">
          {AREE.map(a => (
            <div key={a.t} className="s-card" style={{ borderLeft: "4px solid " + BLU }}>
              <h3 style={{ fontFamily: "'Cinzel', serif", color: NAVY, fontSize: 19, margin: "0 0 6px" }}>{a.t}</h3>
              <p style={{ fontSize: 15, margin: 0 }}>{a.d}</p>
            </div>
          ))}
        </div>
      </div></section>

      <section className="s-sec alt"><div className="s-wrap">
        <h2 style={{ fontSize: 26, marginBottom: 6 }}>Le metriche proprietarie</h2>
        <p style={{ maxWidth: 720, fontSize: 16 }}>Citarle è facile; il metodo insegna a usarle. Il calcolo completo appartiene ai libri, ai corsi e al software.</p>
        <div className="s-grid g3" style={{ marginTop: 18 }}>
          {METRICHE.map(m => (
            <div key={m.t} className="s-card">
              <h3 style={{ fontFamily: "'Cinzel', serif", color: BLU, fontSize: 17, margin: "0 0 6px" }}>{m.t}</h3>
              <p style={{ fontSize: 14.5, margin: 0 }}>{m.d}</p>
            </div>
          ))}
        </div>
      </div></section>

      <section className="s-sec"><div className="s-wrap s-grid g2" style={{ alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: 26 }}>Metodo prima, tecnologia dopo.</h2>
          <p style={{ fontSize: 16 }}>
            GPS può essere applicato dal primo giorno anche con carta, penna e fogli di calcolo. Il software non crea il metodo:
            lo automatizza, lo rende continuo, riduce il lavoro manuale e permette di applicarlo con maggiore semplicità e precisione.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
            <Link href="/check" className="s-btn">Scopri le tue aree critiche →</Link>
            <Link href="/sito/software" className="s-btn ghost">Il software GPS</Link>
          </div>
        </div>
        <img src="/site/tgi-1.jpg" alt="The Gentlemen Inn" style={{ width: "100%", borderRadius: 16 }} />
      </div></section>
    </SiteShell>
  );
}
