// The six recon cards, as data. PURE, so the "which cards are missing" rule is
// unit-tested without the widget registry or a browser.

/** The six recon cards, in the order the Tools spec lists them. */
export const RECON_TOOL_IDS = [
  "recon:dns",
  "recon:whois",
  "recon:certs",
  "recon:bgp",
  "recon:ports",
  "recon:threat",
] as const;

/** The recon cards a board does not hold yet, in order. */
export function missingReconTools(openTypes: readonly string[]): string[] {
  const open = new Set(openTypes);
  return RECON_TOOL_IDS.filter((id) => !open.has(id));
}
