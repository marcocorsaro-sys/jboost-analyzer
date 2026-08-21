"use client";
// HOME SITO GPS — journey emotivo (brief "Journey Emozionale", Dimitar):
// 01 hero riconoscimento · 02 specchio · 03 frattura · 04 costo nascosto · 05 spiegazione
// 06 storia/affinità · 07 possibilità · 08 GPS · 09 Guarda/Prevedi/Scegli · 10 prova · 11 Salon Check
// Regola madre: prima "cosa deve provare il visitatore", poi "cosa gli spieghiamo".
// Vincolo: nessuna prova inventata — schemi dichiaratamente illustrativi, materiali e foto reali.
import Link from "next/link";
import SiteShell, { BLU, NAVY } from "@/components/SiteShell";

const FRATTURE = [
  { c: "Un'agenda piena non è una prova di salute.", d: "Può essere soltanto molto movimento." },
  { c: "Incassare tanto e guadagnare sono due cose diverse.", d: "Il cassetto pieno convive spesso con un margine insufficiente." },
  { c: "Il cliente che viene da dieci anni non è automaticamente quello che ti lascia più margine.", d: "Alcuni clienti assorbono più capacità produttiva di quanta ne restituiscano." },
  { c: "Un team occupato non è necessariamente un team produttivo.", d: "Occupato e performante sono due misure diverse — e quasi nessuno misura la seconda." },
];

export default function SitoHome() {
  return (
    <SiteShell>
      {/* 01 — HERO · riconoscimento + dubbio (intensità 4) */}
      <section className="s-hero">
        <div className="s-wrap" style={{ padding: "92px 22px 78px", textAlign: "center" }}>
          <p className="s-eyebrow">GPS · Growth Performance System</p>
          <h1 style={{ fontSize: "clamp(29px, 5vw, 50px)", margin: "16px auto 20px", maxWidth: 860, lineHeight: 1.2 }}>
            Il tuo salone può essere pieno<br />e tu non sapere se sta davvero andando bene.
          </h1>
          <p style={{ fontSize: 18.5, maxWidth: 620, margin: "0 auto 30px", color: "#dfe6f2" }}>
            Lavori tanto. I clienti ci sono. Gli incassi entrano. Ma questo, da solo, non ti dice dove sta andando la tua azienda.
          </p>
          <Link href="/check" className="s-btn">Scopri cosa sta succedendo nel tuo salone →</Link>
        </div>
      </section>

      {/* 02 — SPECCHIO · identificazione (5) */}
      <section className="s-sec" style={{ padding: "70px 0" }}>
        <div className="s-wrap s-grid g2" style={{ alignItems: "center", gap: 40 }}>
          <img src="/site/tgi-1.jpg" alt="Un salone a fine giornata" style={{ width: "100%", borderRadius: 16, maxHeight: 480, objectFit: "cover" }} />
          <div>
            <p className="s-eyebrow">Le 19:00</p>
            <h2 style={{ fontSize: "clamp(24px,3.4vw,32px)", margin: "10px 0 16px", lineHeight: 1.3 }}>
              Hai lavorato tutto il giorno. Hai incassato.<br />Ma sai quanto hai guadagnato davvero oggi?
            </h2>
            <p style={{ fontSize: 16.5 }}>
              Hai gestito le poltrone, i ritardi, i buchi in agenda, un collaboratore da seguire, un cliente da recuperare.
              Hai chiuso la cassa. E come ogni sera hai una sensazione — buona o meno buona — ma non un numero.
            </p>
            <p style={{ fontSize: 16.5 }}>
              Hai aperto un salone per costruire qualcosa di tuo. Non per diventare il dipendente più stressato della tua stessa azienda.
            </p>
          </div>
        </div>
      </section>

      {/* 03 — FRATTURA · sorpresa (7) · visual per sottrazione */}
      <section className="s-sec navy" style={{ padding: "78px 0" }}>
        <div className="s-wrap" style={{ maxWidth: 820 }}>
          <p className="s-eyebrow" style={{ color: "#9db8e8", textAlign: "center" }}>Quello che sembra un buon segnale</p>
          {FRATTURE.map((f, i) => (
            <div key={i} style={{ padding: "34px 0", borderBottom: i < FRATTURE.length - 1 ? "1px solid rgba(255,255,255,.12)" : "none", textAlign: "center" }}>
              <p style={{ fontFamily: "'Cinzel', serif", fontSize: "clamp(21px,2.9vw,27px)", color: "#fff", margin: "0 0 10px", lineHeight: 1.35 }}>{f.c}</p>
              <p style={{ fontSize: 16, color: "#a9bcd8", margin: 0 }}>{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 04 — COSTO NASCOSTO · tensione controllata (8) · picco della curva */}
      <section className="s-sec" style={{ padding: "84px 0", textAlign: "center" }}>
        <div className="s-wrap" style={{ maxWidth: 760 }}>
          <h2 style={{ fontSize: "clamp(26px,4vw,38px)", lineHeight: 1.25, margin: "0 0 22px" }}>
            Il problema di ciò che non vedi<br />è che continua ad accadere.
          </h2>
          <p style={{ fontSize: 17.5, maxWidth: 640, margin: "0 auto 34px" }}>
            Un'ora di poltrona vuota ha un costo, anche se nessuno la registra. Un servizio sotto margine continua a occupare agenda.
            Un cliente che si sta allontanando esce dalla porta senza che nessuno se ne accorga. Nessuno di questi eventi fa rumore:
            si limitano a ripetersi, giorno dopo giorno.
          </p>
          <div className="s-grid g3" style={{ textAlign: "left" }}>
            {[
              { t: "Il tempo", d: "La capacità produttiva che non usi non torna indietro. Ma senza un valore al minuto, resta invisibile." },
              { t: "Il margine", d: "Un listino costruito sulla concorrenza, e non sui tuoi costi, può farti lavorare tanto e guadagnare poco." },
              { t: "I clienti", d: "Chi si dirada non ti manda un avviso. Te ne accorgi mesi dopo, quando è già diventato il cliente di qualcun altro." },
            ].map(x => (
              <div key={x.t} className="s-card" style={{ borderTop: "4px solid " + BLU }}>
                <h3 style={{ fontFamily: "'Cinzel', serif", color: NAVY, fontSize: 18, margin: "0 0 8px" }}>{x.t}</h3>
                <p style={{ fontSize: 15, margin: 0 }}>{x.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 05 — SPIEGAZIONE · sollievo, la causa (6) */}
      <section className="s-sec alt" style={{ padding: "76px 0" }}>
        <div className="s-wrap" style={{ maxWidth: 800, textAlign: "center" }}>
          <p className="s-eyebrow">La causa, non la colpa</p>
          <h2 style={{ fontSize: "clamp(24px,3.6vw,34px)", margin: "12px 0 18px", lineHeight: 1.3 }}>
            Se scopri cosa è successo soltanto a fine mese,<br />non stai gestendo: stai leggendo il passato.
          </h2>
          <p style={{ fontSize: 17, maxWidth: 680, margin: "0 auto" }}>
            Non è una questione di capacità. È che mentre sei dentro l'operatività è quasi impossibile vedere tutto:
            i dati esistono già — nell'agenda, nella cassa, nello storico — ma restano separati, muti e disponibili troppo tardi.
            Non diventano mai una direzione.
          </p>
          <p style={{ fontSize: 17, maxWidth: 680, margin: "16px auto 0", fontWeight: 600, color: NAVY }}>
            Il punto non è avere più dati. È che i dati producano una decisione, mentre puoi ancora cambiare qualcosa.
          </p>
        </div>
      </section>

      {/* 06 — STORIA · affinità, prima di presentare GPS (5) */}
      <section className="s-sec" style={{ padding: "76px 0" }}>
        <div className="s-wrap s-grid g2" style={{ alignItems: "center", gap: 40 }}>
          <div>
            <p className="s-eyebrow">Perché lo sappiamo</p>
            <h2 style={{ fontSize: "clamp(23px,3.2vw,30px)", margin: "10px 0 16px", lineHeight: 1.32 }}>
              Ci siamo passati dentro, non lo abbiamo studiato da fuori.
            </h2>
            <p style={{ fontSize: 16.5 }}>
              Dimitar A. Hristov apre The Gentlemen Inn nel 2018. Il salone cresce: team, più aree di servizio, agenda piena, incassi.
              Da fuori sembra tutto sotto controllo. È proprio lì che scopre la parte scomoda: accorgersi di un problema a fine mese
              significa quasi sempre accorgersene troppo tardi.
            </p>
            <p style={{ fontSize: 16.5 }}>
              Da quella scoperta nasce un modo diverso di leggere il salone — prima con carta, fogli di calcolo e procedure, sul campo.
              Non una teoria costruita per vendere consulenza: un metodo nato dai problemi di un titolare vero.
            </p>
            <Link href="/sito/storia" className="s-kicker">La storia completa →</Link>
          </div>
          <img src="/site/dimitar-1.jpg" alt="Dimitar A. Hristov, fondatore di GPS" style={{ width: "100%", borderRadius: 16, boxShadow: "0 12px 34px rgba(10,29,61,.18)" }} />
        </div>
      </section>

      {/* 07 — POSSIBILITÀ · curiosità (6) */}
      <section className="s-sec navy" style={{ padding: "80px 0" }}>
        <div className="s-wrap" style={{ maxWidth: 820, textAlign: "center" }}>
          <h2 style={{ fontSize: "clamp(25px,3.8vw,36px)", margin: "0 0 26px", lineHeight: 1.28 }}>
            E se il 12 del mese sapessi già dove stai andando il 31?
          </h2>
          <div className="s-grid g2" style={{ textAlign: "left", marginTop: 10 }}>
            {[
              "Se sapessi, ogni mattina, quanto deve produrre oggi il tuo salone per stare in obiettivo.",
              "Se vedessi quali servizi ti lasciano margine e quali occupano soltanto l'agenda.",
              "Se un cliente che si sta allontanando comparisse in una lista, invece che sparire in silenzio.",
              "Se ogni collaboratore conoscesse il proprio numero — e tu sapessi dove ha ancora spazio.",
            ].map(t => (
              <div key={t} className="s-card" style={{ fontSize: 16, padding: 20 }}>{t}</div>
            ))}
          </div>
        </div>
      </section>

      {/* 08 — GPS · controllo (7) */}
      <section className="s-sec" style={{ padding: "80px 0" }}>
        <div className="s-wrap" style={{ maxWidth: 860, textAlign: "center" }}>
          <p className="s-eyebrow">È esattamente per questo che esiste GPS</p>
          <h2 style={{ fontSize: "clamp(28px,4.2vw,40px)", margin: "12px 0 16px" }}>Non più dati. Una direzione.</h2>
          <p style={{ fontSize: 17.5, maxWidth: 700, margin: "0 auto 34px" }}>
            GPS è un metodo proprietario di gestione del salone — e un gestionale evoluto costruito attorno a quel metodo.
            Mette in relazione costi, tempo, margine, clienti, servizi, team e obiettivi, e li trasforma in decisioni operative.
            Come un GPS reale: ti dice dove sei, ti fa scegliere una destinazione, ti aiuta a correggere la rotta strada facendo.
          </p>
          <div className="s-grid g3" style={{ textAlign: "left" }}>
            {[
              { t: "Il metodo", d: "Applicabile dal primo giorno, anche con carta e fogli di calcolo. È la logica: obiettivo, capacità, margine, cliente, team.", href: "/sito/metodo", c: "Le 7 aree" },
              { t: "Il software", d: "Il gestionale che automatizza il metodo e lo rende quotidiano. Sostituisce quello che usi oggi, con importazione dei dati.", href: "/sito/software", c: "Come funziona" },
              { t: "La formazione", d: "Libri e Academy per imparare a leggere l'azienda: GPS non consegna un cruscotto e ti lascia solo davanti ai numeri.", href: "/sito/academy", c: "Academy e libri" },
            ].map(x => (
              <div key={x.t} className="s-card">
                <h3 style={{ fontFamily: "'Cinzel', serif", color: NAVY, fontSize: 19, margin: "0 0 8px" }}>{x.t}</h3>
                <p style={{ fontSize: 15, margin: "0 0 12px" }}>{x.d}</p>
                <Link href={x.href} className="s-kicker">{x.c} →</Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 09 — GUARDA / PREVEDI / SCEGLI · agency, sequenza causale */}
      <section className="s-sec alt" style={{ padding: "76px 0" }}>
        <div className="s-wrap">
          <h2 style={{ fontSize: "clamp(24px,3.4vw,32px)", textAlign: "center", margin: "0 0 8px" }}>Guarda. Prevedi. Scegli.</h2>
          <p style={{ textAlign: "center", fontSize: 16.5, margin: "0 auto 34px", maxWidth: 560 }}>Non è uno slogan: è la sequenza. Vedo → anticipo → intervengo.</p>
          <div style={{ display: "flex", gap: 0, flexWrap: "wrap", alignItems: "stretch", justifyContent: "center" }}>
            {[
              { n: "Guarda", d: "Vedi la situazione reale mentre accade: margine, capacità, clienti, team. Non a fine mese: adesso." },
              { n: "Prevedi", d: "Storico, medie, obiettivi e andamento corrente disegnano la traiettoria — e fanno emergere lo scostamento prima che diventi un problema." },
              { n: "Scegli", d: "Sai dove intervenire e con quale priorità. Le decisioni restano tue: GPS ti mette nella condizione di prenderle in tempo." },
            ].map((x, i) => (
              <div key={x.n} style={{ flex: "1 1 260px", maxWidth: 320, display: "flex", alignItems: "center" }}>
                <div className="s-card" style={{ flex: 1, borderTop: "4px solid " + BLU }}>
                  <h3 style={{ fontFamily: "'Cinzel', serif", color: BLU, fontSize: 22, margin: "0 0 8px" }}>{x.n}</h3>
                  <p style={{ fontSize: 15, margin: 0 }}>{x.d}</p>
                </div>
                {i < 2 && <span style={{ color: BLU, fontSize: 26, padding: "0 8px" }}>→</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 10 — PROVA · credibilità (6): schemi illustrativi + materiali reali */}
      <section className="s-sec" style={{ padding: "78px 0" }}>
        <div className="s-wrap">
          <p className="s-eyebrow">Come si legge un salone con GPS</p>
          <h2 style={{ fontSize: "clamp(23px,3.2vw,30px)", margin: "10px 0 8px" }}>Tre letture che cambiano le decisioni.</h2>
          <p style={{ maxWidth: 700, fontSize: 16 }}>
            Non sono grafici decorativi: sono il modo in cui il metodo mette in relazione tempo, valore e clienti.
            Gli schemi qui sotto spiegano il meccanismo — i numeri del tuo salone li vedrai sui tuoi dati.
          </p>

          <div className="s-grid g3" style={{ marginTop: 24 }}>
            <div className="s-card">
              <h3 style={{ fontFamily: "'Cinzel', serif", color: NAVY, fontSize: 17, margin: "0 0 4px" }}>Lavorato ≠ incassato</h3>
              <p style={{ fontSize: 14, color: "#5a6572" }}>Prepagate, card e abbonamenti separano il valore erogato dal denaro ricevuto. GPS non li confonde mai.</p>
              <svg viewBox="0 0 300 120" style={{ width: "100%" }}>
                <text x="0" y="26" fontSize="11" fill="#5a6572">lavorato</text>
                <rect x="70" y="14" width="200" height="16" rx="4" fill={BLU} />
                <text x="0" y="60" fontSize="11" fill="#5a6572">incassato</text>
                <rect x="70" y="48" width="140" height="16" rx="4" fill="#4d80d6" />
                <text x="0" y="94" fontSize="11" fill="#5a6572">credito</text>
                <rect x="70" y="82" width="60" height="16" rx="4" fill="#b0c4e6" />
                <text x="70" y="114" fontSize="10" fill="#8a93a3">schema illustrativo del meccanismo</text>
              </svg>
            </div>

            <div className="s-card">
              <h3 style={{ fontFamily: "'Cinzel', serif", color: NAVY, fontSize: 17, margin: "0 0 4px" }}>Il valore del tempo</h3>
              <p style={{ fontSize: 14, color: "#5a6572" }}>Ogni minuto di capacità produttiva ha un costo. Un servizio è sostenibile solo se copre il tempo che occupa.</p>
              <svg viewBox="0 0 300 120" style={{ width: "100%" }}>
                <line x1="20" y1="100" x2="290" y2="100" stroke="#d5dbe6" />
                {[0, 1, 2, 3, 4].map(i => (
                  <g key={i}>
                    <rect x={34 + i * 52} y={100 - [70, 52, 40, 28, 16][i]} width="30" height={[70, 52, 40, 28, 16][i]} rx="3" fill={i < 3 ? BLU : "#d98b6a"} />
                  </g>
                ))}
                <line x1="20" y1="60" x2="290" y2="60" stroke="#d98b6a" strokeDasharray="5 4" />
                <text x="200" y="54" fontSize="10" fill="#b3402a">costo del tempo occupato</text>
                <text x="20" y="116" fontSize="10" fill="#8a93a3">schema illustrativo: servizi sopra e sotto la soglia</text>
              </svg>
            </div>

            <div className="s-card">
              <h3 style={{ fontFamily: "'Cinzel', serif", color: NAVY, fontSize: 17, margin: "0 0 4px" }}>Whale Curve</h3>
              <p style={{ fontSize: 14, color: "#5a6572" }}>Chi contribuisce davvero al margine e chi assorbe capacità più di quanta ne restituisca.</p>
              <svg viewBox="0 0 300 120" style={{ width: "100%" }}>
                <line x1="20" y1="100" x2="290" y2="100" stroke="#d5dbe6" />
                <path d="M20,100 C60,22 110,18 170,44 C220,66 260,88 290,100" fill="none" stroke={BLU} strokeWidth="2.5" />
                <path d="M20,100 C60,82 120,70 190,76 C240,82 270,94 290,100" fill="none" stroke="#d98b6a" strokeWidth="2" strokeDasharray="5 4" />
                <text x="20" y="116" fontSize="10" fill="#8a93a3">schema illustrativo: margine (pieno) e costo (tratteggio)</text>
              </svg>
            </div>
          </div>

          {/* materiali reali */}
          <div className="s-grid g2" style={{ marginTop: 34, alignItems: "center" }}>
            <div>
              <p className="s-eyebrow">Materiali reali</p>
              <h3 style={{ fontFamily: "'Cinzel', serif", color: NAVY, fontSize: 22, margin: "8px 0 10px" }}>Un pensiero documentato, non una promessa.</h3>
              <p style={{ fontSize: 16 }}>
                Il metodo è scritto: «L'azienda chiamata salone» lo introduce per intero, la collana «Le illusioni del salone»
                approfondisce una convinzione alla volta. Il software è oggi in fase pilota con saloni selezionati, a partire da
                The Gentlemen Inn — il laboratorio dove GPS viene applicato ogni giorno su dati veri.
              </p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
                <Link href="/sito/libri" className="s-btn ghost">Vedi i libri</Link>
                <Link href="/sito/software" className="s-btn ghost">Il software</Link>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <img src="/site/libro-madre.jpg" alt="L'azienda chiamata salone" style={{ width: 150, borderRadius: 8, boxShadow: "0 10px 26px rgba(10,29,61,.22)" }} />
              <img src="/site/ill-agenda.jpg" alt="L'illusione dell'agenda piena" style={{ width: 150, borderRadius: 8, boxShadow: "0 10px 26px rgba(10,29,61,.22)" }} />
              <img src="/site/ill-cliente.jpg" alt="L'illusione del cliente fedele" style={{ width: 150, borderRadius: 8, boxShadow: "0 10px 26px rgba(10,29,61,.22)" }} />
            </div>
          </div>
        </div>
      </section>

      {/* 11 — SALON CHECK · azione (7), tono calmo */}
      <section className="s-sec navy" style={{ textAlign: "center", padding: "82px 0" }}>
        <div className="s-wrap" style={{ maxWidth: 720 }}>
          <p className="s-eyebrow" style={{ color: "#9db8e8" }}>Il passo successivo</p>
          <h2 style={{ fontSize: "clamp(26px,3.8vw,36px)", margin: "12px 0 16px", lineHeight: 1.28 }}>
            Scopri cosa sta succedendo nel tuo salone.
          </h2>
          <p style={{ fontSize: 17, margin: "0 auto 30px", maxWidth: 600 }}>
            18 domande, tre minuti. Il Salon Check mette a fuoco le sei aree della tua azienda-salone e ti mostra
            dove hai il controllo e dove stai navigando a vista. Gratuito, e il risultato è tuo.
          </p>
          <Link href="/check" className="s-btn" style={{ fontSize: 17 }}>Fai il Salon Check</Link>
          <p style={{ fontSize: 14.5, color: "#b9c6dd", marginTop: 22 }}>
            Vuoi partire dai numeri? <Link href="/cam" style={{ color: "#fff", textDecoration: "underline" }}>Calcola il tuo CAM</Link> e scopri se il servizio che vendi di più ti fa guadagnare.
          </p>
          <p style={{ fontSize: 13.5, color: "#8fa3c4", marginTop: 14 }}>
            Da «spero che stia andando bene» a «so dove sto andando».
          </p>
        </div>
      </section>
    </SiteShell>
  );
}
