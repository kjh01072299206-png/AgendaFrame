const allowedSources = ["한겨레", "경향신문", "한국일보", "중앙일보", "조선일보"];
const headerAliases = {
  source: ["source", "언론사", "매체"],
  title: ["title", "제목"],
  url: ["url", "원문url", "원문_url", "링크"],
  published_at: ["published_at", "게시시각", "게시_시각", "발행시각"],
  collected_at: ["collected_at", "수집시각", "수집_시각", "관측시각"],
  section: ["section", "섹션", "분야"],
  homepage_placement: ["homepage_placement", "배치", "홈페이지배치"],
  homepage_rank: ["homepage_rank", "순위", "노출순위"],
};

const state = { rows: [], errors: [] };
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
  return value.trim().toLowerCase().replace(/\s+/g, "");
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
  const normalized = value.trim().toLowerCase();
  const placements = { top: "top", main: "main", section: "section", list: "list", 최상단: "top", 메인: "main", 섹션: "section", 목록: "list" };
  return placements[normalized] ?? normalized;
}

function rowsFromCsv(text) {
  const parsed = parseCsv(text);
  if (parsed.length < 2) throw new Error("헤더와 기사 행이 필요합니다.");
  if (parsed.length > 501) throw new Error("한 번에 최대 500행까지 가져올 수 있습니다.");
  const [headers, ...dataRows] = parsed;
  const columns = resolveHeaders(headers);
  for (const required of ["source", "title", "url", "published_at"]) {
    if (columns[required] === undefined) throw new Error(`필수 열 ${required}이(가) 없습니다.`);
  }
  if (headers.some((header) => ["body", "content", "fulltext", "본문", "원문"].includes(normalizedHeader(header)))) {
    throw new Error("기사 본문 열은 가져올 수 없습니다.");
  }

  const now = new Date().toISOString();
  return dataRows.map((values, index) => ({
    _line: index + 2,
    source: values[columns.source] ?? "",
    title: values[columns.title] ?? "",
    url: values[columns.url] ?? "",
    published_at: values[columns.published_at] ?? "",
    collected_at: columns.collected_at === undefined ? now : values[columns.collected_at] || now,
    section: columns.section === undefined ? "" : values[columns.section] ?? "",
    homepage_placement: columns.homepage_placement === undefined ? "" : normalizePlacement(values[columns.homepage_placement] ?? ""),
    homepage_rank: columns.homepage_rank === undefined ? "" : values[columns.homepage_rank] ?? "",
  }));
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
  root.innerHTML = `<div class="preview-summary"><span>전체 ${state.rows.length}건</span>${summary}</div>${state.errors.length ? `<ul class="preview-errors">${errorList}${state.errors.length > 8 ? `<li>그 외 ${state.errors.length - 8}개 오류</li>` : ""}</ul>` : `<p class="preview-ok">형식 검증을 통과했습니다.</p>`}`;
  $("#import-submit").disabled = !state.rows.length || Boolean(state.errors.length);
}

$("#csv-file").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  if (file.size > 1024 * 1024) {
    showToast("CSV는 1MB 이하여야 합니다.");
    return;
  }
  try {
    state.rows = rowsFromCsv(await file.text());
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
    const response = await fetch("/api/import", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ rows }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "가져오기에 실패했습니다.");
    showToast(`${result.inserted}건 저장 · ${result.duplicates}건 중복 제외`);
    $("#import-preview").innerHTML = `<p class="preview-ok">가져오기 완료: 신규 ${result.inserted}건, 중복 ${result.duplicates}건</p>`;
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
