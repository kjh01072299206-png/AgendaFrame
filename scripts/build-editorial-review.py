import argparse
import hashlib
import html
import importlib
import json
import math
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

parser = argparse.ArgumentParser(
    description="Rebuild October 5 body-reading artifact from a private, previously collected archive."
)
parser.add_argument("--private-archive", type=Path, required=True)
parser.add_argument("--runtime", type=Path)
parser.add_argument("--model-path")
args = parser.parse_args()
ROOT = args.private_archive.resolve()
REPO = Path(__file__).resolve().parents[1]
if args.runtime:
    sys.path.insert(0, str(args.runtime.resolve()))
Kiwi = importlib.import_module("kiwipiepy").Kiwi
ISSUES = json.loads(
    (REPO / "site/data/editorial-source/oct5-body-reading-v1.json").read_text(encoding="utf-8")
)
FUNCTIONS = json.loads(
    (REPO / "site/data/editorial-source/oct5-article-functions-v1.json").read_text(encoding="utf-8")
)
LABELS = ["문제 정의", "원인 해석", "책임 귀속", "규범적 평가", "해법·처방", "취재원 구성"]
OUTLETS = {
    "donga": "동아일보",
    "joongang": "중앙일보",
    "hani": "한겨레",
    "hankookilbo": "한국일보",
    "khan": "경향신문",
    "kmib": "국민일보",
    "munhwa": "문화일보",
    "sbs": "SBS",
    "segye": "세계일보",
    "seoul": "서울신문",
}
META = json.loads((ROOT / "metadata.json").read_text(encoding="utf-8"))
KIWI = Kiwi(num_workers=2, model_path=args.model_path)
USER_WORDS = [
    "장동혁",
    "이재명",
    "김용민",
    "추미애",
    "김지용",
    "유시민",
    "박정희",
    "박근혜",
    "육영수",
    "유해진",
    "이재정",
    "김민석",
    "정동영",
    "조현",
    "국과수",
    "합참",
    "보완수사",
    "군사분계선",
    "수지반보병지뢰",
    "무극파",
    "중수청",
    "공소청",
    "정전협정",
    "기관경고",
    "문화전쟁",
    "역사전쟁",
]
for word in USER_WORDS:
    KIWI.add_user_word(word, "NNP")
STOP = {
    "기자",
    "기사",
    "사진",
    "연합뉴스",
    "뉴시스",
    "뉴스",
    "제공",
    "구독",
    "광고",
    "관련",
    "이날",
    "이번",
    "이후",
    "당시",
    "관계자",
    "입장",
    "경우",
    "문제",
    "상황",
    "내용",
    "사실",
    "지난",
    "올해",
    "오늘",
    "우리",
    "이것",
    "그것",
    "해당",
    "대해",
    "통해",
    "라며",
    "주장",
    "설명",
    "발표",
    "부분",
    "지난달",
    "정도",
    "다음",
    "현재",
    "정충신",
    "선임",
    "기자회견",
    "페이스북",
    "보고",
    "이승배",
    "기자페이지",
    "바로가기",
    "확대",
    "보기",
    "이미지",
    "닫기",
    "프린트",
    "글씨",
    "글자",
    "설정",
    "공유",
    "읽기",
    "모드",
    "버튼",
    "입력",
    "수정",
}


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def iso(value):
    return datetime.fromtimestamp(float(value), timezone.utc).isoformat().replace("+00:00", "Z")


def clean(raw):
    # Only reviewed article text is used for tokenisation. Source hashes use raw files.
    text = html.unescape(raw)
    # DongA author subscription cards precede the actual article in saved extracts.
    if "정치부 구독 추천" in text[:350] or "디지털뉴스팀 구독 추천" in text[:350]:
        boundary = text.rfind("구독 ", 0, min(len(text), 450))
        if boundary >= 0:
            text = text[boundary + 3 :]
    if text.startswith("북마크 공유 댓글 인쇄"):
        start = text.find("더중앙플러스 시작하기 Close")
        if start >= 0:
            text = text[start + len("더중앙플러스 시작하기 Close") :]
        # The Kim Yong-min page places a related-news strip before the article.
        if "김용민 더불어민주당 의원. 뉴스1" in text:
            text = text[text.index("김용민 더불어민주당 의원. 뉴스1") :]
    for marker in (
        "놓친 뉴스와 그 맥락까지",
        "© dongA.com",
        "<Copyright",
        "무단 전재 및 재배포 금지",
        "ⓒ",
        "영문번역(English Translation)",
        "댓글 0 글자 크기",
        " 다른 기사 더보기",
        "Copyright",
        "더 중앙 플러스",
    ):
        if marker in text:
            text = text.split(marker, 1)[0]
    text = re.sub(r"오현주 서울시의원.*?서울시의회 바로가기", " ", text, flags=re.S)
    text = re.sub(r"[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", " ", text)
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"기사 읽어주기.*?구글에서 서울신문 먼저 보기", " ", text, flags=re.S)
    text = re.sub(r"읽기모드 다크모드.*?기사반응", " ", text, flags=re.S)
    # Remove extracted navigation phrases, keeping the surrounding news paragraph.
    for nav in (
        "Your browser does not support the audio element.",
        "사진은 기사 내용과 관련 없음.",
        "기자페이지 바로가기",
        "기자 페이지 바로가기",
        "사진 확대보기",
        "이미지 확대보기",
        "사진=연합뉴스",
        "구글에서 서울신문 먼저 보기",
        "한국일보를 선호 출처로 추가",
    ):
        text = text.replace(nav, " ")
    text = re.sub(r"[가-힣]{2,4} 기자(?=\s|$)", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def tokens(text):
    result = []
    pos = Counter()
    for t in KIWI.tokenize(text):
        if (
            t.tag.startswith(("NN", "VV", "VA", "XR", "MAG"))
            and len(t.form) > 1
            and t.form not in STOP
            and not re.search("[a-zA-Z]", t.form)
        ):
            result.append(t.form)
            pos[
                "명사"
                if t.tag.startswith("NN")
                else "동사"
                if t.tag.startswith("VV")
                else "형용사"
                if t.tag.startswith("VA")
                else "부사·어근"
            ] += 1
    return result, pos


def evidence(raw, cue):
    p = raw.find(cue)
    if p < 0:
        raise ValueError(f"Evidence cue missing: {cue}")
    start = max(raw.rfind("\n", 0, p), raw.rfind(". ", 0, p), raw.rfind("다. ", 0, p)) + 1
    stops = [v for v in (raw.find("\n", p), raw.find(". ", p), raw.find("다. ", p)) if v >= 0]
    end = min(stops) + 1 if stops else min(len(raw), p + 260)
    if end - start > 650:
        start = max(start, p - 150)
        end = min(end, p + 300)
    return {
        "unit": "raw_text_character_range",
        "start": start,
        "end": end,
        "sha256": digest(raw[start:end]),
    }


GENERIC = {
    "investigation": ["책임"],
    "operation": ["책임"],
    "adequacy": ["갈등", "책임"],
    "boundary": ["책임"],
    "legitimacy": ["갈등", "도덕성"],
    "freedom": ["갈등", "책임"],
    "mobilization": ["갈등"],
    "institutions": ["갈등", "경제적 결과", "책임"],
    "safety": ["갈등", "책임", "인간적 흥미"],
    "principle": ["도덕성"],
    "faction": ["갈등"],
    "governance": ["갈등", "책임"],
    "completion": ["갈등", "책임"],
    "authority": ["갈등", "책임"],
    "design": ["갈등", "책임"],
    "audit": ["책임"],
    "accountability": ["책임"],
    "editorial": ["책임", "도덕성"],
}
DEVICE_TERMS = [
    "무극파",
    "사심",
    "역사전쟁",
    "문화전쟁",
    "검열",
    "정통성",
    "빈총",
    "빈 총",
    "반신불수",
    "사상누각",
    "상응 조치",
    "정전협정",
    "군사회담",
    "매설",
    "유실",
    "보완수사",
    "인사권",
    "결집",
    "거짓말",
]
results = []
for rank, spec in enumerate(ISSUES, 1):
    articles = []
    bags = {}
    poss = {}
    sentences = {}
    for prefix, group, reading, scope, sources, cue in spec["articles"]:
        m = next(r for r in META if r["article_id"].startswith(prefix))
        raw = (ROOT / "bodies" / f"{m['article_id']}.txt").read_text(encoding="utf-8")
        assert digest(raw) == m["body_hash"], m["article_id"]
        text = clean(raw)
        ts, pos = tokens(text)
        bags[m["article_id"]] = Counter(ts)
        poss[m["article_id"]] = pos
        sentences[m["article_id"]] = [
            set(tokens(s)[0]) for s in re.split(r"(?<=[.!?])\s+|(?<=다\.)", text) if s.strip()
        ]
        tags = GENERIC[group].copy()
        if prefix == "6ca25d19":
            tags.append("인간적 흥미")
        # No quotation is exposed: the link, frozen source hash and locator anchor the reading.
        if cue not in raw:
            replacements = {
                "公开": "밝히",
                "공개": "밝히",
                "설득": "지지",
                "벤처": "지원",
                "창작": "영화",
                "결집": "보수",
                "상응 조치": "지뢰",
                "추미애": "개혁",
            }
            cue = replacements.get(cue, cue)
        ev = evidence(raw, cue)
        articles.append(
            dict(
                articleId=m["article_id"],
                sourceId=m["source_id"],
                outlet=OUTLETS[m["source_id"]],
                title=html.unescape(m["title"]),
                url=m["canonical_url"],
                publishedAt=iso(m["published_at"]),
                collectedAt=iso(m["collected_at"]),
                bodySha256=m["body_hash"],
                reviewedTextSha256=digest(text),
                reviewedCharacters=len(text),
                groupId=group,
                reading=reading,
                scope=scope,
                sources=sources,
                genericFrames=tags,
                genre="사설"
                if group == "editorial"
                else "영상 안내"
                if prefix == "9d2de500"
                else "보도",
                evidence=[ev],
                devices=dict(
                    headline=reading,
                    terms=[t for t in DEVICE_TERMS if t in text],
                    historicalExample="2015년 목함지뢰와 확성기 대응"
                    if "2015" in text and "지뢰" in text
                    else "박근혜의 반복적 정치 등장"
                    if group == "mobilization" and "박근혜" in text
                    else "대통령의 과거 경계 실패 발언"
                    if group == "editorial"
                    else None,
                ),
            )
        )
    for article in articles:
        article["fourFunctions"] = dict(
            zip(
                ["문제 정의", "원인 해석", "규범적 평가", "해법·처방"],
                FUNCTIONS[article["articleId"][:8]],
            )
        )

    def bind_paragraphs(rows, allowed=None):
        bound = []
        for row in rows:
            ids = []
            for prefix in row["articlePrefixes"]:
                matches = [a["articleId"] for a in articles if a["articleId"].startswith(prefix)]
                assert len(matches) == 1, (spec["id"], prefix)
                assert allowed is None or matches[0] in allowed, (spec["id"], prefix)
                ids.append(matches[0])
            assert row["text"].strip() and ids
            bound.append(dict(text=row["text"], articleIds=list(dict.fromkeys(ids))))
        return bound

    groups = []
    for g in spec["groups"]:
        members = [a for a in articles if a["groupId"] == g["id"]]
        assert members
        total = sum((bags[a["articleId"]] for a in members), Counter())
        top = total.most_common(14)
        topterms = {t for t, n in top}
        co = Counter()
        for a in members:
            for sent in sentences[a["articleId"]]:
                words = sorted(sent & topterms)
                for i, t in enumerate(words):
                    for u in words[i + 1 :]:
                        co[(t, u)] += 1
        groups.append(
            dict(
                id=g["id"],
                title=g["title"],
                focus=g["focus"],
                explanationParagraphs=bind_paragraphs(
                    g["explanationParagraphs"], {a["articleId"] for a in members}
                ),
                difference=g["difference"],
                policy=g["policy"],
                sixFunctions=dict(zip(LABELS, g["dims"])),
                articleIds=[a["articleId"] for a in members],
                outlets=list(dict.fromkeys(a["outlet"] for a in members)),
                articleCount=len(members),
                network=dict(
                    nodes=[dict(term=t, count=n) for t, n in top],
                    edges=[
                        dict(source=t, target=u, sentences=n) for (t, u), n in co.most_common(22)
                    ],
                ),
            )
        )
    morphology = []
    allbag = sum(bags.values(), Counter())
    allN = sum(allbag.values())
    for outlet in dict.fromkeys(a["outlet"] for a in articles):
        ids = [a["articleId"] for a in articles if a["outlet"] == outlet]
        bag = sum((bags[k] for k in ids), Counter())
        N = sum(bag.values())
        pos = sum((poss[k] for k in ids), Counter())
        distinct = []
        for term, n in bag.items():
            if n < 3:
                continue
            other = allbag[term] - n
            otherN = allN - N
            if otherN <= 0:
                continue
            score = math.log2(((n + 0.5) / (N + 0.5)) / ((other + 0.5) / (otherN + 0.5)))
            distinct.append(dict(term=term, count=n, log2Ratio=round(score, 3)))
        distinct.sort(key=lambda d: (-d["log2Ratio"], -d["count"], d["term"]))
        morphology.append(
            dict(
                outlet=outlet,
                articleCount=len(ids),
                tokens=N,
                pos=[dict(tag=k, count=v) for k, v in pos.items()],
                distinctive=distinct[:8],
            )
        )
    results.append(
        dict(
            issueId=spec["id"],
            rank=rank,
            title=spec["title"],
            summary=spec["summary"],
            eventParagraphs=bind_paragraphs(spec["eventParagraphs"]),
            terms=[
                dict(
                    term=t["term"],
                    description=t["description"],
                    articleIds=bind_paragraphs(
                        [dict(text=t["description"], articlePrefixes=t["articlePrefixes"])]
                    )[0]["articleIds"],
                )
                for t in spec["terms"]
            ],
            common=spec["common"],
            question=spec["question"],
            insight=spec["insight"],
            articleCount=len(articles),
            outletCount=len(set(a["outlet"] for a in articles)),
            sourceCount=len(set(s for a in articles for s in a["sources"])),
            scopeMix=[
                dict(label=k, count=sum(a["scope"] == k for a in articles))
                for k in ["사건", "사건+구조"]
            ],
            groups=groups,
            articles=articles,
            morphology=morphology,
        )
    )

unique = {a["articleId"] for x in results for a in x["articles"]}
output = dict(
    schemaVersion="agendaframe.codex-body-reading.v1",
    basisDate="2026-10-05",
    analysisSource="codex_body_reading",
    analysisVersion="2026-10-07.2",
    analysisMethod="Codex read archived original article bodies and annotated issue-specific editorial emphasis. Group functions synthesize member readings; groups are not fixed outlet ideologies.",
    collection=dict(
        articleCount=len(META),
        uniqueBodyCount=len(set(m["body_hash"] for m in META)),
        hashVerifiedCount=len(META),
        outletCount=len(set(m["source_id"] for m in META)),
    ),
    coverage=dict(
        issueAssignments=sum(len(x["articles"]) for x in results),
        uniqueReviewedArticleCount=len(unique),
        crossIssueArticleIds=[],
    ),
    linguisticMethod=dict(
        analyzer="kiwipiepy",
        version="0.22.2",
        modelVersion="0.22.1",
        userDictionary=USER_WORDS,
        unit="content morphemes in cleaned stored article text",
        distinctive="log2 relative frequency versus other outlets in the same issue; Jeffreys 0.5 smoothing; minimum count 3",
        network="sentence-level co-occurrence of 14 most frequent content lemmas per annotated group; one count per pair per sentence",
        posTags=["NN*", "VV*", "VA*", "XR*", "MAG*"],
    ),
    issues=results,
)
target = REPO / "site/data/editorial-2026-10-05.json"
target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(
    json.dumps(
        {
            "output": str(target),
            "issues": [(x["issueId"], x["articleCount"], x["outletCount"]) for x in results],
            "reviewedUnique": len(unique),
        },
        ensure_ascii=False,
    )
)
