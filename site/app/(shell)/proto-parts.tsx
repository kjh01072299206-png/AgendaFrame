import { seriesColor, seriesInk } from "../charts";
import { labelOutlets } from "../../lib/proto";
import type {
  ProtoDevice,
  ProtoEvidence,
  ProtoFrameCoding,
  ProtoFrameGroup,
  ProtoIssue,
  ProtoMorphology,
  ProtoVoices,
} from "../../lib/proto";

/* 확장 분석 산출물을 그리는 조각들. 색은 --n1~--n3 + 중립 --n0 네 칸만 쓰고,
   막대·칸에는 이름과 값을 글자로 함께 둔다(색만으로 뜻을 전하지 않는다). */

// ── 무슨 일이었나 ─────────────────────────────────────────────────────────

/** 그날 보도가 나온 순서. 하루치라 이 세로선이 유일한 시간 축이다. */
export function Timeline({
  articles,
}: {
  articles: Array<{ articleId: string; outlet: string; title: string; publishedAt: string | null; url: string | null }>;
}) {
  const sorted = [...articles].sort((a, b) => (a.publishedAt ?? "").localeCompare(b.publishedAt ?? ""));
  return (
    <ol className="afs-flow">
      {sorted.map((article) => (
        <li key={article.articleId}>
          <time className="afs-num">{article.publishedAt ? article.publishedAt.slice(11, 16) : "시각 미상"}</time>
          <div>
            <b>{article.outlet}</b>
            {article.url ? (
              <a href={article.url} target="_blank" rel="noopener noreferrer">
                {article.title}
              </a>
            ) : (
              <span>{article.title}</span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* 특징어는 품사가 다른 같은 낱말이 두 번 올라오는 경우가 있다(음성 5위의 '찌르다'). 합친다. */
export function Keywords({ terms }: { terms: string[] }) {
  return (
    <div className="afs-keys">
      {[...new Set(terms)].map((term) => (
        <span className="afs-chip" key={term}>
          {term}
        </span>
      ))}
    </div>
  );
}

export function Camps({ camps }: { camps: ProtoIssue["camps"] }) {
  return (
    <div className="afs-camps">
      {camps.map((camp) => (
        <section key={camp.name} style={{ ["--cc" as string]: seriesColor(camp.index) }}>
          <b>{camp.name}</b>
          <p>{camp.gist}</p>
          <div className="afs-keys">
            {camp.outlets.map((outlet) => (
              <span className="afs-chip" key={outlet}>
                {outlet}
              </span>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** 매체가 갈린 항목만 나란히 놓는다 — 갈래가 열, 질문이 행이다. */
export function SplitTable({ issue }: { issue: ProtoIssue }) {
  if (!issue.splitRows.length) return <p className="afs-hold">여섯 항목 모두 매체가 같게 썼습니다.</p>;
  return (
    <div className="afs-scroll">
      <table className="afs-table" style={{ minWidth: 520 }}>
        <thead>
          <tr>
            <th scope="col" />
            {issue.camps.map((camp) => (
              <th scope="col" key={camp.name} style={{ ["--cc" as string]: seriesColor(camp.index) }} className="afs-camp-th">
                {camp.name}
                <small>{camp.outlets.join(" · ")}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {issue.splitRows.map((row) => (
            <tr key={row.question}>
              <th scope="row">{row.question}</th>
              {(row.cells ?? []).map((cell, index) => (
                <td key={issue.camps[index]?.name ?? index}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AgreedFacts({ rows }: { rows: ProtoIssue["factRows"] }) {
  return (
    <dl className="afs-agreed">
      {rows.map((row) => (
        <div key={row.question}>
          <dt>{row.question}</dt>
          <dd>{row.common}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Glossary({ terms }: { terms: ProtoIssue["terms"] }) {
  return (
    <dl className="afs-gloss">
      {terms.map((entry) => (
        <div key={entry.term}>
          <dt>{entry.term}</dt>
          <dd>{entry.gloss}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── 언론사 비교 (비이론) ──────────────────────────────────────────────────

/** 세로선 하나에 매체를 걸어 나란히 견준다. 값이 다른 칸만 보이면 되므로 설명을 붙이지 않는다. */
export function VerticalCompare({
  rows,
}: {
  rows: Array<{ outlet: string; problem: string; called: string[]; sources: string[]; tokens: number; scope: string }>;
}) {
  return (
    <ol className="afs-vline">
      {rows.map((row, index) => (
        <li key={`${row.outlet}-${index}`}>
          <b>{row.outlet}</b>
          <dl>
            <div>
              <dt>문제를 무엇이라 했나</dt>
              <dd>{row.problem}</dd>
            </div>
            <div>
              <dt>어떤 말로 불렀나</dt>
              <dd>
                {row.called.length ? (
                  <span className="afs-keys">
                    {row.called.map((term) => (
                      <span className="afs-chip" key={term}>
                        {term}
                      </span>
                    ))}
                  </span>
                ) : (
                  "―"
                )}
              </dd>
            </div>
            <div>
              <dt>누구를 인용했나</dt>
              <dd>{row.sources.length ? row.sources.join(" · ") : "―"}</dd>
            </div>
            <div>
              <dt>시야 · 내용어</dt>
              <dd className="afs-num">
                {row.scope} · {row.tokens}개
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ol>
  );
}

/* 두 값을 나란히 둔다.
    · 취재원 역할 — 이중코딩이 낸 값. 누가 말했는지에 대한 유일한 코딩 결과다.
    · 발언이 다루는 주체 — 그 문장의 의역문에서 단어 규칙으로 좁힌 값. 화자가 아니라 대상이다.
   두 열을 합치면 "대통령을 평가한 문장" 이 "대통령이 한 말" 로 뒤집힌다. */
export function SourcingTable({
  rows,
}: {
  rows: Array<{
    outlet: string;
    roles: Array<{ label: string; n: number }>;
    subjects: Array<{ label: string; n: number }>;
  }>;
}) {
  const names = labelOutlets(rows);
  const all = [...new Set(rows.flatMap((row) => row.roles.map((role) => role.label)))];
  const color = (label: string) => seriesColor(all.indexOf(label));
  const max = Math.max(1, ...rows.map((row) => row.roles.reduce((sum, role) => sum + role.n, 0)));
  return (
    <>
      <ul className="afs-legend">
        {all.map((label) => (
          <li key={label}>
            <i style={{ background: color(label) }} />
            {label}
          </li>
        ))}
      </ul>
      <div className="afs-scroll">
        <table className="afs-table" style={{ minWidth: 480 }}>
          <thead>
            <tr>
              <th scope="col">매체</th>
              <th scope="col">인용원 (막대 길이 = 인용·전언 횟수)</th>
              <th scope="col">취재원 역할</th>
              <th scope="col">발언이 다루는 주체</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const total = row.roles.reduce((sum, role) => sum + role.n, 0);
              return (
                <tr key={names[index]}>
                  <th scope="row">{names[index]}</th>
                  <td>
                    <span className="afs-stk-track" style={{ width: `${((total / max) * 100).toFixed(1)}%` }}>
                      {row.roles.map((role) => (
                        <span
                          className="afs-stk-seg"
                          key={role.label}
                          style={{ flex: role.n, background: color(role.label), color: seriesInk(all.indexOf(role.label)) }}
                        >
                          {role.n}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td>
                    {row.roles.length
                      ? row.roles.map((role) => (
                          <span className="afs-chip afs-num" key={role.label}>
                            {role.label} {role.n}
                          </span>
                        ))
                      : "―"}
                  </td>
                  <td>
                    {row.subjects.length
                      ? row.subjects.map((subject) => (
                          <span className="afs-chip afs-num" key={subject.label}>
                            {subject.label} {subject.n}
                          </span>
                        ))
                      : "―"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function VoiceTable({ rows }: { rows: ProtoVoices[] }) {
  const names = labelOutlets(rows);
  const keys = rows[0]?.mix.map((entry) => entry.label) ?? [];
  return (
    <>
      <ul className="afs-legend">
        {keys.map((key, index) => (
          <li key={key}>
            <i style={{ background: seriesColor(index) }} />
            {key}
          </li>
        ))}
        <li>
          <i style={{ background: "var(--n0)" }} />
          명시 없음
        </li>
      </ul>
      <div className="afs-stk">
        {rows.map((row, index) => {
          const total = row.mix.reduce((sum, entry) => sum + entry.n, 0) + row.silent;
          return (
            <div className="afs-stk-row" key={names[index]}>
              <span className="afs-stk-label">{names[index]}</span>
              <span className="afs-stk-lane">
                <span className="afs-stk-track" style={{ width: "100%" }}>
                  {row.mix.map((entry, i) =>
                    entry.n ? (
                      <span
                        className="afs-stk-seg"
                        key={entry.label}
                        style={{ flex: entry.n, background: seriesColor(i), color: seriesInk(i) }}
                        title={`${entry.label} ${entry.n}`}
                      >
                        {entry.n}
                      </span>
                    ) : null,
                  )}
                  {row.silent ? (
                    <span
                      className="afs-stk-seg"
                      style={{ flex: row.silent, background: "var(--n0)", color: "var(--n0-ink)" }}
                      title={`명시 없음 ${row.silent}`}
                    >
                      {row.silent}
                    </span>
                  ) : null}
                </span>
              </span>
              <b className="afs-num">{total}</b>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function MorphologyTable({ rows }: { rows: ProtoMorphology[] }) {
  const names = labelOutlets(rows);
  return (
    <div className="afs-scroll">
      <table className="afs-table" style={{ minWidth: 560 }}>
        <thead>
          <tr>
            <th scope="col">매체</th>
            <th scope="col">내용어</th>
            <th scope="col">품사 분포</th>
            <th scope="col">이 매체가 유독 많이 쓴 말</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const total = row.pos.reduce((sum, entry) => sum + entry.n, 0) || 1;
            return (
              <tr key={names[index]}>
                <th scope="row">{names[index]}</th>
                <td className="afs-num">{row.tokens}</td>
                <td>
                  {row.pos.map((entry) => (
                    <span className="afs-chip afs-num" key={entry.tag}>
                      {entry.tag} {Math.round((entry.n / total) * 100)}%
                    </span>
                  ))}
                </td>
                <td>
                  {row.distinctive.map((entry) => (
                    <span className="afs-chip afs-num" key={entry.term} title={`${entry.count}회`}>
                      {entry.term} {entry.count}
                    </span>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ArticleList({ rows }: { rows: ProtoEvidence[] }) {
  return (
    <ul className="afs-articles">
      {rows.map((row, index) => (
        <li key={`${row.outlet}-${index}`}>
          <b>{row.outlet}</b>
          {row.url ? (
            <a href={row.url} target="_blank" rel="noopener noreferrer">
              {row.title}
            </a>
          ) : (
            <span>{row.title}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

// ── 프레이밍 분석 (이론) ──────────────────────────────────────────────────

/* Entman 여섯 항목 × 매체. 칸은 프레임 계열이고, 아래 작은 줄은 그 규정을 누구의 말로 썼는지와
   그 문장이 다루는 주체다 — "공동 책임" 만으로는 누구와 누구인지 알 수 없다. */
export function DimMatrix({
  rows,
  subjects,
}: {
  rows: ProtoEvidence[];
  /** 기사 순서대로, 항목 이름 → 그 항목 의역문에 나온 주체 */
  subjects?: Array<Record<string, string[]>>;
}) {
  const names = labelOutlets(rows);
  const columns = rows[0]?.rows.map((row) => row.label) ?? [];
  return (
    <div className="afs-scroll">
      <table className="afs-table" style={{ minWidth: 660 }}>
        <thead>
          <tr>
            <th scope="col">매체</th>
            {columns.map((column) => (
              <th scope="col" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={names[index]}>
              <th scope="row">{names[index]}</th>
              {row.rows.map((cell) => {
                const who = subjects?.[index]?.[cell.label] ?? [];
                return (
                  <td key={cell.label}>
                    {cell.stated ? (
                      <>
                        <span className="afs-chip">{cell.family}</span>
                        {who.length ? <small className="afs-cell-who">{who.join(" · ")}</small> : null}
                        <small className="afs-cell-who">{cell.voice}</small>
                      </>
                    ) : (
                      <span className="afs-unobs">명시 없음</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 프레임 목록을 미리 정하지 않고, 요소 조합이 비슷한 기사끼리 묶어 데이터에서 도출한다. */
export function Clusters({ mk }: { mk: ProtoIssue["mk"] }) {
  return (
    <div className="afs-clus">
      {mk.clusters.map((cluster, index) => (
        <section key={cluster.members.join()} style={{ ["--cc" as string]: seriesColor(index) }}>
          <h3>
            묶음 {index + 1}
            <small>{cluster.members.join(" · ")}</small>
          </h3>
          <p>
            <span>공유한 요소</span>
            {cluster.shared.map((item) => (
              <span className="afs-chip" key={item}>
                {item}
              </span>
            ))}
          </p>
          {cluster.only.length ? (
            <p>
              <span>이 묶음만</span>
              {cluster.only.map((item) => (
                <span className="afs-chip afs-chip-brand" key={item}>
                  {item}
                </span>
              ))}
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}

export function PolicyFrames({ frames }: { frames: ProtoFrameCoding[] }) {
  const names = labelOutlets(frames);
  const codes = [...new Set(frames.flatMap((frame) => frame.boydstun.present.map((entry) => entry.label)))];
  return (
    <div className="afs-scroll">
      <table className="afs-table" style={{ minWidth: 620 }}>
        <thead>
          <tr>
            <th scope="col">매체</th>
            {codes.map((code) => (
              <th scope="col" key={code}>
                {code}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {frames.map((frame, index) => {
            const present = new Set(frame.boydstun.present.map((entry) => entry.label));
            const dominant = frame.boydstun.present.find((entry) => entry.code === frame.boydstun.dominant)?.label;
            return (
              <tr key={names[index]}>
                <th scope="row">{names[index]}</th>
                {codes.map((code) => (
                  <td key={code}>
                    {present.has(code) ? (
                      <span className={`afs-chip${dominant === code ? " afs-chip-brand" : ""}`}>
                        {dominant === code ? "지배" : "확인"}
                      </span>
                    ) : (
                      <span className="afs-unobs">·</span>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function GenericFrames({ frames }: { frames: ProtoFrameCoding[] }) {
  const names = labelOutlets(frames);
  const codes = frames[0]?.semetko.map((entry) => entry.label) ?? [];
  return (
    <div className="afs-scroll">
      <table className="afs-table" style={{ minWidth: 520 }}>
        <thead>
          <tr>
            <th scope="col">매체</th>
            {codes.map((code) => (
              <th scope="col" key={code}>
                {code}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {frames.map((frame, index) => (
            <tr key={names[index]}>
              <th scope="row">{names[index]}</th>
              {frame.semetko.map((entry) => (
                <td key={entry.code}>
                  {entry.present ? <span className="afs-chip afs-chip-brand">있음</span> : <span className="afs-unobs">·</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 개별 사건에 머무는지 구조로 넓히는지, 그리고 무엇을 어떤 말로 불렀는지. */
export function DeviceTable({ rows }: { rows: ProtoDevice[] }) {
  const names = labelOutlets(rows);
  return (
    <div className="afs-scroll">
      <table className="afs-table" style={{ minWidth: 620 }}>
        <thead>
          <tr>
            <th scope="col">매체</th>
            <th scope="col">시야</th>
            <th scope="col">제목-본문</th>
            <th scope="col">무엇을 어떤 말로 불렀나</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={names[index]}>
              <th scope="row">{names[index]}</th>
              <td>{row.scope}</td>
              <td>{row.headline}</td>
              <td>
                {row.terms.length
                  ? row.terms.map((term) => (
                      <span className="afs-chip" key={`${term.concept}-${term.used}`} title={term.concept}>
                        {term.used}
                      </span>
                    ))
                  : "―"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* 자유 배치는 좁은 화면에서 낱말이 겹친다(관문 TEXT-COLLIDE). 가장 많이 이어진 낱말을
   가운데 두고 나머지를 원에 걸어, 겹칠 자리를 없앤다. 세 프레임이 함께 쓴 낱말은 흐리게
   둔다 — 지우면 프레임마다 남는 낱말이 한두 개뿐이라 그림이 서지 않는다. */
const NET_W = 250;
const NET_H = 168;
const NET_CX = 125;
const NET_CY = 84;

function Network({ group, index }: { group: ProtoFrameGroup; index: number }) {
  const all = group.graph.nodes;
  if (!all.length) return null;
  // 중심은 이어진 무게의 합이 가장 큰 낱말
  const weight = new Map<number, number>();
  for (const edge of group.graph.edges) {
    weight.set(edge.a, (weight.get(edge.a) ?? 0) + edge.w);
    weight.set(edge.b, (weight.get(edge.b) ?? 0) + edge.w);
  }
  const order = all.map((node, at) => ({ node, at })).sort((l, r) => (weight.get(r.at) ?? 0) - (weight.get(l.at) ?? 0));
  const hub = order[0];
  const spokes = order.slice(1, 8);
  const co = (at: number) =>
    group.graph.edges.find((e) => (e.a === hub.at && e.b === at) || (e.b === hub.at && e.a === at))?.w ?? 0;
  const maxCount = Math.max(...all.map((n) => n.count));
  const radius = (count: number) => 4 + (count / maxCount) * 9;
  const placed = spokes.map((entry, k) => {
    const angle = (-90 + (360 / spokes.length) * k) * (Math.PI / 180);
    return { ...entry, x: NET_CX + 62 * Math.cos(angle), y: NET_CY + 54 * Math.sin(angle) };
  });
  const label = `${group.members.join(", ")} 프레임의 핵심어 연결망. 중심은 ${hub.node.term} ${hub.node.count}회, 이어진 낱말은 ${placed
    .map((p) => `${p.node.term} ${p.node.count}회`)
    .join(", ")}.`;

  return (
    <svg className="afs-wnet" viewBox={`0 0 ${NET_W} ${NET_H}`} role="img" aria-label={label} style={{ ["--cc" as string]: seriesColor(index) }}>
      <g>
        {placed.map((p) => (
          <line
            className="wn-e"
            key={`e${p.at}`}
            x1={NET_CX}
            y1={NET_CY}
            x2={p.x.toFixed(1)}
            y2={p.y.toFixed(1)}
            strokeWidth={(0.5 + (co(p.at) / Math.max(1, hub.node.count)) * 1.6).toFixed(2)}
          />
        ))}
      </g>
      <g>
        {placed.map((p) => (
          <circle className="wn-n" key={`n${p.at}`} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r={radius(p.node.count).toFixed(1)}>
            <title>{`${p.node.term} ${p.node.count}회`}</title>
          </circle>
        ))}
      </g>
      <circle className="wn-h" cx={NET_CX} cy={NET_CY} r={(radius(hub.node.count) + 3).toFixed(1)}>
        <title>{`${hub.node.term} ${hub.node.count}회`}</title>
      </circle>
      <text className="wn-hl" x={NET_CX} y={NET_CY}>
        {hub.node.term}
      </text>
      <g>
        {placed.map((p) => {
          const r = radius(p.node.count);
          const top = Math.abs(p.y - NET_CY) > 34 && p.y < NET_CY;
          const bottom = Math.abs(p.y - NET_CY) > 34 && p.y > NET_CY;
          const anchor = top || bottom ? "middle" : p.x >= NET_CX ? "start" : "end";
          const lx = anchor === "middle" ? p.x : p.x + (anchor === "start" ? r + 4 : -(r + 4));
          const ly = top ? p.y - r - 7 : bottom ? p.y + r + 7 : p.y;
          return (
            <text
              className={`wn-l${p.node.shared ? " sh" : ""}`}
              key={`l${p.at}`}
              x={lx.toFixed(1)}
              y={ly.toFixed(1)}
              textAnchor={anchor}
            >
              {p.node.term} {p.node.count}
            </text>
          );
        })}
      </g>
    </svg>
  );
}

export function SemanticNetworks({ groups }: { groups: ProtoFrameGroup[] }) {
  return (
    <>
      <ul className="afs-legend">
        <li>원 크기 = 등장 횟수</li>
        <li>선 굵기 = 같은 문장 동시출현</li>
        <li>흐린 글씨 = 세 프레임이 모두 쓴 말</li>
      </ul>
      <div className="afs-nets">
        {groups.map((group, index) => (
          <section key={group.members.join()} style={{ ["--cc" as string]: seriesColor(index) }}>
            <h3>
              프레임 {index + 1}
              <small>{group.members.join(" · ")}</small>
            </h3>
            <Network group={group} index={index} />
          </section>
        ))}
      </div>
    </>
  );
}

/** 서로 다른 값이 1개면 그 층위는 이 사안에서 매체 차이를 잡아내지 못했다. */
export function LayerVerdict({ counts }: { counts: ProtoIssue["counts"] }) {
  return (
    <ul className="afs-verdict">
      {counts.map((count) => (
        <li key={count.layer}>
          <span>{count.layer.replace(/^\d+\s/, "")}</span>
          <span className="afs-num">
            {count.distinct}/{count.of}
          </span>
          <span className={`afs-chip${count.distinct > 1 ? " afs-chip-brand" : ""}`}>{count.distinct > 1 ? "갈림" : "같음"}</span>
        </li>
      ))}
    </ul>
  );
}
