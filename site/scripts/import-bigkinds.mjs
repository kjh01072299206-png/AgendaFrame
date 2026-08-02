import { readFile, stat } from "node:fs/promises";
import process from "node:process";
import { isBigKindsExcludedValue, parseBigKindsXlsx } from "../lib/bigkinds-xlsx.mjs";

const BATCH_SIZE = 100;
const MAX_ROWS = 20_000;
const DEFAULT_ORIGIN = "https://agendaframe-capstone.kjh01072299206.chatgpt.site";
function parseArgs(argv) {
  const args = { file: "", origin: DEFAULT_ORIGIN, startBatch: 0, analyze: false, dryRun: false, date: "", workbookBodies: false, metadataOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!args.file && !value.startsWith("--")) args.file = value;
    else if (value === "--origin") args.origin = argv[++index] ?? "";
    else if (value === "--start-batch") args.startBatch = Number(argv[++index] ?? 0);
    else if (value === "--date") args.date = String(argv[++index] ?? "").trim();
    else if (value === "--analyze") args.analyze = true;
    else if (value === "--dry-run") args.dryRun = true;
    else if (value === "--date") args.date = argv[++index] ?? "";
    else if (value === "--workbook-bodies") args.workbookBodies = true;
    else if (value === "--metadata-only") args.metadataOnly = true;
    else throw new Error(`지원하지 않는 인수입니다: ${value}`);
  }
  if (!args.file) throw new Error("BigKinds .xlsx 파일 경로가 필요합니다.");
  if (!Number.isInteger(args.startBatch) || args.startBatch < 0) throw new Error("--start-batch는 0 이상의 정수여야 합니다.");
  if (args.date && !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error("--date는 YYYY-MM-DD 형식이어야 합니다.");
  return args;
}

function isExcludedStatus(value) {
  const statuses = String(value ?? "")
    .toLowerCase()
    .split(",")
    .map((entry) => entry.trim().replace(/\s+/g, ""))
    .filter(Boolean);
  return statuses.some((status) => EXCLUDED_LIKE.has(status));
}

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function columnMap(headers) {
  const aliases = {
    newsId: ["뉴스식별자", "news_id"],
    publishedAt: ["일자", "날짜", "published_at"],
    source: ["언론사", "source"],
    title: ["제목", "title"],
    section: ["통합분류1", "분야", "section"],
    excerpt: ["본문", "body_excerpt", "excerpt"],
    url: ["url", "원문url", "링크"],
    excluded: ["분석제외여부", "analysis_excluded"],
  };
  return Object.fromEntries(Object.entries(aliases).map(([field, names]) => {
    const index = headers.findIndex((header) => names.includes(normalizeHeader(header)));
    if (index < 0 && ["publishedAt", "source", "title", "url"].includes(field)) {
      throw new Error(`필수 열을 찾지 못했습니다: ${field}`);
    }
    return [field, index];
  }));
}

function publishedAt(value, newsId) {
  const idMatch = String(newsId ?? "").match(/\.(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (idMatch) {
    const [, year, month, day, hour, minute, second] = idMatch;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`;
  }
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}T00:00:00+09:00`;
  }
  const match = String(value ?? "").trim().match(/^(\d{4})[./-]?(\d{2})[./-]?(\d{2})$/);
  if (!match) throw new Error(`게시일 형식을 읽을 수 없습니다: ${value}`);
  return `${match[1]}-${match[2]}-${match[3]}T00:00:00+09:00`;
}

function normalizeUrl(value) {
  const url = new URL(String(value ?? "").trim());
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") throw new Error("HTTPS 기사 URL만 가져올 수 있습니다.");
  return url.toString();
}

async function requestJson(url, token, body, attempt = 0) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      origin: new URL(url).origin,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (attempt < 3 && (response.status === 429 || response.status >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, 750 * 2 ** attempt));
      return requestJson(url, token, body, attempt + 1);
    }
    throw new Error(`${response.status} ${payload.error ?? payload.message ?? "요청 실패"}`);
  }
  return payload;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.IMPORT_TOKEN?.trim();
  if (!args.dryRun && !token) throw new Error("IMPORT_TOKEN 환경 변수가 필요합니다.");
  await stat(args.file);
  const table = parseBigKindsXlsx(await readFile(args.file));
  if (table.length < 2 || table.length > MAX_ROWS + 1) {
    throw new Error(`데이터 행은 1~${MAX_ROWS.toLocaleString("ko-KR")}건이어야 합니다(현재 ${(table.length - 1).toLocaleString("ko-KR")}건).`);
  }
  const columns = columnMap(table[0]);
  const collectedAt = new Date().toISOString();
  let excludedRows = 0;
  let missingUrlRows = 0;
  const rows = table.slice(1).flatMap((values, index) => {
    const excluded = columns.excluded >= 0 && isBigKindsExcludedValue(values[columns.excluded]);
    if (excluded) {
      excludedRows += 1;
      return [];
    }
    if (!String(values[columns.url] ?? "").trim()) {
      missingUrlRows += 1;
      return [];
    }
    const excerpt = columns.excerpt >= 0 ? String(values[columns.excerpt] ?? "").trim() : "";
    const rowPublishedAt = publishedAt(values[columns.publishedAt], columns.newsId >= 0 ? values[columns.newsId] : "");
    if (args.date && rowPublishedAt.slice(0, 10) !== args.date) return [];
    return [{
      _line: index + 2,
      source: String(values[columns.source] ?? "").trim(),
      title: String(values[columns.title] ?? "").trim(),
      url: normalizeUrl(values[columns.url]),
      published_at: rowPublishedAt,
      collected_at: collectedAt,
      section: columns.section >= 0 ? String(values[columns.section] ?? "").trim() : "",
      homepage_placement: "",
      homepage_rank: "",
      excerpt,
      textScope: args.workbookBodies ? "transient_public_page_extract" : "provider_excerpt",
    }];
  });
  const selectedRows = args.date ? rows.filter((row) => row.published_at.slice(0, 10) === args.date) : rows;
  if (args.date && selectedRows.length === 0) throw new Error(`${args.date} 기사가 파일에 없습니다.`);
  const dates = [...new Set(selectedRows.map((row) => row.published_at.slice(0, 10)))].sort();
  const batches = Array.from({ length: Math.ceil(selectedRows.length / BATCH_SIZE) }, (_, index) =>
    selectedRows.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE));
  if (args.dryRun) {
    console.log(JSON.stringify({
      inputRows: table.length - 1,
      excludedRows,
      missingUrlRows,
      acceptedRows: selectedRows.length,
      analyzableExcerpts: selectedRows.filter((row) => row.excerpt.length >= 40).length,
      batches: batches.length,
      dates,
      requestedDate: args.date || null,
      textScopes: Object.fromEntries([...new Set(selectedRows.map((row) => row.textScope))]
        .map((scope) => [scope, selectedRows.filter((row) => row.textScope === scope).length])),
      rawTextStored: false,
    }));
    return;
  }
  let importedRows = 0;
  let analyzedExcerpts = 0;
  for (let index = args.startBatch; index < batches.length; index += 1) {
    const batch = batches[index];
    const structured = args.metadataOnly ? [] : batch.filter((row) => row.excerpt.length >= 40);
    const metadataOnly = batch.filter((row) => row.excerpt.length < 40).map((row) => {
      const metadata = { ...row };
      delete metadata.excerpt;
      delete metadata.textScope;
      return metadata;
    });
    if (structured.length) {
      const result = await requestJson(`${args.origin}/api/import/structured`, token, { rows: structured });
      importedRows += Number(result.received ?? structured.length);
      analyzedExcerpts += Number(result.analyzedExcerpts ?? structured.length);
    }
    if (metadataOnly.length) {
      const result = await requestJson(`${args.origin}/api/import`, token, { rows: metadataOnly });
      importedRows += Number(result.received ?? metadataOnly.length);
    }
    if ((index + 1) % 10 === 0 || index === batches.length - 1) {
      console.log(`가져오기 ${index + 1}/${batches.length} 배치 · ${importedRows.toLocaleString("ko-KR")}건`);
    }
  }
  if (args.analyze) {
    for (const date of dates) {
      const result = await requestJson(`${args.origin}/api/analyze`, token, { date });
      console.log(`분석 ${date} · 이슈 ${Number(result.issueCount ?? 0).toLocaleString("ko-KR")}개`);
    }
  }
  console.log(JSON.stringify({
    inputRows: table.length - 1,
    excludedRows,
    missingUrlRows,
    acceptedRows: selectedRows.length,
    analyzedExcerpts,
    dates,
    requestedDate: args.date || null,
    textScopes: Object.fromEntries([...new Set(selectedRows.map((row) => row.textScope))]
      .map((scope) => [scope, selectedRows.filter((row) => row.textScope === scope).length])),
    rawTextStored: false,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
