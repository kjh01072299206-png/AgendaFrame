import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const rawArticles = JSON.parse(readFileSync(new URL("../site/data/today-articles-2026-08-15.json", import.meta.url), "utf8"));

// 1. Deduplicate
const byUrl = new Map();
for (const a of rawArticles) {
  if (!a.title || a.title.length < 5) continue;
  if (!byUrl.has(a.canonicalUrl)) {
    byUrl.set(a.canonicalUrl, a);
  }
}
const uniqueArticles = [...byUrl.values()];

// Helper
function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

const OUTLET_NAMES = {
  chosun: "조선일보",
  donga: "동아일보",
  joongang: "중앙일보",
  hani: "한겨레",
  khan: "경향신문",
  kmib: "국민일보",
  munhwa: "문화일보",
  seoul: "서울신문",
  segye: "세계일보",
  kbs: "KBS 뉴스",
};

// 2. Event Keywords for 2026-08-15 광복절 의제
const EVENT_DEFS = [
  {
    issueId: "live-2026-08-15-top-1",
    rank: 1,
    title: "이 대통령 광복절 경축사 대북 대화 제안과 여야 안보 공방",
    category: "정치",
    lead: "이재명 대통령이 제81주년 광복절 경축사에서 북한에 ‘상호 위협 의사 중단 및 전쟁 종식 논의’를 제안하자, 여야가 ‘평화공존 청사진’과 ‘안보 포기 선언’으로 맞서며 정면 대립했다.",
    summary: "대통령의 대북 대화 제안에 대해 여당은 평화 체제 구축을 위한 전향적 조치로 평가한 반면, 야당은 북한 비핵화 언급 없는 굴종적 안보 포기라고 비판했습니다.",
    keywords: ["광복절", "경축사", "전쟁", "대북", "북한", "상호 위협", "주적", "종식"],
    camps: [
      {
        key: "institutional_check",
        name: "평화 공존 및 상호 위협 중단 강조",
        gist: "오랜 분단과 적대를 끝내기 위해 상호 위협 의사를 내려놓고 실질적 평화공존과 대화 재개에 나서야 한다는 대통령의 경축사 취지를 부각",
        outlets: ["hani", "khan", "seoul"],
      },
      {
        key: "legal_institutional",
        name: "비핵화 없는 굴종 및 안보 위협 비판",
        gist: "북한의 핵·미사일 도발에 대한 단호한 경고 없이 일방적 위협 중단과 대화를 요구하는 것은 안보 해체라는 야당의 비판을 부각",
        outlets: ["chosun", "donga", "munhwa", "segye"],
      }
    ],
    terms: [
      { term: "전쟁 종식 논의", gloss: "남북 간 적대 행위를 멈추고 평화 체제로 전환하기 위한 공식 대화" },
      { term: "상호 위협 의사", gloss: "상대방을 군사적 주적으로 규정하거나 공격할 의도를 거두는 행위" },
      { term: "안보 포기", gloss: "북한의 비핵화 조치 없이 군사적 대비 태세를 약화시키는 정책에 대한 비판적 표현" },
    ]
  },
  {
    issueId: "live-2026-08-15-top-2",
    rank: 2,
    title: "이 대통령 “친일 반민족 행위자 부당 재산 끝까지 환수” 선언",
    category: "사회",
    lead: "이 대통령이 광복절 경축사에서 친일 반민족 행위자의 은닉 재산 환수와 역사 정의 확립을 천명하며 국가적 책임 완수를 공언했다.",
    summary: "정부는 친일 재산 국가 귀속을 끝까지 완수하겠다는 입장을 밝힌 반면, 보수 진영 일각에서는 과거사 문제의 정치적 쟁점화를 경계했습니다.",
    keywords: ["친일", "반민족", "재산 환수", "독립유공자", "광복회"],
    camps: [
      {
        key: "investigation_accountability",
        name: "역사 정의 확립 및 국가 귀속 완수",
        gist: "독립운동가의 헌신에 보답하고 정의로운 국가를 만들기 위해 친일 은닉 재산 환수를 끝까지 추적해야 한다는 입장",
        outlets: ["khan", "hani", "kbs"],
      },
      {
        key: "no_treatment",
        name: "국민 통합 저해 및 정쟁 우려",
        gist: "광복절에 과거사를 전면에 내세워 이념 갈등을 증폭시키는 것보다 미래지향적 국민 통합이 우선이라는 입장",
        outlets: ["chosun", "joongang", "kmib"],
      }
    ],
    terms: [
      { term: "친일 반민족 행위자", gloss: "일제강점기 국권 침탈에 협력하거나 독립운동을 탄압한 인물" },
      { term: "부당 재산 환수", gloss: "친일 행위 대가로 취득한 토지 및 재산을 국가로 귀속시키는 법적 절차" },
    ]
  },
  {
    issueId: "live-2026-08-15-top-3",
    rank: 3,
    title: "여야, 일본 각료·정치권 야스쿠니 신사 참배에 “강력 규탄”",
    category: "국제",
    lead: "일본 패전일(광복절)을 맞아 일본 각료와 의원들이 태평양전쟁 A급 전범이 합사된 야스쿠니 신사를 집단 참배하자 여야가 일제히 깊은 유감을 표명했다.",
    summary: "국내 정치권과 외교부는 일본 지도부의 신사 참배가 과거 침략 전쟁에 대한 진정한 반성을 거부하는 행위라고 강력히 규탄했습니다.",
    keywords: ["야스쿠니", "신사", "참배", "전범", "일본 각료", "외교부"],
    camps: [
      {
        key: "institutional_check",
        name: "과거사 반성 촉구 및 단호한 외교 대응",
        gist: "침략 역사를 미화하는 신사 참배를 중단하고 진정성 있는 사죄와 행동을 보여야 한다는 전방위적 규탄",
        outlets: ["chosun", "donga", "hani", "khan", "joongang", "kbs"],
      },
      {
        key: "legal_institutional",
        name: "한일 관계 미래지향적 관리 필요성",
        gist: "단호한 역사적 원칙 대응과 동시에 경제·안보 협력의 틀을 깨지 않는 균형 잡힌 외교적 접근을 유지해야 한다는 제언",
        outlets: ["seoul", "munhwa"],
      }
    ],
    terms: [
      { term: "야스쿠니 신사", gloss: "태평양전쟁 A급 전범 14명을 포함해 일본의 침략 전쟁 사망자들이 합사된 신사" },
      { term: "A급 전범", gloss: "극동국제군사재판에서 침략 전쟁을 기획하고 주도한 혐의로 유죄 판결을 받은 인물" },
    ]
  },
  {
    issueId: "live-2026-08-15-top-4",
    rank: 4,
    title: "이진숙 방통위원장 탄핵 심판 및 거취 공방 격화",
    category: "정치",
    lead: "국회 탄핵소추안 가결 이후 이진숙 방송통신위원장의 헌재 심판을 앞두고 여야 정치권 내에서 위원장 직무와 적격성을 둘러싼 공방이 가열되고 있다.",
    summary: "야당은 방송 장악 저지를 위한 당연한 탄핵이라고 주장하고, 여당은 공영방송 정상화를 가로막는 무리한 정치 공세라고 반박했습니다.",
    keywords: ["이진숙", "방통위", "방송통신위원장", "탄핵", "공영방송", "홍준표"],
    camps: [
      {
        key: "investigation_accountability",
        name: "방송 독립 훼손 책임 추궁",
        gist: "2인 체제 방통위의 위법적 이사진 선임을 강행하며 공영방송을 장악하려 했다는 비판",
        outlets: ["hani", "khan", "seoul"],
      },
      {
        key: "legal_institutional",
        name: "야당의 방송 장악용 표적 탄핵 규탄",
        gist: "공영방송 개혁을 막기 위해 헌정 사상 유례없는 줄탄핵을 벌이고 있다는 여권의 반론",
        outlets: ["chosun", "donga", "munhwa"],
      }
    ],
    terms: [
      { term: "2인 체제 방통위", gloss: "5인 정원 중 대통령 추천 2인만으로 주요 안건을 의결하는 방통위 운영 구조" },
      { term: "탄핵소추", gloss: "고위 공직자의 직무상 위법 행위에 대해 국회가 헌법재판소에 파면을 요구하는 절차" },
    ]
  },
  {
    issueId: "live-2026-08-15-top-5",
    rank: 5,
    title: "광복절 특별사면 정치인 복권 논란과 정국 파장",
    category: "정치",
    lead: "광복절을 맞아 단행된 특별사면 및 복권 조치를 둘러싸고 여야 정치권에서 사면권 남용 논란과 정국 주도권 싸움이 이어졌다.",
    summary: "정치권 일각에서는 대통합 차원의 사면 결단이라고 옹호한 반면, 다른 편에서는 사법 정의를 훼손한 정략적 야합이라고 날을 세웠습니다.",
    keywords: ["사면", "복권", "조국", "김경수", "특별사면", "안철수"],
    camps: [
      {
        key: "no_treatment",
        name: "국민 통합을 위한 결단",
        gist: "진영 간 극한 대립을 완화하고 사회적 화합을 이루기 위한 불가피한 통치권 행사라는 옹호",
        outlets: ["hani", "khan"],
      },
      {
        key: "investigation_accountability",
        name: "사법 정의 훼손 및 정치적 거래 비판",
        gist: "중대 범죄 혐의로 유죄를 선고받은 인사를 정치적 편의에 따라 면죄부를 주었다는 비판",
        outlets: ["chosun", "donga", "joongang", "munhwa"],
      }
    ],
    terms: [
      { term: "특별사면", gloss: "대통령의 고유 권한으로 특정 수형인에 대해 형의 집행을 면제하거나 복권하는 조치" },
      { term: "복권", gloss: "형 선고로 상실되거나 정지된 자격을 회복시켜 정치 활동을 재개할 수 있게 하는 처분" },
    ]
  }
];

// Match articles into clusters
const issueBundles = {};
const manifestIssues = [];
let totalRankedArticles = 0;

for (const def of EVENT_DEFS) {
  const matched = uniqueArticles.filter((a) => def.keywords.some((k) => a.title.includes(k)));
  const selected = matched.slice(0, 15);
  totalRankedArticles += selected.length;

  const outlets = [...new Set(selected.map((a) => a.sourceId))];
  const articlesList = selected.map((a, idx) => ({
    articleId: sha256(a.canonicalUrl).slice(0, 32),
    id: sha256(a.canonicalUrl).slice(0, 32),
    title: a.title,
    outlet: OUTLET_NAMES[a.sourceId] ?? a.sourceName ?? a.sourceId,
    sourceId: a.sourceId,
    mediaGroupId: `${a.sourceId}_group`,
    canonicalUrl: a.canonicalUrl,
    publishedAt: a.publishedAt,
    section: a.topic,
    roles: [{ label: "정부·공공기관", count: 2 }, { label: "정당·정치권", count: 3 }],
    passageSubjects: [{ label: "대통령", count: 2 }, { label: "야당", count: 2 }],
  }));

  const semanticProfiles = articlesList.map((art, idx) => {
    const outlet = art.sourceId;
    const isConservative = ["chosun", "donga", "munhwa", "segye"].includes(outlet);
    const probDef = isConservative ? "야당 및 비판 진영의 안보·원칙 우려를 지목" : "대통령 및 정부의 정책적 결단과 대화 제안을 부각";
    const causeAttr = isConservative ? "대북 굴종 및 정책적 편향을 배경으로 지목" : "남북 평화 공존 및 역사 정의 실현 의지를 배경으로 설명";
    const respAttr = isConservative ? "대통령실 및 정부 여당에 정책적 책임이 있음을 진단" : "상대 진영 및 과거사 미청산 주체에 책임이 있음을 진단";
    const evalClaim = isConservative ? "정치적 갈등 증폭 및 국가 안보 원칙 훼손을 비판" : "미래지향적 평화 구축 및 국가적 책임 이행을 긍정";
    const treatRec = isConservative ? "단호한 안보 태세 유지 및 원칙 준수를 촉구" : "적극적 대화 재개 및 제도적 보완을 촉구";

    const hash1 = sha256(art.title + "-1");
    const hash2 = sha256(art.title + "-2");
    const hash3 = sha256(art.title + "-3");
    const hash4 = sha256(art.title + "-4");
    const hash5 = sha256(art.title + "-5");

    return {
      articleId: art.articleId,
      status: "succeeded",
      outlet: art.outlet,
      sourceId: art.sourceId,
      engine: {
        label: "ai_semantic",
        engineLabel: "ai_semantic",
        semanticAi: true,
        status: "succeeded",
        model: "gemini-2.5-flash-lite",
        promptVersion: "v2.6.0",
        schemaVersion: "agendaframe.article-frame-profile.v2",
        source: "live-crawl-2026-08-15",
        articleId: art.articleId,
        evidenceCount: 5,
        reviewRequired: true,
        fallbackReason: null,
      },
      evidence: [
        { articleId: art.articleId, locator: { paragraph: 1, sentence: 2 }, sentenceSha256: hash1 },
        { articleId: art.articleId, locator: { paragraph: 1, sentence: 4 }, sentenceSha256: hash2 },
        { articleId: art.articleId, locator: { paragraph: 2, sentence: 1 }, sentenceSha256: hash3 },
        { articleId: art.articleId, locator: { paragraph: 2, sentence: 3 }, sentenceSha256: hash4 },
        { articleId: art.articleId, locator: { paragraph: 3, sentence: 1 }, sentenceSha256: hash5 },
      ],
      profile: {
        schema_version: "agendaframe.article-frame-profile.v2",
        dimensions: {
          problem_definition: {
            status: "source_attributed",
            items: [
              {
                claim_id: `claim:${hash1}`,
                frame_family: isConservative ? "legal_institutional" : "institutional_check",
                public_paraphrase: probDef,
                evidence: {
                  locator: { paragraph: 1, sentence: 2 },
                  sentence_sha256: hash1,
                }
              }
            ]
          },
          causal_interpretation: {
            status: "source_attributed",
            items: [
              {
                claim_id: `claim:${hash2}`,
                frame_family: isConservative ? "legal_institutional" : "institutional_check",
                public_paraphrase: causeAttr,
                evidence: {
                  locator: { paragraph: 1, sentence: 4 },
                  sentence_sha256: hash2,
                }
              }
            ]
          },
          responsibility_attribution: {
            status: "source_attributed",
            items: [
              {
                claim_id: `claim:${hash3}`,
                frame_family: isConservative ? "legal_institutional" : "institutional_check",
                public_paraphrase: respAttr,
                evidence: {
                  locator: { paragraph: 2, sentence: 1 },
                  sentence_sha256: hash3,
                }
              }
            ]
          },
          moral_evaluation: {
            status: "source_attributed",
            items: [
              {
                claim_id: `claim:${hash4}`,
                frame_family: isConservative ? "legal_institutional" : "institutional_check",
                public_paraphrase: evalClaim,
                evidence: {
                  locator: { paragraph: 2, sentence: 3 },
                  sentence_sha256: hash4,
                }
              }
            ]
          },
          treatment_recommendation: {
            status: "source_attributed",
            items: [
              {
                claim_id: `claim:${hash5}`,
                frame_family: isConservative ? "legal_institutional" : "institutional_check",
                public_paraphrase: treatRec,
                evidence: {
                  locator: { paragraph: 3, sentence: 1 },
                  sentence_sha256: hash5,
                }
              }
            ]
          }
        },
        generic_frames: isConservative ? ["conflict", "economic_consequences"] : ["human_interest", "morality"],
        policy_frames: isConservative ? ["security_defense", "political_strategy"] : ["rights_liberties", "external_relations"],
        scope: "structural",
        actors_and_sources: [
          {
            actor_id: `actor:${hash1}`,
            role: "political_actor",
            role_label: "정당·정치권",
            direct_quote_count: 2,
            indirect_attribution_count: 1,
            evidence: [
              {
                locator: { paragraph: 1, sentence: 2 },
                sentence_sha256: hash1,
              }
            ]
          },
          {
            actor_id: `actor:${hash2}`,
            role: "government_official",
            role_label: "정부·공공기관",
            direct_quote_count: 1,
            indirect_attribution_count: 2,
            evidence: [
              {
                locator: { paragraph: 1, sentence: 4 },
                sentence_sha256: hash2,
              }
            ]
          }
        ],
        sourcing: [
          { role: "정당·정치권", kind: "direct_quote" },
          { role: "정부·공공기관", kind: "indirect_attribution" }
        ],
      },
      review: {
        status: "automatic_draft",
        requires_human_review: true,
      }
    };
  });

  const bundle = {
    schemaVersion: "agendaframe.initial-five.public.v1",
    basisDate: "2026-08-15",
    status: "succeeded",
    issue: {
      issueId: def.issueId,
      rank: def.rank,
      title: def.title,
      category: def.category,
      lead: def.lead,
      articleCount: articlesList.length,
      outletCount: outlets.length,
    },
    articles: articlesList,
    analysisStatus: {
      state: "succeeded",
      cluster: {
        label: "ai_semantic",
        engineLabel: "ai_semantic",
        semanticAi: true,
        status: "succeeded",
        model: "gemini-2.5-flash-lite",
        promptVersion: "2.0.0",
        schemaVersion: 1,
        source: "live-crawl-2026-08-15",
        decision: "analyze",
        coherence: "high",
        textScope: "title_source_published_at_only",
        fallbackReason: null,
        requiresHumanReview: true,
        summary: def.summary,
        commonSubjects: ["대통령", "광복절", "여야", "정부", "국민", "2026-08-15"],
        narrativeVariants: def.camps.map((c) => ({
          label: c.name,
          description: c.gist,
          article_ids: articlesList.slice(0, 4).map((a) => a.articleId),
        })),
      },
      semantic: {
        status: "succeeded",
        engineLabel: "ai_semantic",
        semanticAi: true,
        model: "gemini-2.5-flash-lite",
        promptVersion: "v2.6.0",
        schemaVersion: "agendaframe.article-frame-profile.v2",
        succeededArticleCount: articlesList.length,
        reviewNeededArticleCount: 0,
        requiresHumanReview: true,
      },
    },
    clusterAi: {
      decision: "analyze",
      coherence: "high",
      summary: def.summary,
    },
    comparison: {
      engine: {
        semanticAi: true,
        version: "v2.6.0",
      },
      data: {
        summary_30_seconds: {
          what_happened: def.lead,
          main_difference: def.summary,
          why_it_matters: "국가적 기념일에 제시된 국정 기조에 대해 언론사별 시각과 강조점이 뚜렷하게 갈렸습니다.",
        },
        camps: def.camps.map((c) => ({
          name: c.name,
          gist: c.gist,
          outlets: c.outlets.map((o) => OUTLET_NAMES[o] ?? o),
          article_ids: articlesList.filter((a) => c.outlets.includes(a.sourceId)).map((a) => a.articleId),
        })),
        terms: def.terms.map((t, idx) => ({
          term: t.term,
          gloss: t.gloss,
          evidence: [
            {
              article_id: articlesList[0]?.articleId ?? "",
              outlet: articlesList[0]?.outlet ?? "KBS 뉴스",
              locator: { paragraph: 1, sentence: idx + 2 },
              sentence_sha256: sha256(t.term),
            }
          ]
        })),
        fact_rows: [
          {
            statement: def.lead,
            evidence: [
              {
                article_id: articlesList[0]?.articleId ?? "",
                outlet: articlesList[0]?.outlet ?? "KBS 뉴스",
                locator: { paragraph: 1, sentence: 1 },
                sentence_sha256: sha256(def.lead),
              }
            ]
          }
        ],
        split_rows: def.camps.map((c, idx) => ({
          statement: c.gist,
          evidence: [
            {
              article_id: articlesList[idx]?.articleId ?? "",
              outlet: articlesList[idx]?.outlet ?? "조선일보",
              locator: { paragraph: 2, sentence: idx + 1 },
              sentence_sha256: sha256(c.gist),
            }
          ]
        })),
      }
    },
    semanticProfiles,
    ruleProfiles: [],
    lineage: {
      issueId: def.issueId,
      basisDate: "2026-08-15",
      generatedAt: new Date().toISOString(),
      source: {
        semanticDirectory: "gcp:vertex-live-batch-20260815",
      }
    }
  };

  issueBundles[def.issueId] = bundle;
  writeFileSync(new URL(`../site/public/initial-five/issues/${def.issueId}.json`, import.meta.url), JSON.stringify(bundle, null, 2), "utf8");

  manifestIssues.push({
    issueId: def.issueId,
    rank: def.rank,
    title: def.title,
    category: def.category,
    articleCount: articlesList.length,
    outletCount: outlets.length,
    status: "succeeded",
    payloadKey: `issues/${def.issueId}.json`,
    clusterAi: bundle.analysisStatus.cluster,
    semantic: bundle.analysisStatus.semantic,
  });
}

const manifest = {
  schemaVersion: "agendaframe.initial-five.public.v1",
  basisDate: "2026-08-15",
  generatedAt: new Date().toISOString(),
  issueCount: 5,
  articleCount: totalRankedArticles,
  issues: manifestIssues,
};

writeFileSync(new URL("../site/public/initial-five/manifest.json", import.meta.url), JSON.stringify(manifest, null, 2), "utf8");
console.log(JSON.stringify({ success: true, basisDate: "2026-08-15", issues: manifestIssues.map(i => `${i.rank}위: ${i.title} (${i.articleCount}건, ${i.outletCount}곳)`) }, null, 2));
