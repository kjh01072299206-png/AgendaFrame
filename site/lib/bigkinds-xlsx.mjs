import { unzipSync } from "fflate";

const decoder = new TextDecoder("utf-8");

const BIGKINDS_EXCLUSION_VALUES = new Set([
  "1",
  "true",
  "y",
  "yes",
  "예",
  "예외",
  "제외",
  "exclude",
]);

/**
 * BigKinds exports are not fully consistent: some files put a body-status
 * value such as "본문 확보" under the adjacent exclusion column. Only
 * explicit exclusion markers should remove a row from analysis.
 */
export function isBigKindsExcludedValue(value) {
  return BIGKINDS_EXCLUSION_VALUES.has(String(value ?? "").trim().toLowerCase());
}

function xmlText(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function columnIndex(reference) {
  const letters = String(reference ?? "").match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
}

function sharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?si\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?si>/g)].map((match) =>
    [...match[1].matchAll(/<(?:[A-Za-z_][\w.-]*:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t>/g)]
      .map((text) => xmlText(text[1]))
      .join(""));
}

function cellValue(attributes, body, strings) {
  const type = attributes.match(/\bt="([^"]+)"/)?.[1] ?? "";
  if (type === "inlineStr") {
    return [...body.matchAll(/<(?:[A-Za-z_][\w.-]*:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t>/g)].map((match) => xmlText(match[1])).join("");
  }
  const raw = body.match(/<(?:[A-Za-z_][\w.-]*:)?v\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?v>/)?.[1] ?? "";
  if (type === "s") return strings[Number(raw)] ?? "";
  if (type === "b") return raw === "1";
  if (type === "str") return xmlText(raw);
  if (!raw) return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : xmlText(raw);
}

export function parseBigKindsXlsx(input) {
  const files = unzipSync(input instanceof Uint8Array ? input : new Uint8Array(input));
  const sheetPath = Object.keys(files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))[0];
  if (!sheetPath) throw new Error("Excel 시트를 찾지 못했습니다.");
  const strings = sharedStrings(files["xl/sharedStrings.xml"] ? decoder.decode(files["xl/sharedStrings.xml"]) : "");
  const sheet = decoder.decode(files[sheetPath]);
  const rows = [];
  for (const rowMatch of sheet.matchAll(/<(?:[A-Za-z_][\w.-]*:)?row\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?row>/g)) {
    const rowNumber = Number(rowMatch[1].match(/\br="(\d+)"/)?.[1] ?? rows.length + 1);
    const row = [];
    for (const cellMatch of rowMatch[2].matchAll(/<(?:[A-Za-z_][\w.-]*:)?c\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?c>/g)) {
      const reference = cellMatch[1].match(/\br="([^"]+)"/)?.[1] ?? "";
      row[columnIndex(reference)] = cellValue(cellMatch[1], cellMatch[2], strings);
    }
    while (row.length && row[row.length - 1] == null) row.pop();
    rows[rowNumber - 1] = row;
  }
  return rows.filter((row) => Array.isArray(row) && row.some((cell) => String(cell ?? "").trim().length > 0));
}
