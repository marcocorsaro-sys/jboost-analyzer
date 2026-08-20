"use client";
import Link from "next/link";
import SiteShell, { BLU, NAVY } from "@/components/SiteShell";

export default function Storia() {
  return (
    <SiteShell active="/sito/storia">
      <section className="s-hero"><div className="s-wrap" style={{ padding: "60px 22px 50px" }}>
        <p className="s-eyebrow">La storia</p>
        <h1 style={{ fontSize: "clamp(28px,4.5vw,42px)", margin: "10px 0" }}>GPS nasce da un problema reale, non da un'idea a tavolino.</h1>
      </div></section>

      <section className="s-sec"><div className="s-wrap s-grid g2" style={{ alignItems: "start" }}>
        <div>
          <p style={{ fontSize: 16.5 }}>
            Per anni Dimitar A. Hristov ha gestito il suo salone facendo quello che fanno tanti titolari: lavorare tanto, riempire
            l'agenda, seguire il team, servire i clienti, controllare gli incassi — e intervenire sui numeri soprattutto quando
            qualcosa non tornava.
          </p>
          <p style={{ fontSize: 16.5 }}>
            Da fuori sembrava tutto sotto controllo. Il salone lavorava, i clienti c'erano, il team era impegnato, gli incassi entravano.
            Ma questo non significava che l'azienda stesse andando nella direzione giusta.
          </p>
          <div className="s-card" style={{ borderLeft: "4px solid " + BLU, margin: "18px 0" }}>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: NAVY }}>
              «Accorgermi di un problema a fine mese significava quasi sempre accorgermene troppo tardi.»
            </p>
          </div>
          <p style={{ fontSize: 16.5 }}>
            Il punto di svolta arriva quando inizia a leggere il salone in modo diverso: mettere in relazione costi, tempo, capacità
            produttiva, marginalità, performance, clienti, servizi, ri-prenotazioni, vendite e obiettivi. All'inizio non serviva un
            software sofisticato: servivano le domande giuste, i numeri giusti e un metodo per interpretarli. Carta, fogli di calcolo,
            procedure, controlli quotidiani.
          </p>
        </div>
        <div>
          <img src="/site/dimitar-1.jpg" alt="Dimitar A. Hristov" style={{ width: "100%", borderRadius: 16, marginBottom: 14 }} />
          <img src="/site/tgi-2.jpg" alt="The Gentlemen Inn" style={{ width: "100%", borderRadius: 16, maxHeight: 380, objectFit: "cover" }} />
        </div>
      </div></section>

      <section className="s-sec alt"><div className="s-wrap">
        <h2 style={{ fontSize: 26 }}>Perché si chiama GPS</h2>
        <p style={{ maxWidth: 780, fontSize: 16.5 }}>
          Come un GPS reale, il sistema deve dirti dove sei, permetterti di impostare una destinazione e aiutarti a correggere la rotta
          durante il percorso. Il primo GPS non è stato un software: è stato un metodo — un modo diverso di leggere il salone e prendere
          decisioni, applicabile dal primo giorno anche con carta e penna. Il software è arrivato dopo, come conseguenza naturale: se un
          metodo richiede di raccogliere dati, confrontare obiettivi, individuare anomalie e decidere continuamente, la tecnologia può
          eliminare gran parte del lavoro manuale.
        </p>
        <div className="s-grid g3" style={{ marginTop: 20 }}>
          {[
            { t: "2018", d: "Apre The Gentlemen Inn, progetto dedicato alla cura maschile che cresce fino a diventare un'attività strutturata, con team e più aree di servizio." },
            { t: "Il metodo", d: "Dalla gestione a sensazione alla lettura sistematica dei numeri: nasce GPS, applicato e validato ogni giorno sul campo." },
            { t: "Il sistema", d: "Metodo, libri, formazione, strumenti operativi e software: livelli diversi dello stesso progetto, con The Gentlemen Inn come laboratorio." },
          ].map(x => (
            <div key={x.t} className="s-card">
              <h3 style={{ fontFamily: "'Cinzel', serif", color: BLU, fontSize: 20, margin: "0 0 6px" }}>{x.t}</h3>
              <p style={{ fontSize: 14.5, margin: 0 }}>{x.d}</p>
            </div>
          ))}
        </div>
      </div></section>

      <section className="s-sec" style={{ textAlign: "center" }}><div className="s-wrap">
        <h2 style={{ fontSize: 25 }}>Oggi l'obiettivo è uno solo</h2>
        <p style={{ maxWidth: 660, margin: "0 auto 20px", fontSize: 16.5 }}>
          Aiutare i titolari di salone a smettere di gestire a sensazione e iniziare a leggere la propria attività come un'azienda.
          Non partendo dalla teoria, ma dagli stessi errori, problemi e domande affrontati in prima persona.
        </p>
        <Link href="/check" className="s-btn">Inizia dal Salon Check →</Link>
      </div></section>
    </SiteShell>
  );
}
