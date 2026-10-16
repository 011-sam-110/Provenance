// OSM rows tagged `power=plant` + `plant:source=nuclear` that this layer must NOT show
// as a nuclear power plant. Each entry names its reason. Found by the source audit of
// 2026-10-16, which matched every row against Global Energy Monitor's operating sites:
// 43 of 216 rows were not near one, and these are the ones that are not a power
// station at all (a retired or unfinished POWER plant is not listed here: it stays
// on the layer and says its status, from Wikidata).
//
// Keys are `<type>/<id>` as in the OSM URL. A row is dropped from the live read and
// from the snapshot alike, so a re-harvest cannot bring one back.
export const NUCLEAR_DENYLIST: Readonly<Record<string, string>> = {
  // Vandalism. Served by prod on 2026-10-16 near Chornobyl as "Подача енергии к
  // простате рака", operator "чатыре рака". Reverted in OSM by the 2026-09-21 planet,
  // listed so a stale mirror or snapshot cannot bring it back.
  "way/1547964770": "vandalism (joke name and operator)",
  // Fragments and duplicates.
  "way/219733321": "San Onofre: an unnamed unit fragment titled 'Unit 3', not a plant",
  "way/219733324": "San Onofre: an unnamed unit fragment titled 'Unit 2', not a plant",
  "way/1007084278": "duplicate of Harris Nuclear Plant (way/549051445), 40 m away",
  // Never ran.
  "way/837204459": "Marble Hill: abandoned during construction and dismantled; never operated",
  // Research, fuel-cycle and military sites: real nuclear sites, not power stations.
  "node/8645134918": "Institut Laue-Langevin high-flux research reactor",
  "node/6443114600": "Indústrias Nucleares do Brasil: a fuel-cycle company site, not a power station",
  "way/1354391195": "Pelindaba research reactor (SAFARI-1)",
  "way/1451874401": "Oregon State University research reactor",
  "way/184978095": "Rhode Island Nuclear Science Center research reactor",
  "way/24726877": "'Building TR': Budapest university training reactor",
  "way/124333766": "Centro de Estudios Nucleares La Reina: Chilean research centre",
  "way/306537279": "Centro de Estudios Nucleares Lo Aguirre: Chilean research centre",
  "way/514718570": "NIIAR research reactors (Dimitrovgrad)",
  "way/215133938": "Yongbyon 50 MW reactor: military plutonium site, never completed",
  "way/215200901": "Yongbyon 5 MW reactor: military plutonium production",
  "way/1410158204": "Yongbyon IRT-2000 research reactor",
  "way/187976341": "Khushab Nuclear Complex: military plutonium production",
  "way/187976339": "Khushab heavy-water production plant",
  "way/582056234": "Khushab plutonium production reactors 2 and 3",
  "way/596256457": "Khushab plutonium production reactor 4",
};

/** True when an OSM row (`<type>/<id>`) must not be shown as a power plant. */
export function isDenylistedNuclear(osmId: string): boolean {
  return Object.prototype.hasOwnProperty.call(NUCLEAR_DENYLIST, osmId);
}
