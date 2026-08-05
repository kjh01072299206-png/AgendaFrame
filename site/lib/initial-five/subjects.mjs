/* 취재원 역할 좁히기.
   이중코딩이 낸 역할 코드는 "정당·정치권" 처럼 굵어서, 여당인지 야당인지가 이 사안의 전부인데
   한 통에 들어 있다. 코딩 지침이 실명 반환을 금지하므로 다시 코딩해도 이름은 못 얻지만,
   직위·기관은 이미 의역문 안에 있다.

   그래서 화자의 근거 문장 위치와 같은 위치의 프레임 의역문을 붙여, 그 문장이 누구를 가리키는지
   단어 규칙으로 좁힌다. 원 역할 코드는 지우지 않고 함께 남긴다 — 좁힌 값은 규칙 산출이고
   원 코드는 이중코딩 산출이라 신뢰 수준이 다르다.

   화면(derive.ts)과 API(app/api·worker) 가 같은 규칙을 써야 하므로 여기 한 곳에 둔다.

   고정 우선순위로 고르면 안 된다. "야당은 대통령과 여당이 국민 안전을 정치적 계산의 대상으로
   삼아…" 처럼 한 문장에 여러 주체가 나오는데, 목록 순서가 앞이라는 이유로 '여당'을 고르면
   말한 사람이 야당인 문장을 여당 발언으로 뒤집는다. 의역문은 주체를 앞에 두고 쓰이므로
   가장 먼저 나오는 낱말을 고른다. 같은 위치면 목록 순서로 가른다. */

/** @type {ReadonlyArray<{ re: RegExp, label: string }>} */
export const SUBJECT_RULES = Object.freeze([
  { re: /원내지도부|당 지도부|당 원내|지도부/, label: "당 지도부" },
  { re: /여당|집권당|여권/, label: "여당 관계자" },
  { re: /야당|제1야당|야권/, label: "야당 관계자" },
  { re: /대통령/, label: "대통령·대통령실" },
  { re: /법무부|정부|국무|부처|당국/, label: "정부 부처" },
  { re: /검찰|경찰|수사기관|수사팀/, label: "검찰·경찰" },
  { re: /법원|재판부|심급|판결/, label: "법원·재판부" },
  { re: /변호사|대리인|법무법인|법인/, label: "변호사·소송대리인" },
  { re: /유족|피해자|피해 당사자|입주민|주민/, label: "피해 당사자·유족" },
  { re: /피의자|용의자|혐의자/, label: "피의자" },
  { re: /의원/, label: "개별 의원" },
  { re: /교수|전문가|학계|연구/, label: "학계 전문가" },
  { re: /시민|단체|협회/, label: "시민사회" },
  { re: /관리실|업체|기업|회사/, label: "기업·사업자" },
]);

/**
 * 걸린 규칙들을 본문에 나온 순서로 늘어놓는다. 같은 위치면 목록 순서를 따른다.
 * @param {string} joined
 * @returns {string[]}
 */
function matchesInOrder(joined) {
  /** @type {Array<{ at: number, rank: number, label: string }>} */
  const hits = [];
  SUBJECT_RULES.forEach((rule, rank) => {
    const at = joined.search(rule.re);
    if (at >= 0) hits.push({ at, rank, label: rule.label });
  });
  hits.sort((left, right) => left.at - right.at || left.rank - right.rank);
  /** @type {string[]} */
  const labels = [];
  for (const hit of hits) if (!labels.includes(hit.label)) labels.push(hit.label);
  return labels;
}

/**
 * 의역문에서 화자·주체로 읽히는 서술을 좁힌다. 못 좁히면 null (원 코드를 그대로 쓴다).
 * @param {string[]} texts
 * @returns {string | null}
 */
export function narrowSubject(texts) {
  const joined = texts.join(" ");
  if (!joined) return null;
  return matchesInOrder(joined)[0] ?? null;
}

/**
 * 한 층위의 의역문들에서 등장한 주체 — "공동책임" 만으로는 누구인지 알 수 없다.
 * @param {string[]} texts
 * @param {number} [limit]
 * @returns {string[]}
 */
export function subjectsIn(texts, limit = 3) {
  const joined = texts.join(" ");
  if (!joined) return [];
  return matchesInOrder(joined).slice(0, limit);
}

/**
 * 근거 위치(문단:문장) → 그 위치에서 뽑힌 의역문들. 화자 레코드와 프레임 항목을 잇는 열쇠다.
 * @param {Record<string, { items?: Array<{ public_paraphrase?: string, evidence?: { locator?: { paragraph?: number, sentence?: number } } }> }> | undefined} dimensions
 * @returns {Map<string, string[]>}
 */
export function paraphrasesByLocator(dimensions) {
  /** @type {Map<string, string[]>} */
  const map = new Map();
  for (const node of Object.values(dimensions ?? {})) {
    for (const item of node?.items ?? []) {
      const locator = item.evidence?.locator;
      if (!locator || !item.public_paraphrase) continue;
      const key = `${locator.paragraph ?? 0}:${locator.sentence ?? 0}`;
      map.set(key, [...(map.get(key) ?? []), item.public_paraphrase]);
    }
  }
  return map;
}

/**
 * 화자 레코드가 가리키는 의역문들.
 * @param {{ evidence?: Array<{ locator?: { paragraph?: number, sentence?: number } }> }} actor
 * @param {Map<string, string[]>} byLocator
 * @returns {string[]}
 */
export function actorParaphrases(actor, byLocator) {
  return (actor.evidence ?? []).flatMap(
    (item) => byLocator.get(`${item.locator?.paragraph ?? 0}:${item.locator?.sentence ?? 0}`) ?? [],
  );
}
