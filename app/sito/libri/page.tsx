"use client";
import Link from "next/link";
import SiteShell, { BLU, NAVY } from "@/components/SiteShell";

const ILLUSIONI = [
  { img: "/site/ill-agenda.jpg", t: "L'illusione dell'agenda piena", d: "Perché essere pieni non significa necessariamente usare bene la capacità produttiva o creare margine." },
  { img: "/site/ill-cassetto.jpg", t: "L'illusione del cassetto pieno", d: "Perché incassare tanto può convivere con una redditività insufficiente." },
  { img: "/site/ill-marketing.jpg", t: "L'illusione del marketing gentile", d: "Perché cercare di piacere a tutti può rendere il salone poco riconoscibile e poco scelto." },
  { img: "/site/ill-vendita.jpg", t: "L'illusione della vendita spontanea", d: "Perché ciò che non proponi non resta neutro: diventa spesso un vantaggio per il competitor." },
  { img: "/site/ill-team.jpg", t: "L'illusione del team autonomo", d: "Perché l'autonomia reale nasce da ruoli, standard, obiettivi e misurazione, non dall'assenza del titolare." },
  { img: "/site/ill-cliente.jpg", t: "L'illusione del cliente fedele", d: "Perché non tutti i clienti producono lo stesso valore, e alcuni possono arrivare a consumare il margine del salone." },
];

export default function Libri() {
  return (
    <SiteShell active="/sito/libri">
      <section className="s-hero"><div className="s-wrap" style={{ padding: "60px 22px 50px" }}>
        <p className="s-eyebrow">I libri</p>
        <h1 style={{ fontSize: "clamp(28px,4.5vw,42px)", margin: "10px 0" }}>Strumenti di formazione, non solo pagine.</h1>
        <p style={{ maxWidth: 700, fontSize: 17, color: "#dfe6f2" }}>
          I libri GPS approfondiscono le logiche del metodo. Si parte dal libro madre e si prosegue, quando il problema specifico lo richiede,
          con la collana verticale.
        </p>
      </div></section>

      <section className="s-sec"><div className="s-wrap s-grid g2" style={{ alignItems: "center" }}>
        <img src="/site/libro-madre.jpg" alt="L'azienda chiamata salone — copertina" style={{ width: "100%", maxWidth: 380, borderRadius: 12, boxShadow: "0 14px 40px rgba(10,29,61,.25)", justifySelf: "center" }} />
        <div>
          <p className="s-eyebrow">Il libro madre</p>
          <h2 style={{ fontSize: 28, margin: "8px 0" }}>L'azienda chiamata salone</h2>
          <p style={{ fontSize: 15.5, fontStyle: "italic", color: "#5a6572" }}>
            GPS, il metodo per trasformare il salone in azienda, il titolare in imprenditore e i collaboratori in un vero team.
          </p>
          <p style={{ fontSize: 16 }}>
            È il libro fondativo del progetto. Introduce il lettore alla logica completa di GPS: marginalità, obiettivi, cliente,
            vendita, marketing, team, numeri e metodo. È il passaggio naturale tra il riconoscimento del problema e la scoperta
            strutturata del sistema GPS.
          </p>
          <a href="https://amzn.eu/d/031LSxMT" target="_blank" rel="noreferrer" className="s-btn">Acquistalo su Amazon →</a>
        </div>
      </div></section>

      <section className="s-sec alt"><div className="s-wrap">
        <p className="s-eyebrow">La collana</p>
        <h2 style={{ fontSize: 26, margin: "8px 0 6px" }}>Le illusioni del salone</h2>
        <p style={{ maxWidth: 760, fontSize: 16 }}>
          Sei volumi verticali che smontano, una per una, le convinzioni diffuse nel settore — e mostrano perché portano a decisioni
          sbagliate quando non vengono lette attraverso dati, margini e metodo.
        </p>
        <div className="s-grid g3" style={{ marginTop: 20 }}>
          {ILLUSIONI.map(l => (
            <div key={l.t} className="s-card" style={{ padding: 16, textAlign: "center" }}>
              <img src={l.img} alt={l.t} style={{ width: "100%", maxWidth: 220, borderRadius: 8, boxShadow: "0 8px 22px rgba(10,29,61,.18)" }} />
              <h3 style={{ fontFamily: "'Cinzel', serif", color: NAVY, fontSize: 16.5, margin: "12px 0 6px" }}>{l.t}</h3>
              <p style={{ fontSize: 13.5, margin: 0, color: "#5a6572" }}>{l.d}</p>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 14, color: "#68727f", marginTop: 16 }}>
          I volumi verticali entrano nel percorso quando il problema specifico del titolare richiede un approfondimento mirato — in uscita progressiva.
        </p>
      </div></section>

      <section className="s-sec" style={{ textAlign: "center" }}><div className="s-wrap">
        <h2 style={{ fontSize: 25 }}>Da dove partire? Dal problema più tuo.</h2>
        <p style={{ maxWidth: 620, margin: "0 auto 20px", fontSize: 16 }}>Il Salon Check individua l'area più critica del tuo salone e ti indica il percorso di lettura più utile.</p>
        <Link href="/check" className="s-btn">Fai il Salon Check →</Link>
      </div></section>
    </SiteShell>
  );
}
