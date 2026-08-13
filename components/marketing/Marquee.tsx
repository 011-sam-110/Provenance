import type { CSSProperties } from "react";

/**
 * The wall of publishers, drifting. Two rows in opposite directions so the eye
 * cannot lock onto a single pass and count them.
 *
 * The list comes from the registry's own attribution strings, so this is a real
 * roll-call of who published the data, not a logo garden. Each row is rendered
 * twice back to back and translated -50%, which is what makes the loop seamless.
 */
export default function Marquee({ publishers }: { publishers: string[] }) {
  if (publishers.length < 4) return null;

  const half = Math.ceil(publishers.length / 2);
  const rows = [publishers.slice(0, half), publishers.slice(half)];

  return (
    <div className="pv-marquee" aria-hidden="true">
      {rows.map((row, i) => (
        <div
          key={i}
          className={`pv-marquee-row${i === 1 ? " pv-rev" : ""}`}
          style={{ "--pv-dur": `${34 + i * 10}s` } as CSSProperties}
        >
          {[...row, ...row].map((name, j) => (
            <span key={`${name}-${j}`}>{name}</span>
          ))}
        </div>
      ))}
    </div>
  );
}
