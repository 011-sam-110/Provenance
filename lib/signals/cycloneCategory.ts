// The Saffir–Simpson colour and label of a tropical cyclone. Its own module so both
// lib/signals/tropical-cyclones.ts and lib/signals/cycloneAgencies.ts can use it
// without importing each other. Valid ONLY for 1-minute sustained winds (NHC, JTWC).

/** Classification + max-wind (kt) → {label, colour} on the Saffir–Simpson scale. */
export function cycloneCategory(classification: string, windKt: number): { label: string; color: string } {
  const c = (classification || "").toUpperCase();
  if (c.includes("HU") || c.includes("MH") || windKt >= 64) {
    if (windKt >= 137) return { label: "Cat 5 hurricane", color: "#581c87" };
    if (windKt >= 113) return { label: "Cat 4 hurricane", color: "#7f1d1d" };
    if (windKt >= 96) return { label: "Cat 3 hurricane", color: "#b91c1c" };
    if (windKt >= 83) return { label: "Cat 2 hurricane", color: "#dc2626" };
    return { label: "Cat 1 hurricane", color: "#ea580c" };
  }
  if (c.includes("TS") || windKt >= 34) return { label: "tropical storm", color: "#f59e0b" };
  return { label: "tropical depression", color: "#eab308" };
}
