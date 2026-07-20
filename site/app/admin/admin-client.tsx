"use client";

import readXlsxFile from "read-excel-file";
import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import sourcePanel from "../../data/sources.json";
import QualityReview from "./quality-review";

const ALLOWED_SOURCES = sourcePanel.sources.filter((source) => source.active).map((source) => source.name);
const MAX_ROWS = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const IMPORT_BATCH_SIZE = 500;

const HEADER_ALIASES: Record<string, string[]> = {
  news_id: ["news_id", "뉴스식별자", "뉴스id"],
  source: ["source", "언론사", "매체"],
  title: ["title", "제목"],
  url: ["url", "원문url", "원문_url", "링크"],
  published_at: ["published_at", "게시시각", "게시_시각", "발행시각", "일자", "날짜"],
  collected_at: ["collected_at", "수집시각", "수집_시각", "관측시간"],
  section: ["section", "섹션", "분야", "통합분류1", "통합분류"],
  homepage_placement: ["homepage_placement", "배치", "홈페이지배치"],
  homepage_rank: ["homepage_rank", "순위", "노출순위"],
};

type Cell = string | number | boolean | Date | null;
type ImportRow = {
  _line: number;
  source: string;
  title: string;
  url: string;
  published_at: string;
  collected_at: string;
  section: string;
  homepage_placement: string;
  homepage_rank: string;
};

type AnalysisDay = {
  date: string;
  articleCount: number;
  status: "pending" | "running" | "success" | "failed" | "empty";
  analyzedArticleCount: number;
  issueCount: number;
  errorMessage?: string | null;
};

function apiError(result: unknown, fallback: string) {
  if (!result || typeof result !== "object") return fallback;
  const error = (result as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return fallback;
}

function moveDate(date: string, offset: number) {
  const value = Date.parse(`${date}T00:00:00Z`);
  return new Date(value + offset * 86_400_000).toISOString().slice(0, 10);
}

function batchDateRange(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !Number.isFinite(start) || !Number.isFinite(end)) throw new Error("분석 기간을 확인하세요.");
  if (end < start) throw new Error("종료일은 시작일보다 빠를 수 없습니다.");
  const count = Math.floor((end - start) / 86_400_000) + 1;
  if (count > 7) throw new Error("기간 분석은 한 번에 최대 7일까지 실행할 수 있습니다.");
  return Array.from({ length: count }, (_, index) => moveDate(startDate, index));
}

function normalizedHeader(value: Cell) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function resolveHeaders(headers: Cell[]) {
  return Object.fromEntries(Object.entries(HEADER_ALIASES).flatMap(([field, aliases]) => {
    const index = headers.findIndex((header) => aliases.includes(normalizedHeader(header)));
    return index >= 0 ? [[field, index]] : [];
  })) as Record<string, number>;
}

function parseCsv(text: string): Cell[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else value += character;
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

function publishedAtFromNewsId(value: Cell) {
  const match = String(value ?? "").trim().match(/\.(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!match) return "";
  const [, year, month, day, hour, minute, second] = match;
  const timestamp = `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`;
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : "";
}

function normalizeTimestamp(value: Cell, newsId: Cell = "") {
  const exact = publishedAtFromNewsId(newsId);
  if (exact) return exact;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}T00:00:00+09:00`;
  }
  const text = String(value ?? "").trim();
  const compact = text.match(/^(\d{4})[./-]?(\d{2})[./-]?(\d{2})$/);
  return compact ? `${compact[1]}-${compact[2]}-${compact[3]}T00:00:00+09:00` : text;
}

function normalizeUrl(value: Cell) {
  const text = String(value ?? "").trim();
  try {
    const url = new URL(text);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.toString();
  } catch {
    return text;
  }
}

function normalizePlacement(value: Cell) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const placements: Record<string, string> = { top: "top", main: "main", section: "section", list: "list", 최상단: "top", 메인: "main", 섹션: "section", 목록: "list" };
  return placements[normalized] ?? normalized;
}

function rowsFromTable(parsed: Cell[][]) {
  if (parsed.length < 2) throw new Error("헤더와 기사 행이 필요합니다.");
  if (parsed.length > MAX_ROWS + 1) throw new Error(`한 번에 최대 ${MAX_ROWS.toLocaleString("ko-KR")}행까지 가져올 수 있습니다.`);
  const [headers, ...dataRows] = parsed;
  const columns = resolveHeaders(headers);
  for (const required of ["source", "title", "url", "published_at"]) {
    if (columns[required] === undefined) throw new Error(`필수 열 '${required}'이 없습니다.`);
  }
  const ignoredBody = headers.some((header) => ["body", "content", "fulltext", "본문", "원문"].includes(normalizedHeader(header)));
  const now = new Date().toISOString();
  const rows = dataRows.map((values, index): ImportRow => ({
    _line: index + 2,
    source: String(values[columns.source] ?? "").trim(),
    title: String(values[columns.title] ?? "").trim(),
    url: normalizeUrl(values[columns.url]),
    published_at: normalizeTimestamp(values[columns.published_at], columns.news_id === undefined ? "" : values[columns.news_id]),
    collected_at: columns.collected_at === undefined ? now : normalizeTimestamp(values[columns.collected_at] || now),
    section: columns.section === undefined ? "" : String(values[columns.section] ?? "").trim(),
    homepage_placement: columns.homepage_placement === undefined ? "" : normalizePlacement(values[columns.homepage_placement]),
    homepage_rank: columns.homepage_rank === undefined ? "" : String(values[columns.homepage_rank] ?? "").trim(),
  }));
  return { rows, ignoredBody, restoredTimes: columns.news_id !== undefined };
}

function validateRows(rows: ImportRow[]) {
  const errors: string[] = [];
  for (const row of rows) {
    if (!ALLOWED_SOURCES.includes(row.source)) errors.push(`${row._line}행: 지원하지 않는 언론사입니다.`);
    if (!row.title || row.title.length > 500) errors.push(`${row._line}행: 제목은 1~500자여야 합니다.`);
    try {
      const url = new URL(row.url);
      if (url.protocol !== "https:") throw new Error();
    } catch { errors.push(`${row._line}행: 올바른 HTTPS 원문 URL이 아닙니다.`); }
    if (!Number.isFinite(Date.parse(row.published_at))) errors.push(`${row._line}행: 게시 시각을 확인하세요.`);
    if (!Number.isFinite(Date.parse(row.collected_at))) errors.push(`${row._line}행: 수집 시각을 확인하세요.`);
    if (row.homepage_placement && !["top", "main", "section", "list"].includes(row.homepage_placement)) errors.push(`${row._line}행: 배치는 TOP, MAIN, SECTION, LIST만 가능합니다.`);
    if (row.homepage_rank && (!Number.isInteger(Number(row.homepage_rank)) || Number(row.homepage_rank) < 1)) errors.push(`${row._line}행: 노출 순위는 1 이상의 정수여야 합니다.`);
  }
  return errors;
}

export default function AdminClient() {
  const todayKst = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const [token, setToken] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [ignoredBody, setIgnoredBody] = useState(false);
  const [restoredTimes, setRestoredTimes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [analysisDate, setAnalysisDate] = useState(todayKst);
  const [contentUrl, setContentUrl] = useState("");
  const [contentBody, setContentBody] = useState("");
  const [contentMethod, setContentMethod] = useState("manual_research");
  const [usageBasis, setUsageBasis] = useState("");
  const [rightsAttested, setRightsAttested] = useState(false);
  const [publicEvidenceAllowed, setPublicEvidenceAllowed] = useState(false);
  const [rangeStart, setRangeStart] = useState(() => moveDate(todayKst, -6));
  const [rangeEnd, setRangeEnd] = useState(todayKst);
  const [batchDays, setBatchDays] = useState<AnalysisDay[]>([]);
  const counts = useMemo(() => Object.fromEntries(ALLOWED_SOURCES.map((source) => [source, rows.filter((row) => row.source === source).length])), [rows]);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatus("");
    if (file.size > MAX_FILE_BYTES) {
      setErrors(["파일은 25MB 이하여야 합니다."]);
      return;
    }
    try {
      const table = file.name.toLowerCase().endsWith(".xlsx") ? await readXlsxFile(file) as Cell[][] : parseCsv(await file.text());
      const parsed = rowsFromTable(table);
      setRows(parsed.rows);
      setErrors(validateRows(parsed.rows));
      setIgnoredBody(parsed.ignoredBody);
      setRestoredTimes(parsed.restoredTimes);
      setFileName(file.name);
    } catch (error) {
      setRows([]);
      setErrors([error instanceof Error ? error.message : "파일을 읽지 못했습니다."]);
    }
  }

  async function importRows(event: FormEvent) {
    event.preventDefault();
    if (!token.trim()) return setStatus("관리자 토큰을 입력하세요.");
    setBusy(true);
    setStatus("가져오기 준비 중…");
    try {
      let saved = 0;
      let duplicates = 0;
      for (let offset = 0; offset < rows.length; offset += IMPORT_BATCH_SIZE) {
        const batch = Math.floor(offset / IMPORT_BATCH_SIZE) + 1;
        const batches = Math.ceil(rows.length / IMPORT_BATCH_SIZE);
        setStatus(`기사 저장 중 ${batch}/${batches}`);
        const payload = rows.slice(offset, offset + IMPORT_BATCH_SIZE).map((row) => {
          const payloadRow = { ...row };
          delete (payloadRow as Partial<ImportRow>)._line;
          return payloadRow;
        });
        const response = await fetch("/api/import", { method: "POST", headers: { authorization: `Bearer ${token.trim()}`, "content-type": "application/json" }, body: JSON.stringify({ rows: payload }) });
        const result = await response.json();
        if (!response.ok) throw new Error(apiError(result, `${batch}번째 묶음 저장 실패`));
        saved += Number(result.saved ?? result.inserted) || 0;
        duplicates += Number(result.duplicates) || 0;
      }
      setStatus(`가져오기 완료: 저장 ${saved.toLocaleString("ko-KR")}건 · 중복 ${duplicates.toLocaleString("ko-KR")}건`);
      setRows([]);
      setFileName("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "가져오기에 실패했습니다.");
    } finally { setBusy(false); }
  }

  async function runAnalysis() {
    if (!token.trim()) return setStatus("관리자 토큰을 입력하세요.");
    setBusy(true);
    setStatus(`${analysisDate} 기사 분석 중…`);
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers: { authorization: `Bearer ${token.trim()}`, "content-type": "application/json" }, body: JSON.stringify({ date: analysisDate }) });
      const result = await response.json();
      if (!response.ok) throw new Error(apiError(result, "분석에 실패했습니다."));
      setStatus(`분석 완료: 기사 ${result.articleCount.toLocaleString("ko-KR")}건 · 승인 본문 ${Number(result.authorizedBodyCount ?? 0).toLocaleString("ko-KR")}건 · 이슈 ${result.issueCount.toLocaleString("ko-KR")}개`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "분석에 실패했습니다.");
    } finally { setBusy(false); }
  }

  async function registerContent(event: FormEvent) {
    event.preventDefault();
    if (!token.trim()) return setStatus("관리자 토큰을 입력하세요.");
    if (!rightsAttested) return setStatus("본문을 분석할 수 있는 권한을 먼저 확인하세요.");
    setBusy(true);
    setStatus("승인된 본문을 비공개 저장소에 등록하는 중…");
    try {
      const response = await fetch("/api/content", {
        method: "POST",
        headers: { authorization: `Bearer ${token.trim()}`, "content-type": "application/json" },
        body: JSON.stringify({
          url: contentUrl,
          body: contentBody,
          acquired_at: new Date().toISOString(),
          acquisition_method: contentMethod,
          usage_basis: usageBasis,
          analysis_allowed: true,
          public_evidence_allowed: publicEvidenceAllowed,
          rights_attested: rightsAttested,
          extractor_version: "admin-manual-v1",
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(apiError(result, "본문을 등록하지 못했습니다."));
      setStatus(`본문 등록 완료: ${result.source} · ${Number(result.bodyCharacters).toLocaleString("ko-KR")}자 · 다음 분석부터 반영`);
      setContentUrl("");
      setContentBody("");
      setUsageBasis("");
      setRightsAttested(false);
      setPublicEvidenceAllowed(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "본문을 등록하지 못했습니다.");
    } finally { setBusy(false); }
  }

  async function fetchBatchStatus() {
    batchDateRange(rangeStart, rangeEnd);
    const response = await fetch(`/api/analysis/runs?start=${encodeURIComponent(rangeStart)}&end=${encodeURIComponent(rangeEnd)}`, {
      headers: { authorization: `Bearer ${token.trim()}` },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(apiError(result, "기간 분석 상태를 불러오지 못했습니다."));
    const days = (result.days ?? []) as AnalysisDay[];
    setBatchDays(days);
    return days;
  }

  async function loadBatchStatus() {
    if (!token.trim()) return setStatus("관리자 토큰을 입력하세요.");
    setBusy(true);
    setStatus(`${rangeStart}~${rangeEnd} 분석 상태 확인 중…`);
    try {
      const days = await fetchBatchStatus();
      const complete = days.filter((day) => day.status === "success").length;
      setStatus(`기간 상태 확인: ${days.length}일 중 ${complete}일 분석 완료`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "기간 분석 상태를 불러오지 못했습니다.");
    } finally { setBusy(false); }
  }

  async function runBatchAnalysis() {
    if (!token.trim()) return setStatus("관리자 토큰을 입력하세요.");
    let requestedDates: string[];
    try {
      requestedDates = batchDateRange(rangeStart, rangeEnd);
    } catch (error) {
      return setStatus(error instanceof Error ? error.message : "분석 기간을 확인하세요.");
    }
    setBusy(true);
    let completed = 0;
    let skipped = 0;
    let failed = 0;
    try {
      const existing = await fetchBatchStatus();
      for (const [index, date] of requestedDates.entries()) {
        const current = existing.find((day) => day.date === date);
        if (current?.status === "success") {
          skipped += 1;
          continue;
        }
        if (current?.status === "empty" || !current?.articleCount) {
          skipped += 1;
          continue;
        }
        setStatus(`기간 분석 ${index + 1}/${requestedDates.length}: ${date} 분석 중…`);
        setBatchDays((days) => days.map((day) => day.date === date ? { ...day, status: "running", errorMessage: null } : day));
        try {
          const response = await fetch("/api/analyze", {
            method: "POST",
            headers: { authorization: `Bearer ${token.trim()}`, "content-type": "application/json" },
            body: JSON.stringify({ date }),
          });
          const result = await response.json();
          if (!response.ok) {
            if (response.status === 401) throw new Error(apiError(result, "관리자 토큰이 올바르지 않습니다."));
            failed += 1;
            setBatchDays((days) => days.map((day) => day.date === date ? { ...day, status: "failed", errorMessage: apiError(result, "분석 실패") } : day));
            continue;
          }
          completed += 1;
          setBatchDays((days) => days.map((day) => day.date === date ? { ...day, status: "success", analyzedArticleCount: result.articleCount, issueCount: result.issueCount, errorMessage: null } : day));
        } catch (error) {
          if (error instanceof Error && error.message.includes("토큰")) throw error;
          failed += 1;
          setBatchDays((days) => days.map((day) => day.date === date ? { ...day, status: "failed", errorMessage: error instanceof Error ? error.message : "분석 실패" } : day));
        }
      }
      setStatus(`기간 분석 완료: 신규 ${completed}일 · 기존/기사 없음 ${skipped}일 · 실패 ${failed}일${failed ? " · 다시 실행하면 실패 날짜부터 이어집니다." : ""}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "기간 분석을 완료하지 못했습니다.");
    } finally { setBusy(false); }
  }

  return <div className="admin-body">
    <a className="skip-link" href="#import-form">가져오기 화면으로 건너뛰기</a>
    <header className="admin-topbar">
      <Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">AF</span><span className="brand-copy"><b>AgendaFrame</b><small>DATA ADMIN</small></span></Link>
      <Link className="admin-back" href="/">공개 화면 보기</Link>
    </header>
    <main className="admin-main">
      <section className="admin-intro">
        <p className="eyebrow">NO-COST DATA PIPELINE</p>
        <h1>실데이터를 넣고,<br /><em>분석까지 실행합니다.</em></h1>
        <p>기사 메타데이터와 홈페이지 관측을 먼저 저장하고, 이용 권한이 확인된 본문만 별도 비공개 저장소에서 분석합니다.</p>
      </section>

      <section className="import-card" aria-labelledby="import-title">
        <header><div><p className="eyebrow">STEP 01</p><h2 id="import-title">기사 가져오기</h2></div><a className="template-link" href="/templates/agendaframe-import.csv" download>빈 양식 받기</a></header>
        <form id="import-form" onSubmit={importRows}>
          <label className="field-label" htmlFor="import-token">관리자 토큰</label>
          <input id="import-token" value={token} onChange={(event) => setToken(event.target.value)} type="password" autoComplete="off" required placeholder="배포 때 설정한 IMPORT_TOKEN" />
          <p className="field-help">토큰은 브라우저 저장소에 저장하지 않으며 가져오기와 분석 요청에만 사용합니다.</p>
          <label className={`file-drop ${fileName ? "active" : ""}`} htmlFor="data-file"><span>{fileName || "BigKinds .xlsx 또는 UTF-8 .csv 선택"}</span><small>최대 20,000행 · 25MB · 본문은 전송하지 않음</small></label>
          <input className="sr-only" id="data-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv" onChange={chooseFile} />
          <div className="import-preview" aria-live="polite">
            {!rows.length && !errors.length && <p>파일을 선택하면 5개 언론사별 건수와 형식 오류를 먼저 확인합니다.</p>}
            {!!rows.length && <><div className="preview-summary"><span>전체 {rows.length.toLocaleString("ko-KR")}건</span>{ALLOWED_SOURCES.map((source) => <span key={source}>{source} {counts[source]}건</span>)}</div>{ignoredBody && <p className="preview-ok">본문 열은 감지했지만 서버로 전송하지 않습니다.</p>}{restoredTimes && <p className="preview-ok">뉴스 식별자에서 실제 게시 시각(시·분·초, KST)을 복원했습니다.</p>}</>}
            {!!errors.length && <ul className="preview-errors">{errors.slice(0, 8).map((error) => <li key={error}>{error}</li>)}{errors.length > 8 && <li>그 외 {errors.length - 8}개 오류</li>}</ul>}
            {!!rows.length && !errors.length && <p className="preview-ok">형식 검증을 통과했습니다. 500건씩 나눠 안전하게 저장합니다.</p>}
          </div>
          <button className="import-submit" type="submit" disabled={!rows.length || !!errors.length || busy}>{busy ? "처리 중…" : "검증된 기사 가져오기"}</button>
        </form>
      </section>

      <section className="import-card content-card" aria-labelledby="content-title">
        <header><div><p className="eyebrow">STEP 02</p><h2 id="content-title">승인된 본문 등록</h2></div><span className="private-badge">비공개 분석 전용</span></header>
        <form className="content-form" onSubmit={registerContent}>
          <label><span>이미 가져온 기사 URL</span><input type="url" value={contentUrl} onChange={(event) => setContentUrl(event.target.value)} placeholder="https://언론사.example/article" required /></label>
          <div className="content-fields">
            <label><span>확보 방식</span><select value={contentMethod} onChange={(event) => setContentMethod(event.target.value)}><option value="manual_research">승인된 연구 표본</option><option value="licensed_export">라이선스 데이터</option><option value="publisher_api">언론사 API</option><option value="authorized_crawl">허가된 수집</option></select></label>
            <label><span>이용 근거</span><input value={usageBasis} onChange={(event) => setUsageBasis(event.target.value)} minLength={10} maxLength={500} placeholder="협약·허가·연구 이용 범위를 기록" required /></label>
          </div>
          <label><span>기사 본문</span><textarea value={contentBody} onChange={(event) => setContentBody(event.target.value)} minLength={300} maxLength={200000} rows={10} placeholder="분석 권한이 확인된 기사 전문만 입력하세요." required /></label>
          <p className="field-help">본문은 공개 API로 제공하지 않으며 프레임 근거 탐색에만 사용합니다. BigKinds의 200자 미리보기는 기사 전문으로 등록하지 마세요.</p>
          <label className="consent-row"><input type="checkbox" checked={rightsAttested} onChange={(event) => setRightsAttested(event.target.checked)} /><span>이 본문을 저장·자동 분석할 권한 또는 명확한 이용 근거를 확인했습니다.</span></label>
          <label className="consent-row"><input type="checkbox" checked={publicEvidenceAllowed} onChange={(event) => setPublicEvidenceAllowed(event.target.checked)} /><span>짧은 근거 문장의 공개가 허용된 자료입니다. 선택하지 않으면 근거 문장을 숨깁니다.</span></label>
          <button className="import-submit" type="submit" disabled={busy || !rightsAttested || contentBody.length < 300}>{busy ? "처리 중…" : "승인 본문 등록"}</button>
        </form>
      </section>

      <section className="import-card analysis-card" aria-labelledby="analysis-title">
        <header><div><p className="eyebrow">STEP 03</p><h2 id="analysis-title">분석 생성</h2></div><span className="free-badge">근거 범위 자동 구분</span></header>
        <div className="single-analysis">
          <h3>하루 분석</h3>
          <label className="field-label" htmlFor="analysis-date">분석할 날짜 (KST)</label>
          <input id="analysis-date" className="admin-date" type="date" value={analysisDate} onChange={(event) => setAnalysisDate(event.target.value)} />
          <p className="field-help">본문이 승인된 기사는 본문 표현 단서를, 나머지는 제목 단서만 분석합니다. 두 결과는 화면에서 구분합니다.</p>
          <button className="import-submit" type="button" onClick={runAnalysis} disabled={busy || !analysisDate}>{busy ? "처리 중…" : "분석 실행"}</button>
        </div>
        <div className="batch-analysis">
          <div className="batch-heading"><div><h3>기간 일괄 분석</h3><p>완료된 날짜는 건너뛰고 실패·미완료 날짜만 이어서 분석합니다.</p></div><span>최대 7일</span></div>
          <div className="batch-dates">
            <label><span>시작일</span><input className="admin-date" type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} /></label>
            <label><span>종료일</span><input className="admin-date" type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} /></label>
          </div>
          <div className="batch-actions">
            <button type="button" onClick={loadBatchStatus} disabled={busy}>상태 확인</button>
            <button type="button" onClick={runBatchAnalysis} disabled={busy}>{busy ? "처리 중…" : "기간 분석 시작"}</button>
          </div>
          {!!batchDays.length && <div className="batch-status-list" aria-label="기간 분석 상태">{batchDays.map((day) => <div key={day.date} data-status={day.status}>
            <time>{day.date}</time><span>{day.articleCount.toLocaleString("ko-KR")}건</span><b>{({ pending: "대기", running: "분석 중", success: "완료", failed: "실패", empty: "기사 없음" } as const)[day.status]}</b><small>{day.status === "success" ? `이슈 ${day.issueCount}개` : day.errorMessage ?? ""}</small>
          </div>)}</div>}
        </div>
        {status && <p className="admin-status" role="status">{status}</p>}
      </section>

      <QualityReview token={token} analysisDate={analysisDate} />

      <section className="admin-guide" aria-labelledby="guide-title">
        <div><p className="eyebrow">OPERATION GUIDE</p><h2 id="guide-title">운영 순서</h2></div>
        <dl>
          <div><dt>1. BigKinds</dt><dd><a href="https://www.bigkinds.or.kr/v2/news/search.do" target="_blank" rel="noopener noreferrer">뉴스 검색·분석 열기</a> → 기간과 5개 언론사 선택 → Excel 다운로드</dd></div>
          <div><dt>2. 가져오기</dt><dd>기사 본문을 제외한 언론사·제목·원문 URL·일자·분류만 검증해 저장</dd></div>
          <div><dt>3. 본문 권한</dt><dd>서면 허가·라이선스·연구 범위가 확인된 기사만 별도 등록. 공개 근거 허용 여부도 따로 기록</dd></div>
          <div><dt>4. 분석</dt><dd>하루 분석 또는 최대 7일 기간 분석 실행. 승인 본문과 제목 단서의 근거 범위를 분리해 저장</dd></div>
          <div><dt>5. 품질 검증</dt><dd>상위 30~50개 이슈의 잘못 묶인 기사와 누락 기사를 기록하고 정밀도·재현율 추정치를 확인</dd></div>
        </dl>
        <p>현재 단계에서는 D1과 규칙 분석만 사용하므로 별도 Google Cloud 사용료가 발생하지 않습니다.</p>
      </section>
    </main>
  </div>;
}
