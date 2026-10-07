import type { EditorialArticle } from "./editorial-review";

/** Preserve the frozen article order across every column of an outlet row. */
export function groupEditorialArticles(articles: EditorialArticle[]) {
  const rows = new Map<string, EditorialArticle[]>();
  for (const article of articles) {
    const row = rows.get(article.outlet) ?? [];
    row.push(article);
    rows.set(article.outlet, row);
  }
  return [...rows].map(([outlet, articles]) => ({ outlet, articles }));
}

export function layoutEditorialNetwork(input: Array<{ term: string; count: number }>) {
  const maxCount = Math.max(1, ...input.map(n => n.count));
  const placed: Array<{ term: string; count: number; x: number; y: number; fs: number; w: number; h: number }> = [];
  for (const node of input) {
    const fs = Math.round(8 + Math.sqrt(node.count / maxCount) * 6);
    const w = node.term.length * fs + 4, h = fs + 3;
    let position: { x: number; y: number } | null = null;
    for (let t = 0; t < 6000; t++) {
      const angle = t * 2.39996323, radius = Math.sqrt(t) * 8;
      const x = Math.round((200 + Math.cos(angle) * radius) * 100) / 100;
      const y = Math.round((128 + Math.sin(angle) * radius * .66) * 100) / 100;
      if (x - w / 2 < 8 || x + w / 2 > 392 || y - h / 2 < 8 || y + h / 2 > 248) continue;
      if (placed.some(p => Math.abs(x - p.x) < (w + p.w) / 2 + 18 && Math.abs(y - p.y) < (h + p.h) / 2 + 12)) continue;
      position = { x, y };
      break;
    }
    if (!position) throw new Error("Editorial network labels exceed the diagram bounds");
    placed.push({ ...node, ...position, fs, w, h });
  }
  // Keep the smaller type, but spread the connected nodes into the space it
  // frees. Shrinking type alone would leave a tiny cluster in a large canvas.
  const xs = placed.map(n => n.x), ys = placed.map(n => n.y);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const sx = Math.max(1, Math.min(2.2, (360 - Math.max(...placed.map(n => n.w))) / Math.max(1, right - left)));
  const sy = Math.max(1, Math.min(2.2, (216 - Math.max(...placed.map(n => n.h))) / Math.max(1, bottom - top)));
  return placed.map(n => ({ ...n, x: 200 + (n.x - (left + right) / 2) * sx, y: 128 + (n.y - (top + bottom) / 2) * sy }));
}
