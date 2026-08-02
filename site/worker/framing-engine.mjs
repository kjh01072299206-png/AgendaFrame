/**
 * Evidence-bounded Korean news framing analysis.
 *
 * This module is deliberately deterministic. It does not claim semantic-AI
 * understanding, and it never returns the article body, sentences, quotations,
 * or excerpts. Public results contain controlled paraphrases plus paragraph /
 * sentence locators and salted SHA-256 fingerprints of the supporting sentence.
 */

import {
  contentLemmaSet,
  KOREAN_MORPHOLOGY_DICTIONARY_VERSION,
  KOREAN_MORPHOLOGY_MODE,
  KOREAN_MORPHOLOGY_VERSION,
  summarizeKoreanMorphology,
} from "./korean-morphology.mjs";

export const ARTICLE_FRAME_PROFILE_SCHEMA = "agendaframe.article-frame-profile.v2";
export const ISSUE_FRAME_COMPARISON_SCHEMA = "agendaframe.issue-frame-comparison.v2";
export const FRAMING_ENGINE_VERSION = "korean-morph-evidence-rules-v3";

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
  { code: "economic", label: "경제", terms: ["비용", "예산", "성장", "소득", "고용", "시장", "산업", "경제", "금리", "물가"], strongPatterns: [/(?:경제적 부담|금리 인상|물가 상승|일자리 감소|예산 삭감)/] },
  { code: "capacity_resources", label: "역량·자원", terms: ["인력", "예산", "시설", "역량", "재원", "자원", "기술", "인프라"], strongPatterns: [/(?:인력 부족|예산 부족|재원 부족|인프라 부족)/] },
  { code: "morality", label: "도덕성", terms: ["윤리", "도덕", "정의", "양심", "정당", "부당"], strongPatterns: [/(?:비윤리|도덕적|부당하|정당하지 않)/] },
  { code: "fairness_equality", label: "공정·평등", terms: ["공정", "평등", "차별", "격차", "특혜", "형평", "분배", "취약"], strongPatterns: [/(?:불공정|불평등|차별|특혜|형평성)/] },
  { code: "legality_constitutionality", label: "법·헌정", terms: ["법률", "헌법", "법적", "판결", "재판", "절차", "법치주의"], strongPatterns: [/(?:위법|위헌|절차 위반|법적 논란|법치주의 훼손)/] },
  { code: "policy_prescription", label: "정책 처방", terms: ["정책", "대책", "개선하다", "보완하다", "개정하다", "도입하다", "폐지하다", "지원하다", "규제하다"], strongPatterns: [/(?:개선해야|보완해야|개정해야|도입해야|폐지해야|대책을 마련|정책을 추진)/] },
  { code: "crime_punishment", label: "범죄·처벌", terms: ["범죄", "수사", "기소", "처벌", "형량", "구속", "검찰", "경찰"], strongPatterns: [/(?:범죄|처벌해야|기소|구속영장)/] },
  { code: "security_defense", label: "안보·국방", terms: ["안보", "국방", "군사", "전쟁", "북한", "무기", "외교", "동맹"], strongPatterns: [/(?:국가 안보|군사적 위협|국방력|무력 충돌)/] },
  { code: "health_safety", label: "건강·안전", terms: ["건강", "질병", "환자", "의료", "안전", "재난", "사고", "위험", "방역"], strongPatterns: [/(?:안전 사고|인명 피해|건강권|감염 확산|재난 대응)/] },
  { code: "quality_of_life", label: "삶의 질", terms: ["주거", "교육", "돌봄", "복지", "생활", "교통", "환경"], strongPatterns: [/(?:삶의 질|주거 불안|돌봄 공백|생활 여건)/] },
  { code: "cultural_identity", label: "문화·정체성", terms: ["문화", "정체성", "전통", "종교", "세대", "젠더", "지역"], strongPatterns: [/(?:문화적 정체성|세대 갈등|지역 정서)/] },
  { code: "public_opinion", label: "여론", terms: ["여론", "설문", "지지율", "찬성", "반대"], strongPatterns: [/(?:조사 결과|찬성 여론|반대 여론|지지율)/] },
  { code: "political", label: "정치 과정", terms: ["여당", "야당", "국회", "선거", "정당", "대통령실", "정치권"], strongPatterns: [/(?:여야 공방|정치적 갈등|선거 전략|국회 논의)/] },
  { code: "external_regulation", label: "대외 관계·평판", terms: ["국제사회", "해외", "외교", "무역", "제재", "협약", "평판"], strongPatterns: [/(?:국가 이미지|국제적 평판|무역 제재|외교 관계)/] },
  { code: "other", label: "기타 정책 맥락", terms: [], strongPatterns: [/(?:별도 쟁점|기타 쟁점)/], minimumUniqueTerms: 0 },
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
    const seenCodeScopes = new Set();
    for (const sentence of sentences) {
      for (const rule of DIMENSION_RULES[dimension]) {
        const match = rule.pattern.exec(sentence.text);
        rule.pattern.lastIndex = 0;
        if (!match) continue;
        const voice = classifyVoice(sentence.text, match.index);
        const voiceScope = voice.kind === "journalist_narration" ? "narration" : "source";
        const dedupeKey = `${rule.code}:${voiceScope}`;
        if (seenCodeScopes.has(dedupeKey)) continue;
        items.push({
          code: rule.code,
          public_paraphrase: voice.kind === "journalist_narration"
            ? rule.paraphrase
            : `${ROLE_LABELS[voice.speaker_role] ?? "취재원"}의 발언·설명에서 ${rule.paraphrase.replace(/합니다\.$/, "하는 관점이 제시됩니다.")}`,
          voice,
          evidence: await evidenceReference(articleId, sentence),
        });
        seenCodeScopes.add(dedupeKey);
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
      if (rule.terms) {
        const lemmas = contentLemmaSet(sentence.text);
        const termHits = new Set(rule.terms.filter((term) => lemmas.has(term)));
        const strongMatch = (rule.strongPatterns ?? []).some((pattern) => pattern.test(sentence.text));
        const minimumUniqueTerms = rule.minimumUniqueTerms ?? 2;
        const meetsTermThreshold = rule.terms.length > 0 && termHits.size >= minimumUniqueTerms;
        if (strongMatch || meetsTermThreshold) matched.push(sentence);
      } else if (rule.patterns.some((pattern) => pattern.test(sentence.text))) {
        matched.push(sentence);
      }
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

async function morphologyTermEvidence(articleId, sentences, morphology) {
  const evidence = [];
  for (const term of morphology.term_frequencies ?? []) {
    const sentence = sentences.find((candidate) => contentLemmaSet(candidate.text).has(term.term));
    if (!sentence) continue;
    evidence.push({ term: term.term, pos: term.pos, evidence: await evidenceReference(articleId, sentence) });
  }
  return evidence;
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
  const morphology = summarizeKoreanMorphology(sentences);
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
    morphology: {
      ...morphology,
      term_evidence: await morphologyTermEvidence(articleId, sentences, morphology),
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
    if (/^(?:bodyText|body_text|rawBody|raw_body|sentenceText|sentence_text|quote|quotation|excerpt|html|content|tokens|token_sequence|morpheme_sequence)$/i.test(key)) {
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
  if (profile.schema_version !== ARTICLE_FRAME_PROFILE_SCHEMA) errors.push("unsupported schema_version");
  if (profile.engine?.semantic_ai !== false) errors.push("semantic_ai must be false for this engine");
  if (profile.article?.raw_body_retained !== false) errors.push("raw_body_retained must be false");
  if (!/^[a-f0-9]{64}$/.test(String(profile.article?.body_sha256 ?? ""))) errors.push("body_sha256 must be SHA-256 hex");
  if (profile.morphology?.raw_tokens_retained !== false) errors.push("morphology.raw_tokens_retained must be false");
  if (profile.morphology?.analyzer?.version !== KOREAN_MORPHOLOGY_VERSION) errors.push("unsupported morphology analyzer version");
  if (!Number.isInteger(profile.morphology?.token_count) || profile.morphology.token_count < 0) errors.push("invalid morphology token_count");
  for (const term of profile.morphology?.term_frequencies ?? []) {
    if (typeof term.term !== "string" || term.term.length < 2 || term.term.length > 20) errors.push("invalid morphology term");
    if (!Number.isInteger(term.count) || term.count < 1) errors.push("invalid morphology term count");
  }
  const morphologyEvidence = new Map((profile.morphology?.term_evidence ?? [])
    .map((entry) => [`${entry.pos}:${entry.term}`, entry.evidence]));
  for (const term of profile.morphology?.term_frequencies ?? []) {
    const evidence = morphologyEvidence.get(`${term.pos}:${term.term}`);
    if (!/^[a-f0-9]{64}$/.test(String(evidence?.sentence_sha256 ?? ""))) errors.push("morphology term missing evidence hash");
    if (!Number.isInteger(evidence?.locator?.paragraph) || !Number.isInteger(evidence?.locator?.sentence)) {
      errors.push("morphology term missing evidence locator");
    }
  }
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
    .map((pattern) => ({
      ...pattern,
      outlets: [...pattern.outlets].sort((a, b) => a.localeCompare(b, "ko")),
      article_ids: [...pattern.article_ids].sort(),
      evidence: pattern.evidence.slice(0, 8),
    }))
    .sort((a, b) => b.article_count - a.article_count || a.code.localeCompare(b.code));
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
      const key = `${item.code}:${item.voice.kind === "journalist_narration" ? "narration" : "source"}`;
      const current = patterns.get(key) ?? {
        code: item.code,
        public_paraphrase: item.public_paraphrase,
        voice_scope: item.voice.kind === "journalist_narration" ? "outlet_narration" : "attributed_source",
        article_count: 0,
        outlets: new Set(),
        article_ids: new Set(),
        evidence: [],
      };
      current.article_count += 1;
      current.outlets.add(outletLabel(articleId, metadataById));
      current.article_ids.add(articleId);
      current.evidence.push({ article_id: articleId, source_id: outletId(articleId, metadataById), ...item.evidence });
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
  const byOutlet = new Map();
  for (const profile of profiles) {
    const articleId = profile.article.article_id;
    const sourceName = outletLabel(articleId, metadataById);
    for (const source of profile.actors_and_sources) {
      const role = roles.get(source.role) ?? {
        role: source.role,
        role_label: source.role_label,
        articles: new Set(),
        outlets: new Set(),
        direct_quote_count: 0,
        indirect_attribution_count: 0,
      };
      role.articles.add(articleId);
      role.outlets.add(sourceName);
      role.direct_quote_count += source.direct_quote_count;
      role.indirect_attribution_count += source.indirect_attribution_count;
      roles.set(source.role, role);

      const outlet = byOutlet.get(sourceName) ?? new Map();
      outlet.set(source.role, (outlet.get(source.role) ?? 0) + source.direct_quote_count + source.indirect_attribution_count);
      byOutlet.set(sourceName, outlet);
    }
  }
  const roleRows = [...roles.values()]
    .map((role) => ({
      role: role.role,
      role_label: role.role_label,
      article_count: role.articles.size,
      outlet_count: role.outlets.size,
      direct_quote_count: role.direct_quote_count,
      indirect_attribution_count: role.indirect_attribution_count,
    }))
    .sort((a, b) => (b.direct_quote_count + b.indirect_attribution_count) - (a.direct_quote_count + a.indirect_attribution_count));
  return {
    roles: roleRows,
    by_outlet: [...byOutlet.entries()].map(([outlet, roleCounts]) => ({
      outlet,
      roles: [...roleCounts.entries()].map(([role, count]) => ({ role, role_label: ROLE_LABELS[role] ?? ROLE_LABELS.other, count })),
    })),
    caution: "인용 횟수는 목소리의 가시성을 나타내는 관측치이며, 취재원의 신뢰도나 매체의 지지 여부를 뜻하지 않습니다.",
  };
}

function buildFrameLens(profiles, metadataById) {
  const byOutlet = new Map();
  for (const profile of profiles) {
    const articleId = String(profile.article.article_id);
    const outletName = outletLabel(articleId, metadataById);
    const outlet = byOutlet.get(outletName) ?? { outlet: outletName, articles: new Set(), labels: new Map() };
    outlet.articles.add(articleId);
    for (const descriptor of profile.secondary_descriptors?.policy_frames ?? []) {
      const label = outlet.labels.get(descriptor.code) ?? {
        code: descriptor.code,
        label: descriptor.label,
        articles: new Set(),
        sentence_count: 0,
        evidence: [],
      };
      label.articles.add(articleId);
      label.sentence_count += Number(descriptor.sentence_count ?? 0);
      label.evidence.push(...(descriptor.evidence ?? []).map((entry) => ({ article_id: articleId, ...entry })));
      outlet.labels.set(descriptor.code, label);
    }
    byOutlet.set(outletName, outlet);
  }
  return {
    status: byOutlet.size >= 2 ? "available" : "partial",
    taxonomy: "Policy Frames Codebook-inspired descriptors",
    taxonomy_version: "policy-descriptors-v2",
    method_version: FRAMING_ENGINE_VERSION,
    unit: "article_presence",
    multi_label: true,
    by_outlet: [...byOutlet.values()].map((outlet) => {
      const analyzedArticles = outlet.articles.size;
      const labels = [...outlet.labels.values()];
      const assignmentCount = labels.reduce((sum, label) => sum + label.articles.size, 0);
      return {
        outlet: outlet.outlet,
        analyzed_article_count: analyzedArticles,
        assignment_count: assignmentCount,
        labels: labels
          .map((label) => ({
            code: label.code,
            label: label.label,
            article_count: label.articles.size,
            article_share: analyzedArticles ? label.articles.size / analyzedArticles : 0,
            sentence_count: label.sentence_count,
            composition_share: assignmentCount ? label.articles.size / assignmentCount : 0,
            evidence: uniqueEvidence(label.evidence).slice(0, 4),
          }))
          .sort((left, right) => right.article_count - left.article_count || left.code.localeCompare(right.code)),
      };
    }),
    caution: "기사별 라벨 존재 여부를 집계한 다중 라벨 보조 지표입니다. 기사 수가 많은 매체나 긴 기사가 과대 반영되지 않도록 기사당 라벨을 한 번만 셉니다.",
  };
}

function buildReportingStyleLens(profiles, metadataById) {
  const NEGATIVE_EVALUATIONS = new Set(["negative_legitimacy_evaluation"]);
  const POSITIVE_EVALUATIONS = new Set(["positive_legitimacy_evaluation"]);
  const byOutlet = new Map();
  for (const profile of profiles) {
    const articleId = String(profile.article.article_id);
    const outletName = outletLabel(articleId, metadataById);
    const outlet = byOutlet.get(outletName) ?? {
      outlet: outletName,
      articles: new Set(),
      evaluationValues: [],
      evaluationEvidence: [],
      criticalArticles: 0,
      supportiveArticles: 0,
      attributedOnlyArticles: 0,
      scopeValues: [],
      scopeEvidence: [],
      episodicSentenceCount: 0,
      thematicSentenceCount: 0,
    };
    outlet.articles.add(articleId);
    const evaluationItems = profile.dimensions?.moral_evaluation?.items ?? [];
    const narrationItems = evaluationItems.filter((item) => item.voice?.kind === "journalist_narration");
    const negative = narrationItems.filter((item) => NEGATIVE_EVALUATIONS.has(item.code)).length;
    const positive = narrationItems.filter((item) => POSITIVE_EVALUATIONS.has(item.code)).length;
    if (negative + positive > 0) {
      outlet.evaluationValues.push((positive - negative) / (positive + negative));
      outlet.evaluationEvidence.push(...narrationItems
        .filter((item) => NEGATIVE_EVALUATIONS.has(item.code) || POSITIVE_EVALUATIONS.has(item.code))
        .map((item) => ({ article_id: articleId, ...item.evidence })));
      if (negative > positive) outlet.criticalArticles += 1;
      if (positive > negative) outlet.supportiveArticles += 1;
    } else if (evaluationItems.some((item) => item.voice?.kind !== "journalist_narration")) {
      outlet.attributedOnlyArticles += 1;
    }
    const episodic = Number(profile.scope?.episodic_sentence_count ?? 0);
    const thematic = Number(profile.scope?.thematic_sentence_count ?? 0);
    if (episodic + thematic > 0) outlet.scopeValues.push((thematic - episodic) / (thematic + episodic));
    outlet.scopeEvidence.push(...[
      ...(profile.scope?.evidence?.episodic ?? []),
      ...(profile.scope?.evidence?.thematic ?? []),
    ].map((entry) => ({ article_id: articleId, ...entry })));
    outlet.episodicSentenceCount += episodic;
    outlet.thematicSentenceCount += thematic;
    byOutlet.set(outletName, outlet);
  }
  const average = (values) => values.length
    ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000
    : null;
  return {
    status: byOutlet.size >= 2 ? "available" : "partial",
    method_version: FRAMING_ENGINE_VERSION,
    by_outlet: [...byOutlet.values()].map((outlet) => ({
      outlet: outlet.outlet,
      analyzed_article_count: outlet.articles.size,
      evaluation: {
        status: outlet.evaluationValues.length ? "observed" : "abstained",
        index: average(outlet.evaluationValues),
        observed_article_count: outlet.evaluationValues.length,
        critical_article_count: outlet.criticalArticles,
        supportive_article_count: outlet.supportiveArticles,
        attributed_only_article_count: outlet.attributedOnlyArticles,
        evidence: uniqueEvidence(outlet.evaluationEvidence).slice(0, 5),
      },
      scope: {
        status: outlet.scopeValues.length ? "observed" : "abstained",
        index: average(outlet.scopeValues),
        observed_article_count: outlet.scopeValues.length,
        episodic_sentence_count: outlet.episodicSentenceCount,
        thematic_sentence_count: outlet.thematicSentenceCount,
        evidence: uniqueEvidence(outlet.scopeEvidence).slice(0, 5),
      },
    })),
    caution: "평가 지수는 기자 서술에서 명시적으로 관측된 긍정·부정 정당성 표현만 사용합니다. 인용된 취재원 평가는 제외하며 정치 성향이나 매체 지지도를 뜻하지 않습니다.",
  };
}

function buildMorphologyLens(profiles, metadataById) {
  const termDocuments = new Map();
  const termMediaGroups = new Map();
  for (const profile of profiles) {
    const articleId = String(profile.article.article_id);
    const mediaGroup = mediaGroupForArticle(articleId, metadataById);
    for (const term of profile.morphology?.term_frequencies ?? []) {
      const key = `${term.pos}:${term.term}`;
      const documents = termDocuments.get(key) ?? new Set();
      documents.add(articleId);
      termDocuments.set(key, documents);
      const groups = termMediaGroups.get(key) ?? new Set();
      groups.add(mediaGroup);
      termMediaGroups.set(key, groups);
    }
  }
  const allowedTerms = new Set([...termDocuments.entries()]
    .filter(([key, documents]) => documents.size >= 2 && (termMediaGroups.get(key)?.size ?? 0) >= 2)
    .map(([key]) => key));
  const byOutlet = new Map();
  for (const profile of profiles) {
    const articleId = String(profile.article.article_id);
    const outletName = outletLabel(articleId, metadataById);
    const outlet = byOutlet.get(outletName) ?? {
      outlet: outletName,
      articles: new Set(),
      tokenCount: 0,
      contentTokenCount: 0,
      negationCount: 0,
      posCounts: {},
      terms: new Map(),
    };
    outlet.articles.add(articleId);
    outlet.tokenCount += Number(profile.morphology?.token_count ?? 0);
    outlet.contentTokenCount += Number(profile.morphology?.content_token_count ?? 0);
    outlet.negationCount += Number(profile.morphology?.negation_count ?? 0);
    for (const [pos, count] of Object.entries(profile.morphology?.pos_counts ?? {})) {
      outlet.posCounts[pos] = (outlet.posCounts[pos] ?? 0) + Number(count ?? 0);
    }
    for (const term of profile.morphology?.term_frequencies ?? []) {
      const key = `${term.pos}:${term.term}`;
      if (!allowedTerms.has(key)) continue;
      const current = outlet.terms.get(key) ?? { term: term.term, pos: term.pos, count: 0, documents: new Set(), evidence: [] };
      current.count += Number(term.count ?? 0);
      current.documents.add(articleId);
      const termEvidence = (profile.morphology?.term_evidence ?? [])
        .find((entry) => entry.term === term.term && entry.pos === term.pos)?.evidence;
      if (termEvidence) current.evidence.push({ article_id: articleId, ...termEvidence });
      outlet.terms.set(key, current);
    }
    byOutlet.set(outletName, outlet);
  }
  return {
    status: byOutlet.size >= 2 && allowedTerms.size ? "available" : "partial",
    analyzer: {
      name: "AgendaFrame Korean controlled morphology",
      mode: KOREAN_MORPHOLOGY_MODE,
      version: KOREAN_MORPHOLOGY_VERSION,
      dictionary_version: KOREAN_MORPHOLOGY_DICTIONARY_VERSION,
      pos_tagset: "agendaframe-lite-v1",
    },
    minimum_document_frequency: 2,
    minimum_media_group_frequency: 2,
    by_outlet: [...byOutlet.values()].map((outlet) => ({
      outlet: outlet.outlet,
      analyzed_article_count: outlet.articles.size,
      token_count: outlet.tokenCount,
      content_token_count: outlet.contentTokenCount,
      negation_count: outlet.negationCount,
      pos_counts: outlet.posCounts,
      terms: [...outlet.terms.values()]
        .map((term) => ({
          term: term.term,
          pos: term.pos,
          count: term.count,
          document_count: term.documents.size,
          per_thousand: outlet.contentTokenCount ? Math.round((term.count / outlet.contentTokenCount) * 1_000_000) / 1000 : 0,
          evidence: uniqueEvidence(term.evidence).slice(0, 3),
        }))
        .sort((left, right) => right.per_thousand - left.per_thousand || right.document_count - left.document_count || left.term.localeCompare(right.term, "ko"))
        .slice(0, 15),
    })),
    limitations: [
      "공개 핵심어는 이슈 안에서 2개 이상 기사와 2개 이상 독립 미디어그룹에 등장한 항목만 표시합니다.",
      "단어 순서와 원문 문장은 저장하지 않으며, 빈도는 프레임·논조·기사 품질 판정이 아닙니다.",
      "현재 배포 환경에서는 조사·일부 활용을 정규화하는 경량 규칙형 분석기를 사용합니다.",
    ],
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
  const items = profiles.flatMap((profile) =>
    DIMENSION_ORDER.flatMap((dimension) => profile.dimensions?.[dimension]?.items ?? []),
  );
  const attributedItems = items.filter((item) => item.voice?.kind !== "journalist_narration");
  const share = items.length ? attributedItems.length / items.length : 0;
  return {
    detected: profiles.length >= 2
      && profiles.every((profile) => profile.genre?.code === "straight_news")
      && share >= 0.7,
    attributed_item_count: attributedItems.length,
    total_item_count: items.length,
    attributed_share: Math.round(share * 1000) / 1000,
  };
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
  const analysisModules = {
    frame_composition: buildFrameLens(profiles, metadataById),
    reporting_style: buildReportingStyleLens(profiles, metadataById),
    morphology: buildMorphologyLens(profiles, metadataById),
  };
  const scopeCounts = countBy(profiles, (profile) => profile.scope.code);
  const contextCounts = countBy(profiles, (profile) => profile.context_depth.level);
  const notObservedStatements = axes.map((axis) => axis.not_observed_statement).filter(Boolean);
  const titleOnlyOrShort = profiles.filter((profile) => profile.article.body_character_count < 300).length;
  const sourceDominated = sourceDominance(profiles);
  const common = sourceDominated.detected
    ? "비교 표본에서 관측된 핵심 문제·원인·평가 표현의 대부분은 취재원 발언에 귀속됩니다."
    : describeCommon(axes, profiles.length);
  const observedDivergence = describeDivergence(axes, metadataById);
  const divergence = sourceDominated.detected
    ? {
        detected: false,
        text: "취재원 발언이 설명을 지배해, 표현 차이를 매체 자체의 프레임 차이로 확정하지 않았습니다.",
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
      morphology_analyzer: {
        mode: KOREAN_MORPHOLOGY_MODE,
        version: KOREAN_MORPHOLOGY_VERSION,
        dictionary_version: KOREAN_MORPHOLOGY_DICTIONARY_VERSION,
      },
      semantic_ai: false,
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
    comparison_axes: axes,
    source_lens: sourceLens,
    analysis_modules: analysisModules,
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
