// 차트 프리미티브. 서버 컴포넌트로 렌더되는 순수 함수들이다.
//
// 규칙 두 개를 지킨다.
//  · 색만으로 뜻을 전하지 않는다 — 모든 막대·칸에 이름과 값을 글자로 함께 둔다.
//  · 계열색은 --n1~--n3 + 중립 --n0 네 칸뿐이다. 다섯째 계열은 만들지 않고
//    "그 외"로 접는다(색을 돌려 쓰면 없는 분류를 암시한다).

import Link from "next/link";

export const SERIES = ["var(--n1)", "var(--n2)", "var(--n3)", "var(--n0)"] as const;
/* 계열색 위에 얹는 글자색. 흰 글자는 파랑에서만 AA 를 넘고 청록·주황에서는 3.5:1 로
   떨어지므로 계열마다 따로 고른다(라이트·다크 값은 app-shell.css). */
const SERIES_INK = ["var(--n1-ink)", "var(--n2-ink)", "var(--n3-ink)", "var(--n0-ink)"] as const;

export const seriesColor = (index: number) => SERIES[Math.min(index, SERIES.length - 1)];
export const seriesInk = (index: number) => SERIES_INK[Math.min(index, SERIES_INK.length - 1)];

/** 축 최대값을 1·2·2.5·5 × 10ⁿ 로 올려 눈금이 622/467 처럼 읽히지 않게 한다. */
export function niceMax(value: number, steps = 4) {
  if (value <= 0) return steps;
  const rough = value / steps;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const snap = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return snap * mag * steps;
}

// ── 수평 막대 ──────────────────────────────────────────────────────────────

export function HBars({
  rows,
  unit = "건",
  caption,
}: {
  rows: Array<{ label: string; value: number; sub?: string; href?: string }>;
  unit?: string;
  caption?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => Number(r.value) || 0));
  // 링크가 있으면 role="img" 를 붙이지 않는다 — 하위 요소가 접근성 트리에서 사라진다
  const hasLink = rows.some((r) => r.href);
  return (
    <div
      className="afs-hb"
      role={hasLink ? undefined : "img"}
      aria-label={hasLink ? undefined : `${caption ?? "막대 그래프"}: ${rows.map((r) => `${r.label} ${r.value}${unit}`).join(", ")}`}
    >
      {rows.map((row) => (
        <div className="afs-hb-row" key={row.label}>
          <span className="afs-hb-label">{row.href ? <Link href={row.href}>{row.label}</Link> : row.label}</span>
          <span className="afs-hb-track">
            <span className="afs-hb-fill" style={{ width: `${(row.value / max) * 100}%` }} />
          </span>
          <b className="afs-num">
            {row.value}
            <small>{unit}</small>
          </b>
          {row.sub ? <small className="afs-hb-sub">{row.sub}</small> : null}
        </div>
      ))}
    </div>
  );
}

// ── 누적 막대 ──────────────────────────────────────────────────────────────

export function StackBars({
  rows,
  keys,
  caption,
  scale = true,
}: {
  rows: Array<{ label: string; parts: Record<string, number>; total?: number }>;
  keys: Array<{ key: string; label: string }>;
  caption?: string;
  /** 막대 전체 길이를 합계에 비례시킨다. 끄면 행마다 100%로 정규화돼 5회와 14회가 같은
   *  길이로 그려진다 — 구성만 보고 크기를 감출 때만 끈다. */
  scale?: boolean;
}) {
  const totals = rows.map((row) => row.total ?? keys.reduce((s, k) => s + (row.parts[k.key] ?? 0), 0));
  const maxTotal = Math.max(1, ...totals);
  return (
    <div className="afs-stk">
      <ul className="afs-legend">
        {keys.map((k, i) => (
          <li key={k.key}>
            <i style={{ background: seriesColor(i) }} aria-hidden="true" />
            {k.label}
          </li>
        ))}
      </ul>
      {rows.map((row, rowIndex) => {
        const total = totals[rowIndex];
        return (
          <div className="afs-stk-row" key={row.label}>
            <span className="afs-stk-label">{row.label}</span>
            <span className="afs-stk-lane">
              <span
                className="afs-stk-track"
                style={scale ? { width: `${(total / maxTotal) * 100}%` } : undefined}
                role="img"
                aria-label={`${row.label}: 합계 ${total}, ${keys.map((k) => `${k.label} ${row.parts[k.key] ?? 0}`).join(", ")}`}
              >
              {keys.map((k, i) => {
                const value = row.parts[k.key] ?? 0;
                if (!value) return null;
                const pct = (value / Math.max(1, total)) * 100;
                return (
                  <span
                    className="afs-stk-seg"
                    key={k.key}
                    style={{ width: `${pct}%`, background: seriesColor(i), color: seriesInk(i) }}
                  >
                    {pct >= 11 ? <span>{value}</span> : null}
                  </span>
                );
              })}
              </span>
            </span>
            <b className="afs-num">{total}</b>
          </div>
        );
      })}
      <p className="afs-caption">
        {caption}
        {scale ? " · 막대 전체 길이는 합계에 비례합니다." : ""}
      </p>
    </div>
  );
}

// ── 히트맵 표 ──────────────────────────────────────────────────────────────

export function HeatTable({
  columns,
  rows,
  caption,
  rowHead = "매체",
  colorFrom = 1,
}: {
  columns: string[];
  rows: Array<{ label: string; cells: Array<{ value: number; text?: string }> }>;
  caption?: string;
  rowHead?: string;
  /** 이 값 미만은 칠하지 않는다. 갈림을 찾는 표에서 "1"(=전원 동일)에 색을 주면 합의가 강조된다. */
  colorFrom?: number;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => r.cells.map((c) => c.value)));
  return (
    <div className="afs-scroll">
      <table className="afs-heat">
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>
            <th scope="col">{rowHead}</th>
            {columns.map((c) => (
              <th scope="col" key={c}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {row.cells.map((cell, i) => (
                <td
                  key={columns[i] ?? i}
                  // 농도 상한을 낮게 잡는다 — 진한 칸에서 다크 모드 글자가 배경에 묻는다
                  // 농도 상한은 테마별 토큰이다 — 다크에서 52%는 배경에 묻힌다
                  style={
                    cell.value >= colorFrom
                      ? { background: `color-mix(in srgb, var(--n1) calc(var(--afs-heat-max) * ${(cell.value / max).toFixed(3)}), transparent)` }
                      : undefined
                  }
                >
                  {cell.text ?? (cell.value || "·")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 도넛 ───────────────────────────────────────────────────────────────────

export function Donut({
  items,
  center,
  sub,
  caption,
}: {
  items: Array<{ label: string; count: number }>;
  center: string | number;
  sub?: string;
  caption?: string;
}) {
  const shown = items.slice(0, 3);
  const restCount = items.slice(3).reduce((s, i) => s + i.count, 0);
  const slices = restCount ? [...shown, { label: "그 외", count: restCount }] : shown;
  const total = Math.max(1, slices.reduce((s, i) => s + i.count, 0));
  const R = 52;
  const C = 2 * Math.PI * R;
  // 조각 시작 위치를 미리 누적해 둔다 — 렌더 중에 변수를 다시 대입하지 않기 위해
  const arcs = slices.reduce<Array<{ label: string; count: number; len: number; offset: number }>>((acc, slice) => {
    const previous = acc[acc.length - 1];
    const len = (slice.count / total) * C;
    acc.push({ ...slice, len, offset: previous ? previous.offset + previous.len : 0 });
    return acc;
  }, []);
  return (
    <div className="afs-donut">
      <svg viewBox="0 0 140 140" role="img" aria-label={`${caption ?? "구성"}: ${slices.map((s) => `${s.label} ${s.count}건`).join(", ")}`}>
        <g transform="translate(70 70) rotate(-90)">
          <circle r={R} fill="none" stroke="var(--afs-sunk)" strokeWidth="20" />
          {arcs.map((arc, i) => (
            <circle
              key={arc.label}
              r={R}
              fill="none"
              stroke={seriesColor(i)}
              strokeWidth="20"
              strokeDasharray={`${Math.max(0, arc.len - 1.6)} ${C}`}
              strokeDashoffset={-arc.offset}
            />
          ))}
        </g>
        <text className="afs-donut-hole" x="70" y="68">
          {center}
        </text>
        {sub ? (
          <text className="afs-donut-sub" x="70" y="88">
            {sub}
          </text>
        ) : null}
      </svg>
      <ul className="afs-donut-keys">
        {slices.map((slice, i) => (
          <li key={slice.label}>
            <i style={{ background: seriesColor(i) }} aria-hidden="true" />
            <span>{slice.label}</span>
            <b className="afs-num">{slice.count}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── 쟁점 축 (수평 수직선) ───────────────────────────────────────────────────

export function Spectrum({
  question,
  left,
  right,
  marks,
  unobserved,
}: {
  question: string;
  left: { label: string; articleCount: number };
  right: { label: string; articleCount: number };
  marks: Array<{ outlet: string; position: number; articleCount: number; both: boolean; narrated?: boolean }>;
  unobserved: string[];
}) {
  const lane = (test: (p: number) => boolean) => marks.filter((m) => test(m.position));
  const lanes = [
    { key: "left", items: lane((p) => p < 0.3) },
    { key: "mid", items: lane((p) => p >= 0.3 && p <= 0.7) },
    { key: "right", items: lane((p) => p > 0.7) },
  ];
  return (
    <div className="afs-spectrum">
      <p className="afs-spectrum-q">{question}</p>
      <div className="afs-spectrum-poles">
        <p className="afs-spectrum-pole afs-spectrum-pole-l">
          <b>{left.label}</b>
          <span className="afs-num">{left.articleCount}건</span>
        </p>
        <p className="afs-spectrum-pole afs-spectrum-pole-r">
          <b>{right.label}</b>
          <span className="afs-num">{right.articleCount}건</span>
        </p>
      </div>
      <div className="afs-spectrum-track" aria-hidden="true">
        <span className="afs-spectrum-tick afs-spectrum-tick-l" />
        <span className="afs-spectrum-tick afs-spectrum-tick-m" />
        <span className="afs-spectrum-tick afs-spectrum-tick-r" />
      </div>
      <div className="afs-spectrum-lanes">
        {lanes.map((l) => (
          <ul className={`afs-spectrum-lane afs-spectrum-lane-${l.key}`} key={l.key}>
            {l.items.map((m) => (
              <li key={m.outlet} className={m.narrated === false ? "afs-spectrum-src" : undefined}>
                {m.outlet}
                <b className="afs-num">{m.articleCount}</b>
                {m.narrated === false ? <small title="이 층위에서 매체 자체 서술 없이 취재원 발언으로만 관측">인용</small> : null}
              </li>
            ))}
            {l.items.length === 0 ? <li className="afs-spectrum-empty">해당 매체 없음</li> : null}
          </ul>
        ))}
      </div>
      <p className="afs-spectrum-foot">
        숫자는 그 매체의 기사 수이고, 가운데는 두 계열을 모두 실은 매체입니다. ‘인용’ 표시는 그 층위에서 매체 자체 서술 없이
        취재원 발언으로만 관측된 매체입니다.
        {unobserved.length ? ` 본문에서 이 축이 관측되지 않은 매체: ${unobserved.join(" · ")}.` : ""}
      </p>
    </div>
  );
}

// ── 변별력 계기 (0~5 점) ────────────────────────────────────────────────────

export function SplitMeter({
  rows,
  caption,
}: {
  /** ghost = 취재원 발언까지 합쳐 셌을 때의 값. split 을 넘는 만큼 점선 점으로 덧붙는다. */
  rows: Array<{ label: string; note?: string; split: number; total: number; ghost?: number }>;
  caption?: string;
}) {
  return (
    <div className="afs-meter">
      {rows.map((row) => (
        <div className="afs-meter-row" key={row.label}>
          <span className="afs-meter-label">
            {row.label}
            {row.note ? <small>{row.note}</small> : null}
          </span>
          <span
            className="afs-meter-dots"
            role="img"
            aria-label={
              row.ghost != null && row.ghost > row.split
                ? `${row.total}개 의제 중 매체 서술 기준 ${row.split}개에서 갈렸고, 취재원 발언까지 합치면 ${row.ghost}개입니다`
                : `${row.total}개 의제 중 ${row.split}개에서 매체가 갈렸습니다`
            }
          >
            {Array.from({ length: row.total }, (_, i) => (
              <i key={i} className={i < row.split ? "on" : i < (row.ghost ?? 0) ? "ghost" : ""} />
            ))}
          </span>
          <b className="afs-num">
            {row.split}
            <small>/{row.total}</small>
            {row.ghost != null && row.ghost > row.split ? <small className="afs-ghost-num"> (+{row.ghost - row.split})</small> : null}
          </b>
        </div>
      ))}
      {caption ? <p className="afs-caption">{caption}</p> : null}
    </div>
  );
}

// ── 순위 막대 (홈) ─────────────────────────────────────────────────────────

export function RankList({
  rows,
}: {
  rows: Array<{
    rank: number;
    title: string;
    href: string;
    category: string | null;
    articleCount: number;
    outletCount: number;
    score?: number | null;
    lead?: string | null;
  }>;
}) {
  const scoreValues = rows.map((row) => Number(row.score)).filter(Number.isFinite);
  const max = Math.max(1, ...(scoreValues.length ? scoreValues : rows.map((r) => r.articleCount)));
  return (
    <ol className="afs-rank">
      {rows.map((row) => (
        <li key={row.rank}>
          <Link href={row.href}>
            <span className="afs-rank-no afs-num">{String(row.rank).padStart(2, "0")}</span>
            <span className="afs-rank-body">
              <strong>{row.title}</strong>
              <span className="afs-rank-meta">
                {row.category ? <em>{row.category}</em> : null}
                <span className="afs-num">기사 {row.articleCount}</span>
                <span className="afs-num">매체 {row.outletCount}</span>
                {Number.isFinite(Number(row.score)) ? <span className="afs-num">점수 {Number(row.score).toFixed(1)}</span> : null}
              </span>
              <span className="afs-rank-track" aria-hidden="true">
                <span style={{ width: `${((Number.isFinite(Number(row.score)) ? Number(row.score) : row.articleCount) / max) * 100}%` }} />
              </span>
            </span>
            <span className="afs-rank-go" aria-hidden="true">
              →
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
