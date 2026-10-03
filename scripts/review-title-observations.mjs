// Explicitly reviewed title comparisons only; no AI calls, no heuristic labels.
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reviews = [
  {
    rank: 2, ids: ["c9cbff31423a96c117439ef5663bdfa4", "a828f0bb6b754162dcfbf8f6f6ae733d"],
    headline: "같은 건조 승인, 조치 전달과 국내 수혜 기대의 제목 초점",
    common: "두 제목 모두 미국 투자 외국 조선소의 선박 건조 승인이라는 조치를 다룹니다. 제목에서 확인되는 공통 사건과, 각 제목이 추가로 전면에 놓은 내용을 구분합니다.",
    descriptions: [
      "KBS 제목은 트럼프의 발언 형식으로 미국 투자 외국 조선사의 건조 승인 내용을 제시합니다. ‘최대 2척’이라는 허용 규모가 제목에 포함되어 있으며, 국내 업체의 수혜 기대는 이 제목에 쓰여 있지 않습니다. 이는 제목 범위의 관측이지 본문에서 수혜를 다루지 않았다는 판단은 아닙니다.",
      "국민일보 제목은 투자 외국 조선소의 군함 2척 건조 허가를 제시한 뒤, K조선의 수혜 기대를 덧붙입니다. 조치 설명과 국내 산업의 기대를 한 제목 안에 이어 놓았습니다. ‘기대’는 확정된 수혜 실적을 말하는 표현과 구분해서 읽어야 합니다.",
    ],
    difference: "공통 조치 뒤에 국내 산업의 기대를 제목에 추가했는지가 구체적인 차이입니다. KBS 제목은 승인 내용과 규모에 초점을 두고, 국민일보 제목은 같은 조치에 K조선의 수혜 기대를 연결합니다. 다만 선박과 군함이라는 범위 차이는 제목만으로 실제 정책 대상이 다르다고 확정하지 않습니다. 본문 정책 조건을 대조하기 전에는 핵심 프레임의 대립으로 분류하지 않습니다.",
    interpretation: "제목에 국내 산업의 수혜 기대를 함께 제시했는지는 관측할 수 있습니다. 실제 수혜 발생, 매체의 정책 찬반, 독자의 반응은 이 제목 비교로 판단할 수 없습니다.",
    importance: "국내 산업에 대한 기대가 제목에 나타나는지에 따라 추가로 제시된 정보가 달라집니다. 정책 사실 자체가 반대라는 뜻은 아니므로 제목 관측의 중요도만 평가합니다.",
  },
  {
    rank: 5, ids: ["09825dacd9c1cbad99e8a68a3872447f", "fcc2203e3461734e9b1378589e8b4725"],
    headline: "공통 불복 사실과 ‘세기의 이혼’이라는 추가 명명",
    common: "두 제목은 최태원의 9440억 원 재산분할 불복과 대법원 절차가 다시 이어진다는 사실을 공통으로 제시합니다. 금액 표기와 법원으로 향하는 표현의 차이를 곧바로 별개의 프레임으로 나누지 않습니다.",
    descriptions: [
      "세계일보 제목은 재산분할 금액과 불복 사실을 제시한 뒤 ‘세기의 이혼’이라는 명명을 추가합니다. 이어 다시 대법원으로 간다는 절차를 연결합니다. 해당 명명은 사건을 부르는 제목상의 표현으로 확인되지만, 매체의 이혼 당사자에 대한 평가까지 뜻한다고 단정할 수 없습니다.",
      "중앙일보 제목은 재산분할 금액과 불복, 다시 대법원으로 향한다는 절차를 제시합니다. 세계일보 제목에 있는 ‘세기의 이혼’이라는 명명은 이 제목에는 없습니다. 이 차이는 제목의 표현 구성에 한정하며, 중앙일보 본문에 같은 표현이 없다는 부재 판단으로 확대하지 않습니다.",
    ],
    difference: "두 제목의 법적 사건 설명은 공통입니다. 세계일보는 ‘세기의 이혼’이라는 추가 명명을 제목에 포함하고, 중앙일보는 불복과 절차 설명으로 제목을 구성합니다. 이는 추가 표현의 선택 차이이며, 법리나 상고 이유를 서로 반대로 설명했다는 증거는 아닙니다. ‘9440억’과 ‘재산분할 9440억’의 순서 차이만으로 별도 프레임을 만들지 않습니다.",
    interpretation: "사건 명명이 제목에 추가되었는지의 범위에서만 해석합니다. 당사자의 의도, 법원의 판단 전망, 매체의 고정 성향이나 실제 독자 효과는 판정하지 않습니다.",
    importance: "공통 사실을 유지한 채 사건 명명을 추가했는지 구분할 수 있습니다. 법적 주장 자체의 차이는 확인하지 못했으므로 중요도는 낮게 두었습니다.",
  },
];
for (const review of reviews) {
  const filename = path.join(root, `site/public/initial-five/issues/live-2026-08-15-top-${review.rank}.json`);
  const bundle = JSON.parse(fs.readFileSync(filename, "utf8"));
  const rows = review.ids.map((id, i) => {
    const article = bundle.articles.find((row) => row.articleId === id);
    const entry = bundle.semanticProfiles.find((row) => row.articleId === id);
    if (!article?.title || !entry?.profile?.article?.title_sha256) throw new Error("Missing original title anchor");
    const titleHash = createHash("sha256").update(`agendaframe:title:v2:${id}:${article.title}`).digest("hex");
    if (titleHash !== entry.profile.article.title_sha256) throw new Error("Stored title generation mismatch");
    return { article_id: id, outlet: article.outlet, description: review.descriptions[i], voice: "title_selection", evidence: [],
      title_basis: { title: article.title, title_sha256: entry.profile.article.title_sha256 },
      scope: `저장 제목만 확인 · 발행 시점 ${article.publishedAt} · 원문 링크 ${article.canonicalUrl}` };
  });
  bundle.comparison.data.fine_grained = {
    version: "fine-comparison-v1.0.0", producer: "editorial-title-review", run_id: bundle.lineage.runId,
    observations: [{ observation_id: `title-review:${review.rank}:v1`, axis: "title_lead", status: "expression_only", headline: review.headline,
      common: review.common, articles: rows, difference: review.difference,
      importance: { level: review.rank === 5 ? "low" : "medium", reason: review.importance },
      interpretation: review.interpretation, limitations: "본문 전체·리드·반론·주변 문맥은 새로 확보하지 않았습니다. 저장 제목과 기존 제목 해시만 직접 대조한 편집 검토이며 AI 재분석 결과가 아닙니다." }],
    review: { source: "stored article title metadata", reviewed_at: "2026-10-03", body_reanalysis: false },
  };
  if (review.rank === 5) {
    const result = bundle.comparison.data.synthesis.comparison_result;
    const dimension = result.dimensions.find((item) => item.dimension === "causal_interpretation");
    const invalid = dimension.points.filter((item) => item.observation_id === "obs-2"
      && /뉴스1|국민일보/.test(item.text));
    if (invalid.length) {
      const reason = "기존 원인 비교의 언론사 이름이 기사 ID의 실제 매체와 불일치하여 제외했습니다. 본문 원인 비교는 재분석 전까지 보류합니다.";
      bundle.comparison.data.editorial_quarantine = { reviewed_at: "2026-10-03", reason,
        source_run_id: bundle.lineage.runId, source_prompt_version: bundle.comparison.data.synthesis.promptVersion,
        removed_points: invalid, body_reanalysis: false };
      dimension.points = dimension.points.filter((item) => !invalid.includes(item));
      dimension.evidence = [];
      dimension.status = "held_for_analysis";
      dimension.reason = reason;
      result.status = "held_for_analysis";
      result.reason = reason;
      result.primary_dimension = null;
      bundle.comparison.data.comparison_result = structuredClone(result);
      bundle.comparison.data.comparisonResult = structuredClone(result);
      bundle.comparison.data.splitLine = reason;
      bundle.comparison.data.synthesis.split_line = reason;
    }
    if (bundle.comparison.data.editorial_quarantine) {
      bundle.comparison.data.summary_30_seconds.main_difference = result.reason;
      bundle.comparison.data.summary_30_seconds.divergence_detected = false;
    }
  }
  fs.writeFileSync(filename, JSON.stringify(bundle, null, 2) + "\n");
  console.log(`Reviewed stored title metadata: issue ${review.rank}; no profile prompt or body evidence changed`);
}
