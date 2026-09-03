/**
 * Hand-authored constellation line figures ("asterisms") for the hero sky map.
 *
 * SOURCE AND WHY THIS IS HAND-AUTHORED RATHER THAN DOWNLOADED. The obvious source for
 * this kind of data is Stellarium's `constellationship.fab`. Stellarium is GPL-2.0-only;
 * this repository is AGPL-3.0-only. GPL-2.0-only code cannot be combined into an
 * AGPL-3.0-only work, so that file — and any derivative of it (d3-celestial's own line
 * data is itself sourced from Stellarium) — cannot be used here. Nothing in this file
 * was downloaded from Stellarium, d3-celestial, or any other constellation-line project.
 *
 * What follows is an original selection of standard, centuries-old asterisms (Orion's
 * belt, the Plough, the Great Square...) expressed as pairs of Bayer designations — the
 * designations themselves are astronomical nomenclature, not anyone's copyrightable
 * expression. Every segment below was checked, star by star, against the actual
 * `names` block of `public/sky/naked-eye.json` (compiled 2026-09-03 from HYG v4.4,
 * CC BY-SA 4.0 — see that file's `_provenance`), and every segment's on-sky length was
 * computed from the catalogue's own ra/dec before being kept — see
 * `tests/unit/sky-constellations.test.ts`, which re-derives those lengths independently
 * rather than trusting this file's authorship.
 *
 * SELECTION. All 22 figures come from the brief's own candidate list; none were added
 * beyond it, and none of that list were dropped — each checked out geometrically
 * (every segment’s catalogue-derived separation came out well under the 45-degree
 * "wrong constellation" threshold; the largest is Canopus-Miaplacidus in Carina at
 * ~25.7 deg, and most segments are under 10 deg).
 *
 * DELIBERATELY LEFT OUT, and why:
 *   - Any constellation beyond the given 22 (Hercules, Draco, Virgo, Cetus, Ophiuchus,
 *     Cepheus, Piscis Austrinus, Vela, Puppis, Corvus, Lepus, Canis Minor, Triangulum,
 *     the zodiac's fainter half, etc.) — not asked for, and several of those have line
 *     figures this author is not confident enough of to hand-verify star-by-star.
 *   - Alcor next to Mizar (UMa) — a naming/eyesight footnote, not a line.
 *   - The Pleiades (M45) joined by lines into Taurus — the cluster is conventionally
 *     drawn as a separate compact clump, not stitched onto the Bull's horns/V.
 *   - Orion's head (Lambda Ori / Meissa) — no line to it; the shoulder-belt-leg outline
 *     below is the confident core of the figure and a head spur adds risk for no gain.
 *   - Lyra's full parallelogram (the fourth corner, Delta/Zeta Lyrae) — kept to the
 *     high-confidence Vega-Sheliak-Sulafat triangle rather than guess the exact
 *     quadrilateral corner.
 *   - Aquila's wings (Eta, Theta Aquilae) — the head-and-spine line (Tarazed-Altair-
 *     Alshain, Altair-Okab-Delta-Lambda) is solid; this author was not confident enough
 *     of exactly where the wing stars attach to include them.
 *   - Bootes' fainter tail (Eta Muphrid, Rho) — kept to the five-star kite everyone
 *     agrees on.
 *   - Carina's "False Cross" — that asterism is shared with Vela, which is not one of
 *     the 22 catalogued constellations here; Carina is instead given a simple keel line
 *     through its own three next-brightest stars.
 *
 * STAR REFERENCES. Every `StarRef` below uses the bare Bayer letter (e.g. "Alp"), and
 * `resolveStarRef` is what upgrades that to the right catalogue row when a star has
 * numbered components (e.g. Rigil Kentaurus is only ever catalogued as "Alp-1"). Four
 * segments pin an explicit component suffix instead, because the bare letter's
 * lowest-numbered component is a DIFFERENT, unnamed star from the one actually intended:
 * CMa's Omicron-2 (near Wezen; Omicron-1 is a different, unrelated foreground star),
 * Tau's Theta-2 (Chamukuy, the Hyades V star; Theta-1 is fainter and off the V), Sco's
 * Zeta-2 (the scorpion's-tail star; Zeta-1 is a different, dimmer star), and Sgr's
 * Gamma-2 (Alnasl, the Teapot's spout tip; Gamma-1 is an unnamed, fainter star). In each
 * case the "prefer the lowest component" rule in `resolveStarRef` would silently pick
 * the wrong star, so the intended one is pinned by name instead.
 */

/** A star referenced by its Bayer letter and IAU constellation abbreviation, e.g. ["Alp","Ori"]. */
export type StarRef = readonly [bayer: string, constellation: string];

export type Asterism = {
  /** Human name of the figure, e.g. "Orion", "The Plough". */
  readonly name: string;
  /** IAU 3-letter constellation abbreviation, e.g. "Ori". */
  readonly con: string;
  /** Line segments. Each segment joins two stars. */
  readonly lines: readonly (readonly [StarRef, StarRef])[];
};

export const ASTERISMS: readonly Asterism[] = [
  {
    name: "Orion",
    con: "Ori",
    lines: [
      [["Alp", "Ori"], ["Gam", "Ori"]], // Betelgeuse - Bellatrix (shoulders)
      [["Gam", "Ori"], ["Del", "Ori"]], // Bellatrix - Mintaka
      [["Alp", "Ori"], ["Zet", "Ori"]], // Betelgeuse - Alnitak
      [["Del", "Ori"], ["Eps", "Ori"]], // Mintaka - Alnilam (belt)
      [["Eps", "Ori"], ["Zet", "Ori"]], // Alnilam - Alnitak (belt)
      [["Del", "Ori"], ["Bet", "Ori"]], // Mintaka - Rigel
      [["Zet", "Ori"], ["Kap", "Ori"]], // Alnitak - Saiph
      [["Eps", "Ori"], ["Iot", "Ori"]], // Alnilam - Hatysa (sword)
    ],
  },
  {
    name: "The Plough",
    con: "UMa",
    lines: [
      [["Alp", "UMa"], ["Bet", "UMa"]], // Dubhe - Merak
      [["Bet", "UMa"], ["Gam", "UMa"]], // Merak - Phecda
      [["Gam", "UMa"], ["Del", "UMa"]], // Phecda - Megrez
      [["Del", "UMa"], ["Alp", "UMa"]], // Megrez - Dubhe (closes the bowl)
      [["Del", "UMa"], ["Eps", "UMa"]], // Megrez - Alioth (handle)
      [["Eps", "UMa"], ["Zet", "UMa"]], // Alioth - Mizar
      [["Zet", "UMa"], ["Eta", "UMa"]], // Mizar - Alkaid
    ],
  },
  {
    name: "Ursa Minor",
    con: "UMi",
    lines: [
      [["Alp", "UMi"], ["Del", "UMi"]], // Polaris - Yildun
      [["Del", "UMi"], ["Eps", "UMi"]],
      [["Eps", "UMi"], ["Zet", "UMi"]],
      [["Zet", "UMi"], ["Eta", "UMi"]],
      [["Eta", "UMi"], ["Gam", "UMi"]], // - Pherkad
      [["Gam", "UMi"], ["Bet", "UMi"]], // Pherkad - Kochab
      [["Bet", "UMi"], ["Zet", "UMi"]], // closes the bowl
    ],
  },
  {
    name: "Cassiopeia",
    con: "Cas",
    lines: [
      [["Bet", "Cas"], ["Alp", "Cas"]], // Caph - Schedar
      [["Alp", "Cas"], ["Gam", "Cas"]], // Schedar - Tsih
      [["Gam", "Cas"], ["Del", "Cas"]], // Tsih - Ruchbah
      [["Del", "Cas"], ["Eps", "Cas"]], // Ruchbah - Segin
    ],
  },
  {
    name: "The Northern Cross",
    con: "Cyg",
    lines: [
      [["Alp", "Cyg"], ["Gam", "Cyg"]], // Deneb - Sadr (long axis)
      [["Gam", "Cyg"], ["Bet", "Cyg"]], // Sadr - Albireo
      [["Del", "Cyg"], ["Gam", "Cyg"]], // Fawaris - Sadr (cross axis)
      [["Gam", "Cyg"], ["Eps", "Cyg"]], // Sadr - Aljanah
    ],
  },
  {
    name: "Lyra",
    con: "Lyr",
    lines: [
      [["Alp", "Lyr"], ["Bet", "Lyr"]], // Vega - Sheliak
      [["Alp", "Lyr"], ["Gam", "Lyr"]], // Vega - Sulafat
      [["Bet", "Lyr"], ["Gam", "Lyr"]], // Sheliak - Sulafat
    ],
  },
  {
    name: "Aquila",
    con: "Aql",
    lines: [
      [["Gam", "Aql"], ["Alp", "Aql"]], // Tarazed - Altair
      [["Alp", "Aql"], ["Bet", "Aql"]], // Altair - Alshain
      [["Alp", "Aql"], ["Zet", "Aql"]], // Altair - Okab (spine)
      [["Zet", "Aql"], ["Del", "Aql"]],
      [["Del", "Aql"], ["Lam", "Aql"]],
    ],
  },
  {
    name: "Bootes",
    con: "Boo",
    lines: [
      [["Alp", "Boo"], ["Eps", "Boo"]], // Arcturus - Izar
      [["Eps", "Boo"], ["Del", "Boo"]], // Izar - Qigong
      [["Del", "Boo"], ["Bet", "Boo"]], // Qigong - Nekkar
      [["Bet", "Boo"], ["Gam", "Boo"]], // Nekkar - Seginus
      [["Gam", "Boo"], ["Alp", "Boo"]], // Seginus - Arcturus (closes the kite)
    ],
  },
  {
    name: "Leo",
    con: "Leo",
    lines: [
      // The Sickle (head)
      [["Alp", "Leo"], ["Eta", "Leo"]], // Regulus - Eta Leo
      [["Eta", "Leo"], ["Gam", "Leo"]], // - Algieba
      [["Gam", "Leo"], ["Zet", "Leo"]], // Algieba - Adhafera
      [["Zet", "Leo"], ["Mu", "Leo"]], // Adhafera - Rasalas
      [["Mu", "Leo"], ["Eps", "Leo"]], // Rasalas - Ras Elased Australis
      // The body
      [["Alp", "Leo"], ["Bet", "Leo"]], // Regulus - Denebola
      [["Bet", "Leo"], ["Del", "Leo"]], // Denebola - Zosma
      [["Del", "Leo"], ["The", "Leo"]], // Zosma - Chertan
      [["The", "Leo"], ["Alp", "Leo"]], // Chertan - Regulus (closes the body)
    ],
  },
  {
    name: "Taurus",
    con: "Tau",
    lines: [
      // The Hyades V
      [["Alp", "Tau"], ["Gam", "Tau"]], // Aldebaran - Prima Hyadum
      [["Gam", "Tau"], ["The-2", "Tau"]], // - Chamukuy (pinned: Theta-1 is off the V)
      [["The-2", "Tau"], ["Del", "Tau"]], // - Secunda Hyadum
      [["Alp", "Tau"], ["Eps", "Tau"]], // Aldebaran - Ain (other side of the V)
      // The horns
      [["Alp", "Tau"], ["Bet", "Tau"]], // Aldebaran - Elnath
      [["Bet", "Tau"], ["Zet", "Tau"]], // Elnath - Tianguan
    ],
  },
  {
    name: "Gemini",
    con: "Gem",
    lines: [
      [["Bet", "Gem"], ["Alp", "Gem"]], // Pollux - Castor (heads)
      [["Bet", "Gem"], ["Mu", "Gem"]], // Pollux's line down through the body
      [["Mu", "Gem"], ["Eps", "Gem"]],
      [["Eps", "Gem"], ["Gam", "Gem"]], // - Alhena (foot)
      [["Alp", "Gem"], ["Tau", "Gem"]], // Castor's line down through the body
      [["Tau", "Gem"], ["Iot", "Gem"]], // (foot)
    ],
  },
  {
    name: "Canis Major",
    con: "CMa",
    lines: [
      [["Bet", "CMa"], ["Alp", "CMa"]], // Mirzam - Sirius (nose)
      [["Alp", "CMa"], ["Gam", "CMa"]], // Sirius - Muliphein (neck)
      [["Alp", "CMa"], ["Omi-2", "CMa"]], // Sirius - Omicron-2 (spine; pinned, see header)
      [["Omi-2", "CMa"], ["Del", "CMa"]], // - Wezen
      [["Del", "CMa"], ["Eps", "CMa"]], // Wezen - Adhara (hip)
      [["Del", "CMa"], ["Eta", "CMa"]], // Wezen - Aludra (tail)
    ],
  },
  {
    name: "Scorpius",
    con: "Sco",
    lines: [
      [["Del", "Sco"], ["Bet", "Sco"]], // Dschubba - Acrab (head/claws)
      [["Del", "Sco"], ["Pi", "Sco"]], // Dschubba - Fang
      [["Del", "Sco"], ["Sig", "Sco"]], // Dschubba - Alniyat
      [["Sig", "Sco"], ["Alp", "Sco"]], // Alniyat - Antares
      [["Alp", "Sco"], ["Tau", "Sco"]], // Antares - Paikauhale (curving body)
      [["Tau", "Sco"], ["Eps", "Sco"]], // - Larawag
      [["Eps", "Sco"], ["Mu", "Sco"]], // - Xamidimura
      [["Mu", "Sco"], ["Zet-2", "Sco"]], // - Zeta-2 (pinned, see header)
      [["Zet-2", "Sco"], ["Eta", "Sco"]],
      [["Eta", "Sco"], ["The", "Sco"]], // - Sargas
      [["The", "Sco"], ["Iot", "Sco"]],
      [["Iot", "Sco"], ["Kap", "Sco"]],
      [["Kap", "Sco"], ["Lam", "Sco"]], // - Shaula
      [["Lam", "Sco"], ["Ups", "Sco"]], // Shaula - Lesath (the stinger's "cat's eyes")
    ],
  },
  {
    name: "The Southern Cross",
    con: "Cru",
    lines: [
      [["Alp", "Cru"], ["Gam", "Cru"]], // Acrux - Gacrux (long bar)
      [["Bet", "Cru"], ["Del", "Cru"]], // Mimosa - Imai (cross bar)
    ],
  },
  {
    name: "Centaurus",
    con: "Cen",
    lines: [
      [["Alp", "Cen"], ["Bet", "Cen"]], // Rigil Kentaurus - Hadar (the Pointers)
      [["Bet", "Cen"], ["Eps", "Cen"]], // into the body
      [["Eps", "Cen"], ["Zet", "Cen"]], // - Leepwal
      [["Zet", "Cen"], ["Eta", "Cen"]], // toward the head
      [["Eta", "Cen"], ["The", "Cen"]], // - Menkent (head)
      [["Zet", "Cen"], ["Gam", "Cen"]], // toward the hindquarters
      [["Gam", "Cen"], ["Del", "Cen"]],
    ],
  },
  {
    name: "Perseus",
    con: "Per",
    lines: [
      [["Alp", "Per"], ["Gam", "Per"]], // Mirfak, radiating out to...
      [["Gam", "Per"], ["Del", "Per"]],
      [["Alp", "Per"], ["Bet", "Per"]], // ...Algol...
      [["Bet", "Per"], ["Rho", "Per"]],
      [["Alp", "Per"], ["Eps", "Per"]], // ...the sword arm...
      [["Eps", "Per"], ["Xi", "Per"]], // - Menkib
      [["Alp", "Per"], ["Iot", "Per"]], // ...and a leg.
      [["Iot", "Per"], ["Kap", "Per"]], // - Misam
    ],
  },
  {
    name: "Andromeda",
    con: "And",
    lines: [
      [["Alp", "And"], ["Del", "And"]], // Alpheratz -
      [["Del", "And"], ["Bet", "And"]], // - Mirach
      [["Bet", "And"], ["Gam", "And"]], // Mirach - Almach
    ],
  },
  {
    name: "The Great Square",
    con: "Peg",
    lines: [
      // Markab - Scheat - Alpheratz - Algenib, walking the square's perimeter.
      // Alpheratz is Alpha Andromedae, historically also "Delta Pegasi" — the shared
      // corner is a real, well-known fact about the figure, not an error.
      [["Alp", "Peg"], ["Bet", "Peg"]], // Markab - Scheat
      [["Bet", "Peg"], ["Alp", "And"]], // Scheat - Alpheratz
      [["Alp", "And"], ["Gam", "Peg"]], // Alpheratz - Algenib
      [["Gam", "Peg"], ["Alp", "Peg"]], // Algenib - Markab (closes the square)
      // The neck and a foreleg, off the square.
      [["Alp", "Peg"], ["Eps", "Peg"]], // Markab - Enif
      [["Eps", "Peg"], ["The", "Peg"]], // - Biham
      [["The", "Peg"], ["Zet", "Peg"]], // - Homam
      [["Bet", "Peg"], ["Eta", "Peg"]], // Scheat - Matar
    ],
  },
  {
    name: "Auriga",
    con: "Aur",
    lines: [
      [["Alp", "Aur"], ["Bet", "Aur"]], // Capella - Menkalinan
      [["Bet", "Aur"], ["The", "Aur"]], // - Mahasim
      [["The", "Aur"], ["Iot", "Aur"]], // - Hassaleh
      [["Iot", "Aur"], ["Alp", "Aur"]], // closes the pentagon back to Capella
      [["Alp", "Aur"], ["Eta", "Aur"]], // "The Kids", next to Capella
      [["Eta", "Aur"], ["Zet", "Aur"]], // Haedus - Saclateni
    ],
  },
  {
    name: "The Teapot",
    con: "Sgr",
    lines: [
      // Body and lid
      [["Del", "Sgr"], ["Eps", "Sgr"]], // Kaus Media - Kaus Australis
      [["Eps", "Sgr"], ["Sig", "Sgr"]], // - Nunki
      [["Sig", "Sgr"], ["Phi", "Sgr"]],
      [["Phi", "Sgr"], ["Lam", "Sgr"]], // - Kaus Borealis
      [["Lam", "Sgr"], ["Del", "Sgr"]], // closes the lid back to Kaus Media
      // Spout
      [["Gam-2", "Sgr"], ["Del", "Sgr"]], // Alnasl - Kaus Media (pinned, see header)
      // Handle
      [["Sig", "Sgr"], ["Zet", "Sgr"]], // Nunki - Ascella
      [["Zet", "Sgr"], ["Tau", "Sgr"]],
      [["Tau", "Sgr"], ["Phi", "Sgr"]], // handle rejoins the body at Phi
    ],
  },
  {
    name: "Carina",
    con: "Car",
    lines: [
      [["Alp", "Car"], ["Bet", "Car"]], // Canopus - Miaplacidus
      [["Bet", "Car"], ["Eps", "Car"]], // - Avior
      [["Eps", "Car"], ["Iot", "Car"]], // - Aspidiske (keel line)
    ],
  },
  {
    name: "Corona Borealis",
    con: "CrB",
    lines: [
      // A single open arc, not a closed loop.
      [["The", "CrB"], ["Bet", "CrB"]], // Guansuo - Nusakan
      [["Bet", "CrB"], ["Alp", "CrB"]], // - Alphecca
      [["Alp", "CrB"], ["Gam", "CrB"]], // - Baltesha
      [["Gam", "CrB"], ["Del", "CrB"]], // - Matrchakre
      [["Del", "CrB"], ["Eps", "CrB"]],
      [["Eps", "CrB"], ["Iot", "CrB"]], // - Aurwandilsta
    ],
  },
];

/**
 * Resolves a StarRef to an index into the catalogue's `stars` array, or -1.
 *
 * Tolerates a Bayer component suffix on the catalogue side even when `ref`'s bayer is
 * bare: "Alp" matches a catalogue row whose `b` is "Alp", "Alp-1", or "Alp1" (HYG only
 * ever emits the hyphenated form; the bare-digit form is tolerated too since nothing
 * in the type guarantees which shows up). Among candidates: an EXACT string match on
 * `b` always wins over a component match; among exact matches (a handful of catalogue
 * rows share one literal "b" for an unresolved binary, e.g. Mizar), the brightest wins;
 * among component matches, the LOWEST-numbered component wins, and the brightest breaks
 * a tie there too. This is why four segments above pin an explicit "-2" suffix — for
 * those specific stars the lowest component is a different, unnamed star.
 */
export function resolveStarRef(
  ref: StarRef,
  names: ReadonlyMap<number, { b?: string; c?: string }>,
  magOf: (i: number) => number,
): number {
  const [bayer, con] = ref;

  let bestExactIdx = -1;
  let bestExactMag = Infinity;

  let bestCompIdx = -1;
  let bestCompNum = Infinity;
  let bestCompMag = Infinity;

  for (const [i, e] of names) {
    if (!e.b || e.c !== con) continue;

    if (e.b === bayer) {
      const m = magOf(i);
      if (m < bestExactMag) {
        bestExactIdx = i;
        bestExactMag = m;
      }
      continue;
    }

    if (bestExactIdx !== -1) continue; // an exact match always beats a component match

    // "Bayer-N" (HYG's own form) or "BayerN" (tolerated defensively).
    const hyphen = e.b.match(/^(.*)-(\d+)$/);
    const bare = hyphen ? null : e.b.match(/^(.*?)(\d+)$/);
    const base = hyphen ? hyphen[1] : bare ? bare[1] : null;
    const num = hyphen ? Number(hyphen[2]) : bare ? Number(bare[2]) : NaN;
    if (base !== bayer) continue;

    const m = magOf(i);
    if (num < bestCompNum || (num === bestCompNum && m < bestCompMag)) {
      bestCompIdx = i;
      bestCompNum = num;
      bestCompMag = m;
    }
  }

  return bestExactIdx !== -1 ? bestExactIdx : bestCompIdx;
}
