/**
 * Schema Radiography — scoring rubrics.
 *
 * Each rubric lists, for one schema.org `@type`, the properties Google Rich
 * Results requires, the properties Google recommends, and the properties
 * schema.org additionally suggests. Scoring is deterministic and weighted:
 *
 *     score = (sum of weights for present properties)
 *             / (sum of weights for all rubric properties)
 *             * 100
 *
 * Weights: required = 60, recommended (Google) = 30, recommended (schema.org) = 10.
 * A property is "present" if it exists on the JSON-LD block with a non-empty value.
 *
 * The same formula yields the "projected score" after enrichment — we just
 * compute it on the union of currently-present properties and proposed ones.
 */

export type PropertyTier = 'required' | 'recommended_google' | 'recommended_schema'

export const TIER_WEIGHT: Record<PropertyTier, number> = {
  required: 60,
  recommended_google: 30,
  recommended_schema: 10,
}

export interface RubricProperty {
  key: string
  tier: PropertyTier
  /** Why this property matters — surfaced verbatim in the enrichment UI. */
  why: string
}

export interface SchemaRubric {
  /** Canonical schema.org type matched against detected blocks. */
  type: string
  /** Friendly Italian label rendered in the UI ("JSON di prodotto", ...). */
  italianLabel: string
  /** Page roles where this type usually appears (used for sampling + display). */
  pageRoles: PageRole[]
  properties: RubricProperty[]
}

export type PageRole =
  | 'homepage'
  | 'product'
  | 'article'
  | 'blog'
  | 'news'
  | 'faq'
  | 'category'
  | 'about'
  | 'contact'
  | 'event'
  | 'recipe'
  | 'video'
  | 'location'
  | 'breadcrumb'
  | 'other'

export const PAGE_ROLE_LABEL: Record<PageRole, string> = {
  homepage: 'Homepage',
  product: 'Prodotto',
  article: 'Articolo',
  blog: 'Blog',
  news: 'News',
  faq: 'FAQ',
  category: 'Categoria',
  about: 'About / Chi siamo',
  contact: 'Contatti',
  event: 'Evento',
  recipe: 'Ricetta',
  video: 'Video',
  location: 'Sede / Negozio',
  breadcrumb: 'Breadcrumb (sitewide)',
  other: 'Altra pagina',
}

// ---------------------------------------------------------------------------
// Per-type rubrics. Property lists distilled from Google's Rich Results docs
// (developers.google.com/search/docs/appearance/structured-data) plus the
// schema.org type specifications. The italianLabel + why columns are what the
// enrichment UI surfaces to the user, so they're written for a non-technical
// client reading "perché serve questo campo".
// ---------------------------------------------------------------------------

export const RUBRICS: Record<string, SchemaRubric> = {
  Organization: {
    type: 'Organization',
    italianLabel: 'JSON di brand / azienda',
    pageRoles: ['homepage', 'about'],
    properties: [
      { key: 'name', tier: 'required', why: 'Nome ufficiale del brand mostrato nei Knowledge Panel di Google.' },
      { key: 'url', tier: 'required', why: 'URL canonico del sito — collega l\'entità ai risultati di ricerca.' },
      { key: 'logo', tier: 'recommended_google', why: 'Logo mostrato nei risultati AI e nei Knowledge Panel.' },
      { key: 'sameAs', tier: 'recommended_google', why: 'Link ai profili social/Wikipedia: rafforza l\'identità nei motori AI.' },
      { key: 'contactPoint', tier: 'recommended_google', why: 'Punti di contatto strutturati (telefono, customer service).' },
      { key: 'address', tier: 'recommended_google', why: 'Indirizzo postale: critico per local SEO e Google Business.' },
      { key: 'foundingDate', tier: 'recommended_google', why: 'Anno di fondazione: aumenta autorevolezza (E-E-A-T).' },
      { key: 'founder', tier: 'recommended_schema', why: 'Fondatori dell\'azienda — Q&A AI.' },
      { key: 'description', tier: 'recommended_schema', why: 'Descrizione 1-2 frasi del brand.' },
      { key: 'email', tier: 'recommended_schema', why: 'Email pubblica di contatto.' },
      { key: 'telephone', tier: 'recommended_schema', why: 'Telefono pubblico di contatto.' },
      { key: 'numberOfEmployees', tier: 'recommended_schema', why: 'Dimensione organizzativa per AI assistants.' },
    ],
  },

  LocalBusiness: {
    type: 'LocalBusiness',
    italianLabel: 'JSON di attività locale',
    pageRoles: ['homepage', 'location', 'contact'],
    properties: [
      { key: 'name', tier: 'required', why: 'Nome dell\'attività locale.' },
      { key: 'address', tier: 'required', why: 'Indirizzo postale completo — requisito Google per local pack.' },
      { key: 'telephone', tier: 'required', why: 'Telefono — cliccabile nei risultati mobile.' },
      { key: 'url', tier: 'recommended_google', why: 'URL del sito ufficiale.' },
      { key: 'geo', tier: 'recommended_google', why: 'Coordinate geografiche (lat/lng) per Maps e local pack.' },
      { key: 'openingHours', tier: 'recommended_google', why: 'Orari di apertura mostrati nei risultati.' },
      { key: 'priceRange', tier: 'recommended_google', why: 'Fascia di prezzo (es. €€) mostrata nelle SERP locali.' },
      { key: 'sameAs', tier: 'recommended_google', why: 'Profili social ufficiali.' },
      { key: 'image', tier: 'recommended_schema', why: 'Immagine principale del locale.' },
      { key: 'hasMap', tier: 'recommended_schema', why: 'Link a Google Maps della sede.' },
      { key: 'description', tier: 'recommended_schema', why: 'Descrizione breve dell\'attività.' },
    ],
  },

  WebSite: {
    type: 'WebSite',
    italianLabel: 'JSON del sito (root)',
    pageRoles: ['homepage'],
    properties: [
      { key: 'url', tier: 'required', why: 'URL del sito.' },
      { key: 'name', tier: 'required', why: 'Nome del sito.' },
      { key: 'potentialAction', tier: 'recommended_google', why: 'Sitelinks Search Box: la searchbox interna nei risultati Google.' },
      { key: 'publisher', tier: 'recommended_google', why: 'Editore del sito (collega all\'Organization).' },
      { key: 'description', tier: 'recommended_schema', why: 'Descrizione generale del sito.' },
      { key: 'inLanguage', tier: 'recommended_schema', why: 'Lingua principale del sito (es. it-IT).' },
    ],
  },

  WebPage: {
    type: 'WebPage',
    italianLabel: 'JSON della pagina',
    pageRoles: ['homepage', 'about', 'contact', 'other'],
    properties: [
      { key: 'name', tier: 'required', why: 'Titolo della pagina.' },
      { key: 'url', tier: 'required', why: 'URL canonico della pagina.' },
      { key: 'description', tier: 'recommended_google', why: 'Meta description strutturata — riusata dai motori AI.' },
      { key: 'datePublished', tier: 'recommended_google', why: 'Data di pubblicazione.' },
      { key: 'dateModified', tier: 'recommended_google', why: 'Ultima modifica — segnala freschezza del contenuto.' },
      { key: 'breadcrumb', tier: 'recommended_google', why: 'Riferimento al BreadcrumbList della pagina.' },
      { key: 'inLanguage', tier: 'recommended_schema', why: 'Lingua della pagina.' },
      { key: 'isPartOf', tier: 'recommended_schema', why: 'Collega la pagina al WebSite.' },
      { key: 'primaryImageOfPage', tier: 'recommended_schema', why: 'Immagine principale.' },
    ],
  },

  Article: {
    type: 'Article',
    italianLabel: 'JSON di articolo',
    pageRoles: ['article', 'blog', 'news'],
    properties: [
      { key: 'headline', tier: 'required', why: 'Titolo dell\'articolo — appare nei rich results e in Top Stories.' },
      { key: 'image', tier: 'required', why: 'Immagine principale (≥1200px sul lato lungo per Discover).' },
      { key: 'datePublished', tier: 'required', why: 'Data di pubblicazione — requisito per Top Stories.' },
      { key: 'author', tier: 'required', why: 'Autore dell\'articolo — fondamentale per E-E-A-T.' },
      { key: 'dateModified', tier: 'recommended_google', why: 'Data ultima modifica — segnala aggiornamento.' },
      { key: 'publisher', tier: 'recommended_google', why: 'Editore (con name + logo) — requisito legacy AMP.' },
      { key: 'mainEntityOfPage', tier: 'recommended_google', why: 'Collega l\'articolo all\'URL canonico.' },
      { key: 'articleBody', tier: 'recommended_google', why: 'Corpo dell\'articolo — input diretto per AI summarization.' },
      { key: 'description', tier: 'recommended_schema', why: 'Descrizione breve dell\'articolo.' },
      { key: 'articleSection', tier: 'recommended_schema', why: 'Sezione editoriale.' },
      { key: 'wordCount', tier: 'recommended_schema', why: 'Lunghezza per filtri AI.' },
      { key: 'keywords', tier: 'recommended_schema', why: 'Keyword principali.' },
    ],
  },

  BlogPosting: {
    type: 'BlogPosting',
    italianLabel: 'JSON di post di blog',
    pageRoles: ['blog', 'article'],
    properties: [
      { key: 'headline', tier: 'required', why: 'Titolo del post.' },
      { key: 'image', tier: 'required', why: 'Immagine principale.' },
      { key: 'datePublished', tier: 'required', why: 'Data di pubblicazione.' },
      { key: 'author', tier: 'required', why: 'Autore del post — E-E-A-T.' },
      { key: 'dateModified', tier: 'recommended_google', why: 'Data ultima modifica.' },
      { key: 'publisher', tier: 'recommended_google', why: 'Editore.' },
      { key: 'mainEntityOfPage', tier: 'recommended_google', why: 'URL canonico del post.' },
      { key: 'description', tier: 'recommended_schema', why: 'Excerpt del post.' },
      { key: 'keywords', tier: 'recommended_schema', why: 'Tag principali.' },
    ],
  },

  NewsArticle: {
    type: 'NewsArticle',
    italianLabel: 'JSON di articolo news',
    pageRoles: ['news', 'article'],
    properties: [
      { key: 'headline', tier: 'required', why: 'Titolo della news — Top Stories.' },
      { key: 'image', tier: 'required', why: 'Immagine principale (≥1200px).' },
      { key: 'datePublished', tier: 'required', why: 'Data di pubblicazione esatta.' },
      { key: 'author', tier: 'required', why: 'Autore — E-E-A-T critico per news.' },
      { key: 'dateModified', tier: 'recommended_google', why: 'Aggiornamento news.' },
      { key: 'publisher', tier: 'recommended_google', why: 'Testata editoriale.' },
      { key: 'articleBody', tier: 'recommended_google', why: 'Corpo dell\'articolo.' },
      { key: 'description', tier: 'recommended_schema', why: 'Sommario.' },
      { key: 'articleSection', tier: 'recommended_schema', why: 'Categoria news.' },
    ],
  },

  Product: {
    type: 'Product',
    italianLabel: 'JSON di prodotto',
    pageRoles: ['product'],
    properties: [
      { key: 'name', tier: 'required', why: 'Nome del prodotto — appare nei merchant listing.' },
      { key: 'image', tier: 'required', why: 'Immagine prodotto — requisito Google Shopping.' },
      { key: 'offers', tier: 'required', why: 'Prezzo + disponibilità — sblocca i merchant rich results.' },
      { key: 'description', tier: 'recommended_google', why: 'Descrizione prodotto — input AI per Q&A.' },
      { key: 'brand', tier: 'recommended_google', why: 'Marca: cruciale per matching AI e Google Shopping.' },
      { key: 'aggregateRating', tier: 'recommended_google', why: 'Stelle dei review aggregati — boost CTR.' },
      { key: 'review', tier: 'recommended_google', why: 'Singole recensioni — rich snippet stelle.' },
      { key: 'gtin', tier: 'recommended_google', why: 'GTIN/EAN: collega il prodotto al catalogo globale.' },
      { key: 'mpn', tier: 'recommended_schema', why: 'Codice produttore.' },
      { key: 'sku', tier: 'recommended_schema', why: 'Codice interno SKU.' },
      { key: 'category', tier: 'recommended_schema', why: 'Categoria prodotto.' },
      { key: 'color', tier: 'recommended_schema', why: 'Colore (se varia).' },
    ],
  },

  Offer: {
    type: 'Offer',
    italianLabel: 'JSON di offerta',
    pageRoles: ['product'],
    properties: [
      { key: 'price', tier: 'required', why: 'Prezzo numerico.' },
      { key: 'priceCurrency', tier: 'required', why: 'Valuta ISO (EUR, USD, ...).' },
      { key: 'availability', tier: 'required', why: 'Disponibilità (InStock, OutOfStock, ...).' },
      { key: 'url', tier: 'required', why: 'URL d\'acquisto.' },
      { key: 'priceValidUntil', tier: 'recommended_google', why: 'Validità del prezzo — Google avvisa se manca.' },
      { key: 'itemCondition', tier: 'recommended_google', why: 'Condizione (Nuovo/Usato/Ricondizionato).' },
      { key: 'seller', tier: 'recommended_schema', why: 'Venditore dell\'offerta.' },
    ],
  },

  AggregateRating: {
    type: 'AggregateRating',
    italianLabel: 'JSON di rating aggregato',
    pageRoles: ['product', 'other'],
    properties: [
      { key: 'ratingValue', tier: 'required', why: 'Voto medio (es. 4.7).' },
      { key: 'ratingCount', tier: 'required', why: 'Numero di recensioni.' },
      { key: 'bestRating', tier: 'recommended_google', why: 'Voto massimo (default 5).' },
      { key: 'worstRating', tier: 'recommended_google', why: 'Voto minimo (default 1).' },
      { key: 'itemReviewed', tier: 'recommended_google', why: 'Riferimento all\'item recensito.' },
    ],
  },

  Review: {
    type: 'Review',
    italianLabel: 'JSON di recensione',
    pageRoles: ['product', 'other'],
    properties: [
      { key: 'reviewRating', tier: 'required', why: 'Voto della recensione.' },
      { key: 'author', tier: 'required', why: 'Autore della recensione.' },
      { key: 'itemReviewed', tier: 'required', why: 'Item recensito.' },
      { key: 'datePublished', tier: 'recommended_google', why: 'Data pubblicazione recensione.' },
      { key: 'reviewBody', tier: 'recommended_google', why: 'Testo della recensione.' },
      { key: 'publisher', tier: 'recommended_schema', why: 'Piattaforma che pubblica la recensione.' },
    ],
  },

  FAQPage: {
    type: 'FAQPage',
    italianLabel: 'JSON di FAQ',
    pageRoles: ['faq'],
    properties: [
      { key: 'mainEntity', tier: 'required', why: 'Lista di Question + Answer — l\'unico campo che rende davvero la FAQ.' },
      { key: 'name', tier: 'recommended_google', why: 'Titolo della pagina FAQ.' },
      { key: 'inLanguage', tier: 'recommended_schema', why: 'Lingua delle FAQ.' },
    ],
  },

  HowTo: {
    type: 'HowTo',
    italianLabel: 'JSON di guida (HowTo)',
    pageRoles: ['article'],
    properties: [
      { key: 'name', tier: 'required', why: 'Titolo della guida.' },
      { key: 'step', tier: 'required', why: 'Lista di passi (HowToStep) — il cuore della guida.' },
      { key: 'image', tier: 'recommended_google', why: 'Immagine principale della guida.' },
      { key: 'totalTime', tier: 'recommended_google', why: 'Tempo totale stimato (formato ISO 8601).' },
      { key: 'supply', tier: 'recommended_google', why: 'Materiali necessari.' },
      { key: 'tool', tier: 'recommended_google', why: 'Strumenti necessari.' },
      { key: 'estimatedCost', tier: 'recommended_schema', why: 'Costo stimato.' },
    ],
  },

  BreadcrumbList: {
    type: 'BreadcrumbList',
    italianLabel: 'JSON di breadcrumb',
    pageRoles: ['breadcrumb'],
    properties: [
      { key: 'itemListElement', tier: 'required', why: 'Catena di ListItem (position/name/item) — l\'unico campo che conta.' },
    ],
  },

  Event: {
    type: 'Event',
    italianLabel: 'JSON di evento',
    pageRoles: ['event'],
    properties: [
      { key: 'name', tier: 'required', why: 'Nome evento.' },
      { key: 'startDate', tier: 'required', why: 'Data/ora di inizio.' },
      { key: 'location', tier: 'required', why: 'Luogo o VirtualLocation.' },
      { key: 'endDate', tier: 'recommended_google', why: 'Data/ora di fine.' },
      { key: 'description', tier: 'recommended_google', why: 'Descrizione evento.' },
      { key: 'image', tier: 'recommended_google', why: 'Immagine dell\'evento.' },
      { key: 'offers', tier: 'recommended_google', why: 'Biglietti / prezzi.' },
      { key: 'performer', tier: 'recommended_google', why: 'Artisti / relatori.' },
      { key: 'organizer', tier: 'recommended_google', why: 'Organizzatore.' },
      { key: 'eventStatus', tier: 'recommended_schema', why: 'Stato (Scheduled/Postponed/Cancelled).' },
    ],
  },

  Recipe: {
    type: 'Recipe',
    italianLabel: 'JSON di ricetta',
    pageRoles: ['recipe'],
    properties: [
      { key: 'name', tier: 'required', why: 'Nome ricetta.' },
      { key: 'image', tier: 'required', why: 'Immagine ricetta.' },
      { key: 'recipeIngredient', tier: 'required', why: 'Lista ingredienti.' },
      { key: 'recipeInstructions', tier: 'required', why: 'Istruzioni passo-passo.' },
      { key: 'aggregateRating', tier: 'recommended_google', why: 'Voti aggregati — stelle nei rich results.' },
      { key: 'author', tier: 'recommended_google', why: 'Autore della ricetta.' },
      { key: 'datePublished', tier: 'recommended_google', why: 'Data di pubblicazione.' },
      { key: 'prepTime', tier: 'recommended_google', why: 'Tempo di preparazione.' },
      { key: 'cookTime', tier: 'recommended_google', why: 'Tempo di cottura.' },
      { key: 'totalTime', tier: 'recommended_google', why: 'Tempo totale.' },
      { key: 'recipeYield', tier: 'recommended_google', why: 'Porzioni.' },
      { key: 'nutrition', tier: 'recommended_google', why: 'Valori nutrizionali.' },
      { key: 'description', tier: 'recommended_schema', why: 'Descrizione ricetta.' },
    ],
  },

  VideoObject: {
    type: 'VideoObject',
    italianLabel: 'JSON di video',
    pageRoles: ['video', 'other'],
    properties: [
      { key: 'name', tier: 'required', why: 'Titolo del video.' },
      { key: 'thumbnailUrl', tier: 'required', why: 'URL della miniatura.' },
      { key: 'uploadDate', tier: 'required', why: 'Data di caricamento.' },
      { key: 'description', tier: 'recommended_google', why: 'Descrizione del video.' },
      { key: 'contentUrl', tier: 'recommended_google', why: 'URL del file video.' },
      { key: 'duration', tier: 'recommended_google', why: 'Durata in formato ISO 8601.' },
      { key: 'embedUrl', tier: 'recommended_google', why: 'URL di embed.' },
      { key: 'publisher', tier: 'recommended_schema', why: 'Editore del video.' },
    ],
  },

  ImageObject: {
    type: 'ImageObject',
    italianLabel: 'JSON di immagine',
    pageRoles: ['other'],
    properties: [
      { key: 'contentUrl', tier: 'required', why: 'URL dell\'immagine.' },
      { key: 'width', tier: 'recommended_google', why: 'Larghezza in px.' },
      { key: 'height', tier: 'recommended_google', why: 'Altezza in px.' },
      { key: 'caption', tier: 'recommended_google', why: 'Didascalia.' },
      { key: 'creator', tier: 'recommended_google', why: 'Autore dell\'immagine.' },
      { key: 'license', tier: 'recommended_schema', why: 'Licenza dell\'immagine.' },
      { key: 'creditText', tier: 'recommended_schema', why: 'Credit testuale.' },
    ],
  },

  Person: {
    type: 'Person',
    italianLabel: 'JSON di persona',
    pageRoles: ['about', 'article', 'other'],
    properties: [
      { key: 'name', tier: 'required', why: 'Nome completo.' },
      { key: 'jobTitle', tier: 'recommended_google', why: 'Ruolo/qualifica — E-E-A-T.' },
      { key: 'worksFor', tier: 'recommended_google', why: 'Organizzazione di appartenenza.' },
      { key: 'sameAs', tier: 'recommended_google', why: 'Profili social/autoritari (LinkedIn, Wikipedia, ...).' },
      { key: 'image', tier: 'recommended_google', why: 'Foto profilo.' },
      { key: 'url', tier: 'recommended_google', why: 'URL profilo ufficiale.' },
      { key: 'description', tier: 'recommended_schema', why: 'Bio breve.' },
    ],
  },

  Place: {
    type: 'Place',
    italianLabel: 'JSON di luogo',
    pageRoles: ['location', 'event'],
    properties: [
      { key: 'name', tier: 'required', why: 'Nome del luogo.' },
      { key: 'address', tier: 'required', why: 'Indirizzo postale.' },
      { key: 'geo', tier: 'recommended_google', why: 'Coordinate (lat/lng).' },
      { key: 'url', tier: 'recommended_google', why: 'URL ufficiale.' },
      { key: 'telephone', tier: 'recommended_schema', why: 'Telefono.' },
      { key: 'openingHoursSpecification', tier: 'recommended_schema', why: 'Orari strutturati.' },
    ],
  },

  ItemList: {
    type: 'ItemList',
    italianLabel: 'JSON di lista (catalogo/categoria)',
    pageRoles: ['category'],
    properties: [
      { key: 'itemListElement', tier: 'required', why: 'Lista degli elementi (ListItem) — il cuore del catalogo.' },
      { key: 'numberOfItems', tier: 'recommended_google', why: 'Numero totale di elementi.' },
      { key: 'name', tier: 'recommended_schema', why: 'Nome della lista (es. "Tutti i prodotti").' },
      { key: 'description', tier: 'recommended_schema', why: 'Descrizione della categoria.' },
    ],
  },
}

/** Returns all type keys with a defined rubric. */
export function knownTypes(): string[] {
  return Object.keys(RUBRICS)
}

/** Type aliases — e.g. "Restaurant" rolls up to LocalBusiness for scoring. */
export const TYPE_ALIASES: Record<string, string> = {
  Restaurant: 'LocalBusiness',
  Store: 'LocalBusiness',
  AutoDealer: 'LocalBusiness',
  Dentist: 'LocalBusiness',
  HotelBookmark: 'LocalBusiness',
  Hotel: 'LocalBusiness',
  TechArticle: 'Article',
  Report: 'Article',
  AnalysisNewsArticle: 'NewsArticle',
  BackgroundNewsArticle: 'NewsArticle',
  OpinionNewsArticle: 'NewsArticle',
  ReviewNewsArticle: 'NewsArticle',
  ContactPage: 'WebPage',
  AboutPage: 'WebPage',
  CollectionPage: 'WebPage',
  ProfilePage: 'WebPage',
  SearchResultsPage: 'WebPage',
}

/** Resolve a raw @type to a rubric type (handles aliases). */
export function resolveType(rawType: string): string | null {
  const t = rawType.trim()
  if (RUBRICS[t]) return t
  if (TYPE_ALIASES[t]) return TYPE_ALIASES[t]
  return null
}
