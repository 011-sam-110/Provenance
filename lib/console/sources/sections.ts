// The Sources rail, grouped for reading rather than for the registry.
//
// The registry sorts sources into SIXTEEN groups, which is the right shape for
// the data and the wrong shape for a rail: nine of them hold a single source, so
// a reader scrolling the rail meets nine headings that each introduce one line.
// These six sections fold those groups into the questions someone actually opens
// the console with — what can I see, what is in the air, what is going wrong,
// what is broken, who is fighting, who is suffering.
//
// NOTHING HERE ENUMERATES SOURCES. The mapping is group -> section, and the rows
// are derived from the catalog at call time, so the repo's convention holds: a
// new signal layer is one adapter plus one registry entry, with no edit to this
// file. Only a new GROUP needs a decision here, and
// tests/unit/console-source-sections.test.ts fails when one appears.

import { resolveLabels } from "@/lib/console/sources/labels";
import { SOURCE_CATALOG, type CatalogSource, type SourceKind } from "@/lib/sources/catalog";

export interface SectionDef {
  id: string;
  title: string;
  /** Registry groups folded into this section. */
  groups: readonly string[];
}

/** One source, ready to render as a bullet row. */
export interface SourceRowModel {
  id: string;
  kind: SourceKind;
  /** The shortened, collision-resolved label — see lib/console/sources/labels.ts. */
  label: string;
  /** The registry group, kept so the popover can still say which family it is. */
  group: string;
  color: string;
  attribution: string;
  keyEnv?: string;
}

export interface SourceSectionModel {
  id: string;
  title: string;
  rows: SourceRowModel[];
}

/**
 * The six sections, in reading order.
 *
 * Ground and "Air & space" are a deliberate pair: the first is what a camera on
 * the ground can see, the second is everything above it. The remaining four run
 * from the physical world to the human one.
 */
export const SECTIONS: readonly SectionDef[] = [
  { id: "ground", title: "Ground", groups: ["Cameras"] },
  { id: "air-space", title: "Air & space", groups: ["Aviation", "Space", "Space weather", "Military"] },
  { id: "hazards", title: "Natural hazards & weather", groups: ["Natural hazards", "Weather"] },
  { id: "infrastructure", title: "Infrastructure & networks", groups: ["Infrastructure", "Maritime"] },
  {
    id: "security",
    title: "Conflict & security",
    groups: ["Synthesis", "Intel", "Conflict", "Cyber threat", "Civic safety"],
  },
  { id: "human", title: "Human cost & environment", groups: ["Human cost", "Environment"] },
];

/**
 * Where a source whose group nobody has mapped goes.
 *
 * It is a REAL, VISIBLE section rather than a silent assignment to the nearest
 * plausible heading. Filing an unknown group under "Infrastructure" because it
 * is the biggest would put a source under a heading that makes a claim about it
 * that nobody checked; showing it under "Other" says exactly what is true — it
 * arrived and has not been placed yet. The section is omitted entirely when it
 * has no rows, so in normal operation the rail still shows six headings.
 */
const OTHER: SectionDef = { id: "other", title: "Other", groups: [] };

const SECTION_OF_GROUP = new Map<string, string>();
for (const sec of SECTIONS) for (const g of sec.groups) SECTION_OF_GROUP.set(g, sec.id);

/**
 * Build the rail's sections from a catalog.
 *
 * Takes the catalog as an argument (defaulting to the real one) so a test can
 * feed it a source whose group is unmapped without inventing a registry entry.
 *
 * Rows keep catalog order within a section, which is core-first then registry
 * order — a stable order that nobody has to maintain by hand.
 */
export function buildSourceSections(
  catalog: readonly CatalogSource[] = SOURCE_CATALOG,
): SourceSectionModel[] {
  // Resolved once over the WHOLE catalog: a collision is a property of the set,
  // so a label cannot be shortened correctly one source at a time.
  const labels = resolveLabels(catalog.map((s) => s.label));

  const rowsBySection = new Map<string, SourceRowModel[]>();
  for (const s of catalog) {
    const sectionId = SECTION_OF_GROUP.get(s.group) ?? OTHER.id;
    const row: SourceRowModel = {
      id: s.id,
      kind: s.kind,
      label: labels.get(s.label) ?? s.label,
      group: s.group,
      color: s.color,
      attribution: s.attribution,
      keyEnv: s.keyEnv,
    };
    const list = rowsBySection.get(sectionId);
    if (list) list.push(row);
    else rowsBySection.set(sectionId, [row]);
  }

  const out: SourceSectionModel[] = [];
  for (const sec of [...SECTIONS, OTHER]) {
    const rows = rowsBySection.get(sec.id);
    if (rows?.length) out.push({ id: sec.id, title: sec.title, rows });
  }
  return out;
}
