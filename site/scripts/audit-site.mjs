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

const ISSUE = "bigkinds-2026-07-26-top-1";
const ISSUE_B = "bigkinds-2026-07-26-top-3";
const ROUTES = FAST
  ? ["/", "/issues", `/issues/${ISSUE}`, `/issues/${ISSUE}/outlets`, `/issues/${ISSUE}/framing`, `/issues/${ISSUE}/report`, "/tools/self-check", "/tools/community", "/tools/ask", "/tools/method"]
  : [
      "/", "/issues",
      `/issues/${ISSUE}`, `/issues/${ISSUE}/outlets`, `/issues/${ISSUE}/framing`, `/issues/${ISSUE}/report`,
      `/issues/${ISSUE_B}`, `/issues/${ISSUE_B}/outlets`, `/issues/${ISSUE_B}/framing`, `/issues/${ISSUE_B}/report`,
      "/tools/self-check", "/tools/community", "/tools/ask", "/tools/method",
    ];
const VIEWPORTS = FAST
  ? [{ w: 1280, scheme: "light" }]
  : [{ w: 1440, scheme: "light" }, { w: 1280, scheme: "dark" }, { w: 900, scheme: "light" }, { w: 390, scheme: "light" }, { w: 390, scheme: "dark" }];

const RULES = {
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
  "STALE-WAIVER": { sev: "error", hint: "아무 것도 잡지 않는 웨이버. 고쳐졌으면 지운다." },
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

function chromePath() {
  if (process.env.AF_CHROME) return process.env.AF_CHROME;
  const root = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  const dirs = fs.existsSync(root)
    ? fs.readdirSync(root).filter((d) => d.startsWith("chromium-")).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
    : [];
  for (const d of dirs)
    for (const rel of ["chrome-win64/chrome.exe", "chrome-linux/chrome"]) {
      const p = path.join(root, d, rel);
      if (fs.existsSync(p)) return p;
    }
  throw new Error(`chromium 실행 파일을 못 찾았습니다 (${root}).`);
}

// 페이지 안에서 도는 수집기. 판정 임계값이 전부 여기 있어서 한 곳만 읽으면 된다.
function collect({ w, isDesktop }) {
  const out = {};
  const push = (rule, where) => (out[rule] ||= []).push(where);
  const cls = (el) => {
    const c = el.getAttribute ? el.getAttribute("class") : null;
    return (el.tagName.toLowerCase() + (c ? "." + c.trim().replace(/\s+/g, ".") : "")).slice(0, 54);
  };
  const root = document.querySelector(".afs-shell") || document.body;

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
    const p = el.parentElement;
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
  for (const a of document.querySelectorAll("a[target=_blank]")) if (!/noopener/.test(a.rel)) push("BLANK-REL", (a.textContent || a.href).trim().slice(0, 30));

  const cur = document.querySelectorAll('.afs-nav a[aria-current="page"]').length;
  if (root.querySelector(".afs-nav") && cur !== 1) push("ARIA-CURRENT", `사이드바 aria-current=page ${cur}개`);

  return out;
}

const findings = [];
const add = (rule, where, at) => findings.push({ rule, sev: RULES[rule]?.sev || "error", where, at, id: `${rule}@${at}` });

const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: chromePath() });
const t0 = Date.now();

if (SELFTEST) {
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

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: 900 }, colorScheme: vp.scheme });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (c) => { if (c.type() === "error") errs.push(`console: ${c.text()}`); });
  for (const route of ROUTES) {
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
    const got = await page.evaluate(collect, { w: vp.w, isDesktop: vp.w >= 1200 });
    for (const [rule, list] of Object.entries(got)) for (const where of list) add(rule, where, at);
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
  fs.writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, routes: ROUTES, viewports: VIEWPORTS, findings }, null, 1), "utf8");
  console.log(`  → ${JSON_OUT}`);
}
process.exit(errors.length ? 1 : 0);
