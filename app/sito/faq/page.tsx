"use client";
import Link from "next/link";
import SiteShell, { NAVY } from "@/components/SiteShell";

const FAQ: { q: string; a: string }[] = [
  { q: "GPS è un gestionale o un metodo?", a: "GPS è prima di tutto un metodo proprietario di gestione del salone. Il software è il gestionale evoluto costruito per automatizzare quel metodo e renderlo quotidiano, misurabile e semplice da applicare." },
  { q: "Devo avere il software per applicare GPS?", a: "No. Le logiche del metodo possono essere applicate anche manualmente. Il software elimina gran parte del lavoro di raccolta, calcolo e controllo e permette di applicare GPS in modo continuo." },
  { q: "GPS sostituisce il mio gestionale attuale?", a: "Sì. Il software GPS è progettato per diventare il gestionale operativo del salone, con importazione dei dati esistenti e onboarding rapido." },
  { q: "In cosa è diverso dagli altri gestionali?", a: "GPS nasce intorno a un metodo proprietario. La raccolta dei dati, i KPI, l'AI, le dashboard e i workflow sono progettati per trasformare le informazioni in decisioni e azioni, non soltanto per registrare appuntamenti e incassi." },
  { q: "GPS usa l'intelligenza artificiale?", a: "Sì. L'AI interpreta i dati, individua anomalie e opportunità, supporta i forecast e suggerisce priorità operative. Non sostituisce il titolare: gli fornisce una lettura più rapida e strutturata." },
  { q: "GPS può prevedere il futuro del salone?", a: "GPS non promette previsioni certe. Usa storico, medie, obiettivi e andamento corrente per stimare la traiettoria dell'attività e aiutare a intervenire prima che uno scostamento diventi un problema." },
  { q: "È adatto solo ai grandi saloni?", a: "No. GPS è pensato per saloni che vogliono essere gestiti come aziende. Diventa particolarmente utile quando ci sono più operatori, ruoli, clienti, servizi e decisioni da coordinare." },
  { q: "Serve essere esperti di numeri?", a: "No. Uno degli obiettivi di GPS è rendere leggibili indicatori spesso ignorati o considerati troppo complessi. I corsi e i libri insegnano il metodo; il software automatizza la parte più tecnica." },
  { q: "Che cos'è il costo al minuto?", a: "È una delle metriche centrali del metodo: collega obiettivo economico, capacità produttiva, tempo e sostenibilità dei servizi. Il calcolo viene approfondito nei materiali e nella formazione." },
  { q: "Perché GPS distingue lavorato e incassato?", a: "Perché denaro ricevuto e valore effettivamente erogato non coincidono sempre, soprattutto con prepagate, card e abbonamenti. Separare le due grandezze permette una lettura economica corretta." },
  { q: "Che cos'è la Whale Curve?", a: "Uno strumento di analisi che visualizza il rapporto tra contributo al margine e costo dei clienti. Sul sito è presentata in modo illustrativo; la logica completa è nei libri e nei corsi." },
  { q: "GPS serve a vendere di più?", a: "Può migliorare la performance commerciale, ma non nasce per spingere vendite aggressive. La vendita è parte della consulenza: proporre ciò che è realmente utile al cliente e sostenibile per l'azienda." },
  { q: "GPS controlla i collaboratori?", a: "GPS controlla il sistema e rende visibili obiettivi, risultati e comportamenti misurabili. L'obiettivo non è sorvegliare le persone, ma creare chiarezza, responsabilità e criteri comuni di lavoro." },
  { q: "Cosa comprende GPS oltre al software?", a: "Metodo, libri, Academy, corsi, strumenti operativi, Salon Check, installazione del metodo e software: livelli diversi dello stesso sistema." },
  { q: "Da dove si comincia?", a: "Dalla consapevolezza. Il Salon Check individua le aree critiche; \"L'azienda chiamata salone\" introduce il metodo; poi il percorso può proseguire con i libri verticali, il corso, la demo e l'installazione del software." },
];

export default function Faq() {
  return (
    <SiteShell active="/sito/faq">
      <section className="s-hero"><div className="s-wrap" style={{ padding: "60px 22px 50px" }}>
        <p className="s-eyebrow">FAQ</p>
        <h1 style={{ fontSize: "clamp(28px,4.5vw,42px)", margin: "10px 0" }}>Le domande che ci fanno più spesso.</h1>
      </div></section>
      <section className="s-sec"><div className="s-wrap" style={{ maxWidth: 820 }}>
        {FAQ.map(f => (
          <details key={f.q} className="s-card" style={{ marginBottom: 10, padding: "16px 20px" }}>
            <summary style={{ cursor: "pointer", fontFamily: "'Cinzel', serif", color: NAVY, fontSize: 17, fontWeight: 600 }}>{f.q}</summary>
            <p style={{ fontSize: 15.5, margin: "10px 0 0" }}>{f.a}</p>
          </details>
        ))}
        <div style={{ textAlign: "center", marginTop: 26 }}>
          <Link href="/check" className="s-btn">Fai il Salon Check gratuito →</Link>
        </div>
      </div></section>
    </SiteShell>
  );
}
