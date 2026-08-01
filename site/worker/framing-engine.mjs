/**
 * Evidence-bounded Korean news framing analysis.
 *
 * This module is deliberately deterministic. It does not claim semantic-AI
 * understanding, and it never returns the article body, sentences, quotations,
 * or excerpts. Public results contain controlled paraphrases plus paragraph /
 * sentence locators and salted SHA-256 fingerprints of the supporting sentence.
 */

export const ARTICLE_FRAME_PROFILE_SCHEMA = "agendaframe.article-frame-profile.v1";
export const AI_ARTICLE_FRAME_PROFILE_SCHEMA = "agendaframe.article-frame-profile.v2";
export const ISSUE_FRAME_COMPARISON_SCHEMA = "agendaframe.issue-frame-comparison.v1";
export const FRAMING_ENGINE_VERSION = "korean-evidence-rules-v2";

const DIMENSION_ORDER = Object.freeze([
  "problem_definition",
  "causal_interpretation",
  "responsibility_attribution",
  "moral_evaluation",
  "treatment_recommendation",
]);

const DIMENSION_LABELS = Object.freeze({
  problem_definition: "문제 정의",
  causal_interpretation: "원인 해석",
  responsibility_attribution: "책임 귀속",
  moral_evaluation: "규범적 평가",
  treatment_recommendation: "해법·처방",
});

const REPORTING_VERBS = /(?:말했|밝혔|설명했|주장했|지적했|강조했|전했|반박했|촉구했|요구했|평가했|내다봤|덧붙였|호소했|발표했|논평했|보도했|알렸|답했|언급했)/;
const ATTRIBUTION_MARKERS = /(?:에 따르면|자료에 따르면|보고서에 따르면|입장문에서|논평에서|성명에서|보도자료에서)/;
const DIRECT_QUOTE_RE = /["“‘][^"”’]{2,}["”’]/g;

const DIMENSION_RULES = Object.freeze({
  problem_definition: [
    {
      code: "policy_implementation_problem",
      pattern: /(?:정책|대책|제도|사업|개편|조치).{0,24}(?:실패|미흡|부족|차질|혼선|논란|한계|공백|문제|후퇴|지연)/,
      paraphrase: "정책의 설계나 집행 과정에서 드러난 문제를 중심 쟁점으로 다룹니다.",
    },
    {
      code: "rights_fairness_problem",
      pattern: /(?:권리|차별|불평등|형평|공정|특혜|배제|격차|취약).{0,24}(?:문제|논란|침해|우려|비판|심화|확대)|(?:불공정|불평등|권리 침해|차별 논란)/,
      paraphrase: "권리·공정성·분배의 관점에서 사건의 문제를 정의합니다.",
    },
    {
      code: "economic_burden_problem",
      pattern: /(?:물가|금리|부채|비용|부담|손실|침체|고용|일자리|성장|경기|시장).{0,24}(?:악화|증가|감소|위축|부담|충격|우려|문제|위기)|(?:경제적 부담|민생 부담)/,
      paraphrase: "경제적 비용과 생활·시장에 미치는 부담을 핵심 문제로 다룹니다.",
    },
    {
      code: "safety_harm_problem",
      pattern: /(?:피해|사망|부상|안전|사고|재난|위험|범죄|폭력|질병).{0,24}(?:증가|확산|우려|문제|위기|논란|발생|노출|대란|위협)|(?:인명 피해|안전 문제|범죄 대란)/,
      paraphrase: "사람의 안전과 구체적 피해를 사건의 핵심 문제로 다룹니다.",
    },
    {
      code: "legal_institutional_problem",
      pattern: /(?:법|헌법|법치주의|규정|절차|수사|재판|판결|권한|제도).{0,24}(?:위반|위법|논란|충돌|공백|문제|혼선|위헌|훼손|뒤흔들)|(?:절차적 정당성|법적 논란)/,
      paraphrase: "법적 기준이나 제도·절차의 정당성을 핵심 쟁점으로 다룹니다.",
    },
    {
      code: "political_conflict_problem",
      pattern: /(?:여야|정부|야당|여당|대통령실|국회|정치권).{0,24}(?:충돌|대립|공방|갈등|논란|반발|비판)|(?:정치적 갈등|정쟁)/,
      paraphrase: "정치 행위자 사이의 충돌과 의사결정 갈등을 핵심 문제로 다룹니다.",
    },
    {
      code: "governance_accountability_problem",
      pattern: /(?:정부|기관|조직|당국|위원회|지도부).{0,24}(?:대응|관리|운영|인사|의사결정).{0,18}(?:실패|미흡|부실|논란|문제|지연)|(?:대응 실패|관리 부실|인사 논란)/,
      paraphrase: "공적 기관의 대응과 운영 책임을 중심 문제로 다룹니다.",
    },
  ],
  causal_interpretation: [
    {
      code: "institutional_cause",
      pattern: /(?:제도|구조|법|규정|관행|시스템|절차).{0,30}(?:때문|탓|원인|배경|영향|비롯|초래|낳았)|(?:때문|탓|원인|배경).{0,30}(?:제도|구조|법|규정|관행|시스템|절차)/,
      paraphrase: "제도·구조·절차상의 조건을 원인 또는 배경으로 제시합니다.",
    },
    {
      code: "policy_decision_cause",
      pattern: /(?:정책|결정|조치|대응|규제|지원|예산|인사).{0,30}(?:때문|탓|원인|배경|영향으로|비롯|초래|낳았)|(?:때문|탓|원인|배경).{0,30}(?:정책|결정|조치|대응|규제|지원|예산|인사)/,
      paraphrase: "정책 결정이나 공적 대응을 사건의 원인·배경으로 연결합니다.",
    },
    {
      code: "economic_condition_cause",
      pattern: /(?:금리|물가|경기|수요|공급|환율|비용|시장|소득).{0,30}(?:때문|탓|원인|배경|영향으로|비롯|초래|낳았)|(?:때문|탓|원인|배경).{0,30}(?:금리|물가|경기|수요|공급|환율|비용|시장|소득)/,
      paraphrase: "시장·경제 여건을 사건의 원인 또는 배경으로 설명합니다.",
    },
    {
      code: "actor_action_cause",
      pattern: /(?:발언|행동|결정|지시|거부|중단|방치|개입|압박).{0,24}(?:때문|탓|원인|영향으로|비롯|초래|낳았)|(?:때문|탓).{0,24}(?:발언|행동|결정|지시|거부|중단|방치|개입|압박)/,
      paraphrase: "특정 행위자의 선택이나 행동을 사건 전개의 원인으로 연결합니다.",
    },
    {
      code: "political_incentive_cause",
      pattern: /(?:선거|득표|지지층|강성 당원|당원|강경파|여론의 역풍|정치적 거래|뒷거래|정치공학).{0,36}(?:때문|탓|우려|두려|눈치|활용|유지|깨질|걱정|목적)|(?:때문|탓|우려|두려|눈치|목적).{0,36}(?:선거|득표|지지층|강성 당원|당원|강경파|여론|거래|정치공학)/,
      paraphrase: "선거·당내 경쟁·지지층·정치적 거래와 같은 유인을 사건 전개의 배경으로 제시합니다.",
    },
    {
      code: "external_event_cause",
      pattern: /(?:전쟁|재난|감염|기후|국제|해외|세계|공급망).{0,30}(?:때문|탓|원인|배경|영향으로|비롯|초래|낳았)|(?:때문|탓|원인|배경).{0,30}(?:전쟁|재난|감염|기후|국제|해외|세계|공급망)/,
      paraphrase: "외부 사건이나 국제·환경 조건을 주요 원인·배경으로 제시합니다.",
    },
  ],
  responsibility_attribution: [
    {
      code: "government_responsibility",
      pattern: /(?:정부|대통령실|대통령|당국|부처|지자체|공공기관).{0,32}(?:책임|책임져|책임론|의무|잘못|방치|침묵|회피|대응 실패|관리 부실|사과해야|해명해야|입장을 밝혀)/,
      paraphrase: "정부·공공기관의 대응 책임이 기사 안에서 제기됩니다.",
    },
    {
      code: "political_responsibility",
      pattern: /(?:여당|야당|국회|정당|정치권|의원|지도부|민주당|국민의힘).{0,32}(?:책임|책임져|책임론|의무|잘못|방치|침묵|회피|사과해야|해명해야|눈치를 보|속도전을 벌)/,
      paraphrase: "정당·국회 등 정치 행위자의 책임이 기사 안에서 제기됩니다.",
    },
    {
      code: "corporate_responsibility",
      pattern: /(?:기업|회사|사측|경영진|업체|플랫폼|사업자).{0,32}(?:책임|책임져|책임론|의무|잘못|방치|보상해야|사과해야|개선해야)/,
      paraphrase: "기업·사업자의 조치 또는 피해 구제 책임이 기사 안에서 제기됩니다.",
    },
    {
      code: "individual_responsibility",
      pattern: /(?:장관|대통령|대표|위원장|총장|경찰청장|검사|판사|책임자).{0,32}(?:책임|책임져|책임론|의무|잘못|사퇴해야|사과해야|해명해야)/,
      paraphrase: "특정 직책이나 의사결정권자의 개인적 책임이 기사 안에서 제기됩니다.",
    },
    {
      code: "shared_responsibility",
      pattern: /(?:공동 책임|함께 책임|모두의 책임|사회 전체의 책임|정부와.{0,16}(?:기업|국회|지자체).{0,20}책임)/,
      paraphrase: "복수 행위자 또는 사회 전체에 걸친 공동 책임이 제기됩니다.",
    },
  ],
  moral_evaluation: [
    {
      code: "negative_legitimacy_evaluation",
      pattern: /(?:부당|부적절|무책임|불공정|비상식|비윤리|위법|위헌|졸속|과도|퇴행|후퇴|기만|특혜|무능|비겁|추악|만행|매국|잘못된|바람직하지)/,
      paraphrase: "행위나 결정의 정당성·적절성에 부정적인 평가가 기사 안에서 제시됩니다.",
    },
    {
      code: "positive_legitimacy_evaluation",
      pattern: /(?:정당한|적절한|바람직한|공정한|합리적|타당한|긍정적|성과|모범|필수적|불가피한)/,
      paraphrase: "행위나 결정의 정당성·적절성에 긍정적인 평가가 기사 안에서 제시됩니다.",
    },
    {
      code: "rights_based_evaluation",
      pattern: /(?:인권|권리|존엄|차별|평등|공정|약자|취약계층).{0,24}(?:침해|보장|외면|훼손|개선|위협|존중)/,
      paraphrase: "권리·평등·존엄의 기준으로 사건이나 조치를 평가합니다.",
    },
    {
      code: "public_interest_evaluation",
      pattern: /(?:공익|국민|시민|사회적 신뢰|공공성|민생).{0,24}(?:훼손|증진|보호|외면|기여|위협|도움)/,
      paraphrase: "공익·시민의 삶·사회적 신뢰를 기준으로 사건을 평가합니다.",
    },
  ],
  treatment_recommendation: [
    {
      code: "policy_revision",
      pattern: /(?:정책|대책|제도|법|규정|사업).{0,28}(?:개선해야|보완해야|개정해야|재검토해야|폐지해야|강화해야|마련해야|도입해야|정비해야|필요하다|추진해야)/,
      paraphrase: "정책·제도·법규의 보완이나 변경을 해법으로 제시합니다.",
    },
    {
      code: "accountability_action",
      pattern: /(?:사과해야|사퇴해야|문책해야|수사해야|조사해야|감사해야|해명해야|책임져야|처벌해야|입장을 밝혀야|침묵을 깨|진상 규명|책임자 처벌)/,
      paraphrase: "사과·조사·문책·책임 규명과 같은 조치를 해법으로 제시합니다.",
    },
    {
      code: "institutional_check",
      pattern: /(?:재의요구권|거부권).{0,24}(?:행사|촉구|요구|필요|해야)|(?:보완수사권).{0,24}(?:존치|유지|보장|남겨|폐지 반대)/,
      paraphrase: "거부권 행사나 권한 존치처럼 제도적 견제 장치를 대응책으로 제시합니다.",
    },
    {
      code: "material_support",
      pattern: /(?:지원|보상|구제|예산|인력|시설|서비스).{0,28}(?:확대해야|강화해야|마련해야|제공해야|필요하다|늘려야|보장해야|추진해야)/,
      paraphrase: "지원·보상·자원 확충을 구체적 대응책으로 제시합니다.",
    },
    {
      code: "negotiation_participation",
      pattern: /(?:협의|대화|타협|참여|공론화|숙의|합의|의견 수렴).{0,28}(?:해야|필요|추진|마련|보장|확대)/,
      paraphrase: "대화·협의·참여 절차를 해결 경로로 제시합니다.",
    },
    {
      code: "prevention_enforcement",
      pattern: /(?:예방|단속|감독|점검|규제|처벌|관리|감시).{0,28}(?:강화해야|확대해야|필요하다|시행해야|추진해야|철저히 해야)/,
      paraphrase: "예방·감독·집행 강화를 재발 방지책으로 제시합니다.",
    },
  ],
});

const GENERIC_FRAME_RULES = Object.freeze([
  { code: "conflict", label: "갈등", patterns: [/(?:충돌|공방|대립|갈등|맞서|반발|비판|논쟁)/, /(?:여야|노사|정부와 야당).{0,18}(?:대립|공방|충돌)/] },
  { code: "responsibility", label: "책임", patterns: [/(?:책임|책임론|잘못|방치|문책|사과|해명)/] },
  { code: "economic_consequences", label: "경제적 결과", patterns: [/(?:비용|손실|매출|소득|고용|일자리|물가|금리|성장|경기|시장|예산)/] },
  { code: "human_interest", label: "인간적 관심", patterns: [/(?:피해자|유가족|주민|시민|환자|노동자|학생|가족|눈물|호소|삶|일상)/] },
  { code: "morality", label: "도덕성", patterns: [/(?:도덕|윤리|정의|부당|정당|공정|존엄|양심|옳|그르)/] },
]);

// Policy Frames Codebook-inspired descriptors. They are secondary descriptors,
// not a claim that a complete policy frame has been semantically identified.
const POLICY_DESCRIPTOR_RULES = Object.freeze([
  { code: "economic", label: "경제", patterns: [/(?:비용|예산|성장|소득|고용|시장|산업|경제|금리|물가)/] },
  { code: "capacity_resources", label: "역량·자원", patterns: [/(?:인력|예산|시설|역량|재원|자원|기술|인프라)/] },
  { code: "morality", label: "도덕성", patterns: [/(?:윤리|도덕|정의|양심|옳|그르|정당|부당)/] },
  { code: "fairness_equality", label: "공정·평등", patterns: [/(?:공정|평등|차별|격차|특혜|형평|분배|취약)/] },
  { code: "legality_constitutionality", label: "법·헌정", patterns: [/(?:법률|헌법|위법|위헌|법적|판결|재판|절차)/] },
  { code: "policy_prescription", label: "정책 처방", patterns: [/(?:정책|대책|개선|보완|개정|도입|폐지|지원|규제)/] },
  { code: "crime_punishment", label: "범죄·처벌", patterns: [/(?:범죄|수사|기소|처벌|형량|구속|검찰|경찰)/] },
  { code: "security_defense", label: "안보·국방", patterns: [/(?:안보|국방|군사|전쟁|북한|무기|외교|동맹)/] },
  { code: "health_safety", label: "건강·안전", patterns: [/(?:건강|질병|환자|의료|안전|재난|사고|위험|방역)/] },
  { code: "quality_of_life", label: "삶의 질", patterns: [/(?:주거|교육|돌봄|복지|생활|삶의 질|교통|환경)/] },
  { code: "cultural_identity", label: "문화·정체성", patterns: [/(?:문화|정체성|전통|종교|세대|젠더|지역 정서)/] },
  { code: "public_opinion", label: "여론", patterns: [/(?:여론|설문|조사 결과|지지율|반대 여론|찬성 여론)/] },
  { code: "political", label: "정치 과정", patterns: [/(?:여당|야당|국회|선거|정당|대통령실|정치권)/] },
  { code: "external_regulation", label: "대외 관계·평판", patterns: [/(?:국제사회|해외|외교|무역|제재|협약|국가 이미지|평판)/] },
  { code: "other", label: "기타 정책 맥락", patterns: [/(?:별도 쟁점|기타 쟁점)/] },
]);

const CONTROLLED_CONCEPTS = Object.freeze([
  { code: "government", pattern: /(?:정부|대통령실|부처|당국|지자체|공공기관)/ },
  { code: "legislature_politics", pattern: /(?:국회|여당|야당|정당|의원|정치권)/ },
  { code: "economy", pattern: /(?:경제|시장|물가|금리|고용|산업|기업|소득)/ },
  { code: "rights_fairness", pattern: /(?:권리|인권|공정|평등|차별|격차|취약)/ },
  { code: "safety_health", pattern: /(?:안전|사고|재난|건강|의료|질병|환자|피해)/ },
  { code: "law_justice", pattern: /(?:법|헌법|수사|재판|검찰|경찰|판결|처벌)/ },
  { code: "welfare_livelihood", pattern: /(?:복지|돌봄|주거|교육|생활|민생|지원)/ },
  { code: "international_security", pattern: /(?:국제|외교|안보|국방|북한|전쟁|무역)/ },
  { code: "environment", pattern: /(?:환경|기후|탄소|오염|생태|에너지)/ },
  { code: "citizens", pattern: /(?:시민|국민|주민|노동자|학생|피해자|유가족)/ },
]);

const SOURCE_ROLE_RULES = Object.freeze([
  // Check anonymity first: "정부 관계자" is an unnamed source even though
  // the institution itself is governmental.
  { code: "anonymous_official", pattern: /(?:관계자|소식통|당국자|고위 인사|익명)/ },
  { code: "government_official", pattern: /(?:정부|대통령실|청와대|부처|장관|차관|공무원|당국|지자체|시장|도지사|공공기관)/ },
  { code: "political_actor", pattern: /(?:여당|야당|정당|국회|의원|대표|원내대표|정치권)/ },
  { code: "judiciary_law_enforcement", pattern: /(?:법원|판사|검찰|검사|경찰|수사관|변호사)/ },
  { code: "expert_research", pattern: /(?:교수|연구원|전문가|학자|연구소|위원)/ },
  { code: "civil_society", pattern: /(?:시민단체|노조|협회|연대|위원회|활동가)/ },
  { code: "business", pattern: /(?:기업|회사|사측|경영진|업체|사업자|산업계)/ },
  { code: "affected_person", pattern: /(?:피해자|유가족|주민|시민|환자|노동자|학생|학부모|소비자)/ },
]);

const ROLE_LABELS = Object.freeze({
  government_official: "정부·공공기관",
  political_actor: "정당·정치권",
  judiciary_law_enforcement: "법조·수사기관",
  expert_research: "전문가·연구자",
  civil_society: "시민사회·이익집단",
  business: "기업·산업계",
  affected_person: "당사자·시민",
  anonymous_official: "익명·비실명 관계자",
  other: "기타 취재원",
});

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitSentences(paragraph) {
  if (!paragraph) return [];
  const matches = paragraph.match(/[^.!?。！？]+(?:[.!?。！？]+(?:["”’])?|$)/g);
  const pieces = (matches ?? [paragraph])
    .map((value) => value.trim())
    .filter((value) => value.length >= 2);
  return pieces.length ? pieces : [paragraph];
}

export function segmentKoreanArticle(bodyText) {
  const normalized = normalizeText(bodyText);
  if (!normalized) return [];
  let paragraphs = normalized.split(/\n{2,}/).filter(Boolean);
  if (paragraphs.length === 1 && normalized.includes("\n")) {
    paragraphs = normalized.split(/\n+/).filter(Boolean);
  }
  return paragraphs.flatMap((paragraph, paragraphIndex) =>
    splitSentences(paragraph).map((text, sentenceIndex) => ({
      text,
      paragraph: paragraphIndex + 1,
      sentence: sentenceIndex + 1,
    })),
  );
}

function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 Web Crypto support is required for evidence fingerprints.");
  }
  const encoded = new TextEncoder().encode(value);
  return bytesToHex(await globalThis.crypto.subtle.digest("SHA-256", encoded));
}

async function evidenceReference(articleId, sentence) {
  return {
    locator: {
      paragraph: sentence.paragraph,
      sentence: sentence.sentence,
    },
    sentence_sha256: await sha256(`agendaframe:evidence:v1:${articleId}:${normalizeText(sentence.text)}`),
  };
}

function uniqueEvidence(evidence) {
  const seen = new Set();
  return evidence.filter((item) => {
    const key = `${item.locator.paragraph}:${item.locator.sentence}:${item.sentence_sha256}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findQuoteRanges(text) {
  const ranges = [];
  for (const match of text.matchAll(DIRECT_QUOTE_RE)) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

function sanitizeActorName(value) {
  const cleaned = String(value ?? "")
    .replace(/["“”‘’()[\]{}<>]/g, " ")
    .replace(/(?:은|는|이|가|측은|측이|관계자는|관계자가|에 따르면)$/u, "")
    .replace(/^(?:그러나|하지만|또한|한편|이어|이에|다만)\s+/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length > 28 || /^[0-9]+$/.test(cleaned)) return null;
  const tokens = cleaned.split(" ");
  return tokens.slice(Math.max(0, tokens.length - 4)).join(" ");
}

function extractSpeaker(sentenceText) {
  const quoteStart = Math.min(
    ...["\"", "“", "‘"].map((mark) => {
      const index = sentenceText.indexOf(mark);
      return index < 0 ? Number.POSITIVE_INFINITY : index;
    }),
  );
  const beforeQuote = Number.isFinite(quoteStart) ? sentenceText.slice(0, quoteStart) : sentenceText;
  const anonymousRelation = beforeQuote.trim().match(/([가-힣A-Za-z0-9·][가-힣A-Za-z0-9·\s]{0,20}?)\s*관계자(?:는|가)$/u);
  if (anonymousRelation) return sanitizeActorName(`${anonymousRelation[1]} 관계자`);
  const subjectMatch = beforeQuote.trim().match(/([가-힣A-Za-z0-9·][가-힣A-Za-z0-9·\s]{0,27}?)(?:관계자는|관계자가|측은|측이|은|는|이|가)$/u);
  if (subjectMatch) return sanitizeActorName(subjectMatch[1]);

  const accordingMatch = sentenceText.match(/([가-힣A-Za-z0-9·][가-힣A-Za-z0-9·\s]{0,27}?)(?:의\s+)?(?:자료|보고서|입장|설명|발표)?에 따르면/u);
  if (accordingMatch) return sanitizeActorName(accordingMatch[1]);

  const reportingIndex = sentenceText.search(REPORTING_VERBS);
  if (reportingIndex >= 0) {
    const prefix = sentenceText.slice(0, reportingIndex);
    const fallback = prefix.match(/([가-힣A-Za-z0-9·][가-힣A-Za-z0-9·\s]{0,27}?)(?:관계자는|관계자가|측은|측이|은|는|이|가)[^.!?]{0,80}$/u);
    if (fallback) return sanitizeActorName(fallback[1]);
  }
  return null;
}

function sourceRole(name) {
  if (!name) return "other";
  return SOURCE_ROLE_RULES.find((rule) => rule.pattern.test(name))?.code ?? "other";
}

function classifyVoice(sentenceText, matchIndex) {
  const speakerName = extractSpeaker(sentenceText);
  const quoteRange = findQuoteRanges(sentenceText).find((range) => matchIndex >= range.start && matchIndex < range.end);
  if (quoteRange) {
    return {
      kind: speakerName ? "direct_quote" : "uncertain_quote",
      speaker_name: speakerName,
      speaker_role: sourceRole(speakerName),
    };
  }
  if ((REPORTING_VERBS.test(sentenceText) || ATTRIBUTION_MARKERS.test(sentenceText)) && speakerName) {
    return {
      kind: "indirect_source",
      speaker_name: speakerName,
      speaker_role: sourceRole(speakerName),
    };
  }
  return {
    kind: "journalist_narration",
    speaker_name: null,
    speaker_role: null,
  };
}

function dimensionStatus(items) {
  if (!items.length) return "not_observed";
  return items.some((item) => item.voice.kind === "journalist_narration")
    ? "observed"
    : "source_attributed";
}

function dimensionResult(items) {
  const status = dimensionStatus(items);
  return {
    status,
    outlet_narration_observed: status === "observed",
    items,
    abstention_reason: status === "not_observed"
      ? "분석 가능한 본문에서 이 요소를 직접 뒷받침하는 표현을 확인하지 못했습니다."
      : null,
  };
}

async function extractDimensions(articleId, sentences) {
  const dimensions = {};
  for (const dimension of DIMENSION_ORDER) {
    const items = [];
    const seenCodes = new Set();
    for (const sentence of sentences) {
      for (const rule of DIMENSION_RULES[dimension]) {
        const match = rule.pattern.exec(sentence.text);
        rule.pattern.lastIndex = 0;
        if (!match || seenCodes.has(rule.code)) continue;
        const voice = classifyVoice(sentence.text, match.index);
        const evidence = await evidenceReference(articleId, sentence);
        const variantKey = `rules:${dimension}:${rule.code}`;
        items.push({
          claim_id: `claim:${await sha256(`agendaframe:claim:v1:${articleId}:${dimension}:${variantKey}:${voice.kind}`)}`,
          code: rule.code,
          frame_family: rule.code,
          variant_key: variantKey,
          public_paraphrase: voice.kind === "journalist_narration"
            ? rule.paraphrase
            : `${ROLE_LABELS[voice.speaker_role] ?? "취재원"}의 발언·설명에서 ${rule.paraphrase.replace(/합니다\.$/, "하는 관점이 제시됩니다.")}`,
          voice,
          evidence,
        });
        seenCodes.add(rule.code);
      }
    }
    dimensions[dimension] = dimensionResult(items);
  }
  return dimensions;
}

function genreRule(title, sentences) {
  const heading = normalizeText(title);
  const first = sentences.slice(0, 3).map((item) => item.text).join(" ");
  if (/(?:^\s*\[?사설\]?|^\s*사설[:\s]|社說)/u.test(heading)) {
    return { code: "editorial", label: "사설", basis: "제목의 명시적 사설 표지" };
  }
  if (/(?:^\s*\[?(?:칼럼|기고|시론|논단|기자수첩)\]?|^\s*(?:칼럼|기고)[:\s])/u.test(heading)) {
    return { code: "opinion", label: "칼럼·기고", basis: "제목의 명시적 의견 기사 표지" };
  }
  if (/(?:인터뷰|일문일답|Q&A|대담)/iu.test(heading) || /(?:문\s*[:：].{2,80}답\s*[:：])/u.test(first)) {
    return { code: "interview", label: "인터뷰·대담", basis: "제목 또는 도입부의 문답 표지" };
  }
  if (/(?:팩트체크|사실은|검증)/u.test(heading)) {
    return { code: "fact_check", label: "팩트체크", basis: "제목의 검증 기사 표지" };
  }
  if (/(?:해설|분석|진단|쟁점|왜\?|어떻게|따져보니|짚어보니)/u.test(heading)) {
    return { code: "analysis_explainer", label: "해설·분석", basis: "제목의 해설·분석 표지" };
  }
  return { code: "straight_news", label: "스트레이트 기사", basis: "명시적인 의견·해설 장르 표지가 없음" };
}

async function genreEvidence(articleId, title, sentences, genre) {
  if (genre.code === "straight_news" || !sentences.length) return [];
  const titleSentence = { text: normalizeText(title), paragraph: 0, sentence: 0 };
  return [await evidenceReference(articleId, titleSentence)];
}

function collectSourceMentions(sentences) {
  const sources = new Map();
  for (const sentence of sentences) {
    const speaker = extractSpeaker(sentence.text);
    if (!speaker || (!REPORTING_VERBS.test(sentence.text) && !ATTRIBUTION_MARKERS.test(sentence.text))) continue;
    const quoteRanges = findQuoteRanges(sentence.text);
    const kind = quoteRanges.length ? "direct_quote" : "indirect_source";
    const key = `${speaker}:${sourceRole(speaker)}`;
    const current = sources.get(key) ?? {
      name: speaker,
      role: sourceRole(speaker),
      direct_quote_count: 0,
      indirect_attribution_count: 0,
      locators: [],
    };
    if (kind === "direct_quote") current.direct_quote_count += 1;
    else current.indirect_attribution_count += 1;
    current.locators.push({ paragraph: sentence.paragraph, sentence: sentence.sentence });
    sources.set(key, current);
  }
  return [...sources.values()].map((source, index) => ({
    actor_id: `source-${index + 1}`,
    ...source,
    locators: source.locators.slice(0, 5),
  }));
}

async function sourceEvidence(articleId, sentences, source) {
  const byLocator = new Map(sentences.map((sentence) => [`${sentence.paragraph}:${sentence.sentence}`, sentence]));
  const evidence = [];
  for (const locator of source.locators.slice(0, 3)) {
    const sentence = byLocator.get(`${locator.paragraph}:${locator.sentence}`);
    if (sentence) evidence.push(await evidenceReference(articleId, sentence));
  }
  return uniqueEvidence(evidence);
}

async function sourceProfile(articleId, sentences) {
  const mentions = collectSourceMentions(sentences);
  return Promise.all(mentions.map(async ({ locators: _locators, ...source }) => ({
    ...source,
    role_label: ROLE_LABELS[source.role] ?? ROLE_LABELS.other,
    evidence: await sourceEvidence(articleId, sentences, { ...source, locators: _locators }),
  })));
}

async function descriptorSignals(articleId, sentences, rules) {
  const results = [];
  for (const rule of rules) {
    const matched = [];
    for (const sentence of sentences) {
      if (rule.patterns.some((pattern) => pattern.test(sentence.text))) matched.push(sentence);
    }
    if (!matched.length) continue;
    results.push({
      code: rule.code,
      label: rule.label,
      sentence_count: matched.length,
      share_of_sentences: Math.round((matched.length / Math.max(1, sentences.length)) * 1000) / 1000,
      evidence: await Promise.all(matched.slice(0, 2).map((sentence) => evidenceReference(articleId, sentence))),
      interpretation_limit: "고정 어휘·구문이 관측된 보조 지표이며, 그 자체로 완결된 프레임 판정은 아닙니다.",
    });
  }
  return results.sort((a, b) => b.sentence_count - a.sentence_count || a.code.localeCompare(b.code));
}

async function contextProfile(articleId, sentences) {
  const signals = [
    { code: "historical_context", label: "과거 경과", pattern: /(?:지난해|작년|당시|이후|이전|역대|그동안|수년|년 전|과거|부터)/ },
    { code: "statistics", label: "수치·통계", pattern: /(?:\d[\d,.]*\s*(?:%|퍼센트|명|건|원|조|억|만|배)|통계|조사 결과|집계)/ },
    { code: "institutional_context", label: "법·제도 맥락", pattern: /(?:법률|법안|시행령|조례|규정|제도|절차|판결|헌법)/ },
    { code: "comparative_context", label: "비교 맥락", pattern: /(?:반면|비교하면|보다|달리|해외 사례|다른 나라|지역별|계층별)/ },
    { code: "causal_context", label: "원인·배경 설명", pattern: /(?:때문|탓|원인|배경|영향으로|비롯|초래|계기)/ },
    { code: "counter_position", label: "반론·대안 관점", pattern: /(?:반면|그러나|다만|이에 대해|반박|반론|반대 측|다른 시각)/ },
  ];
  const observed = [];
  for (const signal of signals) {
    const matched = sentences.filter((sentence) => signal.pattern.test(sentence.text));
    if (!matched.length) continue;
    observed.push({
      code: signal.code,
      label: signal.label,
      sentence_count: matched.length,
      evidence: await Promise.all(matched.slice(0, 2).map((sentence) => evidenceReference(articleId, sentence))),
    });
  }
  const depthScore = Math.min(100, observed.reduce((sum, item) => sum + Math.min(3, item.sentence_count) * 8, 0));
  return {
    level: depthScore >= 55 ? "deep" : depthScore >= 25 ? "moderate" : "shallow",
    score: depthScore,
    signals: observed,
    caution: "맥락 깊이는 관측 가능한 배경·통계·제도·반론 표지의 범위를 나타내며 기사 품질 점수가 아닙니다.",
  };
}

async function scopeProfile(articleId, sentences) {
  const episodicPattern = /(?:피해자|유가족|주민|시민|환자|노동자|학생|가족|개인|현장|사건|사고|사례|인터뷰)/;
  const thematicPattern = /(?:통계|추세|구조|제도|정책|역사|법률|전국|산업|시장|사회적|장기|수년|비율|조사 결과)/;
  const episodic = sentences.filter((sentence) => episodicPattern.test(sentence.text));
  const thematic = sentences.filter((sentence) => thematicPattern.test(sentence.text));
  let code = "not_observed";
  if (episodic.length && thematic.length) {
    const ratio = episodic.length / thematic.length;
    code = ratio >= 2 ? "episodic" : ratio <= 0.5 ? "thematic" : "mixed";
  } else if (episodic.length) code = "episodic";
  else if (thematic.length) code = "thematic";
  return {
    code,
    label: {
      episodic: "사례·사건 중심",
      thematic: "구조·맥락 중심",
      mixed: "사례와 구조를 함께 제시",
      not_observed: "범위 판정 유보",
    }[code],
    episodic_sentence_count: episodic.length,
    thematic_sentence_count: thematic.length,
    evidence: {
      episodic: await Promise.all(episodic.slice(0, 2).map((sentence) => evidenceReference(articleId, sentence))),
      thematic: await Promise.all(thematic.slice(0, 2).map((sentence) => evidenceReference(articleId, sentence))),
    },
    caution: code === "not_observed"
      ? "분석 본문에서 사례 중심 또는 구조 중심을 뒷받침할 명시적 표지를 충분히 확인하지 못했습니다."
      : "기사의 설명 범위를 나타내는 보조 분류이며 보도의 우열을 뜻하지 않습니다.",
  };
}

async function framingDevices(articleId, title, sentences, sources) {
  const titleText = normalizeText(title);
  const lead = sentences.slice(0, 2);
  const rules = [
    { code: "statistics", label: "수치·통계", pattern: /(?:\d[\d,.]*\s*(?:%|퍼센트|명|건|원|조|억|만|배)|통계|조사 결과|집계)/ },
    { code: "contrast", label: "대조·반론", pattern: /(?:반면|그러나|다만|이에 대해|반박|반론|엇갈|상반)/ },
    { code: "historical_reference", label: "과거 경과", pattern: /(?:지난해|작년|당시|이후|이전|역대|그동안|수년|과거)/ },
    { code: "personal_example", label: "개인·현장 사례", pattern: /(?:피해자|유가족|주민|환자|노동자|학생|현장|사례|호소)/ },
    { code: "evaluative_headline", label: "평가적 제목", pattern: /(?:논란|충격|참사|무능|졸속|파장|위기|성과|쾌거|후퇴|강행|폭주)/ },
  ];
  const devices = [];
  for (const rule of rules) {
    const matched = rule.code === "evaluative_headline"
      ? (rule.pattern.test(titleText) && sentences.length ? [sentences[0]] : [])
      : sentences.filter((sentence) => rule.pattern.test(sentence.text));
    if (!matched.length) continue;
    devices.push({
      code: rule.code,
      label: rule.label,
      count: matched.length,
      appears_in_lead: matched.some((sentence) => lead.includes(sentence)),
      evidence: await Promise.all(matched.slice(0, 2).map((sentence) => evidenceReference(articleId, sentence))),
    });
  }
  devices.push({
    code: "source_attribution",
    label: "명시적 취재원 인용",
    count: sources.reduce((sum, source) => sum + source.direct_quote_count + source.indirect_attribution_count, 0),
    appears_in_lead: false,
    evidence: uniqueEvidence(sources.flatMap((source) => source.evidence)).slice(0, 3),
  });
  return devices;
}

function associationMap(sentences) {
  const pairs = new Map();
  for (const sentence of sentences) {
    const concepts = CONTROLLED_CONCEPTS.filter((concept) => concept.pattern.test(sentence.text)).map((concept) => concept.code);
    const unique = [...new Set(concepts)].sort();
    for (let left = 0; left < unique.length; left += 1) {
      for (let right = left + 1; right < unique.length; right += 1) {
        const key = `${unique[left]}::${unique[right]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }
  return [...pairs.entries()]
    .map(([key, sentenceCount]) => {
      const [source, target] = key.split("::");
      return { source, target, sentence_count: sentenceCount };
    })
    .sort((a, b) => b.sentence_count - a.sentence_count || `${a.source}:${a.target}`.localeCompare(`${b.source}:${b.target}`))
    .slice(0, 12);
}

function wordCount(text) {
  return normalizeText(text).split(/\s+/).filter(Boolean).length;
}

/**
 * Analyze one Korean-language article without returning raw article text.
 *
 * @param {{articleId:string,title:string,bodyText:string,publishedAt?:string|null}} input
 * @returns {Promise<Record<string, unknown>>}
 */
export async function analyzeArticleFraming(input) {
  const articleId = String(input?.articleId ?? "").trim();
  const title = normalizeText(input?.title);
  const bodyText = normalizeText(input?.bodyText);
  if (!articleId) throw new TypeError("articleId is required.");
  if (!title) throw new TypeError("title is required.");
  if (!bodyText) throw new TypeError("bodyText is required.");

  const sentences = segmentKoreanArticle(bodyText);
  const genre = genreRule(title, sentences);
  const sources = await sourceProfile(articleId, sentences);
  const dimensions = await extractDimensions(articleId, sentences);
  const profile = {
    schema_version: ARTICLE_FRAME_PROFILE_SCHEMA,
    engine: {
      name: "AgendaFrame Korean evidence rules",
      version: FRAMING_ENGINE_VERSION,
      approach: "deterministic_extractive_rules",
      semantic_ai: false,
      evidence_storage: "locator_and_salted_sha256_only",
      limitations: [
        "이 결과는 한국어 어휘·구문 규칙에 따른 구조화 관측이며 사람의 의미 해석이나 LLM 판정이 아닙니다.",
        "취재원에게 귀속된 발언은 언론사의 서술·입장으로 합산하지 않습니다.",
        "확인되지 않음은 기사에 요소가 없다는 단정이 아니라 분석 가능한 본문에서 규칙으로 관측되지 않았다는 뜻입니다.",
      ],
    },
    article: {
      article_id: articleId,
      published_at: input?.publishedAt ? String(input.publishedAt) : null,
      title_sha256: await sha256(`agendaframe:title:v1:${articleId}:${title}`),
      body_sha256: await sha256(`agendaframe:body:v1:${articleId}:${bodyText}`),
      body_character_count: bodyText.length,
      body_word_count: wordCount(bodyText),
      paragraph_count: Math.max(0, ...sentences.map((sentence) => sentence.paragraph)),
      sentence_count: sentences.length,
      raw_body_retained: false,
    },
    genre: {
      ...genre,
      evidence: await genreEvidence(articleId, title, sentences, genre),
    },
    dimensions,
    actors_and_sources: sources,
    context_depth: await contextProfile(articleId, sentences),
    scope: await scopeProfile(articleId, sentences),
    secondary_descriptors: {
      generic_frames: await descriptorSignals(articleId, sentences, GENERIC_FRAME_RULES),
      policy_frames: await descriptorSignals(articleId, sentences, POLICY_DESCRIPTOR_RULES),
      controlled_associations: associationMap(sentences),
    },
    framing_devices: await framingDevices(articleId, title, sentences, sources),
    review: {
      status: "machine_observation_unreviewed",
      requires_human_review: true,
      publication_rule: "책임 귀속·규범적 평가·매체 간 차이는 사람 검토 전 확정 표현으로 공개하지 않습니다.",
    },
  };

  const validation = validateArticleFrameProfile(profile);
  if (!validation.valid) {
    throw new Error(`Invalid article frame profile: ${validation.errors.join("; ")}`);
  }
  return profile;
}

function findForbiddenKeys(value, path = "$", errors = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenKeys(item, `${path}[${index}]`, errors));
    return errors;
  }
  if (!value || typeof value !== "object") return errors;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:bodyText|body_text|rawBody|raw_body|sentenceText|sentence_text|quote|quotation|excerpt|html|content)$/i.test(key)) {
      errors.push(`${path}.${key} may contain raw article text`);
    }
    findForbiddenKeys(child, `${path}.${key}`, errors);
  }
  return errors;
}

/**
 * Validate a public/storable profile. The validator deliberately rejects fields
 * conventionally used to carry bodies, sentences, quotations, or excerpts.
 *
 * @param {Record<string, unknown>} profile
 * @returns {{valid:boolean, errors:string[]}}
 */
export function validateArticleFrameProfile(profile) {
  const errors = [];
  if (!profile || typeof profile !== "object") return { valid: false, errors: ["profile must be an object"] };
  const deterministicProfile = profile.schema_version === ARTICLE_FRAME_PROFILE_SCHEMA;
  const semanticProfile = profile.schema_version === AI_ARTICLE_FRAME_PROFILE_SCHEMA;
  if (!deterministicProfile && !semanticProfile) errors.push("unsupported schema_version");
  if (deterministicProfile && profile.engine?.semantic_ai !== false) {
    errors.push("semantic_ai must be false for the deterministic schema");
  }
  if (semanticProfile && profile.engine?.semantic_ai !== true) {
    errors.push("semantic_ai must be true for the semantic schema");
  }
  if (profile.article?.raw_body_retained !== false) errors.push("raw_body_retained must be false");
  if (!/^[a-f0-9]{64}$/.test(String(profile.article?.body_sha256 ?? ""))) errors.push("body_sha256 must be SHA-256 hex");
  for (const dimension of DIMENSION_ORDER) {
    const result = profile.dimensions?.[dimension];
    if (!result || !["observed", "source_attributed", "not_observed"].includes(result.status)) {
      errors.push(`${dimension} has invalid status`);
      continue;
    }
    if (result.status === "not_observed" && result.items?.length) errors.push(`${dimension} not_observed must have no items`);
    if (result.status === "source_attributed" && result.outlet_narration_observed !== false) {
      errors.push(`${dimension} source_attributed cannot be outlet narration`);
    }
    for (const item of result.items ?? []) {
      if (!["journalist_narration", "direct_quote", "indirect_source", "uncertain_quote"].includes(item.voice?.kind)) {
        errors.push(`${dimension} has invalid voice`);
      }
      if (item.claim_id !== undefined && !/^claim:[a-f0-9]{64}$/.test(String(item.claim_id))) {
        errors.push(`${dimension} has invalid claim_id`);
      }
      if (item.frame_family !== undefined && item.frame_family !== null
        && !/^[a-z0-9_]{2,80}$/.test(String(item.frame_family))) {
        errors.push(`${dimension} has invalid frame_family`);
      }
      if (item.variant_key !== undefined && !String(item.variant_key).trim()) {
        errors.push(`${dimension} has invalid variant_key`);
      }
      if (!/^[a-f0-9]{64}$/.test(String(item.evidence?.sentence_sha256 ?? ""))) {
        errors.push(`${dimension} has invalid evidence hash`);
      }
      if (!Number.isInteger(item.evidence?.locator?.paragraph) || !Number.isInteger(item.evidence?.locator?.sentence)) {
        errors.push(`${dimension} has invalid evidence locator`);
      }
    }
  }
  findForbiddenKeys(profile, "$", errors);
  return { valid: errors.length === 0, errors };
}

function metadataMap(metadata) {
  if (metadata instanceof Map) return metadata;
  if (Array.isArray(metadata)) {
    return new Map(metadata.map((article) => [String(article.articleId ?? article.article_id ?? article.id), article]));
  }
  return new Map(Object.entries(metadata ?? {}));
}

function outletLabel(articleId, metadataById) {
  const metadata = metadataById.get(String(articleId)) ?? {};
  return String(metadata.sourceName ?? metadata.source_name ?? metadata.source ?? metadata.outletName ?? metadata.outlet_name ?? "출처 미상");
}

function outletId(articleId, metadataById) {
  const metadata = metadataById.get(String(articleId)) ?? {};
  return String(metadata.sourceId ?? metadata.source_id ?? metadata.outletId ?? metadata.outlet_id ?? outletLabel(articleId, metadataById));
}

function countBy(items, getter) {
  const counts = {};
  for (const item of items) {
    const key = getter(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function sortedPatterns(patterns) {
  return [...patterns.values()]
    .map((pattern) => {
      const paraphrases = [...pattern.paraphrases].sort((a, b) => a.localeCompare(b, "ko"));
      return {
        ...pattern,
        public_paraphrase: paraphrases[0] ?? pattern.public_paraphrase,
        paraphrases,
        outlets: [...pattern.outlets].sort((a, b) => a.localeCompare(b, "ko")),
        article_ids: [...pattern.article_ids].sort(),
        claim_ids: [...pattern.claim_ids].sort(),
        evidence: pattern.evidence.slice(0, 8),
      };
    })
    .sort((a, b) => b.article_count - a.article_count || a.code.localeCompare(b.code));
}

function semanticVariantKey(dimension, item, profile) {
  if (profile.engine?.semantic_ai !== true) {
    return normalizeText(item.variant_key) || String(item.code);
  }
  const frameFamily = String(item.frame_family ?? "").trim();
  if (/^[a-z0-9_]{2,80}$/.test(frameFamily)) {
    return `semantic:${dimension}:family:${frameFamily}`;
  }
  const normalizedMeaning = normalizeText(item.public_paraphrase)
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalizedMeaning
    ? `semantic:${dimension}:${normalizedMeaning}`
    : String(item.code);
}

function claimIdForItem(articleId, dimension, variantKey, voiceScope, item) {
  const provided = String(item.claim_id ?? "");
  if (/^claim:[a-f0-9]{64}$/.test(provided)) return provided;
  return `legacy:${articleId}:${dimension}:${variantKey}:${voiceScope}`;
}

function buildAxis(dimension, profiles, metadataById) {
  const patterns = new Map();
  let outletNarrationCount = 0;
  let sourceAttributedOnlyCount = 0;
  let notObservedCount = 0;
  for (const profile of profiles) {
    const articleId = profile.article.article_id;
    const result = profile.dimensions[dimension];
    if (result.status === "not_observed") {
      notObservedCount += 1;
      continue;
    }
    if (result.outlet_narration_observed) outletNarrationCount += 1;
    else sourceAttributedOnlyCount += 1;
    for (const item of result.items) {
      const variantKey = semanticVariantKey(dimension, item, profile);
      const voiceScope = item.voice.kind === "journalist_narration" ? "outlet_narration" : "attributed_source";
      const claimId = claimIdForItem(articleId, dimension, variantKey, voiceScope, item);
      const key = `${variantKey}:${voiceScope}`;
      const current = patterns.get(key) ?? {
        code: item.code,
        frame_family: item.frame_family ?? null,
        variant_key: variantKey,
        public_paraphrase: item.public_paraphrase,
        paraphrases: new Set(),
        voice_scope: voiceScope,
        article_count: 0,
        outlets: new Set(),
        article_ids: new Set(),
        claim_ids: new Set(),
        evidence: [],
      };
      current.paraphrases.add(item.public_paraphrase);
      current.outlets.add(outletLabel(articleId, metadataById));
      current.article_ids.add(articleId);
      current.claim_ids.add(claimId);
      current.article_count = current.article_ids.size;
      current.evidence.push({
        article_id: articleId,
        source_id: outletId(articleId, metadataById),
        claim_id: claimId,
        voice_kind: item.voice.kind,
        ...item.evidence,
      });
      patterns.set(key, current);
    }
  }
  return {
    dimension,
    label: DIMENSION_LABELS[dimension],
    observed_article_count: profiles.length - notObservedCount,
    outlet_narration_article_count: outletNarrationCount,
    source_attributed_only_article_count: sourceAttributedOnlyCount,
    not_observed_article_count: notObservedCount,
    patterns: sortedPatterns(patterns),
    not_observed_statement: notObservedCount
      ? `${notObservedCount}건에서는 분석 가능한 본문 안에서 ${DIMENSION_LABELS[dimension]} 요소가 관측되지 않았습니다. 이는 해당 요소의 실제 부재나 의도적 누락을 뜻하지 않습니다.`
      : null,
  };
}

function buildSourceLens(profiles, metadataById) {
  const roles = new Map();
  const outletArticles = new Map();
  const outletSourceArticles = new Map();
  const byOutlet = new Map();
  for (const profile of profiles) {
    const articleId = profile.article.article_id;
    const sourceName = outletLabel(articleId, metadataById);
    const articles = outletArticles.get(sourceName) ?? new Set();
    articles.add(articleId);
    outletArticles.set(sourceName, articles);
    const roleMap = byOutlet.get(sourceName) ?? new Map();
    byOutlet.set(sourceName, roleMap);
    for (const source of profile.actors_and_sources ?? []) {
      const directCount = Number(source.direct_quote_count ?? 0);
      const indirectCount = Number(source.indirect_attribution_count ?? 0);
      if (directCount + indirectCount <= 0) continue;
      const sourceArticles = outletSourceArticles.get(sourceName) ?? new Set();
      sourceArticles.add(articleId);
      outletSourceArticles.set(sourceName, sourceArticles);
      const role = roles.get(source.role) ?? {
        role: source.role,
        role_label: source.role_label,
        articles: new Set(),
        outlets: new Set(),
        direct_articles: new Set(),
        indirect_articles: new Set(),
        observation_ids: new Set(),
        evidence: [],
        direct_quote_count: 0,
        indirect_attribution_count: 0,
      };
      role.articles.add(articleId);
      role.outlets.add(sourceName);
      const observationId = String(
        source.actor_id ?? `source-observation:${articleId}:${source.role}`,
      );
      role.observation_ids.add(observationId);
      role.evidence.push(
        ...(source.evidence ?? []).map((evidence) => ({
          article_id: articleId,
          source_id: outletId(articleId, metadataById),
          claim_id: observationId,
          voice_kind: directCount > 0 ? "direct_quote" : "indirect_source",
          ...evidence,
        })),
      );
      if (directCount > 0) role.direct_articles.add(articleId);
      if (indirectCount > 0) role.indirect_articles.add(articleId);
      role.direct_quote_count += directCount;
      role.indirect_attribution_count += indirectCount;
      roles.set(source.role, role);

      const outletRole = roleMap.get(source.role) ?? {
        role: source.role,
        role_label: source.role_label,
        articles: new Set(),
        direct_articles: new Set(),
        indirect_articles: new Set(),
        observation_ids: new Set(),
        evidence: [],
        mention_count: 0,
      };
      outletRole.articles.add(articleId);
      outletRole.observation_ids.add(observationId);
      outletRole.evidence.push(...role.evidence.filter((item) => item.article_id === articleId));
      if (directCount > 0) outletRole.direct_articles.add(articleId);
      if (indirectCount > 0) outletRole.indirect_articles.add(articleId);
      outletRole.mention_count += directCount + indirectCount;
      roleMap.set(source.role, outletRole);
    }
  }
  const outletNames = [...outletArticles.keys()].sort((a, b) => a.localeCompare(b, "ko"));
  const roleRows = [...roles.values()]
    .map((role) => {
      const rates = outletNames.map((outlet) => {
        const denominator = outletArticles.get(outlet)?.size ?? 0;
        const numerator = byOutlet.get(outlet)?.get(role.role)?.articles.size ?? 0;
        return denominator ? numerator / denominator : 0;
      });
      return {
        role: role.role,
        role_label: role.role_label,
        article_count: role.articles.size,
        outlet_count: role.outlets.size,
        direct_quote_article_count: role.direct_articles.size,
        indirect_attribution_article_count: role.indirect_articles.size,
        direct_quote_count: role.direct_quote_count,
        indirect_attribution_count: role.indirect_attribution_count,
        observation_ids: [...role.observation_ids].sort(),
        evidence: uniqueComparisonEvidence(role.evidence),
        presence_gap: rates.length
          ? Math.round((Math.max(...rates) - Math.min(...rates)) * 1000) / 1000
          : 0,
      };
    })
    .sort((a, b) => b.article_count - a.article_count || a.role.localeCompare(b.role));
  const officialRoles = new Set([
    "government_official",
    "political_actor",
    "judiciary_law_enforcement",
    "anonymous_official",
  ]);
  return {
    roles: roleRows,
    by_outlet: outletNames.map((outlet) => {
      const totalArticleCount = outletArticles.get(outlet)?.size ?? 0;
      const sourceArticleCount = outletSourceArticles.get(outlet)?.size ?? 0;
      const roleRowsForOutlet = [...(byOutlet.get(outlet)?.values() ?? [])]
        .map((role) => ({
          role: role.role,
          role_label: role.role_label,
          count: role.articles.size,
          article_count: role.articles.size,
          presence_rate: totalArticleCount
            ? Math.round((role.articles.size / totalArticleCount) * 1000) / 1000
            : 0,
          direct_quote_article_count: role.direct_articles.size,
          indirect_attribution_article_count: role.indirect_articles.size,
          mention_count: role.mention_count,
          observation_ids: [...role.observation_ids].sort(),
          evidence: uniqueComparisonEvidence(role.evidence),
        }))
        .sort((a, b) => b.article_count - a.article_count || a.role.localeCompare(b.role));
      const officialArticleIds = new Set();
      for (const role of byOutlet.get(outlet)?.values() ?? []) {
        if (!officialRoles.has(role.role)) continue;
        for (const articleId of role.articles) officialArticleIds.add(articleId);
      }
      const affected = byOutlet.get(outlet)?.get("affected_person")?.articles.size ?? 0;
      return {
        outlet,
        article_count: totalArticleCount,
        source_article_count: sourceArticleCount,
        official_share: sourceArticleCount
          ? Math.round((officialArticleIds.size / sourceArticleCount) * 1000) / 1000
          : null,
        affected_group_presence_rate: totalArticleCount
          ? Math.round((affected / totalArticleCount) * 1000) / 1000
          : 0,
        roles: roleRowsForOutlet,
      };
    }),
    caution: "목소리 가시성은 역할이 등장한 고유 기사 비율을 우선하며, 반복 인용 횟수는 보조 정보로만 제공합니다.",
  };
}

function dominantSecondary(profiles, section, limit = 5) {
  const counts = new Map();
  for (const profile of profiles) {
    for (const item of profile.secondary_descriptors?.[section] ?? []) {
      const current = counts.get(item.code) ?? { code: item.code, label: item.label, article_count: 0 };
      current.article_count += 1;
      counts.set(item.code, current);
    }
  }
  return [...counts.values()].sort((a, b) => b.article_count - a.article_count || a.code.localeCompare(b.code)).slice(0, limit);
}

function mediaGroupForArticle(articleId, metadataById) {
  const metadata = metadataById.get(String(articleId)) ?? {};
  return String(metadata.mediaGroupId ?? metadata.media_group_id ?? outletId(articleId, metadataById));
}

function divergencePair(patterns, metadataById) {
  for (let left = 0; left < patterns.length; left += 1) {
    const leftGroups = new Set(patterns[left].article_ids.map((articleId) => mediaGroupForArticle(articleId, metadataById)));
    for (let right = left + 1; right < patterns.length; right += 1) {
      const rightGroups = new Set(patterns[right].article_ids.map((articleId) => mediaGroupForArticle(articleId, metadataById)));
      const leftExclusive = [...leftGroups].some((group) => !rightGroups.has(group));
      const rightExclusive = [...rightGroups].some((group) => !leftGroups.has(group));
      if (leftExclusive && rightExclusive) return [patterns[left], patterns[right]];
    }
  }
  return null;
}

function describeDivergence(axes, metadataById) {
  const candidates = axes
    .map((axis) => {
      const narrationPatterns = axis.patterns.filter((pattern) => pattern.voice_scope === "outlet_narration");
      return { axis, pair: divergencePair(narrationPatterns, metadataById) };
    })
    .filter(({ pair }) => pair)
    .sort((left, right) => {
      const dimensionPriority = DIMENSION_ORDER.indexOf(left.axis.dimension) - DIMENSION_ORDER.indexOf(right.axis.dimension);
      return dimensionPriority || right.axis.observed_article_count - left.axis.observed_article_count;
    });
  if (!candidates.length) {
    return {
      detected: false,
      text: "매체 서술로 확인된 요소만 놓고 볼 때, 서로 다른 미디어그룹의 설명 패턴이 갈렸다고 확정할 근거는 아직 충분하지 않습니다.",
    };
  }
  const { axis, pair } = candidates[0];
  const labels = pair.map((pattern) => pattern.public_paraphrase.replace(/합니다\.$/, "")).join(" / ");
  return {
    detected: true,
    text: `${axis.label}에서 서로 다른 미디어그룹의 매체 서술이 갈립니다: ${labels}.`,
  };
}

function describeCommon(axes, profileCount) {
  const threshold = Math.max(2, Math.ceil(profileCount * 0.6));
  for (const axis of axes) {
    const common = axis.patterns.find((pattern) => pattern.voice_scope === "outlet_narration" && pattern.article_count >= threshold);
    if (common) return `${axis.label}에서 ${common.public_paraphrase}`;
  }
  return "분석 표본의 60% 이상에서 공통으로 확인되는 단일한 매체 서술 패턴은 관측되지 않았습니다.";
}

function sourceDominance(profiles) {
  const voiceObservations = new Set();
  for (const profile of profiles) {
    const articleId = String(profile.article?.article_id ?? "");
    for (const dimension of DIMENSION_ORDER) {
      for (const item of profile.dimensions?.[dimension]?.items ?? []) {
        const voiceScope = item.voice?.kind === "journalist_narration"
          ? "outlet_narration"
          : "attributed_source";
        voiceObservations.add(`${articleId}\n${dimension}\n${voiceScope}`);
      }
    }
  }
  const attributedItemCount = [...voiceObservations]
    .filter((value) => value.endsWith("\nattributed_source"))
    .length;
  const share = voiceObservations.size ? attributedItemCount / voiceObservations.size : 0;
  const sourceDominanceSafeGenre = profiles.every((profile) =>
    profile.genre?.code === "straight_news"
    || (profile.engine?.semantic_ai === true && profile.genre?.code === "unknown"),
  );
  return {
    detected: profiles.length >= 2
      && sourceDominanceSafeGenre
      && share >= 0.7,
    attributed_item_count: attributedItemCount,
    total_item_count: voiceObservations.size,
    attributed_share: Math.round(share * 1000) / 1000,
  };
}

function uniqueComparisonEvidence(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.article_id}:${entry.claim_id}:${entry.sentence_sha256}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function issueMapAnchor(pattern, metadataById) {
  const mediaGroups = new Set(
    pattern.article_ids.map((articleId) => mediaGroupForArticle(articleId, metadataById)),
  );
  return {
    group_id: pattern.variant_key,
    label: pattern.public_paraphrase,
    frame_family: pattern.frame_family ?? null,
    article_count: pattern.article_count,
    outlet_count: pattern.outlets.length,
    independent_media_group_count: mediaGroups.size,
    claim_ids: pattern.claim_ids,
    evidence: pattern.evidence,
  };
}

function issueMapPair(patterns, profileCount) {
  const candidates = [];
  for (let leftIndex = 0; leftIndex < patterns.length; leftIndex += 1) {
    const left = patterns[leftIndex];
    if (left.article_count < 2) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < patterns.length; rightIndex += 1) {
      const right = patterns[rightIndex];
      if (right.article_count < 2) continue;
      const leftArticles = new Set(left.article_ids);
      const rightArticles = new Set(right.article_ids);
      const intersection = [...leftArticles].filter((articleId) => rightArticles.has(articleId)).length;
      const union = new Set([...leftArticles, ...rightArticles]).size;
      const leftCoverage = leftArticles.size / Math.max(1, profileCount);
      const rightCoverage = rightArticles.size / Math.max(1, profileCount);
      const balancedCoverage = leftCoverage + rightCoverage
        ? (2 * leftCoverage * rightCoverage) / (leftCoverage + rightCoverage)
        : 0;
      const overlap = union ? intersection / union : 0;
      candidates.push({
        left,
        right,
        balanced_coverage: Math.round(balancedCoverage * 1000) / 1000,
        overlap: Math.round(overlap * 1000) / 1000,
        axis_strength: Math.round(balancedCoverage * (1 - overlap) * 1000) / 1000,
        covered_article_count: union,
        smaller_anchor_article_count: Math.min(left.article_count, right.article_count),
      });
    }
  }
  return candidates.sort((left, right) =>
    right.axis_strength - left.axis_strength
    || right.smaller_anchor_article_count - left.smaller_anchor_article_count
    || right.covered_article_count - left.covered_article_count
    || `${left.left.variant_key}:${left.right.variant_key}`.localeCompare(
      `${right.left.variant_key}:${right.right.variant_key}`,
    ))[0] ?? null;
}

function buildIssueMap(axes, profiles, metadataById, sourceDominated, semanticDraftPresent) {
  const problemAxis = axes.find((axis) => axis.dimension === "problem_definition");
  const narrationPatterns = problemAxis?.patterns.filter(
    (pattern) => pattern.voice_scope === "outlet_narration",
  ) ?? [];
  const outletIds = new Set(
    profiles.map((profile) => outletId(profile.article.article_id, metadataById)),
  );
  const mediaGroups = new Set(
    profiles.map((profile) => mediaGroupForArticle(profile.article.article_id, metadataById)),
  );
  const structuralRequirements = {
    minimum_articles: 4,
    minimum_outlets: 3,
    minimum_independent_media_groups: 2,
    minimum_articles_per_anchor: 2,
  };
  const withheld = (status, reason) => ({
    status,
    reason,
    axis_id: null,
    dimension: "problem_definition",
    label: problemAxis?.label ?? DIMENSION_LABELS.problem_definition,
    left_anchor: null,
    right_anchor: null,
    selection_basis: {
      ...structuralRequirements,
      article_count: profiles.length,
      outlet_count: outletIds.size,
      independent_media_group_count: mediaGroups.size,
    },
    outlets: [],
  });

  if (sourceDominated.detected) {
    return withheld(
      "withheld_source_dominated",
      "취재원 발언이 분석 항목의 70% 이상을 차지해 언론사 자체의 쟁점 위치 계산을 보류했습니다.",
    );
  }
  if (
    profiles.length < structuralRequirements.minimum_articles
    || outletIds.size < structuralRequirements.minimum_outlets
    || mediaGroups.size < structuralRequirements.minimum_independent_media_groups
  ) {
    return withheld(
      "withheld_insufficient_evidence",
      "쟁점 지도를 만들기 위한 기사·언론사·독립 미디어그룹 표본이 충분하지 않습니다.",
    );
  }
  const pair = issueMapPair(narrationPatterns, profiles.length);
  if (!pair) {
    return withheld(
      "withheld_insufficient_evidence",
      "문제 정의 양쪽에서 각각 두 건 이상의 기자 서술 근거를 확인하지 못했습니다.",
    );
  }

  const leftArticles = new Set(pair.left.article_ids);
  const rightArticles = new Set(pair.right.article_ids);
  const profilesByOutlet = new Map();
  for (const profile of profiles) {
    const articleId = profile.article.article_id;
    const sourceId = outletId(articleId, metadataById);
    const source = outletLabel(articleId, metadataById);
    const current = profilesByOutlet.get(sourceId) ?? { source_id: sourceId, source, profiles: [] };
    current.profiles.push(profile);
    profilesByOutlet.set(sourceId, current);
  }
  const outlets = [...profilesByOutlet.values()].map((entry) => {
    let leftCount = 0;
    let rightCount = 0;
    let mixedCount = 0;
    const eligibleArticleIds = new Set();
    for (const profile of entry.profiles) {
      const articleId = profile.article.article_id;
      const left = leftArticles.has(articleId);
      const right = rightArticles.has(articleId);
      if (!left && !right) continue;
      eligibleArticleIds.add(articleId);
      if (left && right) mixedCount += 1;
      else if (left) leftCount += 1;
      else rightCount += 1;
    }
    const eligibleArticleCount = leftCount + rightCount + mixedCount;
    const score = eligibleArticleCount
      ? Math.round(((rightCount - leftCount) / eligibleArticleCount) * 1000) / 1000
      : null;
    const classification = eligibleArticleCount < 2
      ? "insufficient"
      : score <= -1 / 3
        ? "left"
        : score >= 1 / 3
          ? "right"
          : "mixed";
    const evidence = uniqueComparisonEvidence(
      [...pair.left.evidence, ...pair.right.evidence].filter(
        (item) => eligibleArticleIds.has(item.article_id),
      ),
    );
    return {
      source_id: entry.source_id,
      source: entry.source,
      classification,
      score,
      display_position: score === null ? null : Math.round((50 + 40 * score) * 10) / 10,
      article_count: entry.profiles.length,
      eligible_article_count: eligibleArticleCount,
      left_article_count: leftCount,
      mixed_article_count: mixedCount,
      right_article_count: rightCount,
      evidence_status: eligibleArticleCount === 0
        ? "insufficient"
        : eligibleArticleCount === 1
          ? "single_article_observation"
          : semanticDraftPresent
            ? "automatic_draft"
            : "supported",
      claim_ids: [...new Set(evidence.map((item) => item.claim_id))].sort(),
      evidence,
    };
  }).sort((left, right) =>
    (left.score === null) - (right.score === null)
    || (left.score ?? 0) - (right.score ?? 0)
    || left.source.localeCompare(right.source, "ko"));

  return {
    status: semanticDraftPresent ? "provisional" : "available",
    reason: semanticDraftPresent
      ? "검증된 본문 근거로 계산했지만 의미 분류는 사람 검토 전인 자동 분석 초안입니다."
      : "기사당 한 표로 두 문제 정의와의 연결을 계산했습니다.",
    axis_id: `problem_definition:${pair.left.variant_key}:${pair.right.variant_key}`,
    dimension: "problem_definition",
    label: problemAxis.label,
    left_anchor: issueMapAnchor(pair.left, metadataById),
    right_anchor: issueMapAnchor(pair.right, metadataById),
    selection_basis: {
      ...structuralRequirements,
      article_count: profiles.length,
      outlet_count: outletIds.size,
      independent_media_group_count: mediaGroups.size,
      balanced_coverage: pair.balanced_coverage,
      overlap: pair.overlap,
      axis_strength: pair.axis_strength,
      covered_article_count: pair.covered_article_count,
      formula: "axisStrength=harmonicCoverage*(1-overlap); outletScore=(right-left)/(left+mixed+right)",
    },
    outlets,
  };
}

function narrativeSignature(profile, metadataById) {
  const articleId = profile.article.article_id;
  const dimensions = new Map();
  for (const dimension of DIMENSION_ORDER) {
    const result = profile.dimensions?.[dimension];
    if (!result || result.status === "not_observed" || result.model_status === "conflicting") continue;
    const groups = new Map();
    for (const item of result.items ?? []) {
      if (item.voice?.kind !== "journalist_narration") continue;
      const variantKey = semanticVariantKey(dimension, item, profile);
      const claimId = claimIdForItem(articleId, dimension, variantKey, "outlet_narration", item);
      const group = groups.get(variantKey) ?? {
        group_id: variantKey,
        labels: new Set(),
        claim_ids: new Set(),
        evidence: [],
      };
      group.labels.add(item.public_paraphrase);
      group.claim_ids.add(claimId);
      group.evidence.push({
        article_id: articleId,
        source_id: outletId(articleId, metadataById),
        claim_id: claimId,
        voice_kind: item.voice.kind,
        ...item.evidence,
      });
      groups.set(variantKey, group);
    }
    if (groups.size) dimensions.set(dimension, groups);
  }
  return { article_id: articleId, profile, dimensions };
}

function groupsIntersect(left, right) {
  if (!left || !right) return false;
  return [...left.keys()].some((key) => right.has(key));
}

function narrativeCompatible(left, right) {
  if (!groupsIntersect(
    left.dimensions.get("problem_definition"),
    right.dimensions.get("problem_definition"),
  )) return false;
  let matchingDimensions = 0;
  let conflictingDimensions = 0;
  for (const dimension of DIMENSION_ORDER.slice(1)) {
    const leftGroups = left.dimensions.get(dimension);
    const rightGroups = right.dimensions.get(dimension);
    if (!leftGroups || !rightGroups) continue;
    if (groupsIntersect(leftGroups, rightGroups)) matchingDimensions += 1;
    else conflictingDimensions += 1;
  }
  return matchingDimensions >= 2 && conflictingDimensions === 0;
}

function completeLinkNarrativeClusters(signatures) {
  const clusters = [];
  for (const signature of [...signatures].sort((a, b) => a.article_id.localeCompare(b.article_id))) {
    const compatible = clusters
      .filter((cluster) => cluster.every((member) => narrativeCompatible(signature, member)))
      .sort((left, right) => right.length - left.length
        || left.map((member) => member.article_id).join(":").localeCompare(
          right.map((member) => member.article_id).join(":"),
        ));
    if (compatible.length) compatible[0].push(signature);
    else clusters.push([signature]);
  }
  return clusters;
}

function dominantNarrativeClause(cluster, dimension) {
  const observedMembers = cluster.filter((member) => member.dimensions.has(dimension));
  if (!observedMembers.length) return null;
  const groups = new Map();
  for (const member of observedMembers) {
    for (const [groupId, item] of member.dimensions.get(dimension)) {
      const group = groups.get(groupId) ?? {
        group_id: groupId,
        labels: new Set(),
        article_ids: new Set(),
        claim_ids: new Set(),
        evidence: [],
      };
      group.article_ids.add(member.article_id);
      for (const label of item.labels) group.labels.add(label);
      for (const claimId of item.claim_ids) group.claim_ids.add(claimId);
      group.evidence.push(...item.evidence);
      groups.set(groupId, group);
    }
  }
  const ranked = [...groups.values()].sort((left, right) =>
    right.article_ids.size - left.article_ids.size || left.group_id.localeCompare(right.group_id));
  const selected = ranked[0];
  if (!selected || selected.article_ids.size < 2) return null;
  if (ranked[1]?.article_ids.size === selected.article_ids.size) return null;
  const supportShare = selected.article_ids.size / observedMembers.length;
  if (supportShare < 0.6) return null;
  return {
    dimension,
    label: DIMENSION_LABELS[dimension],
    group_id: selected.group_id,
    summary: [...selected.labels].sort((a, b) => a.localeCompare(b, "ko"))[0],
    supporting_article_count: selected.article_ids.size,
    observed_article_count: observedMembers.length,
    support_share: Math.round(supportShare * 1000) / 1000,
    article_ids: [...selected.article_ids].sort(),
    claim_ids: [...selected.claim_ids].sort(),
    evidence: uniqueComparisonEvidence(selected.evidence),
  };
}

function buildNarratives(profiles, metadataById) {
  const signatures = profiles.map((profile) => narrativeSignature(profile, metadataById));
  const semanticDraftPresent = profiles.some(
    (profile) => profile.engine?.semantic_ai === true && profile.review?.status !== "human_reviewed",
  );
  const dimensionFields = {
    problem_definition: "problem",
    causal_interpretation: "cause",
    responsibility_attribution: "responsibility",
    moral_evaluation: "evaluation",
    treatment_recommendation: "remedy",
  };
  const candidates = completeLinkNarrativeClusters(signatures)
    .filter((cluster) => cluster.length >= 2)
    .map((cluster) => {
      const clauses = {};
      for (const dimension of DIMENSION_ORDER) {
        clauses[dimensionFields[dimension]] = dominantNarrativeClause(cluster, dimension);
      }
      const downstreamCount = DIMENSION_ORDER.slice(1)
        .filter((dimension) => clauses[dimensionFields[dimension]]).length;
      if (!clauses.problem || downstreamCount < 2) return null;
      const articleIds = cluster.map((member) => member.article_id).sort();
      const outlets = [...new Set(articleIds.map((articleId) => outletLabel(articleId, metadataById)))]
        .sort((a, b) => a.localeCompare(b, "ko"));
      const mediaGroups = new Set(
        articleIds.map((articleId) => mediaGroupForArticle(articleId, metadataById)),
      );
      const observedClauses = Object.values(clauses).filter(Boolean);
      const claimIds = [...new Set(observedClauses.flatMap((clause) => clause.claim_ids))].sort();
      const evidence = uniqueComparisonEvidence(observedClauses.flatMap((clause) => clause.evidence));
      return {
        status: semanticDraftPresent ? "automatic_draft" : "supported",
        article_count: articleIds.length,
        outlet_count: outlets.length,
        independent_media_group_count: mediaGroups.size,
        completeness: Math.round((observedClauses.length / DIMENSION_ORDER.length) * 1000) / 1000,
        supporting_article_ids: articleIds,
        supporting_outlets: outlets,
        claim_ids: claimIds,
        evidence,
        ...clauses,
        summary: observedClauses
          .map((clause) => `${clause.label}: ${clause.summary}`)
          .join(" · "),
      };
    })
    .filter(Boolean)
    .sort((left, right) =>
      right.article_count - left.article_count
      || right.outlet_count - left.outlet_count
      || right.completeness - left.completeness
      || right.independent_media_group_count - left.independent_media_group_count
      || left.summary.localeCompare(right.summary, "ko"))
    .slice(0, 2);
  return candidates.map((narrative, index) => ({
    narrative_id: `narrative-${index + 1}`,
    ...narrative,
  }));
}

function buildReaderQuestions(issueMap, narratives, sourceLens, axes, profiles, metadataById) {
  const candidates = [];
  if (narratives.length >= 2) {
    const fields = ["problem", "cause", "responsibility", "evaluation", "remedy"];
    const differing = fields.filter((field) =>
      narratives[0][field]?.group_id
      && narratives[1][field]?.group_id
      && narratives[0][field].group_id !== narratives[1][field].group_id);
    if (differing.length >= 2) {
      const evidence = uniqueComparisonEvidence([
        ...narratives[0].evidence,
        ...narratives[1].evidence,
      ]);
      candidates.push({
        question_id: "narrative-contrast",
        trigger_type: "narrative_contrast",
        priority: 0,
        question: "두 주요 서사는 같은 사건의 원인·책임·해법을 왜 다르게 연결할까요?",
        basis_claim_ids: [...new Set([...narratives[0].claim_ids, ...narratives[1].claim_ids])].sort(),
        basis_article_ids: [...new Set(evidence.map((item) => item.article_id))].sort(),
        evidence,
      });
    }
  }
  if (issueMap.left_anchor && issueMap.right_anchor) {
    const evidence = uniqueComparisonEvidence([
      ...issueMap.left_anchor.evidence,
      ...issueMap.right_anchor.evidence,
    ]);
    candidates.push({
      question_id: "problem-definition-contrast",
      trigger_type: "issue_axis_contrast",
      priority: 1,
      question: `왜 일부 보도는 ${issueMap.left_anchor.label}을, 다른 보도는 ${issueMap.right_anchor.label}을 중심 문제로 제시했을까요?`,
      basis_claim_ids: [...new Set([
        ...issueMap.left_anchor.claim_ids,
        ...issueMap.right_anchor.claim_ids,
      ])].sort(),
      basis_article_ids: [...new Set(evidence.map((item) => item.article_id))].sort(),
      evidence,
    });
  }
  const voiceGap = [...(sourceLens.roles ?? [])]
    .filter((role) => role.presence_gap >= 0.5 && role.observation_ids?.length)
    .sort((left, right) =>
      (right.role === "affected_person") - (left.role === "affected_person")
      || right.presence_gap - left.presence_gap
      || right.article_count - left.article_count
      || left.role.localeCompare(right.role))[0];
  if (voiceGap) {
    const evidence = uniqueComparisonEvidence(voiceGap.evidence ?? []);
    candidates.push({
      question_id: `source-gap-${voiceGap.role}`,
      trigger_type: voiceGap.role === "affected_person" ? "affected_voice_gap" : "source_voice_gap",
      priority: voiceGap.role === "affected_person" ? 2 : 3,
      question: `${voiceGap.role_label}의 목소리가 일부 매체에서만 관측된 차이는 사건 이해에 어떤 영향을 줄까요?`,
      basis_claim_ids: voiceGap.observation_ids,
      basis_article_ids: [...new Set(evidence.map((item) => item.article_id))].sort(),
      evidence,
    });
  }
  for (const axis of axes) {
    const presentOutlets = new Set();
    const absentOutlets = new Set();
    for (const profile of profiles) {
      if (profile.extraction?.input_truncated === true) continue;
      const articleId = profile.article.article_id;
      const outlet = outletLabel(articleId, metadataById);
      const result = profile.dimensions?.[axis.dimension];
      if (!result) continue;
      if (result.status === "not_observed") absentOutlets.add(outlet);
      else presentOutlets.add(outlet);
    }
    if (presentOutlets.size < 2 || absentOutlets.size < 1) continue;
    const patterns = axis.patterns.filter((pattern) => pattern.voice_scope === "outlet_narration");
    const evidence = uniqueComparisonEvidence(patterns.flatMap((pattern) => pattern.evidence));
    const claimIds = [...new Set(patterns.flatMap((pattern) => pattern.claim_ids))].sort();
    if (!claimIds.length) continue;
    candidates.push({
      question_id: `context-gap-${axis.dimension}`,
      trigger_type: "context_gap",
      priority: 4 + DIMENSION_ORDER.indexOf(axis.dimension),
      question: `일부 기사에서만 ${axis.label} 설명이 관측된 차이를 함께 확인해 볼까요?`,
      basis_claim_ids: claimIds,
      basis_article_ids: [...new Set(evidence.map((item) => item.article_id))].sort(),
      evidence,
    });
  }
  return candidates
    .filter((candidate) => candidate.basis_claim_ids.length && candidate.evidence.length)
    .sort((left, right) => left.priority - right.priority || left.question_id.localeCompare(right.question_id))
    .slice(0, 3)
    .map(({ priority, ...question }) => {
      void priority;
      return question;
    });
}

/**
 * Compare article-level profiles belonging to the same event.
 *
 * @param {Array<Record<string, unknown>>} profiles
 * @param {Array<Record<string, unknown>>|Map<string, Record<string, unknown>>|Record<string, Record<string, unknown>>} articleMetadata
 * @param {{issueId?:string|null, issueTitle?:string|null}} options
 * @returns {Record<string, unknown>}
 */
export function buildIssueFrameComparison(profiles, articleMetadata = [], options = {}) {
  if (!Array.isArray(profiles) || !profiles.length) throw new TypeError("At least one article frame profile is required.");
  const invalid = profiles.map((profile) => validateArticleFrameProfile(profile)).find((result) => !result.valid);
  if (invalid) throw new TypeError(`Invalid article frame profile: ${invalid.errors.join("; ")}`);
  const metadataById = metadataMap(articleMetadata);
  const articleIds = profiles.map((profile) => profile.article.article_id);
  const outlets = new Set(articleIds.map((articleId) => outletId(articleId, metadataById)));
  const mediaGroups = new Set(articleIds.map((articleId) => {
    const metadata = metadataById.get(String(articleId)) ?? {};
    return String(metadata.mediaGroupId ?? metadata.media_group_id ?? outletId(articleId, metadataById));
  }));
  const axes = DIMENSION_ORDER.map((dimension) => buildAxis(dimension, profiles, metadataById));
  const sourceLens = buildSourceLens(profiles, metadataById);
  const scopeCounts = countBy(profiles, (profile) => profile.scope.code);
  const contextCounts = countBy(profiles, (profile) => profile.context_depth.level);
  const notObservedStatements = axes.map((axis) => axis.not_observed_statement).filter(Boolean);
  const titleOnlyOrShort = profiles.filter((profile) => profile.article.body_character_count < 300).length;
  const sourceDominated = sourceDominance(profiles);
  const semanticDraftPresent = profiles.some(
    (profile) =>
      profile.engine?.semantic_ai === true
      && profile.review?.status !== "human_reviewed",
  );
  const issueMap = buildIssueMap(
    axes,
    profiles,
    metadataById,
    sourceDominated,
    semanticDraftPresent,
  );
  const narratives = buildNarratives(profiles, metadataById);
  const readerQuestions = buildReaderQuestions(
    issueMap,
    narratives,
    sourceLens,
    axes,
    profiles,
    metadataById,
  );
  const common = sourceDominated.detected
    ? "비교 표본에서 관측된 핵심 문제·원인·평가 표현의 대부분은 취재원 발언에 귀속됩니다."
    : describeCommon(axes, profiles.length);
  const observedDivergence = describeDivergence(axes, metadataById);
  const divergence = sourceDominated.detected
    ? {
        detected: false,
        text: "취재원 발언이 설명을 지배해, 표현 차이를 매체 자체의 프레임 차이로 확정하지 않았습니다.",
      }
    : semanticDraftPresent
      ? {
          detected: false,
          text: "AI가 구조화한 설명 변형은 표시하지만, 의미가 실제로 갈렸다는 판단은 사람 검토 전까지 보류합니다.",
        }
      : observedDivergence;
  const dominantRole = sourceLens.roles[0];
  const sourceSummary = sourceDominated.detected
    ? `분석 항목의 ${Math.round(sourceDominated.attributed_share * 100)}%가 직접·간접인용 또는 인용 경계의 표현으로 분류됐습니다. 같은 발언을 어느 위치에 배치했는지는 비교할 수 있지만, 이를 매체의 동의로 해석하면 안 됩니다.`
    : dominantRole
    ? `가장 자주 가시화된 취재원 범주는 ${dominantRole.role_label}이며 ${dominantRole.article_count}건에서 관측됐습니다. 이는 매체의 동의나 취재원 신뢰도 판정이 아닙니다.`
    : "명시적으로 귀속된 취재원 범주를 안정적으로 확인하지 못했습니다.";

  return {
    schema_version: ISSUE_FRAME_COMPARISON_SCHEMA,
    issue: {
      issue_id: options.issueId ? String(options.issueId) : null,
      issue_title: options.issueTitle ? String(options.issueTitle) : null,
    },
    method: {
      article_first: true,
      comparison_unit: "same_event_articles",
      outlet_voice_separated_from_sources: true,
      source_dominance_check: sourceDominated,
      secondary_taxonomies_are_descriptive_only: true,
      semantic_ai: profiles.some((profile) => profile.engine?.semantic_ai === true),
      caution: "동일 사건으로 검증된 기사끼리만 비교해야 하며, 관측되지 않은 요소를 의도적 누락으로 해석하지 않습니다.",
    },
    sample: {
      article_count: profiles.length,
      outlet_count: outlets.size,
      independent_media_group_count: mediaGroups.size,
      body_evidence_article_count: profiles.filter((profile) => profile.article.sentence_count > 0).length,
      short_body_article_count: titleOnlyOrShort,
      genres: countBy(profiles, (profile) => profile.genre.code),
      context_depth: contextCounts,
      scope: scopeCounts,
      article_ids: articleIds,
    },
    issue_map: issueMap,
    narratives,
    reader_questions: readerQuestions,
    comparison_axes: axes,
    source_lens: sourceLens,
    secondary_descriptors: {
      generic_frames: dominantSecondary(profiles, "generic_frames"),
      policy_frames: dominantSecondary(profiles, "policy_frames"),
    },
    not_observed_statements: notObservedStatements,
    summary_30_seconds: {
      sample: `${outlets.size}개 매체의 ${profiles.length}건을 본문 근거 위치와 함께 비교했습니다.`,
      common_ground: common,
      main_difference: divergence.text,
      divergence_detected: divergence.detected,
      source_context: sourceSummary,
      limit: `이 요약은 규칙 기반 관측 결과입니다. ${notObservedStatements.length}개 비교 축에서 일부 미관측이 있으며, 사람 검토 전에는 매체의 의도·편향·사실성 판정으로 사용하면 안 됩니다.`,
    },
    review: {
      status: "machine_comparison_unreviewed",
      requires_human_review: true,
    },
  };
}
