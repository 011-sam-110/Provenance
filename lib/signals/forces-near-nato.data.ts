// lib/signals/forces-near-nato.data.ts
// CURATED BY HAND: the Russian sites near NATO's borders that Sam's articles name, each
// with what the reporting claims about it. Read by lib/signals/forces-near-nato.ts.
//
// THE RULES EVERY ROW KEEPS (tests/unit/forces-near-nato.test.ts checks the shape):
//  - `quote` is copied from the article, never retyped. Each one here was found by exact
//    string search in the article's text on 2026-10-30. "[...]" marks words left out and
//    "[word]" a word put in; nothing else in a quote differs from the page. 30 words at most.
//  - A quote in Russian keeps the Russian, and `translation` is ours, said as ours in the UI.
//  - `attributedTo` is who the outlet says made the claim. The claim is theirs, not ours.
//  - `date` is the article's publication date, not the date of what it describes.
//  - `at` is the town from the gazetteer named beside it, never the base itself: no article
//    gives a base's own position. A site whose town the reporting does not name has `at: null`
//    and is listed in the widget, never drawn.
//  - A claim about a whole country or region is not a site: it goes in LEFT_OUT with why.
// To add a site: read the article, copy the sentence, check it by string search, look the
// town up on Wikidata, add the row, and move COMPILED_AT in forces-near-nato.ts.

/** The NATO border a site faces, as the reporting frames it. */
export type NatoBorder = "nordic" | "baltic" | "poland-lithuania" | "deep";

export const BORDER_LABEL: Readonly<Record<NatoBorder, string>> = {
  nordic: "Finland and Norway",
  baltic: "Baltic states",
  "poland-lithuania": "Poland and Lithuania",
  deep: "Deep reserve",
};

/** Display order of the border groups, north to south, then the deep reserve. */
export const BORDER_ORDER: readonly NatoBorder[] = ["nordic", "baltic", "poland-lithuania", "deep"];

export interface NatoClaim {
  /** Verbatim from the article. "[...]" = words left out, "[word]" = a word put in. */
  quote: string;
  /** Set when the quote is not English. */
  lang?: "ru";
  /** Our translation of a non-English quote. */
  translation?: string;
  /** The outlet that published the article. */
  outlet: string;
  /** Who the outlet says made the claim. */
  attributedTo: string;
  /** The article's publication date, YYYY-MM-DD. */
  date: string;
  url: string;
  /** The satellite image dates the article gives, when it gives them. */
  imagery?: string;
}

export interface NatoSite {
  id: string;
  /** Our one line for the card, scoped to the quotes: the quotes are the claim. */
  summary: string;
  /** The town, or a description when the reporting names none. */
  name: string;
  /** The unit or facility, when the reporting names one. */
  unit: string | null;
  region: string;
  border: NatoBorder;
  /** The distance to NATO the reporting gives, in its own terms. */
  distance: string | null;
  /** The town's position and the gazetteer entry it came from. Null: listed, never drawn. */
  at: { lat: number; lon: number; gazetteer: string } | null;
  claims: NatoClaim[];
}

export const NATO_SITES: NatoSite[] = [
  {
    id: "buy",
    summary: "New T-90M tanks and BTR-82A carriers arriving since autumn 2025",
    name: "Buy",
    unit: "22nd Central Reserve Base",
    region: "Kostroma Oblast",
    border: "baltic",
    distance: "About 500 km from Estonia and Latvia",
    at: { lat: 58.4833, lon: 41.5167, gazetteer: "Wikidata Q132855" },
    claims: [
      {
        quote: "At the 22nd Central Reserve Base in Buy, Kostroma region, satellite imagery showed newly manufactured T-90M tanks and BTR-82A armored personnel carriers arriving between fall 2025 and October 2026.",
        outlet: "UNITED24 Media",
        attributedTo: "OSINT analysts Mark Krutov, Jompy and Covert Cabal",
        date: "2026-10-19",
        url: "https://united24media.com/war-in-ukraine/russia-emptied-its-armor-reserves-for-ukraine-now-new-tanks-are-piling-up-near-nato-borders-23576",
      },
      {
        quote: "Заполнение базы новой техникой хорошо видно на сравнении ее спутниковых снимков, сделанных год назад, 18 октября 2025-го, и совсем недавно, 3 октября 2026-го.",
        lang: "ru",
        translation: "The base filling with new equipment shows clearly when its satellite images are compared: one taken a year ago, on 18 October 2025, and one very recent, on 3 October 2026.",
        outlet: "Radio Svoboda (RFE/RL)",
        attributedTo: "Radio Svoboda, comparing satellite images",
        date: "2026-10-16",
        url: "https://www.svoboda.org/a/zapasy-dlya-novoy-voyny-rossiya-napolnyaet-novymi-tankami-bazy-hraneniya/33877890.html",
        imagery: "18 Oct 2025 and 3 Oct 2026",
      },
    ],
  },
  {
    id: "topchikha",
    summary: "Refurbished T-72B3 tanks and BMP-2s arriving since June 2026",
    name: "Topchikha",
    unit: "349th Central Tank Storage Base",
    region: "Altai Krai",
    border: "deep",
    distance: "Far from Russia's western borders, as Radio Svoboda puts it",
    at: { lat: 52.8211, lon: 83.1197, gazetteer: "Wikidata Q4460926" },
    claims: [
      {
        quote: "At the 349th Central Storage Base in Topchikha, Altai region, refurbished T-72B3 tanks and BMP-2 infantry fighting vehicles began appearing around June 2026.",
        outlet: "UNITED24 Media",
        attributedTo: "OSINT analysts Mark Krutov, Jompy and Covert Cabal",
        date: "2026-10-19",
        url: "https://united24media.com/war-in-ukraine/russia-emptied-its-armor-reserves-for-ukraine-now-new-tanks-are-piling-up-near-nato-borders-23576",
      },
      {
        quote: "После первых поставок летом – до 78 танков и более сотни БМП – 349-я центральная база хранения танков в последнее время пополнилась еще сильнее.",
        lang: "ru",
        translation: "After the first deliveries in the summer, up to 78 tanks and more than a hundred infantry fighting vehicles, the 349th central tank storage base has lately filled up even more.",
        outlet: "Radio Svoboda (RFE/RL)",
        attributedTo: "Jompy, an OSINT analyst, speaking to Radio Svoboda",
        date: "2026-10-16",
        url: "https://www.svoboda.org/a/zapasy-dlya-novoy-voyny-rossiya-napolnyaet-novymi-tankami-bazy-hraneniya/33877890.html",
      },
    ],
  },
  {
    id: "pechenga",
    summary: "Facilities for an entire division, about 11 km from Norway",
    name: "Pechenga",
    unit: null,
    region: "Murmansk Oblast",
    border: "nordic",
    distance: "About 11 km from Norway",
    at: { lat: 69.5606, lon: 31.2278, gazetteer: "Wikidata Q1013438" },
    claims: [
      {
        quote: "facilities for an entire division in Pechenga, roughly 11 kilometers from Norway",
        outlet: "UNITED24 Media",
        attributedTo: "A June 2026 investigation by DR, NRK, SVT and Delfi",
        date: "2026-10-19",
        url: "https://united24media.com/war-in-ukraine/russia-emptied-its-armor-reserves-for-ukraine-now-new-tanks-are-piling-up-near-nato-borders-23576",
      },
    ],
  },
  {
    id: "kandalaksha",
    summary: "An artillery formation, and building work in a closed military town",
    name: "Kandalaksha",
    unit: null,
    region: "Murmansk Oblast",
    border: "nordic",
    distance: "About 100 km from Finnish Lapland",
    at: { lat: 67.1569, lon: 32.4117, gazetteer: "Wikidata Q144264" },
    claims: [
      {
        quote: "an artillery formation near Kandalaksha close to Finland",
        outlet: "UNITED24 Media",
        attributedTo: "A June 2026 investigation by DR, NRK, SVT and Delfi",
        date: "2026-10-19",
        url: "https://united24media.com/war-in-ukraine/russia-emptied-its-armor-reserves-for-ukraine-now-new-tanks-are-piling-up-near-nato-borders-23576",
      },
      {
        quote: "в июне 2025 года [...] Yle заметили на спутниковых снимках, что Россия начала масштабные строительные работы в закрытом военном городке, расположенном в 100 километрах от границы с финской Лапландией, в Кандалакше.",
        lang: "ru",
        translation: "In June 2025 [...] Yle spotted on satellite images that Russia had begun large-scale construction in a closed military town 100 kilometres from the border with Finnish Lapland, in Kandalaksha.",
        outlet: "Radio Svoboda (RFE/RL)",
        attributedTo: "Yle, Finland's public broadcaster, as reported by Radio Svoboda",
        date: "2026-10-16",
        url: "https://www.svoboda.org/a/zapasy-dlya-novoy-voyny-rossiya-napolnyaet-novymi-tankami-bazy-hraneniya/33877890.html",
        imagery: "June 2025",
      },
    ],
  },
  {
    id: "novaya-vilga",
    summary: "A new 44th Army Corps garrison for about 15,000 troops",
    name: "Novaya Vilga",
    unit: "44th Army Corps garrison",
    region: "Republic of Karelia",
    border: "nordic",
    distance: null,
    at: { lat: 61.8106, lon: 34.1511, gazetteer: "Wikidata Q4321989" },
    claims: [
      {
        quote: "a new 44th Army Corps garrison for approximately 15,000 troops at Novaya Vilga near Petrozavodsk",
        outlet: "UNITED24 Media",
        attributedTo: "A June 2026 investigation by DR, NRK, SVT and Delfi",
        date: "2026-10-19",
        url: "https://united24media.com/war-in-ukraine/russia-emptied-its-armor-reserves-for-ukraine-now-new-tanks-are-piling-up-near-nato-borders-23576",
      },
    ],
  },
  {
    id: "karelia-374",
    summary: "Malva and Giatsint-K artillery arriving since 2025",
    name: "Karelia, town not reported",
    unit: "374th Mobilization Deployment Support Center",
    region: "Republic of Karelia",
    border: "nordic",
    distance: "About 185 km from Finland",
    at: null,
    claims: [
      {
        quote: "In Karelia, the 374th Mobilization Deployment Support Center – about 185 kilometers (115 miles) from Finland – has been receiving Malva artillery systems and Giatsint-K self-propelled guns since 2025.",
        outlet: "Kyiv Post",
        attributedTo: "OSINT analysts Mark Krutov, Jompy and Covert Cabal",
        date: "2026-10-19",
        url: "https://www.kyivpost.com/post/87513",
      },
    ],
  },
  {
    id: "luga",
    summary: "Concentrations of armoured vehicles near Estonia",
    name: "Luga",
    unit: null,
    region: "Leningrad Oblast",
    border: "baltic",
    distance: null,
    at: { lat: 58.7333, lon: 29.8167, gazetteer: "Wikidata Q15322" },
    claims: [
      {
        quote: "concentrations of armored vehicles around Luga near Estonia",
        outlet: "UNITED24 Media",
        attributedTo: "A June 2026 investigation by DR, NRK, SVT and Delfi",
        date: "2026-10-19",
        url: "https://united24media.com/war-in-ukraine/russia-emptied-its-armor-reserves-for-ukraine-now-new-tanks-are-piling-up-near-nato-borders-23576",
      },
    ],
  },
  {
    id: "baltiysk",
    summary: "Naval infantry expanding; S-400 launchers seen raised",
    name: "Baltiysk",
    unit: null,
    region: "Kaliningrad Oblast",
    border: "poland-lithuania",
    distance: null,
    at: { lat: 54.65, lon: 19.9167, gazetteer: "Wikidata Q5660" },
    claims: [
      {
        quote: "Russia is also expanding its naval infantry presence in Baltiysk near Kaliningrad.",
        outlet: "UNITED24 Media",
        attributedTo: "A June 2026 investigation by DR, NRK, SVT and Delfi",
        date: "2026-10-19",
        url: "https://united24media.com/war-in-ukraine/russia-emptied-its-armor-reserves-for-ukraine-now-new-tanks-are-piling-up-near-nato-borders-23576",
      },
      {
        quote: "Using automated image recognition, the company established that launchers had been raised at a mobile position of an S-400 surface-to-air missile system near Baltiysk.",
        outlet: "UA.NEWS",
        attributedTo: "Iceye, a Finnish satellite company, in an unpublished report cited by Frankfurter Allgemeine Zeitung and Interia",
        date: "2026-10-19",
        url: "https://ua.news/en/world/rosiia-buduie-radar-u-kaliningradskii-oblasti-z-dalnistiu-do-3000-km-interia",
      },
    ],
  },
  {
    id: "gvardeysk",
    summary: "A radar being built that may see up to 3,000 km",
    name: "Gvardeysk",
    unit: "Over-the-horizon radar, being built",
    region: "Kaliningrad Oblast",
    border: "poland-lithuania",
    distance: null,
    at: { lat: 54.6667, lon: 21.0833, gazetteer: "Wikidata Q5668" },
    claims: [
      {
        quote: "[Russia] is building an over-the-horizon radar in Gvardeysk, Kaliningrad region, which, according to satellite analysis, may detect aircraft and missiles at distances of up to 3,000 kilometers.",
        outlet: "UA.NEWS",
        attributedTo: "Iceye, a Finnish satellite company, in an unpublished report cited by Frankfurter Allgemeine Zeitung and Interia",
        date: "2026-10-19",
        url: "https://ua.news/en/world/rosiia-buduie-radar-u-kaliningradskii-oblasti-z-dalnistiu-do-3000-km-interia",
      },
    ],
  },
];

/** Named in the articles but not a site on this layer, and why. Shown in the expanded view. */
export const LEFT_OUT: { name: string; why: string; url: string }[] = [
  { name: "6018th storage base", why: "The reporting gives no place for it.", url: "https://united24media.com/war-in-ukraine/russia-emptied-its-armor-reserves-for-ukraine-now-new-tanks-are-piling-up-near-nato-borders-23576" },
  { name: "Belarus: mobilisation, village militias, readiness for war by 2027", why: "Claims about a whole country, not a site.", url: "https://meduza.io/en/news/2026/09/11/up-to-mobilization-belarusian-president-lukashenko-says-it-s-time-to-shake-up-belarus-s-army" },
  { name: "New barracks and depots in Karelia and the Leningrad Military District", why: "Iceye names a region, not a site.", url: "https://ua.news/en/world/rosiia-buduie-radar-u-kaliningradskii-oblasti-z-dalnistiu-do-3000-km-interia" },
  { name: "Kaliningrad Oblast's missiles and ground forces", why: "Claims about the whole region; the CNA piece is from 2023.", url: "https://www.cna.org/our-media/indepth/2023/05/kaliningrad-impregnable-fortress-or-russian-Alamo" },
];
