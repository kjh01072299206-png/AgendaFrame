#!/usr/bin/env node
// 렌더 회귀 채점기. 규칙별로 결함을 판정하고 error 가 남으면 exit 1.
//
//   node scripts/audit-site.mjs --url http://127.0.0.1:3000
//   node scripts/audit-site.mjs --url ... --fast --against baseline.json
//   node scripts/audit-site.mjs --url ... --selftest      규칙이 실제로 발동하는지
//
// 웨이버는 scripts/audit-waivers.json 의 {rule, match, reason}. 아무 것도 잡지
// 못하는 웨이버는 STALE-WAIVER 로 실패한다 — 죽은 예외를 남기지 않기 위해.

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { comparisonReleaseFailures } from "./comparison-release-gate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const BASE = (opt("url", "http://127.0.0.1:3000")).replace(/\/$/, "");
const FAST = flag("fast");
const SHOTS = opt("shots");
const JSON_OUT = opt("json");
const AGAINST = opt("against");
const SELFTEST = flag("selftest");
const RELEASE = flag("release");

const VIEWPORTS = FAST
  ? [{ w: 1280, scheme: "light" }]
  : [{ w: 1440, scheme: "light" }, { w: 1280, scheme: "dark" }, { w: 900, scheme: "light" }, { w: 390, scheme: "light" }, { w: 390, scheme: "dark" }];

const RULES = {
  "HOME-PARITY": { sev: "error", hint: "공개 홈이 프로토타입의 분야 분포 → 의제 카드 → 갈림 요약 구성을 유지해야 한다." },
  "JS-ERROR": { sev: "error", hint: "콘솔 오류·예외. 렌더 경로가 깨졌다는 뜻이므로 먼저 고친다." },
  "HTTP": { sev: "error", hint: "2xx 가 아닌 응답. 라우트가 없거나 서버가 던졌다." },
  "DUP-ID": { sev: "error", hint: "같은 id 가 둘 이상. 템플릿이 조각을 반복 출력한다." },
  "DOC-OVERFLOW": { sev: "error", hint: "문서가 뷰포트보다 넓다 → 가로 스크롤. 격자 칸에 min-width:0 이 빠졌는지 본다." },
  "SPILL": { sev: "error", hint: "자식이 부모보다 넓다. 부모에 overflow-x:auto 를 주거나 폭을 줄인다." },
  "DESK-CLIP": { sev: "error", hint: "넓은 화면(≥1200px)에서 표가 잘린다. 넓은 표는 전폭 패널로 옮긴다." },
  "EMPTY-PANEL": { sev: "error", hint: "패널 본문이 비었다. 데이터가 없으면 패널을 렌더하지 않는다." },
  "CONTRAST": { sev: "error", hint: "글자 대비가 WCAG AA 미달(본문 4.5:1, 큰 글자 3:1)." },
  "MONO-NUM": { sev: "error", hint: "표시용 숫자에 모노스페이스. 마침표·쉼표가 벌어져 '23 . 7'로 읽힌다." },
  "TAP-SIZE": { sev: "error", hint: "좁은 화면 터치 대상이 24×24px 미만(WCAG 2.5.8)." },
  "FOCUS-RING": { sev: "error", hint: "Tab 초점에 보이는 링이 없다." },
  "SVG-LABEL": { sev: "error", hint: "svg 에 role=img + aria-label 이 없다(장식이면 aria-hidden)." },
  "TEXT-COLLIDE": { sev: "error", hint: "SVG 글자끼리 겹친다." },
  "ARIA-CURRENT": { sev: "error", hint: "현재 화면을 나타내는 aria-current 가 정확히 1개가 아니다." },
  "HEAD-META": { sev: "error", hint: "lang·title·viewport 누락." },
  "BLANK-REL": { sev: "warn", hint: 'target=_blank 에 rel="noopener" 가 없다.' },
  "HEADING-SKIP": { sev: "warn", hint: "제목 단계가 뛴다(h1 → h3)." },
  "FIRST-SCREEN": { sev: "error", hint: "첫 화면의 핵심 정보 구조가 0 스크롤에서 보이지 않거나 숨겨졌다." },
  "ANALYSIS-RELEASE": { sev: "error", hint: "배포에는 현재 계약의 실제 분석 결과가 필요하며, 전부 보류인 화면은 완료가 아니다." },
  "INTERACTION": { sev: "error", hint: "390px 분석 화면의 제목·탭·근거 펼침·비교 카드 조작이 동작하지 않는다." },
  "STALE-WAIVER": { sev: "error", hint: "아무 것도 잡지 않는 웨이버. 고쳐졌으면 지운다." },
};

// A first-screen target is readable when at least half of the target block
// and a minimum number of pixels are inside the 0-scroll viewport. A 1px
// intersection is not evidence that a sentence or table row can be read;
// naturally tall article rows may continue below the fold.
const FIRST_SCREEN_REQUIREMENTS = {
  "사건 설명 문장": { minVisibleHeight: 20, minVisibleRatio: 1 },
  "비교 질문": { minVisibleHeight: 20, minVisibleRatio: 1 },
  "대표 비교 카드 제목": { minVisibleHeight: 20, minVisibleRatio: 1 },
  "비교 카드 대신 보류 상태": { minVisibleHeight: 48, minVisibleRatio: 0.5 },
  "프레이밍 요약": { minVisibleHeight: 20, minVisibleRatio: 0.5 },
  "프레임 4기능 표 헤더": { minVisibleHeight: 30, minVisibleRatio: 0.5 },
  "프레임 4기능 첫 기사 행": { minVisibleHeight: 90, minVisibleRatio: 0.5 },
};

async function loadChromium() {
  const req = createRequire(import.meta.url);
  const cands = [
    () => req.resolve("playwright-core"),
    () => process.env.AF_PW,
    () => process.env.CLAUDE_JOB_DIR && path.join(process.env.CLAUDE_JOB_DIR, "tmp", "node_modules", "playwright-core", "index.js"),
  ];
  for (const c of cands) {
    let p;
    try { p = c(); } catch { continue; }
    if (!p || !fs.existsSync(p)) continue;
    const mod = req(p);
    if (mod?.chromium) return mod.chromium;
  }
  throw new Error("playwright-core 를 못 찾았습니다. AF_PW=<경로/index.js> 로 지정하세요.");
}

/* 브라우저를 찾는 곳은 OS 마다 다르다. 이 관문을 팀원 PC 와 CI(우분투)에서도
   돌려야 하므로 세 곳을 모두 본다:
     PLAYWRIGHT_BROWSERS_PATH (명시) · %LOCALAPPDATA%/ms-playwright (윈도) ·
     ~/.cache/ms-playwright (리눅스·맥, npx playwright install 기본 위치) */
function chromePath() {
  if (process.env.AF_CHROME) return process.env.AF_CHROME;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright"),
    process.env.HOME && path.join(process.env.HOME, ".cache", "ms-playwright"),
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, ".cache", "ms-playwright"),
  ].filter(Boolean);
  const rels = [
    "chrome-win64/chrome.exe",
    "chrome-linux/chrome",
    "chrome-linux64/chrome",
    "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs
      .readdirSync(root)
      .filter((d) => d.startsWith("chromium-"))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const d of dirs)
      for (const rel of rels) {
        const p = path.join(root, d, rel);
        if (fs.existsSync(p)) return p;
      }
  }
  throw new Error(
    `chromium 실행 파일을 못 찾았습니다. 찾아본 곳: ${roots.join(" · ") || "(없음)"}\n` +
      "npx playwright install chromium 을 실행하거나 AF_CHROME=<실행 파일 경로> 로 지정하세요.",
  );
}

// 페이지 안에서 도는 수집기. 판정 임계값이 전부 여기 있어서 한 곳만 읽으면 된다.
function collect({ w, isDesktop, route = "", firstScreenRequirements = {} }) {
  const out = {};
  const push = (rule, where) => (out[rule] ||= []).push(where);
  const cls = (el) => {
    const c = el.getAttribute ? el.getAttribute("class") : null;
    return (el.tagName.toLowerCase() + (c ? "." + c.trim().replace(/\s+/g, ".") : "")).slice(0, 54);
  };
  const root = document.querySelector(".afs-shell") || document.body;
  if (location.pathname === "/") {
    const panels = [...document.querySelectorAll(".afp-home-panel > h2")].map((el) => el.textContent.trim());
    const expected = ["그날 언론이 가장 많이 다룬 분야", "오늘의 의제 순위", "오늘의 갈림 한 장면"];
    if (panels.join("|") !== expected.join("|")) push("HOME-PARITY", "홈 구역의 순서 또는 제목이 다름");
    const cards = [...document.querySelectorAll(".afp-home-issue-link")];
    if (cards.length !== 5 || cards.some((el) => !el.getAttribute("href")?.endsWith("/outlets"))) push("HOME-PARITY", "상위 5개 의제 카드·비교 경로 누락");
    const loadedFont = [...document.fonts].some((font) => font.family.includes("Pretendard Variable") && font.status === "loaded");
    if (!loadedFont) push("HOME-PARITY", "프로토타입 글꼴이 실제로 로드되지 않음");
    if (innerWidth > 860) {
      const side = document.querySelector(".afs-side");
      if (!side || Math.abs(side.getBoundingClientRect().width - 236) > 1) push("HOME-PARITY", "데스크톱 내비 너비가 236px와 다름");
    }
  }

  const firstScreen = [];
  const recordFirstScreen = (label, selector, el = document.querySelector(selector)) => {
    if (!el) {
      firstScreen.push({ label, selector, visible: false, reason: "selector missing" });
      push("FIRST-SCREEN", `${label} 없음 (${selector})`);
      return;
    }
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const requirement = firstScreenRequirements[label] ?? { minVisibleHeight: 20, minVisibleRatio: 0.5 };
    const effectiveRequirement = { ...requirement, minVisibleHeight: Math.min(requirement.minVisibleHeight, rect.height) };
    const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    const visibleRatio = rect.height > 0 ? visibleHeight / rect.height : 0;
    const hit = visibleHeight > 0 ? document.elementFromPoint(
      Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2)),
      Math.max(0, rect.top) + visibleHeight / 2,
    ) : null;
    const occluded = !hit || (hit !== el && !el.contains(hit));
    const visible = window.scrollY === 0
      && style.display !== "none"
      && style.visibility !== "hidden"
      && Number(style.opacity) >= 0.6
      && rect.width > 0
      && rect.height > 0
      && rect.top >= 0
      && !occluded
      && visibleHeight >= effectiveRequirement.minVisibleHeight
      && visibleRatio + 0.001 >= effectiveRequirement.minVisibleRatio;
    const box = {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    firstScreen.push({
      label,
      selector,
      visible,
      occluded,
      fullyContained: rect.top >= 0 && rect.bottom <= window.innerHeight,
      visibleHeight: Math.round(visibleHeight),
      visibleRatio: Number(visibleRatio.toFixed(2)),
      required: effectiveRequirement,
      box,
    });
    if (!visible) push("FIRST-SCREEN", `${label} ${selector} box=${JSON.stringify(box)} visible=${Math.round(visibleHeight)}px/${Math.round(rect.height)}px ratio=${visibleRatio.toFixed(2)} scrollY=${Math.round(window.scrollY)}`);
  };
  if ((route.endsWith("/outlets") || route.endsWith("/framing")) && w === 1440) {
    if (route.endsWith("/outlets")) {
      recordFirstScreen("사건 설명 문장", "#sec-event-summary .afp-event-first");
      recordFirstScreen("비교 질문", "#sec-comparison-axis .afp-axis-question-v2");
      if (document.querySelector("#sec-camps .afp-camp-card-v2 .afp-camp-headline")) {
        [...document.querySelectorAll("#sec-camps .afp-camp-grid-v2 .afp-camp-headline")].forEach((title, index) => {
          recordFirstScreen("대표 비교 카드 제목", `#sec-camps .afp-camp-grid-v2 > :nth-child(${index + 1}) .afp-camp-headline`, title);
        });
      } else {
        recordFirstScreen("비교 카드 대신 보류 상태", "#sec-camps .afp-no-groups");
      }
    } else {
      recordFirstScreen("프레이밍 요약", "#sec-synthesis .afp-summary p:first-of-type");
      recordFirstScreen("프레임 4기능 표 헤더", "#sec-four-functions thead");
      recordFirstScreen("프레임 4기능 첫 기사 행", "#sec-four-functions tbody tr:first-child");
    }
  }
  out.__firstScreen = firstScreen;

  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) push("DOC-OVERFLOW", `문서 ${de.scrollWidth}px > 뷰포트 ${de.clientWidth}px`);
  const seen = new Set();
  for (const el of document.querySelectorAll("[id]")) {
    if (seen.has(el.id)) push("DUP-ID", `#${el.id}`);
    seen.add(el.id);
  }
  if (!de.lang) push("HEAD-META", "html[lang] 없음");
  if (!document.title.trim()) push("HEAD-META", "title 비었음");
  if (!document.querySelector("meta[name=viewport]")) push("HEAD-META", "meta viewport 없음");

  for (const el of root.querySelectorAll("*")) {
    // Closed disclosure content has no layout, and display:contents has no
    // parent box. Compare visible elements with their actual containing box;
    // neither a zero-width disclosure nor a contents wrapper can overflow.
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    let p = el.parentElement;
    while (p && getComputedStyle(p).display === "contents") p = p.parentElement;
    if (!p || el.closest("svg")) continue;
    if (getComputedStyle(el).overflowX === "auto") continue;
    if (getComputedStyle(p).overflowX === "auto") continue;
    if (el.scrollWidth > p.clientWidth + 2) push("SPILL", `${cls(el)} ${el.scrollWidth} > 부모 ${p.clientWidth}`);
  }

  if (isDesktop)
    for (const s of document.querySelectorAll(".afs-scroll")) {
      if (s.scrollWidth > s.clientWidth + 1)
        push("DESK-CLIP", `${s.scrollWidth}>${Math.round(s.clientWidth)} ${(s.querySelector("caption,th")?.textContent || cls(s)).trim().slice(0, 24)}`);
    }

  for (const n of document.querySelectorAll(".afs-in")) {
    if (!n.textContent.trim()) push("EMPTY-PANEL", (n.closest(".afs-card")?.querySelector("h2,h3")?.textContent || "?").trim().slice(0, 26));
  }

  for (const s of root.querySelectorAll("svg")) {
    if (s.getAttribute("aria-hidden") !== "true" && !(s.getAttribute("role") === "img" && s.getAttribute("aria-label")))
      push("SVG-LABEL", `${cls(s)} «${(s.querySelector("text")?.textContent || "").trim().slice(0, 18)}»`);
    const rs = [...s.querySelectorAll("text")].map((t) => t.getBoundingClientRect());
    let hits = 0;
    for (let a = 0; a < rs.length; a++)
      for (let b = a + 1; b < rs.length; b++) {
        const ox = Math.min(rs[a].right, rs[b].right) - Math.max(rs[a].left, rs[b].left);
        const oy = Math.min(rs[a].bottom, rs[b].bottom) - Math.max(rs[a].top, rs[b].top);
        if (ox > 1 && oy > 1 && ox * oy > 6) hits++;
      }
    if (hits) push("TEXT-COLLIDE", `${cls(s)} 겹침 ${hits}쌍`);
  }

  for (const sel of [".afs-num", ".afs-kpi dd", ".afs-heat td", ".afs-donut-hole", ".afs-hb-row > b"]) {
    for (const el of [...document.querySelectorAll(sel)].slice(0, 3)) {
      const ff = getComputedStyle(el).fontFamily.toLowerCase();
      if (/mono|consolas|courier|menlo/.test(ff)) push("MONO-NUM", `${sel} → ${ff.slice(0, 40)}`);
    }
  }

  // 대비 — 색 문자열은 캔버스에 1px 찍어 읽는다(color-mix()/color(srgb ..) 오판 방지)
  const cx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
  const parse = (c) => {
    if (!c || c === "transparent" || c === "none") return null;
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "rgba(0,0,0,0)";
    cx.fillStyle = c;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  };
  const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
  const bgOf = (el) => {
    const chain = [];
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.004) { chain.push(c); if (c.a >= 0.995) break; }
    }
    chain.push({ r: 255, g: 255, b: 255, a: 1 });
    let base = chain[chain.length - 1];
    for (let i = chain.length - 2; i >= 0; i--) base = over(chain[i], base);
    return base;
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const dedup = new Set();
  for (const el of root.querySelectorAll("*")) {
    if (el.closest("svg")) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length)) continue;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || +st.opacity < 0.6) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.right <= 0 || r.bottom <= 0) continue;
    if (/inset\(\s*(?:50|100)%/.test(st.clipPath) || /rect\(0px,?\s*0px/.test(st.clip)) continue;
    const bg = bgOf(el);
    let fg = parse(st.color);
    if (!fg) continue;
    if (fg.a < 0.995) fg = over(fg, bg);
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(st.fontSize), bold = +st.fontWeight >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (ratio + 0.05 < need) {
      const key = `${cls(el)}|${ratio.toFixed(1)}`;
      if (dedup.has(key)) continue;
      dedup.add(key);
      push("CONTRAST", `${cls(el)} ${ratio.toFixed(2)}:1 (필요 ${need}) «${el.textContent.trim().slice(0, 16)}»`);
    }
  }

  if (w <= 480)
    for (const el of document.querySelectorAll("button, a[href], select, summary, [role=button]")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (getComputedStyle(el).display === "inline" && el.closest("p, li, td")) continue;
      if (r.width < 24 || r.height < 24) push("TAP-SIZE", `${cls(el)} ${Math.round(r.width)}×${Math.round(r.height)} «${el.textContent.trim().slice(0, 14)}»`);
    }

  let prev = 1;
  for (const h of root.querySelectorAll("h1, h2, h3, h4")) {
    const lv = +h.tagName[1];
    if (lv > prev + 1) push("HEADING-SKIP", `h${prev} → h${lv} «${h.textContent.trim().slice(0, 20)}»`);
    prev = lv;
  }
  for (const a of document.querySelectorAll("a[target=_blank]")) if (!/noopener|noreferrer/.test(a.rel)) push("BLANK-REL", (a.textContent || a.href).trim().slice(0, 30));

  const cur = document.querySelectorAll('.afs-nav a[aria-current="page"]').length;
  if (root.querySelector(".afs-nav") && cur !== 1) push("ARIA-CURRENT", `사이드바 aria-current=page ${cur}개`);

  return out;
}

const findings = [];
const firstScreenReports = [];
const interactionReports = [];
const comparisonReports = [];
const add = (rule, where, at) => findings.push({ rule, sev: RULES[rule]?.sev || "error", where, at, id: `${rule}@${at}` });

const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: chromePath() });
const t0 = Date.now();

// Deterministic regression: hidden disclosure content and display:contents
// wrappers must not create false overflow reports; real overflow must still fail.
if (flag("spill-selftest")) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(`<html lang="ko"><head><title>Overflow regression</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
    <main class="afs-shell">
      <details><summary>Closed</summary><a style="display:block;width:500px;height:24px">Hidden content</a></details>
      <nav style="width:100px;overflow-x:auto"><div style="display:contents"><a style="display:block;width:200px;height:24px">Scrollable content</a></div></nav>
      <div style="width:100px"><div class="real-spill-child" style="width:200px;height:24px">Real overflow</div></div>
    </main></body></html>`);
  const spills = (await page.evaluate(collect, { w: 390, isDesktop: false, route: "/regression" }))["SPILL"] ?? [];
  await browser.close();
  const passed = spills.length === 1 && spills[0].includes("real-spill-child");
  console.log(`Overflow regression: ${passed ? "PASS" : "FAIL"} (${JSON.stringify(spills)})`);
  process.exit(passed ? 0 : 1);
}

async function discoverIssueIds(page) {
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForTimeout(200);
  return await page.evaluate(() => [...new Set([
    ...[...document.querySelectorAll('a[href^="/issues/"]')]
      .map((link) => link.getAttribute("href") || "")
      .map((href) => href.split("?")[0].split("#")[0])
      .filter((href) => /^\/issues\/[^/]+$/.test(href))
      .map((href) => decodeURIComponent(href.slice("/issues/".length))),
    ...[...document.querySelectorAll("select option")]
      .map((option) => option.getAttribute("value") || "")
      .filter(Boolean),
  ])].slice(0, 5));
}

async function checkOutletsMobileInteractions(page) {
  const initial = await page.evaluate(() => {
    const visible = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity) >= 0.6
        && rect.width >= 24
        && rect.height >= 24;
    };
    const failures = [];
    const checks = ["페이지 제목", "현재 화면 내비게이션"];
    if (!visible(".afp-page-title-line h1")) failures.push("페이지 제목이 보이지 않습니다");
    if (!visible('.afs-nav a[aria-current="page"]')) failures.push("현재 화면 내비게이션이 보이지 않습니다");

    const evidence = document.querySelector("#sec-evidence details.afp-article");
    const evidenceSummary = evidence?.querySelector(":scope > summary");
    checks.push("기사 근거 펼침");
    if (!evidence || !evidenceSummary) {
      failures.push("기사 근거 펼침 대상이 없습니다");
    } else {
      evidenceSummary.click();
    }

    const cards = [...document.querySelectorAll("#sec-camps .afp-camp-card-v2:not(.afp-camp-card-secondary)")];
    const targetIndex = cards.findIndex((card) => card.getAttribute("aria-expanded") !== "true");
    const resolvedIndex = targetIndex >= 0 ? targetIndex : cards.length ? 0 : -1;
    const target = resolvedIndex >= 0 ? cards[resolvedIndex] : null;
    checks.push(target ? "비교 카드 선택" : "비교 보류 상태");
    if (target) {
      target.click();
    } else if (!visible("#sec-camps .afp-no-groups")) {
      failures.push("비교 카드 또는 보류 상태가 없습니다");
    }
    return {
      failures,
      checks,
      evidencePresent: Boolean(evidence),
      evidenceWasOpen: Boolean(evidence?.open),
      targetIndex: resolvedIndex,
      cardWasExpanded: target?.getAttribute("aria-expanded") === "true",
    };
  });
  await page.waitForTimeout(80);
  const after = await page.evaluate(({ targetIndex }) => {
    const evidence = document.querySelector("#sec-evidence details.afp-article");
    const cards = [...document.querySelectorAll("#sec-camps .afp-camp-card-v2:not(.afp-camp-card-secondary)")];
    return {
      evidenceOpen: Boolean(evidence?.open),
      cardExpanded: targetIndex >= 0 ? cards[targetIndex]?.getAttribute("aria-expanded") === "true" : null,
    };
  }, initial);
  const failures = [...initial.failures];
  if (initial.evidencePresent && !after.evidenceOpen) failures.push("기사 근거 펼침이 열리지 않습니다");
  if (initial.targetIndex >= 0 && after.cardExpanded === initial.cardWasExpanded) failures.push("비교 카드 선택 상태가 바뀌지 않습니다");
  return { checks: initial.checks, failures };
}

if (SELFTEST) {
  const selftestPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const selftestIssues = await discoverIssueIds(selftestPage);
  const ISSUE = selftestIssues[0];
  await selftestPage.close();
  if (!ISSUE) throw new Error("active home has no issue links for the render self-test");
  const CASES = [
    ["SPILL", "/", "격자 칸에 3000px 요소를 넣는다", () => { const d = document.createElement("div"); d.style.width = "3000px"; d.textContent = "x"; document.querySelector(".afs-in").appendChild(d); }],
    ["DESK-CLIP", `/issues/${ISSUE}/outlets`, "표를 4000px 로 늘린다", () => { document.querySelector(".afs-scroll table").style.minWidth = "4000px"; }],
    ["EMPTY-PANEL", "/", "패널 본문을 비운다", () => { document.querySelector(".afs-in").textContent = ""; }],
    ["MONO-NUM", "/", "숫자를 모노스페이스로 바꾼다", () => { document.querySelectorAll(".afs-kpi dd").forEach((e) => (e.style.fontFamily = "Consolas, monospace")); }],
    ["CONTRAST", "/", "글자색을 배경색과 같게 만든다", () => { const e = document.querySelector(".afs-in p"); e.style.color = getComputedStyle(e.closest(".afs-card")).backgroundColor; }],
    ["DUP-ID", "/", "id 를 중복시킨다", () => { const n = document.querySelector("[id]"); n.parentElement.appendChild(n.cloneNode(false)); }],
    ["SVG-LABEL", "/", "svg 의 role·aria-label·aria-hidden 을 떼어낸다", () => { const s = document.querySelector(".afs-shell svg"); s.removeAttribute("role"); s.removeAttribute("aria-label"); s.removeAttribute("aria-hidden"); }],
    ["TEXT-COLLIDE", "/", "svg 글자 두 개를 같은 자리로 옮긴다", () => { const t = document.querySelectorAll("svg text"); t[1].setAttribute("x", t[0].getAttribute("x") || 0); t[1].setAttribute("y", t[0].getAttribute("y") || 0); }],
    ["ARIA-CURRENT", "/", "현재 화면 표시를 지운다", () => { document.querySelectorAll('.afs-nav a[aria-current="page"]').forEach((e) => e.removeAttribute("aria-current")); }],
    ["HEAD-META", "/", "html[lang] 을 지운다", () => document.documentElement.removeAttribute("lang")],
    ["TAP-SIZE", "/", "내비 링크를 10px 로 줄인다", () => { document.querySelectorAll(".afs-nav a").forEach((b) => { b.style.cssText += ";padding:0;min-height:0;height:10px;font-size:6px"; }); }, { w: 390 }],
    ["HEADING-SKIP", "/", "h2 를 h4 로 바꾼다", () => { const h = document.querySelector(".afs-card h2"); const n = document.createElement("h4"); n.innerHTML = h.innerHTML; h.replaceWith(n); }],
  ];
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let bad = 0;
  console.log(`\n채점기 자기검사 — 규칙 ${CASES.length}개\n`);
  for (const [rule, route, what, inject, over] of CASES) {
    await page.goto(BASE + route, { waitUntil: "load" });
    await page.waitForTimeout(240);
    const args = { w: 1280, isDesktop: true, ...over };
    const before = (await page.evaluate(collect, args))[rule] || [];
    let err = null;
    try { await page.evaluate(inject); } catch (e) { err = e.message.split("\n")[0]; }
    await page.waitForTimeout(70);
    const list = err ? [] : ((await page.evaluate(collect, args))[rule] || []);
    const fresh = list.filter((x) => !before.includes(x));
    if (!fresh.length) bad++;
    console.log(`  ${fresh.length ? "OK  " : "FAIL"} ${rule.padEnd(14)} ${what}${err ? ` — 주입 실패: ${err}` : ""}`);
    console.log(`       ↳ ${before.length} → ${list.length}건${fresh.length ? `  ${fresh[0].slice(0, 70)}` : ""}`);
  }
  await page.close();
  await browser.close();
  console.log(`\n  발동 ${CASES.length - bad}/${CASES.length}${bad ? " — 발동하지 않는 규칙은 통과를 거짓으로 보고합니다." : ""}`);
  process.exit(bad ? 2 : 0);
}

let ROUTES = [];
for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: 900 }, colorScheme: vp.scheme });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (c) => { if (c.type() === "error") errs.push(`console: ${c.text()}`); });
  const issueIds = await discoverIssueIds(page);
  const issueRoutes = issueIds.flatMap((issueId) => [
    `/issues/${encodeURIComponent(issueId)}`,
    `/issues/${encodeURIComponent(issueId)}/outlets`,
    `/issues/${encodeURIComponent(issueId)}/framing`,
    `/issues/${encodeURIComponent(issueId)}/report`,
  ]);
  const routes = FAST
    ? ["/", "/issues", ...issueRoutes.slice(0, 4), "/tools/self-check", "/tools/community", "/tools/ask", "/tools/method"]
    : ["/", "/issues", ...issueRoutes, "/tools/self-check", "/tools/community", "/tools/ask", "/tools/method"];
  ROUTES = routes;
  for (const route of routes) {
    const at = `${route} @${vp.w}${vp.scheme === "dark" ? "d" : ""}`;
    const response = await page.goto(BASE + route, { waitUntil: "load" });
    if (!response || !response.ok()) add("HTTP", `${response ? response.status() : "no response"}`, at);
    await page.waitForTimeout(200);
    if (route === "/tools/self-check") {
      const n = await page.$$eval(".afs-quiz > li", (l) => l.length);
      for (let i = 0; i < n; i++) {
        await page.click(`.afs-quiz > li:nth-child(${i + 1}) .afs-quiz-opts button:first-child`);
        await page.waitForTimeout(40);
      }
      await page.waitForTimeout(150);
    }
    const got = await page.evaluate(collect, { w: vp.w, isDesktop: vp.w >= 1200, route, firstScreenRequirements: FIRST_SCREEN_REQUIREMENTS });
    if (vp.w === 1440 && route.endsWith("/outlets")) {
      comparisonReports.push({ route, ...await page.evaluate(() => {
        const lead = document.querySelector(".afp-comparison-lead-v2");
        return { status: lead?.getAttribute("data-comparison-status") ?? "missing", publishable: lead?.getAttribute("data-comparison-publishable") === "true" };
      }) });
    }
    if (got.__firstScreen?.length) firstScreenReports.push({ at, route, boxes: got.__firstScreen });
    for (const [rule, list] of Object.entries(got)) {
      if (rule.startsWith("__")) continue;
      for (const where of list) add(rule, where, at);
    }
    if (vp.w === 390 && vp.scheme === "light" && route.endsWith("/outlets")) {
      const interaction = await checkOutletsMobileInteractions(page);
      interactionReports.push({ at, route, checks: interaction.checks, failures: interaction.failures });
      for (const where of interaction.failures) add("INTERACTION", where, at);
    }
    if (route === "/") {
      await page.evaluate(() => document.body.focus());
      const seenWho = new Set();
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press("Tab");
        const r = await page.evaluate(() => {
          const a = document.activeElement;
          if (!a || a === document.body) return null;
          const s = getComputedStyle(a);
          const c = a.getAttribute("class");
          return { who: (a.tagName.toLowerCase() + (c ? "." + c.trim().replace(/\s+/g, ".") : "")).slice(0, 40), ow: parseFloat(s.outlineWidth) || 0, os: s.outlineStyle, sh: s.boxShadow };
        });
        if (!r || seenWho.has(r.who)) continue;
        seenWho.add(r.who);
        if (!((r.ow >= 1.5 && r.os !== "none") || (r.sh && r.sh !== "none"))) add("FOCUS-RING", `${r.who} outline ${r.ow}px ${r.os}`, at);
      }
    }
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `${route.replace(/[/]/g, "_") || "_root"}-${vp.w}-${vp.scheme}.png`), fullPage: true });
    }
  }
  for (const e of errs) add("JS-ERROR", e.slice(0, 130), `@${vp.w}${vp.scheme === "dark" ? "d" : ""}`);
  await page.close();
}
await browser.close();
if (RELEASE) {
  for (const failure of comparisonReleaseFailures(comparisonReports)) add("ANALYSIS-RELEASE", failure, "release");
}

// The first-screen rule must cover every initial-five issue, not just the
// first route that happened to render. Keep the coverage check next to the
// browser loop so a future route/discovery regression cannot silently remove
// P (5 issues × 2 analysis pages) from the gate.
const firstScreenRoutes = ROUTES.filter((route) => route.endsWith("/outlets") || route.endsWith("/framing"));
const firstScreenAt1440 = new Set(
  firstScreenReports
    .filter((report) => report.at.endsWith("@1440"))
    .map((report) => report.at.replace(/ @1440$/, "")),
);
if (firstScreenRoutes.length !== 10) {
  add("FIRST-SCREEN", `첫 화면 대상 라우트가 10개(5개 이슈 × 2페이지)가 아님: ${firstScreenRoutes.length}`, "@1440");
}
for (const route of firstScreenRoutes) {
  if (!firstScreenAt1440.has(route)) add("FIRST-SCREEN", `${route}의 첫 화면 측정 결과가 없습니다`, "@1440");
}

const wf = path.join(HERE, "audit-waivers.json");
const waivers = fs.existsSync(wf) ? JSON.parse(fs.readFileSync(wf, "utf8")).waivers || [] : [];
const hits = waivers.map(() => 0);
for (const f of findings) {
  const i = waivers.findIndex((w) => w.rule === f.rule && (!w.match || (f.where + " " + f.at).includes(w.match)));
  if (i >= 0) { f.sev = "waived"; f.reason = waivers[i].reason; hits[i]++; }
}
waivers.forEach((w, i) => {
  if (!hits[i]) findings.push({ rule: "STALE-WAIVER", sev: "error", at: "audit-waivers.json", where: `${w.rule} «${w.match || "*"}» — 이제 아무 것도 잡지 않는다`, id: `STALE-WAIVER@${w.rule}` });
});

const live = findings.filter((f) => f.sev !== "waived");
const errors = live.filter((f) => f.sev === "error");
const byRule = new Map();
for (const f of live) {
  if (!byRule.has(f.rule)) byRule.set(f.rule, []);
  byRule.get(f.rule).push(f);
}

console.log(`\n${BASE} · 라우트 ${ROUTES.length} × 뷰포트 ${VIEWPORTS.length} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`  첫 화면 측정 ${firstScreenReports.filter((report) => report.at.endsWith("@1440")).length}개 · 모바일 상호작용 ${interactionReports.length}개`);
if (!byRule.size) console.log("  결함 0 — 모든 규칙 통과");
for (const [rule, list] of [...byRule].sort((a, b) => (RULES[a[0]].sev === "error" ? -1 : 1) - (RULES[b[0]].sev === "error" ? -1 : 1) || b[1].length - a[1].length)) {
  console.log(`\n  [${RULES[rule].sev.toUpperCase()}] ${rule} × ${list.length}`);
  console.log(`    → ${RULES[rule].hint}`);
  const uniq = [...new Map(list.map((f) => [f.where, f])).values()];
  for (const f of uniq.slice(0, 7)) console.log(`    · ${f.at.padEnd(44)} ${f.where}`);
  if (uniq.length > 7) console.log(`    · … ${uniq.length - 7}건 더`);
}
console.log(`\n  error ${errors.length} · warn ${live.length - errors.length} · waived ${findings.length - live.length}`);

if (AGAINST && fs.existsSync(AGAINST)) {
  const prev = new Set((JSON.parse(fs.readFileSync(AGAINST, "utf8")).findings || []).filter((f) => f.sev !== "waived").map((f) => f.id + "|" + f.where));
  const now = new Set(live.map((f) => f.id + "|" + f.where));
  const fresh = [...now].filter((k) => !prev.has(k));
  console.log(`  이전 대비 — 신규 ${fresh.length} · 해결 ${[...prev].filter((k) => !now.has(k)).length} · 유지 ${now.size - fresh.length}`);
  fresh.slice(0, 6).forEach((k) => console.log(`    + ${k.slice(0, 100)}`));
}
if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, routes: ROUTES, viewports: VIEWPORTS, findings, comparisons: comparisonReports, firstScreen: firstScreenReports, interactions: interactionReports }, null, 1), "utf8");
  console.log(`  → ${JSON_OUT}`);
}
process.exit(errors.length ? 1 : 0);
