import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The console's token block had no guard, which is exactly how a 4.15:1 accent
 * shipped as the TEXT colour in 92 rules while the block's own comment claimed the
 * palette "keeps the identity and the contrast".
 *
 * Two of these assertions are about colour and three are about drift. The drift
 * ones matter as much: `--tnx-fs` has five consumers, while the console region
 * of this stylesheet holds 88 hard-coded `font-size: Npx` declarations and 20
 * `border-radius: 0` ones. Changing the token moves almost nothing, so a
 * type-scale change can be "done" while the console looks identical. A literal
 * is how a token dies.
 */

const CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

/** Comments hold braces and prose that would derail any brace walk. */
const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of a `{ … }` block whose selector line contains `needle`. */
function blockAfter(needle: string): string {
  const at = BARE.indexOf(needle);
  expect(at, `selector not found: ${needle}`).toBeGreaterThan(-1);
  const open = BARE.indexOf("{", at);
  const close = BARE.indexOf("\n}", open);
  return BARE.slice(open, close);
}

/**
 * ONE PALETTE, WHERE THERE WERE TWO.
 *
 * This held both skins and every colour assertion below walks it, which is why they
 * are still worded "in BOTH skins" in places. The dark skin was removed and the light
 * values were folded into `.tn-terminal` itself, so there is one entry now — and it
 * stays a LIST rather than being inlined, because the assertions it feeds are the
 * ones that caught a 4.15:1 accent shipping as the default text colour in 92 rules,
 * and unrolling six loops into six straight-line tests to save one array is how a
 * guard like that gets weakened by accident.
 */
const SKINS = [["light", "\n.tn-terminal {"]] as const;

function token(block: string, name: string): string {
  const hex = new RegExp(`${name}:\\s*(#[0-9a-f]{3,8})`, "i").exec(block)?.[1];
  expect(hex, `no ${name} hex in block`).toBeTruthy();
  return (hex as string).toLowerCase();
}

/** WCAG 2.x relative luminance and contrast ratio. */
function ratio(a: string, b: string): number {
  const lum = (h: string) => {
    const n = h.replace("#", "");
    const ch = [0, 2, 4].map((i) => {
      const c = parseInt(n.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * Every declaration in the console REGION of the stylesheet.
 *
 * Scoped by region, not by selector, and the difference is not academic: I wrote
 * this the selector way first and it found 38 literals. The region holds 88. The
 * other 50 sit in rules like `.tn-rail-title` and `.tn-cw-count`, which are
 * console chrome but never spell `.tn-terminal` in their own selector, so a
 * selector-scoped guard would have declared the sweep complete with more than
 * half the console still hard-coded — the exact failure this test exists to stop.
 *
 * The boundary is the file's own: the `OPENDATA TERMINAL` banner, whose text
 * states "Everything below is scoped to `.tn-terminal`". Verified rather than
 * taken on trust — of 387 top-level selectors below it, all but `.world-map`
 * and one attribute selector are `.tn-*` or `.tnx-*`.
 *
 * A brace walk rather than a regex, because `@media` nests and a flat scan would
 * attribute a nested rule's declarations to the wrong selector.
 */
const REGION_MARK = "OPENDATA TERMINAL";

function terminalDeclarations(): { selector: string; decl: string }[] {
  const at = CSS.indexOf(REGION_MARK);
  expect(at, "console region banner not found").toBeGreaterThan(-1);
  const region = CSS.slice(at).replace(/\/\*[\s\S]*?\*\//g, "");

  const out: { selector: string; decl: string }[] = [];
  const stack: string[] = [];
  let buf = "";
  const flush = (chunk: string) => {
    for (const d of chunk.split(";")) {
      const decl = d.trim();
      if (decl) out.push({ selector: stack[stack.length - 1] ?? "", decl });
    }
  };
  for (const c of region) {
    if (c === "{") {
      stack.push(buf.trim());
      buf = "";
    } else if (c === "}") {
      flush(buf);
      stack.pop();
      buf = "";
    } else if (c === ";") {
      flush(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  return out;
}

describe("terminal tokens — colour", () => {
  it("--tnx-accent clears 4.5:1 on every surface it lands on, in BOTH skins", () => {
    // The light accent is the reason this file exists. #b8690a measures 4.15:1 on
    // --tnx-panel (white) and 3.66:1 on --tnx-bg, and light is DEFAULT_TERMINAL_SKIN,
    // so the default console failed AA for accent text. This assertion was written
    // and watched go red against those values before any token was touched.
    for (const [name, sel] of SKINS) {
      const block = blockAfter(sel);
      const accent = token(block, "--tnx-accent");
      for (const surface of ["--tnx-bg", "--tnx-panel", "--tnx-panel-head"]) {
        const bg = token(block, surface);
        expect(
          ratio(accent, bg),
          `${name}: --tnx-accent ${accent} on ${surface} ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("--tnx-lag is not the accent, so 'lagging' cannot render as 'selected'", () => {
    // The severity work separated urgency from selection and stopped one token
    // short: --tnx-lag was the SAME hex as --tnx-accent in both skins, so a feed
    // that had fallen behind was indistinguishable from a control you had chosen.
    for (const [name, sel] of SKINS) {
      const block = blockAfter(sel);
      expect(token(block, "--tnx-lag"), `${name}: lag is the accent`).not.toBe(
        token(block, "--tnx-accent"),
      );
    }
  });

  it("the ink ramp holds the ratio its ROLE requires, on --tnx-panel", () => {
    // Thresholds are per role, and they record what each ink is FOR rather than a
    // uniform aspiration that would fail today and teach the next reader to
    // loosen the test. Measured on the current ramp:
    //   ink    16.40 dark / 18.19 light — body text
    //   dim     7.32 dark /  5.86 light — secondary text, still text
    //   faint   4.10 dark /  3.61 light — de-emphasised
    //   ghost   2.75 dark /  2.28 light — NOT a text colour (RailGlyph fills,
    //                                     disabled chrome); a text threshold here
    //                                     would be a false claim about its job
    //
    // NOTE, and it is a real gap rather than a rounding: --tnx-ink-faint sits
    // between 3 and 4.5, so it only clears AA as LARGE text (>=24px, or 18.66px
    // bold). The console has nothing that size — the type scale tops out well
    // below it — so any small text painted --tnx-ink-faint is below AA today.
    // Pinned at 3 to stop it drifting further while that is decided; raising it
    // is a change to the ramp, not to this test.
    const FLOOR: Record<string, number> = {
      "--tnx-ink": 4.5,
      "--tnx-ink-dim": 4.5,
      "--tnx-ink-faint": 3,
      "--tnx-ink-ghost": 1.5,
    };
    for (const [name, sel] of SKINS) {
      const block = blockAfter(sel);
      const panel = token(block, "--tnx-panel");
      for (const [ink, floor] of Object.entries(FLOOR)) {
        const hex = token(block, `${ink}(?!-)`);
        expect(ratio(hex, panel), `${name}: ${ink} ${hex} on panel`).toBeGreaterThanOrEqual(floor);
      }
    }
  });
});

describe("terminal tokens — drift", () => {
  it("no fixed font-size px literal survives in the console region", () => {
    // The literals are what make --tnx-fs cosmetic. Every size must come from the
    // scale so that changing the scale changes the console.
    const offenders = terminalDeclarations()
      .filter(({ decl }) => /^font-size\s*:\s*[\d.]+px$/.test(decl))
      .map(({ selector, decl }) => `${selector} { ${decl} }`);
    expect(offenders, `font-size px literals: ${offenders.length}`).toEqual([]);
  });

  it("no custom property smuggles a px font size past the scale", () => {
    // The third way a scale rots, and the one that is invisible to both rules
    // above BY CONSTRUCTION. A rule reading `font-size: var(--some-thing)` is
    // not a literal and never will be, so a sweep of literals cannot see the
    // px sitting one level up in `--some-thing: 10.5px`.
    //
    // `--tnx-fs` is the one legitimate px font size in the region: it is the
    // root the other four steps are calc()d from, so it has to be a real
    // length. Everything else derives.
    //
    // THE CAMERA-TILE OVERLAY IS EXEMPT, AND ENUMERATED RATHER THAN WAIVED.
    // This assertion was written before `.tn-cscond` existed, on the prediction
    // that the conditions work would land holding px in a custom property. It
    // did, and firing was the point: it turned an omission into a decision.
    // The decision is to leave it alone, and the reason is that this text is not
    // console chrome. It is a two-line scrim in the corner of a photograph, and
    // every point it grows is picture it covers — the one place in the product
    // where bigger type is a straight loss. It also has no surface behind it to
    // take a theme from, which is why the same block hardcodes its greens and
    // oranges. The body scale is a rule about text on a surface and this is not
    // that.
    //
    // Pinned by VALUE, not merely allowed by name, so the exemption cannot
    // quietly widen: changing one of these three is now an edit to this test
    // with this comment in front of you. Note they sit below `--tnx-fs-xs`
    // (11px), and at the ~80% browser zoom this product is read at, 9px is about
    // 7.2 device pixels. If anyone judges that too small to be worth showing,
    // the fix is to raise these numbers here — not to loosen the guard.
    const OVERLAY_EXEMPT: Record<string, string> = {
      "--tn-cscond-fs": "10.5px",
      "--tn-cscond-fs2": "9.5px",
      "--tn-cscond-mark-fs": "9px",
    };

    const offenders = terminalDeclarations()
      .filter(({ decl }) => /^--[\w-]*(fs|font-size)[\w-]*\s*:\s*[\d.]+px$/.test(decl))
      .filter(({ decl }) => !/^--tnx-fs\s*:/.test(decl))
      .filter(({ decl }) => {
        const [name, value] = decl.split(":").map((x) => x.trim());
        return OVERLAY_EXEMPT[name] !== value;
      })
      .map(({ selector, decl }) => `${selector} { ${decl} }`);
    expect(offenders, `px font sizes hidden in custom properties: ${offenders.length}`).toEqual([]);
  });

  it("the exempted overlay properties still exist, at the sizes the exemption names", () => {
    // An exemption for a rule that has been deleted or renamed is worse than no
    // exemption: it is a silent hole the next px literal drops straight into.
    // This fails if `.tn-cscond` stops declaring one of them, which is the
    // moment to delete the entry above rather than leave it standing.
    const decls = new Set(terminalDeclarations().map(({ decl }) => decl.replace(/\s+/g, " ")));
    for (const [name, value] of Object.entries({
      "--tn-cscond-fs": "10.5px",
      "--tn-cscond-fs2": "9.5px",
      "--tn-cscond-mark-fs": "9px",
    })) {
      expect(decls, `${name} is exempted but no longer declared`).toContain(`${name}: ${value}`);
    }
  });

  it("only the boot wordmark sets a fluid size in raw px", () => {
    // clamp() is deliberately NOT covered by the rule above: a fluid size is a
    // different thing from a fixed one, and blanket-banning px inside clamp
    // would have been a rule about syntax rather than about drift. But exempting
    // every clamp would leave a second way for the scale to rot, so the
    // exception is enumerated instead of assumed. The three boot clamps that
    // WERE on the body scale now take their bounds from it.
    //
    // .tnx-boot-word is display type — a 40-to-92px wordmark on the boot splash.
    // It is not on the body scale and should not follow it: a console that made
    // its splash wordmark 3px bigger because the table rows grew would be
    // obeying a rule that means nothing at that size.
    const fluid = terminalDeclarations()
      .filter(({ decl }) => /^font-size\s*:/.test(decl) && /clamp/.test(decl) && /[\d.]+px/.test(decl))
      .map(({ selector }) => selector);
    expect(fluid).toEqual([".tnx-boot-word"]);
  });

  it("no border-radius: 0 survives in the console region", () => {
    // Square corners were the old identity. A rule pinning 0 does not follow the
    // radius tokens, so it stays square while everything around it rounds — the
    // retune would rot one rule at a time instead of failing here.
    const offenders = terminalDeclarations()
      .filter(({ decl }) => /^border-radius\s*:\s*0(px)?$/.test(decl))
      .map(({ selector, decl }) => `${selector} { ${decl} }`);
    expect(offenders, `border-radius: 0 literals: ${offenders.length}`).toEqual([]);
  });
});
