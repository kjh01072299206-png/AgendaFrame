import { readFile } from "node:fs/promises";
import { parseBigKindsXlsx } from "../lib/bigkinds-xlsx.mjs";

const [file, targetDate = "2026-07-26"] = process.argv.slice(2);
if (!file) throw new Error("Usage: node scripts/inspect-bigkinds-date.mjs <xlsx> [YYYY-MM-DD]");

const rows = parseBigKindsXlsx(await readFile(file));
const headers = rows[0].map((value) => String(value ?? "").trim());
const normalizedDate = targetDate.replaceAll("-", "");
const dateColumns = headers
  .map((header, index) => ({ header, index }))
  .filter(({ header }) => /일자|날짜|date|news.?id|뉴스.?식별자/i.test(header));
const matchingRows = rows.slice(1).filter((row) =>
  dateColumns.some(({ index }) => String(row[index] ?? "").replace(/\D/g, "").includes(normalizedDate)),
);

console.log(JSON.stringify({
  headers,
  rowCount: rows.length - 1,
  dateColumns,
  targetDate,
  matchingRowCount: matchingRows.length,
  preview: matchingRows.slice(0, 12).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header || `column_${index + 1}`, row[index] ?? null])),
  ),
}, null, 2));
