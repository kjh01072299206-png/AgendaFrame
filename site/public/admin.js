const allowedSources = ["한겨레", "경향신문", "한국일보", "중앙일보", "조선일보"];
const headerAliases = {
  source: ["source", "언론사", "매체"],
  title: ["title", "제목"],
  url: ["url", "원문url", "원문_url", "링크"],
  published_at: ["published_at", "게시시각", "게시_시각", "발행시각", "일자", "날짜"],
  collected_at: ["collected_at", "수집시각", "수집_시각", "관측시각"],
  section: ["section", "섹션", "분야", "통합분류1"],
  homepage_placement: ["homepage_placement", "배치", "홈페이지배치"],
  homepage_rank: ["homepage_rank", "순위", "노출순위"],
};

const MAX_ROWS = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const IMPORT_BATCH_SIZE = 500;
const state = { rows: [], errors: [], ignoredBodyColumn: false };
const $ = (selector) => document.querySelector(selector);

function showToast(message) {
  const toast = $("#admin-toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2800);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(value.trim());
      value = "";
    } else if (character === "\n") {
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else if (character !== "\r") value += character;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  if (quoted) throw new Error("닫히지 않은 큰따옴표가 있습니다.");
  return rows;
}

function normalizedHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function resolveHeaders(headers) {
  const resolved = {};
  for (const [field, aliases] of Object.entries(headerAliases)) {
    const index = headers.findIndex((header) => aliases.includes(normalizedHeader(header)));
    if (index >= 0) resolved[field] = index;
  }
  return resolved;
}

function normalizePlacement(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const placements = { top: "top", main: "main", section: "section", list: "list", 최상단: "top", 메인: "main", 섹션: "section", 목록: "list" };
  return placements[normalized] ?? normalized;
}

function normalizePublishedAt(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}T00:00:00+09:00`;
  }

  const text = String(value ?? "").trim();
  const compactDate = text.match(/^(\d{4})[.\/-]?(\d{2})[.\/-]?(\d{2})$/);
  if (compactDate) return `${compactDate[1]}-${compactDate[2]}-${compactDate[3]}T00:00:00+09:00`;
  return text;
}

function normalizeArticleUrl(value) {
  const text = String(value ?? "").trim();
  try {
    const url = new URL(text);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.toString();
  } catch {
    return text;
  }
}

function rowsFromTable(parsed) {
  if (parsed.length < 2) throw new Error("헤더와 기사 행이 필요합니다.");
  if (parsed.length > MAX_ROWS + 1) throw new Error(`한 번에 최대 ${MAX_ROWS.toLocaleString("ko-KR")}행까지 가져올 수 있습니다.`);
  const [headers, ...dataRows] = parsed;
  const columns = resolveHeaders(headers);
  for (const required of ["source", "title", "url", "published_at"]) {
    if (columns[required] === undefined) throw new Error(`필수 열 ${required}이(가) 없습니다.`);
  }
  state.ignoredBodyColumn = headers.some((header) => ["body", "content", "fulltext", "본문", "원문"].includes(normalizedHeader(header)));

  const now = new Date().toISOString();
  return dataRows.map((values, index) => ({
    _line: index + 2,
    source: String(values[columns.source] ?? "").trim(),
    title: String(values[columns.title] ?? "").trim(),
    url: normalizeArticleUrl(values[columns.url]),
    published_at: normalizePublishedAt(values[columns.published_at]),
    collected_at: columns.collected_at === undefined ? now : normalizePublishedAt(values[columns.collected_at] || now),
    section: columns.section === undefined ? "" : String(values[columns.section] ?? "").trim(),
    homepage_placement: columns.homepage_placement === undefined ? "" : normalizePlacement(values[columns.homepage_placement] ?? ""),
    homepage_rank: columns.homepage_rank === undefined ? "" : String(values[columns.homepage_rank] ?? "").trim(),
  }));
}

async function rowsFromFile(file) {
  if (file.name.toLowerCase().endsWith(".xlsx")) {
    if (typeof window.readXlsxFile !== "function") throw new Error("Excel 읽기 모듈을 불러오지 못했습니다.");
    return rowsFromTable(await window.readXlsxFile(file));
  }
  return rowsFromTable(parseCsv(await file.text()));
}

function validateRows(rows) {
  const errors = [];
  for (const row of rows) {
    if (!allowedSources.includes(row.source)) errors.push(`${row._line}행: 지원하지 않는 언론사입니다.`);
    if (!row.title || row.title.length > 500) errors.push(`${row._line}행: 제목은 1~500자여야 합니다.`);
    try {
      const url = new URL(row.url);
      if (url.protocol !== "https:") throw new Error("https required");
    } catch {
      errors.push(`${row._line}행: 올바른 HTTPS 원문 URL이 아닙니다.`);
    }
    if (!Number.isFinite(Date.parse(row.published_at))) errors.push(`${row._line}행: 게시 시각을 확인하세요.`);
    if (!Number.isFinite(Date.parse(row.collected_at))) errors.push(`${row._line}행: 수집 시각을 확인하세요.`);
    if (row.homepage_placement && !["top", "main", "section", "list"].includes(row.homepage_placement)) errors.push(`${row._line}행: 배치 값은 TOP, MAIN, SECTION, LIST만 가능합니다.`);
    if (row.homepage_rank && (!Number.isInteger(Number(row.homepage_rank)) || Number(row.homepage_rank) < 1)) errors.push(`${row._line}행: 노출 순위는 1 이상의 정수여야 합니다.`);
  }
  return errors;
}

function renderPreview() {
  const root = $("#import-preview");
  const counts = Object.fromEntries(allowedSources.map((source) => [source, 0]));
  state.rows.forEach((row) => { if (counts[row.source] !== undefined) counts[row.source] += 1; });
  const summary = allowedSources.map((source) => `<span>${source} ${counts[source]}건</span>`).join("");
  const errorList = state.errors.slice(0, 8).map((error) => `<li>${error.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character])}</li>`).join("");
  const privacyNotice = state.ignoredBodyColumn ? `<p class="preview-ok">BigKinds의 본문 열은 폐기했으며 서버로 전송하지 않습니다.</p>` : "";
  root.innerHTML = `<div class="preview-summary"><span>전체 ${state.rows.length.toLocaleString("ko-KR")}건</span>${summary}</div>${privacyNotice}${state.errors.length ? `<ul class="preview-errors">${errorList}${state.errors.length > 8 ? `<li>그 외 ${state.errors.length - 8}개 오류</li>` : ""}</ul>` : `<p class="preview-ok">형식 검증을 통과했습니다. 500건씩 나누어 안전하게 저장합니다.</p>`}`;
  $("#import-submit").disabled = !state.rows.length || Boolean(state.errors.length);
}

$("#csv-file").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    showToast("파일은 25MB 이하여야 합니다.");
    return;
  }
  try {
    state.ignoredBodyColumn = false;
    state.rows = await rowsFromFile(file);
    state.errors = validateRows(state.rows);
    $(".file-drop span").textContent = file.name;
    $(".file-drop").classList.add("active");
    renderPreview();
  } catch (error) {
    state.rows = [];
    state.errors = [error.message];
    renderPreview();
  }
});

$("#import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = $("#import-token").value.trim();
  if (!token) {
    showToast("관리자 토큰을 입력해 주세요.");
    return;
  }
  const button = $("#import-submit");
  button.disabled = true;
  button.textContent = "저장 중…";
  try {
    const rows = state.rows.map((entry) => {
      const row = { ...entry };
      delete row._line;
      return row;
    });
    let inserted = 0;
    let duplicates = 0;
    const totalBatches = Math.ceil(rows.length / IMPORT_BATCH_SIZE);
    for (let offset = 0; offset < rows.length; offset += IMPORT_BATCH_SIZE) {
      const batchNumber = Math.floor(offset / IMPORT_BATCH_SIZE) + 1;
      button.textContent = `저장 중… ${batchNumber}/${totalBatches}`;
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ rows: rows.slice(offset, offset + IMPORT_BATCH_SIZE) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(`${batchNumber}번째 묶음: ${result.error ?? "가져오기에 실패했습니다."}`);
      inserted += Number(result.inserted) || 0;
      duplicates += Number(result.duplicates) || 0;
    }
    showToast(`${inserted.toLocaleString("ko-KR")}건 저장 · ${duplicates.toLocaleString("ko-KR")}건 중복 제외`);
    $("#import-preview").innerHTML = `<p class="preview-ok">가져오기 완료: 신규 ${inserted.toLocaleString("ko-KR")}건, 중복 ${duplicates.toLocaleString("ko-KR")}건</p>`;
    $("#csv-file").value = "";
    $("#import-token").value = "";
    state.rows = [];
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  } finally {
    button.textContent = "검증된 데이터 가져오기";
  }
});
