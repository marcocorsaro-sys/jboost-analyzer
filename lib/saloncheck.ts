"use client";
// GPS SALON CHECK — 18 domande diagnostiche, 6 aree, punteggio interno nascosto (0 = ok, 3 = critico)

export const AREAS: Record<string, { label: string; icon: string }> = {
  numeri: { label: "Numeri & Margine", icon: "📊" },
  agenda: { label: "Agenda & Capacità", icon: "📅" },
  clienti: { label: "Clienti", icon: "💈" },
  vendita: { label: "Vendita", icon: "💰" },
  marketing: { label: "Marketing", icon: "📣" },
  team: { label: "Team", icon: "👥" },
};

export type Q = { area: keyof typeof AREAS & string; text: string; opts: { t: string; s: number }[] };

export const QUESTIONS: Q[] = [
  // ── NUMERI & MARGINE ─────────────────────────────────────────────
  { area: "numeri", text: "Sai quanto ti costa un'ora di lavoro del tuo salone (affitto, personale, tutto)?", opts: [
    { t: "Sì, lo conosco al minuto e lo uso per decidere", s: 0 },
    { t: "Ho un'idea approssimativa", s: 1 },
    { t: "No, ma il fatturato mi sembra buono", s: 2 },
    { t: "No, non l'ho mai calcolato", s: 3 },
  ]},
  { area: "numeri", text: "Dei servizi in listino, sai quali ti lasciano margine e quali te lo mangiano?", opts: [
    { t: "Sì, servizio per servizio", s: 0 },
    { t: "Solo per i servizi principali", s: 1 },
    { t: "Ragiono sul totale a fine mese", s: 2 },
    { t: "No, mai analizzato", s: 3 },
  ]},
  { area: "numeri", text: "Come sono nati i prezzi del tuo listino?", opts: [
    { t: "Dal costo orario reale + obiettivo di guadagno", s: 0 },
    { t: "Guardando la concorrenza della zona", s: 2 },
    { t: "Sono quelli 'storici', ritoccati ogni tanto", s: 2 },
    { t: "Non li rivedo da anni", s: 3 },
  ]},
  // ── AGENDA & CAPACITÀ ────────────────────────────────────────────
  { area: "agenda", text: "In una settimana tipo, quanto è piena la tua agenda?", opts: [
    { t: "Oltre l'85%, e so dirlo con precisione", s: 0 },
    { t: "Tra il 60% e l'85%", s: 1 },
    { t: "Meno del 60%", s: 2 },
    { t: "Non lo so misurare", s: 3 },
  ]},
  { area: "agenda", text: "I buchi in agenda, come li gestisci?", opts: [
    { t: "Li conosco e li riempio con azioni mirate", s: 0 },
    { t: "Capitano, cerco di sistemarli quando li vedo", s: 1 },
    { t: "Ho giorni interi deboli e ci ho fatto il callo", s: 2 },
    { t: "L'agenda la gestisco a memoria/su carta", s: 3 },
  ]},
  { area: "agenda", text: "Sai quanto ti costa in euro un'ora di poltrona vuota?", opts: [
    { t: "Sì, ed è il numero che guardo ogni giorno", s: 0 },
    { t: "Più o meno", s: 1 },
    { t: "Mai calcolato", s: 2 },
    { t: "Non credo serva saperlo", s: 3 },
  ]},
  // ── CLIENTI ──────────────────────────────────────────────────────
  { area: "clienti", text: "I tuoi clienti tornano con la frequenza che vorresti?", opts: [
    { t: "Sì, la misuro: la maggioranza torna nei tempi giusti", s: 0 },
    { t: "Credo di sì, ma non la misuro", s: 1 },
    { t: "Molti si diradano e non me ne accorgo subito", s: 2 },
    { t: "Vivo soprattutto di passaggio", s: 3 },
  ]},
  { area: "clienti", text: "Se un buon cliente sparisce per 3 mesi, cosa succede?", opts: [
    { t: "Lo intercettiamo e lo ricontattiamo", s: 0 },
    { t: "A volte ce ne accorgiamo", s: 1 },
    { t: "Non succede niente", s: 2 },
    { t: "Non saprei nemmeno dire chi manca", s: 3 },
  ]},
  { area: "clienti", text: "Il prossimo appuntamento del cliente quando viene fissato?", opts: [
    { t: "In salone, prima che esca — quasi sempre", s: 0 },
    { t: "A volte lo proponiamo", s: 1 },
    { t: "Quasi mai: decide lui quando tornare", s: 2 },
    { t: "Lavoriamo solo su chi entra", s: 3 },
  ]},
  // ── VENDITA ──────────────────────────────────────────────────────
  { area: "vendita", text: "La tua fiche media (scontrino medio): la conosci e la lavori?", opts: [
    { t: "La conosco e ho obiettivi per farla crescere", s: 0 },
    { t: "La conosco ma non la lavoro", s: 1 },
    { t: "Non la conosco con precisione", s: 2 },
    { t: "Non so cosa guardare", s: 3 },
  ]},
  { area: "vendita", text: "Quanto pesa la rivendita prodotti sul tuo fatturato?", opts: [
    { t: "Più del 10%, misurato", s: 0 },
    { t: "Qualcosa vendiamo, senza metodo", s: 1 },
    { t: "Quasi nulla", s: 2 },
    { t: "Non vendiamo prodotti", s: 3 },
  ]},
  { area: "vendita", text: "Upgrade e servizi aggiuntivi vengono proposti in poltrona?", opts: [
    { t: "Sì, con un metodo uguale per tutti", s: 0 },
    { t: "Dipende dall'operatore", s: 1 },
    { t: "Raramente", s: 2 },
    { t: "Mai: sembra invadente", s: 3 },
  ]},
  // ── MARKETING ────────────────────────────────────────────────────
  { area: "marketing", text: "Da dove arrivano i tuoi clienti nuovi?", opts: [
    { t: "Da canali che misuro e alimento con costanza", s: 0 },
    { t: "Quasi solo passaparola", s: 1 },
    { t: "Dai social, ma senza costanza", s: 2 },
    { t: "Di nuovi ne arrivano pochissimi", s: 3 },
  ]},
  { area: "marketing", text: "Le tue promozioni come nascono?", opts: [
    { t: "Mirate su segmenti di clienti, e ne misuro il ritorno", s: 0 },
    { t: "Sconti quando serve riempire", s: 2 },
    { t: "Solo sotto le feste", s: 2 },
    { t: "Non ne faccio mai", s: 1 },
  ]},
  { area: "marketing", text: "Telefoni, email e consensi dei tuoi clienti?", opts: [
    { t: "Database completo, con consensi, e lo uso", s: 0 },
    { t: "Raccolti ma mai usati", s: 1 },
    { t: "Parziali e sparsi", s: 2 },
    { t: "Sono nella mia testa / in rubrica", s: 3 },
  ]},
  // ── TEAM ─────────────────────────────────────────────────────────
  { area: "team", text: "I tuoi collaboratori conoscono i loro numeri (obiettivo, occupazione)?", opts: [
    { t: "Sì, con obiettivi chiari e condivisi", s: 0 },
    { t: "A grandi linee", s: 1 },
    { t: "No, i numeri li vedo solo io", s: 2 },
    { t: "Lavoro da solo", s: 1 },
  ]},
  { area: "team", text: "La differenza di produttività tra collaboratori…", opts: [
    { t: "È misurata e se ne parla apertamente", s: 0 },
    { t: "La percepisco ma non la misuro", s: 1 },
    { t: "È molto ampia e non so spiegarla", s: 3 },
    { t: "Preferisco non guardare", s: 3 },
  ]},
  { area: "team", text: "Ferie, orari e presenze del team come sono gestiti?", opts: [
    { t: "Pianificati insieme alla capacità produttiva", s: 0 },
    { t: "Su un calendario condiviso", s: 1 },
    { t: "A voce, di settimana in settimana", s: 2 },
    { t: "Sempre in emergenza", s: 3 },
  ]},
];

// osservazioni per area, a fasce di criticità (bassa <34, media 34-66, alta >66)
export const OBSERVATIONS: Record<string, { alta: string; media: string; bassa: string }> = {
  numeri: {
    alta: "Il salone naviga senza sapere quanto costa un'ora di lavoro: ogni prezzo del listino è una scommessa. È l'area da cui partire, perché condiziona tutte le altre.",
    media: "Alcuni numeri li conosci, ma non guidano ancora le decisioni: il listino e i margini vanno riportati sul costo orario reale.",
    bassa: "I numeri fondamentali sono sotto controllo: ottima base per lavorare sulle altre aree.",
  },
  agenda: {
    alta: "Ogni ora vuota ha un costo preciso che oggi nessuno vede: l'agenda va trasformata da calendario a strumento economico.",
    media: "L'agenda gira, ma i buchi non hanno ancora un prezzo né un piano per riempirli: lì c'è margine immediato.",
    bassa: "La capacità produttiva è ben presidiata: il tempo è già trattato come una risorsa economica.",
  },
  clienti: {
    alta: "I clienti entrano ed escono senza controllo: senza riappuntamento e recupero dei dormienti, il fatturato dipende dal caso.",
    media: "La base clienti c'è ma è lasciata a se stessa: frequenza e ritorni vanno misurati e lavorati, non sperati.",
    bassa: "Il rapporto con i clienti è gestito con metodo: frequenza e ritorni sono già un asset.",
  },
  vendita: {
    alta: "Ogni cliente in poltrona vale più di quello che spende oggi: fiche media, prodotti e upgrade sono leve quasi ferme.",
    media: "Qualcosa si vende, ma senza metodo: basta un processo semplice e uguale per tutti per alzare la fiche media.",
    bassa: "La vendita in salone ha già un metodo: si può raffinare, non rifondare.",
  },
  marketing: {
    alta: "L'arrivo di clienti nuovi è affidato al caso e i contatti esistenti sono un tesoro inutilizzato: serve un sistema, non più visibilità generica.",
    media: "C'è presenza ma non un sistema: canali misurabili e un database usato davvero cambierebbero il ritmo dei nuovi ingressi.",
    bassa: "L'acquisizione è presidiata: i canali portano clienti in modo misurabile.",
  },
  team: {
    alta: "Il team lavora senza numeri: senza obiettivi individuali e capacità pianificata, la crescita poggia solo sulle tue spalle.",
    media: "Il team funziona ma a sensazione: obiettivi individuali e presenze pianificate libererebbero tempo e margine.",
    bassa: "Il team è gestito con criteri chiari: buona base per delegare la crescita.",
  },
};

export function computeScores(answers: { area: string; s: number }[]) {
  const by: Record<string, { sum: number; max: number }> = {};
  for (const a of answers) {
    by[a.area] = by[a.area] ?? { sum: 0, max: 0 };
    by[a.area].sum += a.s;
    by[a.area].max += 3;
  }
  const scores: Record<string, number> = {};
  for (const k of Object.keys(AREAS)) scores[k] = by[k] ? Math.round((by[k].sum / by[k].max) * 100) : 0;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return { scores, primary: ranked[0]?.[0] ?? "numeri", secondary: ranked[1]?.[0] ?? "agenda" };
}
