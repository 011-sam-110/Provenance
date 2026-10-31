import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

// The console top bar's presentation. The board tabs come from Leon, 2026-10-29: centred in
// the bar with no dot. The short bar comes from Sam, 2026-10-31: the camera counts leave, and
// Discord, Shortcuts and the moon move into Settings. These are source pins, because the
// things they hold are things CSS and markup can quietly undo: a border put back on the tab,
// a dot that returns, a button that creeps back. What is painted and pressed is in
// tests/e2e/console-navbar.spec.ts.

const ROOT = resolve(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(resolve(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

const header = read("components", "terminal", "TerminalHeader.tsx");
const panel = read("components", "shell", "SettingsPanel.tsx");
const shortcuts = read("components", "shell", "settings", "ShortcutsTab.tsx");
const display = read("components", "shell", "settings", "DisplayTab.tsx");
const css = read("app", "globals.css");

/** The body of the first rule whose selector is exactly `selector`. */
function ruleBody(source: string, selector: string): string {
  const at = source.indexOf(`${selector} {`);
  expect(at, `${selector} is in the sheet`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", at);
  return source.slice(open + 1, source.indexOf("}", open));
}

describe("the board tabs", () => {
  test("no dot and no edited class: the state is in the hover text and the accessible name", () => {
    expect(header).not.toContain("tnx-hdr-board-dot");
    expect(header).not.toContain("is-edited");
    expect(header).toMatch(/title=\{`[^`]*\$\{edited \? " · customised" : ""\}`\}/);
    expect(header).toMatch(/<span className="tn-sr-only"> board\{edited \? ", customised" : ""\}<\/span>/);
  });

  test("the edited state is read after hydration, with an empty server snapshot", () => {
    expect(header).toContain("useSyncExternalStore(shellLayoutStore.subscribe, editedSnapshot, noneEdited)");
    expect(header).toMatch(/const noneEdited = \(\) => "";/);
    // `isBoardEdited` hits localStorage: it must not be called in BoardTabs' render.
    const tabs = header.slice(header.indexOf("function BoardTabs()"), header.indexOf("export default function TerminalHeader"));
    expect(tabs).not.toContain("isBoardEdited(");
  });

  test("nothing in any stylesheet still styles the dot", () => {
    const dir = resolve(ROOT, "app");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".css"))) {
      const text = read("app", f);
      expect(text, f).not.toContain("tnx-hdr-board-dot");
      expect(text, f).not.toContain("tn-mo-dot-in");
      expect(text, f).not.toContain(".tnx-hdr-board.is-edited");
    }
  });

  test("the tab keeps its full content box: no border-bottom, an inset shadow marks the active one", () => {
    expect(ruleBody(css, ".tn-terminal .tnx-hdr-board")).not.toContain("border-bottom");
    expect(ruleBody(css, ".tn-terminal .tnx-hdr-board.is-active")).toContain("box-shadow: inset 0 -2px 0 var(--tnx-accent)");
    expect(ruleBody(css, ".tn-terminal .tnx-hdr-board.is-active")).not.toContain("border-bottom");
  });

  test("the travelling marker hands over by removing the shadow, not a border colour", () => {
    const motion = read("app", "console-motion.css");
    expect(motion).toMatch(/\.tnx-hdr-boards\[data-ind="1"\] \.tnx-hdr-board\.is-active \{\s*box-shadow: none;\s*\}/);
  });
});

describe("the short bar", () => {
  test("keeps the brand, the tabs, presence, Support, Source, Settings and Account", () => {
    expect(header).toContain("<Mark ");
    expect(header).toContain("<BoardTabs />");
    expect(header).toContain("<LivePresence />");
    expect(header).toContain("href={BRAND.kofiUrl}");
    expect(header).toContain('tn-settings-trigger"');
    expect(header).toContain("<AccountButton ");
  });

  test("the Source link stays: it is the AGPL section 13 offer", () => {
    expect(header).toContain("href={BRAND.repoUrl}");
  });

  test("keeps what nobody sees: the page's h1 and the two status lines", () => {
    expect(header.match(/<h1 /g)).toHaveLength(1);
    expect(header).toContain('data-testid="stat-line"');
    expect(header).toContain('data-testid="a11y-status-line"');
  });

  test("Discord, Shortcuts, the moon and the camera counts have left", () => {
    for (const gone of ["CameraStats", "StatGlyphs", "statsView", "DiscordMark", "discordUrl", "SkinGlyphs", "MoonGlyph", "SunGlyph", "tn-palette-trigger", "tnx-hdr-skin", "tnx-hdr-btn-mark"]) {
      expect(header, gone).not.toContain(gone);
    }
  });

  test("the strip's files, route and rules went with it, so nothing is left to reach", () => {
    for (const file of [
      ["components", "terminal", "CameraStats.tsx"],
      ["components", "terminal", "StatGlyphs.tsx"],
      ["components", "terminal", "SkinGlyphs.tsx"],
      ["lib", "cameras", "statsView.ts"],
      ["lib", "cameras", "stats.ts"],
      ["app", "api", "camera-stats", "route.ts"],
    ]) {
      expect(existsSync(resolve(ROOT, ...file)), file.join("/")).toBe(false);
    }
    expect(css).not.toContain("CAMERA STATS STRIP");
    expect(css).not.toMatch(/\.cs-[a-z]/);
    expect(css).not.toContain(".tnx-hdr-skin");
    expect(css).not.toContain(".tnx-hdr-btn-mark");
  });
});

describe("what moved into Settings", () => {
  test("Discord is a link in the drawer, outside the tablist, from the one address constant", () => {
    expect(panel).toContain("href={BRAND.discordUrl}");
    expect(panel).toContain("<DiscordMark");
    expect(panel).toContain("Join the Discord");
    // A tablist may hold only tabs, so the link cannot sit inside the rail's element.
    const rail = panel.slice(panel.indexOf('role="tablist"'), panel.indexOf("</div>", panel.indexOf('role="tablist"')));
    expect(rail).not.toContain("discordUrl");
  });

  test("the palette's door is the first thing on the Shortcuts tab, and it goes through onOpenPalette", () => {
    const body = shortcuts.slice(shortcuts.indexOf("export default function ShortcutsTab"));
    const door = body.indexOf("Open command palette");
    expect(door).toBeGreaterThan(-1);
    expect(door).toBeLessThan(body.indexOf("KEY_ACTIONS.map"));
    expect(body).toContain("onClick={onOpenPalette}");
    expect(header).toContain("onOpenPalette={onOpenPalette}");
    // The drawer closes first, so the palette does not open behind it.
    expect(panel).toMatch(/onClose\(\);\s*onOpenPalette\(\);/);
  });

  test("Theme is the first row of Display, and the only theme control", () => {
    const body = display.slice(display.indexOf("export default function DisplayTab"));
    expect(body.indexOf('aria-label="Theme"')).toBeGreaterThan(-1);
    expect(body.indexOf('aria-label="Theme"')).toBeLessThan(body.indexOf("tn-settings-row", body.indexOf('aria-label="Theme"')));
    expect(body.indexOf('aria-label="Theme"')).toBeLessThan(body.indexOf('aria-label="Interface language"'));
    expect(header).not.toContain("terminalSkinStore.set");
    expect(header).not.toContain("terminalSkinStore.toggle");
  });

  test("the header still hydrates the saved skin, because the drawer's row reads the store", () => {
    expect(header).toContain("terminalSkinStore.hydrate()");
  });
});
