"use client";
import Link from "next/link";
import SiteShell, { BLU, NAVY } from "@/components/SiteShell";

const AREE = [
  "Mentalità imprenditoriale e controllo economico",
  "KPI, margini, capacità produttiva e costo al minuto",
  "Cliente, frequenza, valore e marginalità",
  "Vendita come consulenza e scelta guidata",
  "Up-sell, cross-sell, prodotti e ri-prenotazione",
  "Team, ruoli, obiettivi, responsabilità e bonus",
  "Marketing guidato dai dati e dai segmenti",
  "Applicazione pratica del metodo GPS nel salone",
];

export default function Academy() {
  return (
    <SiteShell active="/sito/academy">
      <section className="s-hero"><div className="s-wrap" style={{ padding: "60px 22px 50px" }}>
        <p className="s-eyebrow">GPS Academy</p>
        <h1 style={{ fontSize: "clamp(28px,4.5vw,42px)", margin: "10px 0" }}>Formazione che si misura sul campo.</h1>
        <p style={{ maxWidth: 720, fontSize: 17, color: "#dfe6f2" }}>
          Niente teoria manageriale generica, niente sola motivazione: ogni contenuto è collegato a problemi reali del salone,
          indicatori misurabili e azioni applicabili da subito.
        </p>
      </div></section>

      <section className="s-sec"><div className="s-wrap s-grid g2">
        <div>
          <h2 style={{ fontSize: 26 }}>A chi si rivolge</h2>
          <div className="s-card" style={{ marginBottom: 12, borderLeft: "4px solid " + BLU }}>
            <b>Titolari</b> che vogliono passare dalla gestione a sensazione alla gestione per obiettivi.
          </div>
          <div className="s-card" style={{ marginBottom: 12, borderLeft: "4px solid " + BLU }}>
            <b>Manager e reception</b> che coordinano giornata, clienti, priorità e team.
          </div>
          <div className="s-card" style={{ borderLeft: "4px solid " + BLU }}>
            <b>Operatori</b> che vogliono migliorare consulenza, performance, proposta e responsabilità sul risultato.
          </div>
        </div>
        <div>
          <h2 style={{ fontSize: 26 }}>Le aree formative</h2>
          <div className="s-card">
            {AREE.map(a => <div key={a} style={{ padding: "8px 0", borderBottom: "1px solid #edf0f5", fontSize: 15 }}>· {a}</div>)}
          </div>
        </div>
      </div></section>

      <section className="s-sec navy"><div className="s-wrap s-grid g2" style={{ alignItems: "center" }}>
        <div>
          <p className="s-eyebrow" style={{ color: "#9db8e8" }}>Il primo passo</p>
          <h2 style={{ fontSize: 27 }}>Il corso introduttivo</h2>
          <p style={{ fontSize: 16 }}>
            Una giornata in presenza ad alto impatto, costruita per far emergere il problema centrale: lavorare molto, avere clienti
            e incassare non significa necessariamente sapere dove sta andando l'azienda. Il corso introduce il metodo e crea la
            consapevolezza necessaria per applicarlo.
          </p>
          <p style={{ fontSize: 22, fontFamily: "'Cinzel', serif", color: "#fff" }}>199 € · giornata introduttiva</p>
          <p style={{ fontSize: 13.5, color: "#93a3bd" }}>Date e location vengono comunicate a ridosso di ogni evento.</p>
        </div>
        <img src="/site/dimitar-2.jpg" alt="Dimitar Hristov" style={{ width: "100%", borderRadius: 16, maxHeight: 460, objectFit: "cover" }} />
      </div></section>

      <section className="s-sec" style={{ textAlign: "center" }}><div className="s-wrap">
        <h2 style={{ fontSize: 25 }}>Dalla formazione all'implementazione</h2>
        <p style={{ maxWidth: 700, margin: "0 auto 20px", fontSize: 16 }}>
          La formazione non termina con il corso: GPS può accompagnare il salone nell'installazione concreta del metodo — lettura iniziale,
          obiettivi, KPI, procedure, formazione del team e software. Academy e software sono due strumenti dello stesso sistema.
        </p>
        <Link href="/check" className="s-btn">Scopri da dove partire →</Link>
      </div></section>
    </SiteShell>
  );
}
