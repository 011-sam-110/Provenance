import { cameraProviderLink } from "@/lib/cameras/providerLink";

/**
 * Which of attribution / licence actually have something to say, trimmed and in
 * display order. Pure, so the "what should this render" decision is unit-testable
 * without a DOM — this repo has no React testing library.
 */
export function attributionParts(attribution: string, license: string): string[] {
  return [attribution, license].map((s) => s.trim()).filter(Boolean);
}

// Mandatory upstream credit under a camera snapshot. The operator name links to
// its open-data / home page when we can resolve one (the product rule: every
// selector shows its source as a real clickable link); unknown operators stay
// plain text — honest, never a fabricated link.
//
// A credit with nothing to credit is not a credit, it is punctuation. camslot.tsx
// feeds both attribution and licence as "" for every camera-wall tile (the
// conditions overlay is the credit there), which used to paint a bare " · " in the
// bottom-right corner — the same corner the conditions overlay occupies. Rendering
// null when there is nothing to say, and joining only the parts that exist, fixes
// it at THIS layer rather than in each of the four callers individually.
export function AttributionBadge({ attribution, license }: { attribution: string; license: string }) {
  const parts = attributionParts(attribution, license);
  const src = cameraProviderLink(attribution);
  if (parts.length === 0 && !src) return null;
  return (
    <span className="attribution" data-testid="attribution">
      {parts.join(" · ")}
      {src && (
        <>
          {parts.length > 0 ? " · " : ""}
          <a href={src.url} target="_blank" rel="noreferrer noopener">
            {src.label} ↗
          </a>
        </>
      )}
    </span>
  );
}
