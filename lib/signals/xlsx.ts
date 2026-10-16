// A minimal XLSX reader: one sheet, by name, as rows of cell text. No dependency.
//
// An .xlsx file is a ZIP of XML parts. This reads the ZIP's central directory (whose
// sizes are reliable even when the local headers use data descriptors), inflates the
// three parts a sheet needs with the Web DecompressionStream ("deflate-raw", like
// lib/signals/gdelt.ts, so no node:zlib reaches a client bundle), and reads cells with
// regular expressions. It handles shared strings, inline strings and plain values,
// which is all the INFORM workbooks use. It does not evaluate formulas: a formula
// cell yields its cached value, which Excel always writes.

const CDIR_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const LOCAL_SIG = 0x04034b50;

/** Pure: the ZIP members' names and where their compressed bytes sit. */
export function zipDirectory(buf: ArrayBuffer): Map<string, { method: number; start: number; size: number }> {
  const view = new DataView(buf);
  const out = new Map<string, { method: number; start: number; size: number }>();
  // The end-of-central-directory record is in the last 22 + 65,535 bytes.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return out;
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= buf.byteLength; n++) {
    if (view.getUint32(p, true) !== CDIR_SIG) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    if (local + 30 <= buf.byteLength && view.getUint32(local, true) === LOCAL_SIG) {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      if (start + size <= buf.byteLength) out.set(name, { method, start, size });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** One ZIP member as text, or null when it is missing or uses another compression. */
export async function zipMemberText(buf: ArrayBuffer, name: string): Promise<string | null> {
  const m = zipDirectory(buf).get(name);
  if (!m) return null;
  const bytes = new Uint8Array(buf, m.start, m.size);
  if (m.method === 0) return new TextDecoder().decode(bytes);
  if (m.method !== 8) return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return await new Response(stream).text();
  } catch {
    return null;
  }
}

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

/** Pure: sharedStrings.xml → the string table (rich-text runs joined). */
export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    out.push(unescape((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
  }
  return out;
}

/** "AB" → 27 (0-based column index). */
function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Pure: a worksheet's XML + the string table → rows of cell text ("" for empty). */
export function parseSheetRows(xml: string, strings: string[]): string[][] {
  const rows: string[][] = [];
  for (const row of xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) ?? []) {
    const cells: string[] = [];
    for (const m of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = m[1] ?? "";
      const inner = m[2] ?? "";
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let text = "";
      if (type === "s" && v !== undefined) text = strings[Number(v)] ?? "";
      else if (type === "inlineStr") text = unescape((inner.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join(""));
      else if (v !== undefined) text = unescape(v);
      const i = ref ? colIndex(ref) : cells.length;
      while (cells.length < i) cells.push("");
      cells[i] = text;
    }
    rows.push(cells);
  }
  return rows;
}

/** One named sheet of an .xlsx as rows of cell text, or null when it cannot be read. */
export async function readXlsxSheet(buf: ArrayBuffer, sheetName: string): Promise<string[][] | null> {
  const [workbook, rels, shared] = await Promise.all([
    zipMemberText(buf, "xl/workbook.xml"),
    zipMemberText(buf, "xl/_rels/workbook.xml.rels"),
    zipMemberText(buf, "xl/sharedStrings.xml"),
  ]);
  if (!workbook || !rels) return null;
  let rid: string | undefined;
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[0])?.[1];
    if (name !== undefined && unescape(name) === sheetName) rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
  }
  if (!rid) return null;
  let target: string | undefined;
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    if (/\bId="([^"]+)"/.exec(m[0])?.[1] === rid) target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
  }
  if (!target) return null;
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const sheet = await zipMemberText(buf, path);
  if (!sheet) return null;
  return parseSheetRows(sheet, shared ? parseSharedStrings(shared) : []);
}
