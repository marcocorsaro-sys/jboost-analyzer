/**
 * V4 Content driver — question bank (Bibbia sheets 9a + 9b).
 *
 * This file is a VERBATIM TypeScript transcription of sheet "9b · Content
 * Question Bank" (embedded from seo_content_assessment_templates.xlsx).
 * Nine templates, each with ~5 questions; every question has an area, a
 * weight "(w N)" and four answers A/B/C/D with a description and "[N pts]".
 *
 * The per-answer points embedded in 9b are AUTHORITATIVE (9a note: "Actual
 * per-answer points are embedded per question in sheet 9b — use those, they
 * are authoritative"). Answer labels (9a v5): A = Very bad, B = Bad,
 * C = Good, D = Very good — ascending points, A = 0 ... D = max.
 *
 * KNOWN SOURCE ANOMALY — Article template (9a "Open point"):
 * the source lists the Article template with 7 areas and weights
 * 15,25,10,20,(n/a),10,20, but sheet 9b actually contains 6 questions
 * numbered 1,2,3,4,6,7 — question #5 "Use of bolds" was absorbed into #4
 * "Walls of text" (its wording covers emphasis/bolding) and has no answers
 * of its own. Moreover several questions' max points differ from their
 * stated weight (Q1 Author & Date w15 but max 10; Q4 Walls w20 but max 15;
 * Q7 Internal linking w20 but max 15), so the max points sum to 85, not 100.
 * Per project decision (2026-08-11) the template is transcribed AS-IS —
 * 6 questions, points exactly as printed in 9b — and the scoring engine
 * (lib/v4/content/score.ts) normalizes by the template's own max points,
 * which absorbs the inconsistency without inventing numbers.
 *
 * Template keys deliberately match the CHECK constraint on
 * content_answers.template_key (Block 1 migration
 * 20260721160000_v4_block1_foundations.sql): 'global','homepage','plp',
 * 'pdp','article','listing_articles','service_page','about','faq' — so a
 * bank key is storable as-is, with no mapping layer to drift.
 */

export type ContentAnswerKey = 'A' | 'B' | 'C' | 'D'

export type ContentTemplateKey =
  | 'global'
  | 'homepage'
  | 'plp'
  | 'pdp'
  | 'faq'
  | 'service_page'
  | 'about'
  | 'listing_articles'
  | 'article'

/** 9a v5: the label precedes the answer text, mapped to the ascending scale. */
export const ANSWER_LABELS: Record<ContentAnswerKey, string> = {
  A: 'Very bad',
  B: 'Bad',
  C: 'Good',
  D: 'Very good',
}

export interface ContentAnswerOption {
  key: ContentAnswerKey
  /** 'Very bad' | 'Bad' | 'Good' | 'Very good' (9a v5 answer labels). */
  label: string
  /** Authoritative points from sheet 9b ("[N pts]"). */
  points: number
  /** Full answer text, verbatim from 9b. */
  description: string
}

export interface ContentQuestion {
  /**
   * Question number as printed in 9b. Progressive per template — except
   * Article, where #5 does not exist in the source (see header) and the
   * ids are 1,2,3,4,6,7. Matches content_answers.question_num.
   */
  id: number
  /** Question area, verbatim from 9b (weight stripped). */
  area: string
  /** Declared weight "(w N)" from 9b. NOT always equal to max points (Article). */
  weight: number
  /** Full question text, verbatim from 9b. */
  question: string
  /** Exactly four options, A → D, ascending points, A = 0. */
  answers: ContentAnswerOption[]
}

export interface ContentTemplate {
  key: ContentTemplateKey
  /** Template name as printed in 9b ("TEMPLATE: ..."). */
  label: string
  /** Template assessment scope, where 9b provides one. */
  description?: string
  questions: ContentQuestion[]
}

function opt(key: ContentAnswerKey, points: number, description: string): ContentAnswerOption {
  return { key, label: ANSWER_LABELS[key], points, description }
}

/** The full bank, in 9b source order. */
export const CONTENT_BANK: ContentTemplate[] = [
  {
    key: 'global',
    label: 'Global',
    description:
      'Global - SEO Content Assessment Assess whether the sitewide elements present on all pages — footer, breadcrumb, structured data and technical SEO signals — are correctly implemented and support crawlability, indexing and user navigation.',
    questions: [
      {
        id: 1,
        area: 'Footer completeness and institutional signals',
        weight: 30,
        question:
          'Does the footer provide complete institutional information and useful navigation signals for users and search engines?',
        answers: [
          opt('A', 0, 'Footer is absent, minimal or only contains a copyright line. No contact details, no address, no links to main site sections, no VAT/company number, no social profiles.'),
          opt('B', 10, 'Footer contains partial information: some links to policies or a few section links, but contact details, physical address, VAT/company registration, or social profiles are missing.'),
          opt('C', 20, 'Footer is fairly complete: contacts, address and links to main sections are present, but VAT/registration number, social profile links, or some policy links (privacy policy, cookie policy, terms) are missing.'),
          opt('D', 30, 'Footer is rich and complete: it includes physical address, telephone and/or email contacts, VAT or company registration number, links to main site sections, links to all relevant policies (privacy, cookies, terms), and social media profile links.'),
        ],
      },
      {
        id: 2,
        area: 'Breadcrumb navigation',
        weight: 30,
        question:
          'Is breadcrumb navigation present, coherent with the site architecture across the main page templates of the site?',
        answers: [
          opt('A', 0, 'Breadcrumb is absent on all or most page types. Users have no navigational path indicator beyond the browser URL or the main menu.'),
          opt('B', 10, 'Breadcrumb is present only on some page types (e.g. only on PDPs but not PLPs, or only on articles) and is inconsistent or missing on key templates.'),
          opt('C', 20, 'Breadcrumb is present on most page types and reflects the URL structure, but is missing on a few templates, truncated on deeper pages, or not always coherent with the actual page hierarchy.'),
          opt('D', 30, 'Breadcrumb is present and consistent across all main page templates, correctly reflects the full navigational path from homepage to current page, and uses descriptive anchor labels aligned with page titles and section names.'),
        ],
      },
      {
        id: 3,
        area: 'Navigation microcopy and sitewide CTA quality',
        weight: 20,
        question:
          'Are the labels in the main navigation, recurring CTAs and key interface messages descriptive, consistent and aligned with user intent?',
        answers: [
          opt('A', 0, 'Navigation labels are generic or cryptic (e.g. "Area 1", "Solutions", "More"), CTAs are vague throughout the site ("Click here", "Discover", "Read more") with no contextual specificity.'),
          opt('B', 6, 'Navigation labels name the main sections adequately, but CTAs are mostly generic and interchangeable across page types. There is no consistency in how actions or next steps are communicated sitewide.'),
          opt('C', 13, 'Navigation labels are clear and descriptive for most sections, and CTAs in key pages are reasonably specific, but inconsistencies exist — some page types use generic CTAs while others are well-crafted.'),
          opt('D', 20, 'Navigation labels are descriptive and aligned with how users think about the site\'s content areas. CTAs sitewide are specific, action-oriented and contextual (e.g. "Request a quote for X", "Explore Y solutions") — creating a consistent and intent-driven experience throughout the site.'),
        ],
      },
      {
        id: 4,
        area: 'Information architecture and sitewide navigability',
        weight: 20,
        question:
          'Is the site\'s information architecture clear, consistent and navigable across all page types — making it easy for both users and search engines to understand how content is organised?',
        answers: [
          opt('A', 0, 'The IA is unclear or inconsistent: section naming changes across page types, the menu does not reflect the actual content structure, and users cannot easily understand where they are or how to reach other sections.'),
          opt('B', 6, 'The main sections are identifiable but the hierarchy is shallow or flat — sibling pages, subcategories or content clusters are not surfaced, making it hard to navigate beyond the top level.'),
          opt('C', 13, 'The IA is reasonably clear: main sections are well named and accessible, but the hierarchy between parent and child pages is not always explicit, and some content areas are buried or disconnected from the main navigation.'),
          opt('D', 20, 'The IA is clear, deep and consistent sitewide: sections are logically named and hierarchically structured, the menu reflects the actual content organisation, parent–child relationships between pages are explicit, and users can always orient themselves and reach related content intuitively.'),
        ],
      },
    ],
  },
  {
    key: 'homepage',
    label: 'Homepage',
    description:
      'Homepage - SEO Content Assessment Assess whether the homepage communicates a clear value proposition, establishes the thematic identity of the site, builds trust and guides users toward the main sections and conversion actions.',
    questions: [
      {
        id: 1,
        area: 'Primary services/products visibility',
        weight: 25,
        question:
          'Does the homepage clearly present the main services or products offered, making the core offer immediately recognizable?',
        answers: [
          opt('A', 0, 'The main offer is absent or invisible above the fold. Users cannot understand what services or products the company provides without navigating elsewhere.'),
          opt('B', 8, 'Some services or products are mentioned, but only through generic labels (e.g. "Solutions", "Products") or buried in secondary sections, without enough detail to understand the actual offer.'),
          opt('C', 17, 'The main services or products are presented and recognizable, but the selection is incomplete, the naming is not search-oriented, or key offer areas are grouped under vague headings rather than shown individually.'),
          opt('D', 25, 'The main services or products are prominently featured with clear, descriptive labels and brief contextual copy that helps users immediately understand the offer\'s scope — and are directly linked to the relevant section pages.'),
        ],
      },
      {
        id: 2,
        area: 'Value proposition above the fold',
        weight: 20,
        question:
          'Does the homepage communicate a clear and distinctive value proposition — explaining who the company is, what makes it different and why users should choose it?',
        answers: [
          opt('A', 0, 'Value proposition is absent or completely generic. The page does not explain who the company is, what it stands for or why it is different from competitors.'),
          opt('B', 6, 'A tagline or claim is present but vague or purely aspirational (e.g. "Your trusted partner for growth"). It does not communicate a real differentiator or a reason to choose this brand over others.'),
          opt('C', 13, 'The value proposition is present and understandable: the company identity and its main differentiator are described, but the message is not sharp or memorable enough to stand out from category competitors.'),
          opt('D', 20, 'The value proposition is clear, specific and differentiating: it communicates who the company is, what makes it unique, and why it is the right choice — without requiring scrolling, reading between the lines or background knowledge of the brand.'),
        ],
      },
      {
        id: 3,
        area: 'Trust signals and social proof',
        weight: 20,
        question:
          'Does the homepage include trust signals such as client logos, numbers, certifications or reviews to reinforce credibility?',
        answers: [
          opt('A', 0, 'No trust signals are present. The homepage makes claims without any supporting evidence, social proof, notable clients, certifications or tangible results.'),
          opt('B', 6, 'Minimal trust signals: a few generic claims ("trusted by thousands") without concrete evidence, or a small number of logos without context.'),
          opt('C', 13, 'Trust signals are present: client logos, a key number or a certification badge, but they are not prominent, contextualized or varied enough to reinforce credibility effectively.'),
          opt('D', 20, 'Strong and diversified trust signals: notable client logos, quantified results (e.g. 500+ projects, 20 years of experience), industry certifications, ratings or verified reviews (e.g. Trustpilot, Google), placed prominently and coherently with the value proposition.'),
        ],
      },
      {
        id: 4,
        area: 'Navigation to main sections and contact accessibility',
        weight: 20,
        question: 'Does the homepage make it easy to access the main site sections and to initiate contact?',
        answers: [
          opt('A', 0, 'No CTA, contact link or clear access to main sections. The homepage is a dead end: users cannot intuitively reach services, products or contact information.'),
          opt('B', 6, 'Navigation is present but generic: a standard menu or a single contact link without editorial guidance. Main sections are reachable but not featured on the page.'),
          opt('C', 13, 'Main sections are accessible and a contact CTA is present, but the editorial logic is weak: sections are not prioritized by relevance, or CTAs are not sufficiently visible.'),
          opt('D', 20, 'The page provides clear and prioritized access to main sections (services, products, about, blog) through in-body links or highlighted modules, and features at least one prominent and specific CTA to contact or start the conversion funnel.'),
        ],
      },
      {
        id: 5,
        area: 'Semantic content depth and contextual internal linking',
        weight: 15,
        question:
          'Does the homepage include introductory content with sufficient semantic depth and relevant internal links to the main areas of the site?',
        answers: [
          opt('A', 0, 'Homepage is purely graphical or visual: almost no text, no meaningful semantic content, no contextual internal links beyond top navigation.'),
          opt('B', 5, 'Some text is present but limited to short labels, bullet points or promotional headings. Internal links are only in navigation; no editorial links in the body.'),
          opt('C', 10, 'Introductory text covers the main topics of the site and some body links are present, but the semantic depth is limited and the internal linking logic is not fully intentional.'),
          opt('D', 15, 'The homepage includes textual content that covers the main thematic areas of the site, naturally introduces services/products/sectors, and provides contextual internal links to key pages with descriptive anchors aligned with search intent.'),
        ],
      },
    ],
  },
  {
    key: 'plp',
    label: 'PLP',
    description:
      'PLP Ecommerce - SEO Content Assessment Assess whether the listing page clarifies the category, structures its content semantically, strengthens product relevance and connects the category to the wider SEO cluster.',
    questions: [
      {
        id: 1,
        area: 'H1 and category naming',
        weight: 15,
        question: 'Does the H1 clearly identify the main SEO topic of the category?',
        answers: [
          opt('A', 0, 'H1 is missing, hidden, duplicated incorrectly, too generic or not coherent with the category. Examples: Products, Catalog, Shop.'),
          opt('B', 5, 'H1 is present but weak: it names the category generically, does not clarify the offer well, or feels keyword-stuffed.'),
          opt('C', 10, 'H1 is clear and coherent with the main category, but not very distinctive compared with similar categories or not fully aligned with title, breadcrumb and page content.'),
          opt('D', 15, 'H1 is clear, unique, natural and descriptive: it immediately communicates the category, the scope of the offer and the main search intent without SEO forcing.'),
        ],
      },
      {
        id: 2,
        area: 'Heading hierarchy and semantic structure',
        weight: 20,
        question: 'Does the heading hierarchy correctly organize category, sections and linked products?',
        answers: [
          opt('A', 0, 'Headings are missing, used only for styling, or completely incoherent. The page has no understandable semantic structure.'),
          opt('B', 7, 'Structure is partial or confusing: generic H2/H3, disordered editorial sections, or product names placed at the same level as major page blocks without a clear logic.'),
          opt('C', 14, 'Structure is fairly clear: H1 for the category, H2/H3 for main sections, subcategories or editorial blocks, with some inconsistencies around linked products or secondary modules.'),
          opt('D', 20, 'Structure is very clear: the page distinguishes main topic, subtopics, subcategories, guides/FAQ and products. Product names are handled coherently and do not make the outline noisy.'),
        ],
      },
      {
        id: 3,
        area: 'Category copy and semantic intent coverage',
        weight: 25,
        question: 'Does the category content naturally cover the search intent and semantic field of the page?',
        answers: [
          opt('A', 0, 'Category text is absent, duplicated, hidden, generic or clearly written only to fill the page.'),
          opt('B', 8, 'Text is present but superficial: it describes the category generically, with little useful information and weak alignment with user queries.'),
          opt('C', 17, 'Text is relevant: it introduces the category, includes useful synonyms/variants and covers some choice criteria, but with limited depth or differentiation.'),
          opt('D', 25, 'Text is strong and SEO-oriented: it covers category, search variants, relevant attributes, use cases, user needs and choice criteria while remaining natural and useful.'),
        ],
      },
      {
        id: 4,
        area: 'Content of products linked in the listing',
        weight: 20,
        question: 'Are the linked products presented with useful and category-relevant textual information?',
        answers: [
          opt('A', 0, 'Products are linked with poor text, codes, incomplete names, images without context or generic labels such as Discover, View, Model 123.'),
          opt('B', 7, 'Product names are present but not very descriptive: they do not help users understand type, variant, brand, attribute or differences between products.'),
          opt('C', 14, 'Products have fairly descriptive names coherent with the category, but useful information such as variant, material, format, use, gender, brand or key attribute is missing.'),
          opt('D', 20, 'Linked products strengthen the SEO relevance of the PLP: names, microcopy and anchors are descriptive, category-coherent and help users and search engines understand the offer.'),
        ],
      },
      {
        id: 5,
        area: 'Editorial and contextual internal links',
        weight: 20,
        question: 'Does the PLP include relevant internal links to related pages in the SEO cluster?',
        answers: [
          opt('A', 0, 'No relevant internal links beyond standard product links, or links are generic/non-contextual.'),
          opt('B', 7, 'Internal links are present but weak: few, not very visible, generic anchors or links to non-priority pages.'),
          opt('C', 14, 'Good internal links to subcategories, indexable filters, relevant products or guides, but the editorial logic can be improved.'),
          opt('D', 20, 'Strong, intentional internal linking: connects subcategories, related clusters, buying guides and strategic products/categories with descriptive and contextual anchors.'),
        ],
      },
    ],
  },
  {
    key: 'pdp',
    label: 'PDP',
    description:
      'PDP Ecommerce - SEO Content Assessment Assess whether the product detail page explains what the product is, what makes it relevant for search, why it is distinctive and how it connects to the rest of the catalogue.',
    questions: [
      {
        id: 1,
        area: 'H1 and product naming',
        weight: 15,
        question: 'Does the H1 clearly identify the product and its main distinctive elements?',
        answers: [
          opt('A', 0, 'H1 is missing, duplicated, generic or not descriptive. Examples: Product, Product detail, or only an SKU/code.'),
          opt('B', 5, 'H1 is present but weak: incomplete product name, hard to understand or too dependent on brand/internal codes.'),
          opt('C', 10, 'H1 is clear and coherent with the product, but not very distinctive versus variants, similar models or parent category.'),
          opt('D', 15, 'H1 is clear, unique and natural: it includes product name and, where useful, brand, model, type, variant or main attribute without keyword stuffing.'),
        ],
      },
      {
        id: 2,
        area: 'Product description and semantic coverage',
        weight: 25,
        question: 'Is the product description original, specific and semantically useful?',
        answers: [
          opt('A', 0, 'Description is absent, almost empty, duplicated from the manufacturer or replicated across many PDPs with minimal changes.'),
          opt('B', 8, 'Description is present but generic/promotional: many claims, few concrete details, weak SEO value.'),
          opt('C', 17, 'Description is relevant: it explains main features, benefits and some use cases, but with limited depth or distinctiveness.'),
          opt('D', 25, 'Description is strong and SEO-oriented: original, natural and specific, covering features, benefits, uses, user needs, differences from alternatives and real search terms.'),
        ],
      },
      {
        id: 3,
        area: 'Decision-making information and purchase support',
        weight: 25,
        question: 'Does the PDP provide enough information to evaluate and buy the product?',
        answers: [
          opt('A', 0, 'Essential information is missing: features, variants, dimensions, materials, compatibility, use, availability or relevant conditions are not explained.'),
          opt('B', 8, 'Only minimal information is present: price, CTA and a few bullets/specs without context. Users must look elsewhere to understand suitability.'),
          opt('C', 17, 'Good coverage: attributes, specifications, variants, materials, measures, compatibility, use or reviews are present, but not always complete or well organized.'),
          opt('D', 25, 'Very strong coverage: the PDP helps users choose, compare and buy through practical details, variants, compatibility, contents, care/use instructions, reviews/Q&A, returns/shipping/warranty where relevant.'),
        ],
      },
      {
        id: 4,
        area: 'Heading hierarchy and PDP module organization',
        weight: 15,
        question:
          'Does the heading hierarchy correctly organize description, specifications, reviews, FAQ and cross-sell modules?',
        answers: [
          opt('A', 0, 'Headings are missing, used only for styling or incoherent. The page has no readable structure.'),
          opt('B', 5, 'Structure is confusing: description, specs, reviews, related products and FAQ are at the same level without a clear logic.'),
          opt('C', 10, 'Structure is fairly clear: H1 for the product, H2/H3 for description, details, reviews or related products, with some inconsistencies.'),
          opt('D', 15, 'Structure is very clear: the main product remains central; description, specs, reviews, FAQ, variants and cross-sell are organized into understandable, scannable sections.'),
        ],
      },
      {
        id: 5,
        area: 'Internal links to catalogue and support content',
        weight: 20,
        question:
          'Does the PDP include relevant internal links to categories, variants, related products and guides?',
        answers: [
          opt('A', 0, 'PDP is almost isolated: few useful internal links beyond standard navigation, or generic anchors such as click here or discover.'),
          opt('B', 7, 'Internal links are present but weak: breadcrumb/menu or standard related products, without editorial logic or descriptive anchors.'),
          opt('C', 14, 'Good linking to category, brand, variants, alternative products, accessories or guides, with room to improve priorities and anchors.'),
          opt('D', 20, 'Strategic internal linking: connects category/PLP, brand, variants, bundles, compatible accessories, substitutes, buying guides and FAQ with descriptive contextual anchors.'),
        ],
      },
    ],
  },
  {
    key: 'faq',
    label: 'FAQ',
    description:
      'FAQ Page - SEO Content Assessment Assess whether the FAQ works as a hub of real micro-intents: clear scope, atomic questions, direct answers, correct depth and useful routes to the next step.',
    questions: [
      {
        id: 1,
        area: 'Thematic scope and FAQ architecture',
        weight: 15,
        question: 'Does the FAQ have a clear thematic scope and coherent structure?',
        answers: [
          opt('A', 0, 'The page is a generic container of heterogeneous questions, mixing unrelated topics such as product, service, company, shipping, payments, technical issues, policies and careers.'),
          opt('B', 5, 'The general theme is understandable, but the FAQ is too broad or disordered. Some questions feel out of scope or belong to other site sections.'),
          opt('C', 10, 'The scope is fairly clear: the page addresses a recognizable theme and most questions are coherent, although grouping by section can be improved.'),
          opt('D', 15, 'The scope is very clear: the FAQ is dedicated to a well-defined theme, service, product, process or customer journey stage. Questions are organized in logical groups with no generic container effect.'),
        ],
      },
      {
        id: 2,
        area: 'Question quality, granularity and wording',
        weight: 25,
        question: 'Are questions natural, specific, atomic and aligned with real user doubts?',
        answers: [
          opt('A', 0, 'Questions are artificial, promotional, internally worded or too vague. Examples: Why choose us?, What is our mission?, Discover the benefits of our service.'),
          opt('B', 8, 'Questions are understandable but generic, weakly search-oriented or too bundled. A single question contains multiple different intents.'),
          opt('C', 17, 'Questions capture real doubts and are mostly specific, but there are overlaps, wording issues or missing intents.'),
          opt('D', 25, 'Questions are natural, specific, atomic and user-oriented. Each one captures a precise doubt, avoids duplication and covers relevant long-tail variants, exceptions, prerequisites, costs, timing, limits or special cases.'),
        ],
      },
      {
        id: 3,
        area: 'Answer format and usefulness',
        weight: 25,
        question: 'Does each answer resolve the doubt directly, self-sufficiently and in a scannable way?',
        answers: [
          opt('A', 0, 'Answers are vague, incomplete, promotional or do not actually answer the question. They often send users to contact support without providing useful information.'),
          opt('B', 8, 'Answers are present but minimal: they give only partial guidance and lack conditions, examples, limits or practical steps.'),
          opt('C', 17, 'Answers are clear and useful: they answer the question and include some practical details, but are not always structured in the most effective FAQ format.'),
          opt('D', 25, 'Answers are optimized for FAQ format: direct answer first, then details, conditions, examples, exceptions, operational steps or useful routes. Each answer is understandable even in isolation.'),
        ],
      },
      {
        id: 4,
        area: 'Depth management and relationship with other content',
        weight: 15,
        question:
          'Does the FAQ manage depth correctly without duplicating or replacing guides, service pages or product pages?',
        answers: [
          opt('A', 0, 'The FAQ cannibalizes or duplicates other site content, or tries to cover complex topics in overly short, insufficient answers.'),
          opt('B', 5, 'Some answers are too long and resemble mini-articles; others are too short for the question. It is unclear when the FAQ should answer and when it should route users elsewhere.'),
          opt('C', 10, 'Depth is generally correct: the FAQ answers main doubts and links elsewhere when needed, but overlaps or missed editorial opportunities remain.'),
          opt('D', 15, 'Depth is well managed: the FAQ answers micro-intents concisely and links to guides, service pages, PDPs, PLPs, documentation or articles when the topic needs deeper treatment. It also helps identify future dedicated pages.'),
        ],
      },
      {
        id: 5,
        area: 'FAQ navigation and next steps',
        weight: 20,
        question: 'Can users quickly find the right answer and continue toward the most relevant next step?',
        answers: [
          opt('A', 0, 'The FAQ is a long flat list with no sections, index, contextual links or next-step paths. Users must manually scroll everything.'),
          opt('B', 7, 'The page has a minimal structure, such as accordions or Q&A blocks, but no real orientation system or useful onward paths.'),
          opt('C', 14, 'The FAQ is fairly navigable: thematic sections, logical question order and some internal links toward useful pages.'),
          opt('D', 20, 'The FAQ works as a navigable hub: clear sections, questions ordered by priority or journey stage, possible index/jump links, contextual links and next steps toward transactional pages, guides, support, categories or forms.'),
        ],
      },
    ],
  },
  {
    key: 'service_page',
    label: 'Service Page',
    description:
      'Service Page - SEO Content Assessment Assess whether the service page clearly describes the offer, communicates concrete benefits, addresses user doubts and connects to related content to support the consideration and conversion journey.',
    questions: [
      {
        id: 1,
        area: 'H1 and service naming',
        weight: 15,
        question:
          'Does the H1 clearly identify the specific service, its scope and its main search intent?',
        answers: [
          opt('A', 0, 'H1 is missing, hidden, generic or shared across multiple service pages. Examples: Our services, What we do, Solutions.'),
          opt('B', 5, 'H1 is present but only names the service by a brand-internal label without explaining what it is, its scope or why users would search for it.'),
          opt('C', 10, 'H1 clearly names the service and gives a basic idea of its scope, but is not fully aligned with the main search query or does not differentiate from similar service pages on the same site.'),
          opt('D', 15, 'H1 is unique, descriptive and search-oriented: it names the service, communicates its scope or sector, and aligns naturally with the query a potential customer would type to find this offer.'),
        ],
      },
      {
        id: 2,
        area: 'Service description and semantic coverage',
        weight: 25,
        question:
          'Does the page content clearly describe what the service is, how it works and for whom it is intended?',
        answers: [
          opt('A', 0, 'Description is absent, extremely brief or completely generic. The page does not explain what the service actually involves, how it is delivered or who the typical client is.'),
          opt('B', 8, 'A description is present but superficial: it names the service and makes vague claims (e.g. "innovative and reliable solutions") without explaining the scope, process or target audience.'),
          opt('C', 17, 'The description explains what the service is and gives a reasonable overview of how it works and for whom, but lacks specificity on processes, target sectors or differentiating elements.'),
          opt('D', 25, 'The description is complete and SEO-oriented: it explains what the service entails, how it is delivered (process, methodology or phases), who it is for (sector, company type, need), and naturally integrates search-relevant terminology without keyword stuffing.'),
        ],
      },
      {
        id: 3,
        area: 'Benefits and outcomes',
        weight: 25,
        question:
          'Does the page explicitly communicate the concrete benefits and measurable outcomes that the service delivers to clients?',
        answers: [
          opt('A', 0, 'No benefits are communicated. The page describes the service activities but does not explain the value or outcomes for the client.'),
          opt('B', 8, 'Generic benefits are mentioned (e.g. "improve efficiency", "reduce costs") as short bullet points, without concrete detail, quantification or link to the service described.'),
          opt('C', 17, 'Benefits are present and relevant to the service, but lack specificity: outcomes are described without examples, case data or connection to the client\'s real-world situation.'),
          opt('D', 25, 'Benefits are specific, convincing and tied to the service: they explain what improves, by how much (where possible), for whom, and are supported by examples, data, case references or client testimonials that reinforce credibility.'),
        ],
      },
      {
        id: 4,
        area: 'FAQ and support content',
        weight: 15,
        question:
          'Does the page include a FAQ section that answers real questions about the service, targeted at users in the consideration phase?',
        answers: [
          opt('A', 0, 'No FAQ is present. Questions that prospects typically have about the service (scope, process, costs, timelines, prerequisites) are not addressed anywhere on the page.'),
          opt('B', 5, 'A FAQ section exists but contains only one or two generic questions, or questions that are purely commercial (e.g. "Why choose us?") without informational value.'),
          opt('C', 10, 'The FAQ addresses several real questions about the service and provides useful answers, but coverage is incomplete: key doubts around costs, timelines, process or eligibility are missing.'),
          opt('D', 15, 'The FAQ covers the main questions a prospect would have at the consideration stage: scope and process of the service, typical timelines, costs or pricing model, prerequisites, what is included and what is not, and next steps to proceed. Answers are specific and actionable.'),
        ],
      },
      {
        id: 5,
        area: 'Related content and contextual internal links',
        weight: 20,
        question:
          'Does the page include relevant internal links to related services, case studies, articles or other pages that support the conversion journey?',
        answers: [
          opt('A', 0, 'No contextual internal links beyond standard navigation. The page is a dead end: users cannot reach related services, supporting content or next steps from the body of the page.'),
          opt('B', 6, 'Some internal links exist (e.g. a generic "related services" block at the bottom) but anchors are non-descriptive, link priority is unclear or links do not support the user journey logically.'),
          opt('C', 13, 'Related services, case studies or articles are linked with reasonable anchors, but the selection is not fully intentional: some relevant pages are missing and the editorial logic connecting them to the current service is not explicit.'),
          opt('D', 20, 'The page features a strategic network of contextual internal links: related or complementary services with descriptive anchors, links to case studies or sector pages that reinforce credibility, and links to supporting content (articles, guides, FAQs) that help users move forward in the conversion funnel.'),
        ],
      },
    ],
  },
  {
    key: 'about',
    label: 'About',
    questions: [
      {
        id: 1,
        area: 'History & Heritage',
        weight: 15,
        question:
          'Does the page tell the brand\'s story (origins, milestones, track record) in a way that builds credibility rather than generic filler?',
        answers: [
          opt('A', 0, 'No history. The page gives no sense of the company\'s origins, age or journey.'),
          opt('B', 5, 'A vague or boilerplate mention of being established or having years of experience, with no specifics, dates or milestones.'),
          opt('C', 10, 'A real founding story and some milestones are told, but it is thin, purely chronological, or not connected to why it matters to the reader.'),
          opt('D', 15, 'A specific heritage narrative (founding, key milestones, track record) with concrete dates and facts that establish longevity and credibility, connecting the past to present-day value.'),
        ],
      },
      {
        id: 2,
        area: 'Value Proposition (Mission/Vision)',
        weight: 20,
        question:
          'Does the page clearly articulate why the company exists, what it stands for and the value it delivers, beyond generic claims?',
        answers: [
          opt('A', 0, 'No mission, vision or value statement. The reader cannot tell what the company stands for or why it is different.'),
          opt('B', 6, 'Mission or vision is present but generic and interchangeable (e.g. delivering excellence and innovation), with no substance or differentiation.'),
          opt('C', 13, 'A clear mission/vision communicates purpose and some values, but stays abstract: it does not translate into concrete value for the customer or a real point of difference.'),
          opt('D', 20, 'A distinctive value proposition that states why the company exists, what it stands for, and the concrete value it delivers and for whom: differentiated, specific and consistent with the wider brand.'),
        ],
      },
      {
        id: 3,
        area: 'Team & Leadership',
        weight: 25,
        question:
          'Does the page show the real people behind the brand (named leadership and key staff with roles and credentials) to support trust and E-E-A-T?',
        answers: [
          opt('A', 0, 'No people. The company is presented as an anonymous corporate voice with no named individuals.'),
          opt('B', 8, 'A few names or titles appear (e.g. our founder) but with no photos, bios or credentials: minimal and impersonal.'),
          opt('C', 17, 'Named leaders or team members are shown with photos and roles, but bios are thin or the credentials and expertise that would establish authority are missing.'),
          opt('D', 25, 'Real, named people (founders, leadership, key staff) with photos, clear roles and credentials or experience that establish expertise, ideally linked to fuller profiles, giving the brand a credible human face.'),
        ],
      },
      {
        id: 4,
        area: 'Social Proof',
        weight: 25,
        question:
          'Does the page substantiate the brand\'s claims with external proof: testimonials, clients, press, awards, certifications or meaningful numbers?',
        answers: [
          opt('A', 0, 'No social proof. The page makes claims about itself with nothing external to back them up.'),
          opt('B', 8, 'Token proof only: a couple of unattributed testimonials, a few logos, or vague figures with no source or context.'),
          opt('C', 17, 'Several credible proof points (named testimonials, client logos, awards, stats) are present, but they are generic, dated, or not tied to specific outcomes or relevance.'),
          opt('D', 25, 'Strong, specific and verifiable proof (attributed testimonials, recognisable clients, press mentions, awards, certifications, quantified results) that directly substantiates the brand\'s claims and builds trust.'),
        ],
      },
      {
        id: 5,
        area: 'Contact & Next Steps',
        weight: 15,
        question:
          'Does the page route the reader onward with clear CTAs and surface tangible presence (location, contact details) for conversion and entity signals?',
        answers: [
          opt('A', 0, 'The page is a dead end: no CTA, no contact details, no onward path to products, services or contact.'),
          opt('B', 5, 'A generic link or footer contact exists, but there is no intentional next step from the body and no real-world presence (location, contact) surfaced.'),
          opt('C', 10, 'Clear contact details and at least one onward path are present, but CTAs are weak or generic, or location/NAP signals are incomplete or inconsistent.'),
          opt('D', 15, 'The page guides the reader forward with clear, relevant CTAs (contact, careers, products, demo) and surfaces tangible presence (consistent NAP, location, verifiable contact details), supporting both conversion and entity/local SEO.'),
        ],
      },
    ],
  },
  {
    key: 'listing_articles',
    label: 'Listing of articles',
    questions: [
      {
        id: 1,
        area: 'H1',
        weight: 20,
        question:
          'Does the H1 clearly identify the topic, scope and intent of the article collection, and distinguish it from other listing pages on the site?',
        answers: [
          opt('A', 0, 'H1 is missing, hidden, or generic and shared across listing pages. Examples: Blog, News, Articles, Latest posts.'),
          opt('B', 6, 'H1 names the section with a brand-internal or label-only term (e.g. Insights, The Hub) without communicating the topic or what content the user will find.'),
          opt('C', 13, 'H1 names the topic clearly but uses generic phrasing not aligned to how users search for the theme, or does not differentiate from adjacent category/listing pages.'),
          opt('D', 20, 'H1 is unique and descriptive: it names the specific topic, signals the type and breadth of content, and aligns naturally with the query a user browsing this theme would type.'),
        ],
      },
      {
        id: 2,
        area: 'Categories',
        weight: 30,
        question:
          'Are articles organized into a clear, search-aligned category structure that helps users and search engines understand the topical scope and reach relevant content?',
        answers: [
          opt('A', 0, 'No category structure. Articles appear in a flat, undifferentiated stream with no thematic grouping or filtering.'),
          opt('B', 10, 'Categories exist but are unclear, overlapping or internally labelled; they do not map to how users think about the topic, are too few or too many to be useful, or the links are non-descriptive or not crawlable.'),
          opt('C', 20, 'Categories are present and reasonably aligned to user topics with crawlable links, but the taxonomy has gaps or redundancy: some categories overlap, relevant sub-topics are missing, or the parent/child hierarchy is not clearly expressed.'),
          opt('D', 30, 'Categories form a clear, search-aligned taxonomy: mutually distinct, mapped to real search demand, with descriptive anchors and a logical hierarchy. Each category functions as a strong topical hub, supporting both user navigation and crawl/indexation logic.'),
        ],
      },
      {
        id: 3,
        area: 'TAGS',
        weight: 15,
        question:
          'Are tags used as a deliberate, governed secondary discovery layer that adds value without creating thin or duplicate index pages?',
        answers: [
          opt('A', 0, 'No tags, or tags used chaotically: auto-generated, near-duplicate, hundreds of single-use tags creating thin indexable pages and crawl/index bloat.'),
          opt('B', 5, 'Tags exist but are ungoverned: duplicates, overlap with categories, no clear distinction between tag and category, and tag pages are thin or low value.'),
          opt('C', 10, 'Tags are reasonably curated and help cross-cutting discovery, but governance is incomplete: some redundancy with categories, inconsistent application across articles, or tag-page indexation is not deliberately controlled.'),
          opt('D', 15, 'Tags are a deliberate, governed layer: a controlled vocabulary distinct from categories, applied consistently, supporting cross-topic discovery, with indexation handled intentionally (valuable tag hubs indexed, thin ones noindexed) to avoid dilution.'),
        ],
      },
      {
        id: 4,
        area: 'Intro text',
        weight: 20,
        question:
          'Does the listing page include intro copy that frames the topic and adds search-relevant context, without unnecessarily pushing the article list below the fold?',
        answers: [
          opt('A', 0, 'No intro text. The page jumps straight into the article grid with no topical or contextual framing for users or search engines.'),
          opt('B', 6, 'A short intro exists but is generic boilerplate (e.g. Read our latest articles below) with no topical substance or search value.'),
          opt('C', 13, 'Intro text frames the topic and includes some relevant terminology, but is thin, not fully aligned to search intent, or does not convey the breadth and value of the collection.'),
          opt('D', 20, 'Intro text concisely frames the topic, establishes the page\'s relevance and authority, integrates search-relevant terminology naturally, and orients the user to what they will find, without excessive length that buries the listing.'),
        ],
      },
      {
        id: 5,
        area: 'Engagement Signals',
        weight: 15,
        question:
          'Does the page include elements that encourage interaction and onward movement: new, most popular,  images, dates or excerpts, etc',
        answers: [
          opt('A', 0, 'No engagement affordances: bare titles or links, no previews, images, dates or excerpts, and no clear way to continue browsing.'),
          opt('B', 5, 'Basic listing elements exist (titles, maybe thumbnails), but previews are weak or inconsistent, metadata is missing, and there are no prompts to subscribe, filter or continue the journey.'),
          opt('C', 10, 'Previews include titles, images, excerpts and basic metadata, and pagination works, but engagement is not optimized: weak CTAs, no newsletter or subscription prompt, no surfacing of popular or related content.'),
          opt('D', 15, 'Rich previews (title, image, excerpt, date, author/category), a clean scannable layout, sensible pagination or load-more, and conversion/retention prompts (newsletter signup, related categories, popular articles) that extend the session and support the funnel.'),
        ],
      },
    ],
  },
  {
    // Transcribed AS-IS from 9b: 6 questions numbered 1,2,3,4,6,7 (no #5 —
    // "Use of bolds" was absorbed into #4), max points sum to 85, not 100.
    // See the file header for the full anomaly note and provenance.
    key: 'article',
    label: 'Article',
    questions: [
      {
        id: 1,
        area: 'Author & Date',
        weight: 15,
        question:
          'Does the article clearly attribute authorship and signal freshness, supporting credibility and E-E-A-T?',
        answers: [
          opt('A', 0, 'No author and no date. The article is anonymous and gives no indication of when it was published or updated.'),
          opt('B', 3, 'Author or date is present but minimal: a name with no link or bio, or a date with no distinction between published and updated.'),
          opt('C', 7, 'Author and date are present with some authority (e.g. linked author or short bio), but incomplete: no stated credentials, or no visible last-updated date.'),
          opt('D', 10, 'Named author with linked bio and credentials that establish expertise, plus a clear published date and visible last-updated date, ideally reinforced with structured data.'),
        ],
      },
      {
        id: 2,
        area: 'Clear Heading Hierarchy',
        weight: 25,
        question:
          'Does the article use a single H1 and a logical, descriptive H2/H3 structure that maps its content and supports scanning?',
        answers: [
          opt('A', 0, 'No real heading structure: multiple H1s, styled text used instead of true headings, or no logical order at all.'),
          opt('B', 8, 'Headings exist but are inconsistent: levels are skipped, generic labels are used, or headings are applied for styling rather than structure.'),
          opt('C', 17, 'Hierarchy is mostly logical and correctly nested, but headings are generic or not search-aligned, limiting scannability and snippet potential.'),
          opt('D', 25, 'Single H1 with cleanly nested, descriptive H2/H3 headings that follow the article\'s logic, aid scanning, and align with how users search, supporting featured snippet eligibility.'),
        ],
      },
      {
        id: 3,
        area: 'Table of content',
        weight: 10,
        question:
          'For longer articles, is there a functional table of contents that helps users navigate to relevant sections?',
        answers: [
          opt('A', 0, 'No table of contents on an article long enough to need one. Users must scroll through the entire piece to find a section.'),
          opt('B', 3, 'A list of sections exists but is not anchored or clickable, or a ToC is present where it adds no value or is poorly placed.'),
          opt('C', 7, 'A working anchored ToC exists but is incomplete: it misses sections, does not match the actual headings, or lacks an active-state for orientation.'),
          opt('D', 10, 'A complete anchored ToC mirrors the heading structure with working jump links, well placed (and ideally sticky or collapsible), aiding navigation and supporting jump-to links in search.'),
        ],
      },
      {
        id: 4,
        area: 'Walls of text',
        weight: 20,
        question:
          'Is the content broken into scannable, comfortably readable blocks rather than dense, unbroken paragraphs? Is emphasis used strategically to highlight key points and improve scannability, without over-bolding or keyword stuffing?',
        answers: [
          opt('A', 0, 'Dense walls of text: very long paragraphs, little spacing, exhausting and discouraging to read.'),
          opt('B', 5, 'Some breaks exist but long paragraphs still dominate, with little visual rhythm or use of supporting formatting.'),
          opt('C', 10, 'Paragraph length is mostly reasonable, but pockets of dense text or uneven formatting interrupt the reading flow.'),
          opt('D', 15, 'Consistently short, scannable paragraphs with generous whitespace and varied formatting (lists, callouts, media) that make the article comfortable to read on any device.'),
        ],
      },
      {
        id: 6,
        area: 'Suggested articles',
        weight: 10,
        question:
          'Does the article surface relevant suggested or related content that extends the session and reinforces topical depth?',
        answers: [
          opt('A', 0, 'No suggested or related content. The article is a dead end with no onward reading path.'),
          opt('B', 3, 'A related block exists but is generic or auto-generated, with suggestions that are off-topic or only loosely connected.'),
          opt('C', 7, 'Suggestions are relevant but the selection is not fully intentional: weak previews or anchors, suboptimal placement, or some obvious related pieces missing.'),
          opt('D', 10, 'Curated, topically relevant suggestions with strong previews, placed to extend the session and reinforce the article\'s topical cluster.'),
        ],
      },
      {
        id: 7,
        area: 'Relevant internal linking',
        weight: 20,
        question:
          'Does the body of the article include contextual internal links with descriptive anchors that support the reader\'s journey and topical clusters?',
        answers: [
          opt('A', 0, 'No contextual internal links beyond standard navigation. The body offers no path to related content.'),
          opt('B', 5, 'A few links exist but anchors are generic, links are not contextually relevant, or they point mainly to the homepage or commercial pages.'),
          opt('C', 10, 'Relevant in-body links with reasonable anchors are present, but coverage is incomplete or the editorial logic connecting them is inconsistent.'),
          opt('D', 15, 'A strategic set of in-body internal links with descriptive anchors to related articles, pillar or hub pages and supporting content, reinforcing topical clusters and guiding the reader forward.'),
        ],
      },
    ],
  },
]

/** All template keys, in bank (9b) order. */
export const CONTENT_TEMPLATE_KEYS: ContentTemplateKey[] = CONTENT_BANK.map((t) => t.key)

const BY_KEY = new Map<string, ContentTemplate>(CONTENT_BANK.map((t) => [t.key, t]))

export function getContentTemplate(key: string): ContentTemplate | undefined {
  return BY_KEY.get(key)
}

export function isContentTemplateKey(key: string): key is ContentTemplateKey {
  return BY_KEY.has(key)
}

/**
 * Max points of one template = sum of the D answers. 100 for every template
 * except Article (85 — see the header anomaly note); the scoring engine
 * divides by THIS, never by a hardcoded 100.
 */
export function templateMaxPoints(template: ContentTemplate): number {
  return template.questions.reduce(
    (sum, q) => sum + Math.max(...q.answers.map((a) => a.points)),
    0,
  )
}
