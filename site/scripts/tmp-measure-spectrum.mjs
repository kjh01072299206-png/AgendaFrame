// Temporary verification script: measure .afs-spectrum-poles layout at 1280px dark
// Drives headless Chrome over CDP using Node's built-in WebSocket. No deps.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9223;
const URL_TARGET = process.argv[2] ?? "https://agendaframe-capstone.vercel.app/issues/bigkinds-2026-07-26-top-1/outlets";
const SHOT = process.argv[3] ?? null;

const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  "--window-size=1280,1600",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("chrome debug port never came up");
}

const ws = new WebSocket(await getPageWs());
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let id = 0;
const pending = new Map();
const events = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method) events.push(msg.method);
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, (msg) => (msg.error ? reject(new Error(method + ": " + JSON.stringify(msg.error))) : resolve(msg.result)));
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1600, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
await send("Page.navigate", { url: URL_TARGET });

// wait for load + a settle delay for client hydration
for (let i = 0; i < 120 && !events.includes("Page.loadEventFired"); i++) await sleep(250);
await sleep(2500);

const expr = `(async () => {
  await document.fonts.ready;
  await new Promise((r) => setTimeout(r, 500));
  const loadedFonts = [...document.fonts].map((f) => f.family + ' ' + f.weight + ' ' + f.status);
  const bodyFont = getComputedStyle(document.body).fontFamily;
  const out = { href: location.href, innerWidth: innerWidth, scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', dataTheme: document.documentElement.dataset.theme ?? null, bodyFont, loadedFonts, axes: [] };
  const blocks = document.querySelectorAll('.afs-spectrum');
  for (const block of blocks) {
    const card = block.closest('.afs-card, .afs-axis-item');
    const heading = card ? (card.querySelector('h3, h2')?.textContent ?? '').trim() : '';
    const polesEl = block.querySelector('.afs-spectrum-poles');
    const cs = getComputedStyle(polesEl);
    const axis = { heading, question: block.querySelector('.afs-spectrum-q')?.textContent.trim(),
      polesAlignItems: cs.alignItems, polesWidth: polesEl.getBoundingClientRect().width, poles: [] };
    for (const sel of ['.afs-spectrum-pole-l', '.afs-spectrum-pole-r']) {
      const pole = block.querySelector(sel);
      const b = pole.querySelector('b');
      const bcs = getComputedStyle(b);
      const text = b.textContent;
      const node = b.firstChild;
      // group characters into visual lines by rect top
      const lines = [];
      for (let i = 0; i < text.length; i++) {
        const r = document.createRange();
        r.setStart(node, i); r.setEnd(node, i + 1);
        const rect = r.getBoundingClientRect();
        const line = lines.find((L) => Math.abs(L.top - rect.top) < 2);
        if (line) { line.text += text[i]; }
        else lines.push({ top: rect.top, text: text[i] });
      }
      const bRect = b.getBoundingClientRect();
      const poleRect = pole.getBoundingClientRect();
      axis.poles.push({ side: sel.endsWith('-l') ? 'left' : 'right', text,
        font: bcs.fontFamily.slice(0, 60), fontSize: bcs.fontSize,
        overflowWrap: bcs.overflowWrap, wordBreak: bcs.wordBreak,
        bTop: +bRect.top.toFixed(1), bBottom: +bRect.bottom.toFixed(1), bWidth: +bRect.width.toFixed(1),
        poleTop: +poleRect.top.toFixed(1),
        lineCount: lines.length,
        lines: lines.map((L) => ({ top: +L.top.toFixed(1), text: L.text })) });
    }
    out.axes.push(axis);
  }
  return JSON.stringify(out);
})()`;

const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
console.log(res.result.value);

if (SHOT) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(SHOT, Buffer.from(shot.data, "base64"));
  console.error("viewport screenshot saved: " + SHOT);
}

ws.close();
chrome.kill();
process.exit(0);
