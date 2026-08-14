// Profile-backed event synthesis for the public site.
// Reuses coded public paraphrases and drops anything without locator+hash.
// Do not label outlets progressive/conservative.

const SHA256 = /^[0-9a-fA-F]{64}$/;
const CAMP_LABELS = {
  legal_institutional: "제도 안전장치 약화를 앞세운 쪽",
  no_treatment: "구체적 대응보다 경고를 전한 쪽",
  institutional_check: "대통령의 침묵과 거부권 요구를 앞세운 쪽",
  investigation_accountability: "수사와 책임 추궁을 앞세운 쪽",
};

function cleanText(value, limit = 280) {
  if (typeof value !== "string") return "";
  return value.split(/\s+/).join(" ").slice(0, limit);
}

function itemEvidence(articleId, item) {
  const evidence = item?.evidence;
  const locator = evidence?.locator;
  const digest = evidence?.sentence_sha256 || evidence?.sentenceSha256;
  if (!locator || typeof digest !== "string" || !SHA256.test(digest)) return null;
  if (locator.paragraph == null || locator.sentence == null) return null;
  return {
    article_id: articleId,
    locator: { paragraph: locator.paragraph, sentence: locator.sentence },
    sentence_sha256: digest.toLowerCase(),
  };
}

function firstObservedItem(profile, dimension) {
  const items = profile?.dimensions?.[dimension]?.items;
  if (!Array.isArray(items)) return null;
  return items.find((item) => item && item.public_paraphrase) ?? null;
}

function campKey(profile) {
  const problem = firstObservedItem(profile, "problem_definition");
  const treatment = firstObservedItem(profile, "treatment_recommendation");
  const problemFamily = problem?.frame_family || "";
  if (problemFamily === "legal_institutional") return "legal_institutional";
  if (!treatment) return "no_treatment";
  return treatment.frame_family || problemFamily || "other";
}

function rowsFor(coded, dimension) {
  const rows = [];
  for (const row of coded) {
    const item = firstObservedItem(row.profile, dimension);
    if (!item) continue;
    const evidence = itemEvidence(row.articleId, item);
    if (!evidence) continue;
    rows.push({
      article_id: row.articleId,
      outlet: row.outlet,
      text: cleanText(item.public_paraphrase),
      family: item.frame_family || "",
      evidence,
    });
  }
  return rows;
}

function claim(text, evidence) {
  if (!text || !evidence?.length) return { text: null, status: "insufficient_evidence", evidence: [] };
  return { text, status: "observed", evidence };
}

export function composeEventSynthesis(bundle) {
  const articles = bundle?.articles ?? [];
  const profiles = bundle?.semanticProfiles ?? [];
  const byId = new Map(articles.map((article) => [article.articleId, article]));
  const coded = [];
  for (const entry of profiles) {
    if (!entry?.articleId || !entry.profile) continue;
    const article = byId.get(entry.articleId);
    coded.push({
      articleId: entry.articleId,
      outlet: article?.outlet || article?.sourceId || "",
      profile: entry.profile,
      camp: campKey(entry.profile),
    });
  }
  if (!coded.length) return { usable: false, opposition: false, camps: [] };

  const problems = rowsFor(coded, "problem_definition");
  const causes = rowsFor(coded, "causal_interpretation");
  const duties = rowsFor(coded, "responsibility_attribution");
  const morals = rowsFor(coded, "moral_evaluation");
  const remedies = rowsFor(coded, "treatment_recommendation");

  const grouped = new Map();
  for (const row of coded) {
    const list = grouped.get(row.camp) ?? [];
    list.push(row);
    grouped.set(row.camp, list);
  }

  const camps = [];
  for (const [key, members] of grouped) {
    if (key === "other" && grouped.size > 1) continue;
    const memberIds = new Set(members.map((row) => row.articleId));
    let gists = remedies.filter((row) => memberIds.has(row.article_id));
    if (key === "no_treatment" || key === "legal_institutional" || !gists.length) {
      gists = problems.filter((row) => memberIds.has(row.article_id));
    }
    if (!gists.length) continue;
    const lead = gists[0];
    camps.push({
      name: CAMP_LABELS[key] || "관측된 강조 묶음",
      gist: lead.text,
      outlets: [...new Set(members.map((row) => row.outlet).filter(Boolean))],
      article_ids: members.map((row) => row.articleId),
      evidence: [lead.evidence],
      index: camps.length,
    });
  }

  const opposition = camps.length >= 2;
  const publicCamps = opposition ? camps.slice(0, 4) : [];

  const agreedBits = [];
  const agreedEvidence = [];
  if (causes.length && new Set(causes.map((row) => row.family)).size === 1) {
    agreedBits.push("원인을 대통령·여당의 정치적 계산에서 찾는다");
    agreedEvidence.push(...causes.slice(0, 3).map((row) => row.evidence));
  }
  if (duties.length && new Set(duties.map((row) => row.family)).size === 1) {
    agreedBits.push("책임을 대통령과 여당 양쪽에 함께 돌린다");
    agreedEvidence.push(...duties.slice(0, 3).map((row) => row.evidence));
  }
  const agreedText = agreedBits.join(" ") || causes[0]?.text || null;
  if (agreedText && !agreedEvidence.length && causes[0]) agreedEvidence.push(causes[0].evidence);

  const splitText = opposition
    ? `같은 사건에서 ${publicCamps.map((camp) => `${camp.name}는 ${camp.gist}`).join(", ")}.`
    : null;
  const splitEvidence = opposition ? publicCamps.flatMap((camp) => camp.evidence) : [];
  const title = bundle?.issue?.title?.trim() || "";
  const whatText = title && problems[0] ? `${title}. ${problems[0].text}` : (title || problems[0]?.text || null);

  const factRows = [];
  if (agreedBits.some((bit) => bit.includes("원인")) && causes[0]) {
    factRows.push({ question: "왜 이렇게 됐다고 했나", common: causes[0].text, cells: null, status: "observed", evidence: [causes[0].evidence] });
  }
  if (agreedBits.some((bit) => bit.includes("책임")) && duties[0]) {
    factRows.push({ question: "누구 책임이라고 했나", common: duties[0].text, cells: null, status: "observed", evidence: [duties[0].evidence] });
  }

  const splitRows = [];
  if (opposition) {
    const problemCells = [];
    const remedyCells = [];
    for (const camp of publicCamps) {
      const ids = new Set(camp.article_ids);
      const problem = problems.find((row) => ids.has(row.article_id));
      const remedy = remedies.find((row) => ids.has(row.article_id));
      problemCells.push(problem ? { text: problem.text, evidence: [problem.evidence] } : { text: null, evidence: [] });
      remedyCells.push(remedy
        ? { text: remedy.text, evidence: [remedy.evidence] }
        : { text: "기사에서 구체적 대응·해법이 명시되지 않음", evidence: camp.evidence });
    }
    splitRows.push({
      question: "무엇이 문제라고 했나",
      common: null,
      cells: problemCells.map((cell) => cell.text),
      status: "observed",
      evidence: problemCells.flatMap((cell) => cell.evidence),
    });
    splitRows.push({
      question: "어떻게 하자고 했나",
      common: null,
      cells: remedyCells.map((cell) => cell.text),
      status: "observed",
      evidence: remedyCells.flatMap((cell) => cell.evidence),
    });
  }

  return {
    schemaVersion: "agendaframe.event-synthesis.v1",
    promptVersion: "event-synthesis-v1.0.0",
    usable: Boolean(whatText || agreedText || publicCamps.length || factRows.length),
    opposition,
    what_happened: claim(whatText, problems.slice(0, 4).map((row) => row.evidence)),
    agreed_line: claim(agreedText, agreedEvidence),
    split_line: opposition
      ? claim(splitText, splitEvidence)
      : { text: null, status: "explicit_not_stated", evidence: [], reason: "서로 다른 근거 그룹이 없어 대립 구도로 표시하지 않습니다." },
    so_what: opposition
      ? claim("어느 기사 묶음을 먼저 읽느냐에 따라 이 사안이 정치 책임 문제로 보이는지, 제도 문제로 보이는지, 경고만 남는지가 달라진다.", splitEvidence)
      : { text: null, status: "explicit_not_stated", evidence: [] },
    camps: publicCamps,
    terms: [],
    fact_rows: factRows,
    split_rows: splitRows,
    frame_functions: [
      ["problem_definition", problems],
      ["causal_interpretation", causes],
      ["responsibility_attribution", duties],
      ["evaluation", morals],
      ["treatment_recommendation", remedies],
    ].flatMap(([dimension, rows]) => {
      if (!rows.length) return [];
      const families = new Set(rows.map((row) => row.family).filter(Boolean));
      const summary = families.size === 1 ? rows[0].text : (opposition ? publicCamps.map((camp) => camp.gist).join(" / ") : rows[0].text);
      const evidence = families.size === 1 || !opposition ? [rows[0].evidence] : publicCamps.flatMap((camp) => camp.evidence);
      return [{ dimension, summary, status: "observed", evidence }];
    }),
    proof_rows: [
      ["problem_definition", problems],
      ["causal_interpretation", causes],
      ["responsibility_attribution", duties],
      ["evaluation", morals],
      ["treatment_recommendation", remedies],
    ].flatMap(([dimension, rows]) => rows.map((row) => ({
      article_id: row.article_id,
      outlet: row.outlet,
      dimension,
      text: row.text,
      evidence: [row.evidence],
    }))),
  };
}

function sourceLensFromProfiles(bundle) {
  const byId = new Map((bundle?.articles ?? []).map((article) => [article.articleId, article]));
  const outlets = new Map();
  for (const entry of bundle?.semanticProfiles ?? []) {
    const article = byId.get(entry.articleId);
    const outlet = article?.outlet || article?.sourceId || entry.articleId;
    const bucket = outlets.get(outlet) ?? { outlet, roles: new Map() };
    for (const actor of entry.profile?.actors_and_sources ?? []) {
      const label = actor.role_label || actor.role || "미분류";
      const count = Number(actor.direct_quote_count || 0) + Number(actor.indirect_attribution_count || 0) || 1;
      const current = bucket.roles.get(label) ?? { role: actor.role, role_label: label, count: 0 };
      current.count += count;
      bucket.roles.set(label, current);
    }
    outlets.set(outlet, bucket);
  }
  return {
    by_outlet: [...outlets.values()].map((row) => ({
      outlet: row.outlet,
      roles: [...row.roles.values()].sort((left, right) => right.count - left.count || left.role_label.localeCompare(right.role_label)),
    })),
    caution: "취재원 구성은 발화 가시성의 관측이지 매체의 의도 판정이 아닙니다.",
  };
}

export function withEventSynthesis(bundle) {
  if (!bundle) return bundle;
  if (bundle.comparison?.data?.synthesis?.usable) return bundle;
  const synthesis = composeEventSynthesis(bundle);
  if (!synthesis.usable) return bundle;
  const brief = bundle.comparison?.data?.summary_30_seconds ?? {};
  const existingLens = bundle.comparison?.data?.source_lens;
  const sourceLens = existingLens?.by_outlet?.length ? existingLens : sourceLensFromProfiles(bundle);
  const agreed = synthesis.agreed_line?.status === "observed" ? synthesis.agreed_line.text : brief.common_ground;
  const split = synthesis.opposition && synthesis.split_line?.status === "observed"
    ? synthesis.split_line.text
    : (synthesis.opposition ? brief.main_difference : "서로 다른 근거 그룹이 확인되지 않아 대립 구도로 표시하지 않고 공통 보도로 읽습니다.");
  return {
    ...bundle,
    clusterAi: {
      ...bundle.clusterAi,
      summary: bundle.clusterAi?.summary || (synthesis.what_happened?.status === "observed" ? synthesis.what_happened.text : null),
    },
    comparison: {
      ...bundle.comparison,
      data: {
        ...bundle.comparison?.data,
        synthesis,
        source_lens: sourceLens,
        whatHappened: synthesis.what_happened?.status === "observed" ? synthesis.what_happened.text : null,
        agreedLine: agreed ?? null,
        splitLine: split ?? null,
        soWhat: synthesis.so_what?.status === "observed" ? synthesis.so_what.text : null,
        camps: synthesis.opposition ? synthesis.camps : [],
        factRows: synthesis.fact_rows ?? [],
        splitRows: synthesis.opposition ? synthesis.split_rows ?? [] : [],
        terms: synthesis.terms ?? [],
        summary_30_seconds: {
          ...brief,
          common_ground: agreed ?? brief.common_ground,
          main_difference: split ?? brief.main_difference,
          source_context: synthesis.so_what?.status === "observed" ? synthesis.so_what.text : brief.source_context,
          divergence_detected: synthesis.opposition,
          limit: "기사 ID·locator·문장 해시가 연결된 관측만 표시합니다. 언론사 성향은 추론하지 않습니다.",
        },
      },
    },
  };
}
