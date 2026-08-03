"""Build the question-first framing pages.

One page per event, not one page per method. Each page carries a single
question chosen from what the coding actually found, and the page shape
follows the finding: issues where the press converged get a convergence
banner and a flat list; issues where it split get a side-by-side of the
words each outlet chose.

Machine facts (outlets, titles, links, coded paraphrases, key terms,
source roles, uniformity) come from the run artifacts. The question line,
the neutral headline and the "nobody asked" block are editorial sentences
written on top of those facts, and the page says so at the bottom.

Usage:  python build_pages.py [DATA_ROOT]
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUN_DIR = Path("tmp") / "claude-framing-2026-07-26"


def find_data() -> Path | None:
    """Locate the run artifacts. They live in a gitignored scratch dir, so a
    worktree checkout has to walk back up to the main working copy."""
    for base in HERE.parents:
        if (base / RUN_DIR / "workflow-result.json").is_file():
            return base / RUN_DIR
    return None

CIRCLED = "①②③④⑤"
ROLE_KO = {
    "government_official": "정부·공공기관",
    "political_actor": "정당·정치권",
    "judiciary_law_enforcement": "사법·수사기관",
    "expert_research": "전문가·연구자",
    "civil_society": "시민사회",
    "business": "기업",
    "affected_person": "당사자·시민",
    "anonymous_official": "익명 관계자",
    "other": "기타",
}
SCOPE_KO = {"episodic": "개별 사건", "mixed": "절반쯤 섞임", "thematic": "구조·맥락"}
DIM_KO = {
    "problem_definition": "무엇이 문제라고 했나",
    "causal_attribution": "왜 이렇게 됐다고 했나",
    "responsibility_attribution": "누구 책임이라고 했나",
    "evaluation": "어떻게 평가했나",
    "treatment_recommendation": "어떻게 하자고 했나",
    "actor_visibility": "누구 말을 실었나",
}


# ─────────────────────────────────────────────────────────── data

def load(data_root: Path):
    workflow = json.loads((data_root / "workflow-result.json").read_text(encoding="utf-8"))
    meta = {}
    for line in (data_root.parent / "initial-five-prepared" / "articles.jsonl").read_text(
        encoding="utf-8"
    ).splitlines():
        if line.strip():
            row = json.loads(line)
            meta[row["article_id"]] = row

    issues = {}
    for rank in range(1, 6):
        reader = json.loads(
            (data_root / "reader" / f"top-{rank}.json").read_text(encoding="utf-8")
        )
        rows = [a for a in workflow["articles"] if a["rank"] == rank]
        rows.sort(key=lambda a: meta[a["articleId"]]["published_at"])
        seen = Counter(a["outlet_label"] for a in rows)
        used = Counter()

        arts = []
        for a in rows:
            label = a["outlet_label"]
            if seen[label] > 1:
                label = f"{a['outlet_label']} {CIRCLED[used[a['outlet_label']]]}"
                used[a["outlet_label"]] += 1
            info = meta[a["articleId"]]
            fp = a["final"].get("framing_plus") or {}
            dims = {d["dimension"]: d for d in a["final"]["dimensions"]}
            roles = Counter()
            for actor in a["final"].get("actors") or []:
                roles[ROLE_KO.get(actor["role"], actor["role"])] += 1
            arts.append(
                {
                    "label": label,
                    "outlet": a["outlet_label"],
                    "id": a["articleId"],
                    "title": info["title"],
                    "url": info["canonical_url"],
                    "published": info["published_at"][11:16],
                    "dims": dims,
                    "terms": [t["term_used"] for t in fp.get("key_term_choices") or []],
                    "scope": (fp.get("iyengar") or {}).get("code"),
                    "roles": list(roles.keys()),
                }
            )

        # 공통으로 전한 것 / 어디에도 없는 것 — 같은 층위의 두 얼굴이라 함께 모은다.
        common, absent = [], []
        for row in reader["matrix"]:
            if not row.get("common"):
                continue
            if row["common"].strip() in {"언급 없음", "없음"}:
                absent.append(f"{row['question']} — 이 사안 기사 전부에 해당 서술이 없습니다")
            else:
                common.append((row["question"], row["common"]))

        scopes = Counter(a["scope"] for a in arts)
        if scopes.get("thematic", 0) == 0:
            if scopes.get("mixed", 0):
                absent.append(
                    f"구조·제도 설명으로 쓴 기사 — 없습니다"
                    f"(개별 사건 {scopes.get('episodic', 0)}건, 절반쯤 섞인 기사 {scopes['mixed']}건)"
                )
            else:
                absent.append(
                    f"구조·제도 설명 — {len(arts)}건 모두 개별 사건으로만 다룹니다"
                )

        issues[rank] = {
            "rank": rank,
            "articles": arts,
            "common": common,
            "absent": absent,
            "whatHappened": reader["whatHappened"],
            "terms": reader["terms"],
        }
    return issues


# ─────────────────────────────────────────────────── 편집 문안

EDITORIAL = {
    1: {
        "slug": "issue-1",
        "headline": "검찰 보완수사권 폐지 추진에 야당 반발",
        "shape": "converge",
        "own_dim": "actor_visibility",
        "question": "이 기사에서 말하는 사람은 누구인가",
        "sub": "일곱 기사 모두 야당 쪽 발언을 중심으로 채워집니다. 그래서 이 사안에서 갈린 것은 사건에 대한 해석이 아니라, "
        "같은 사람의 말을 어디까지 옮겼는지입니다.",
        "banners": [
            ("7건 / 7건", "비판 대상이 된 대통령·여당의 반론이 어느 기사에도 실리지 않았습니다."),
            ("6건 / 7건", "인용된 취재원이 정당·정치권 한 종류뿐입니다. 남은 1건(중앙일보)에만 정부 관계자의 전언이 하나 더 있습니다."),
            ("2건", "야당 원내대표가 소셜미디어에 올린 글 한 편이 기사 전체를 채웁니다."),
        ],
        "tag_field": "treatment_recommendation",
        "tag_map": {
            "institutional_check": "거부권을 쓰라고 요구",
            None: "요구 없이 경고만 전달",
        },
        "tag_note": "각 기사가 같은 발언에서 무엇까지 옮겼는지",
        "asked": [
            "보완수사권을 없애면 실제 수사에서 무엇이 달라지는지 — 7건에 수사 실무자나 법학자의 설명은 없습니다.",
            "폐지를 추진하는 쪽은 왜 그렇게 하는지 — 추진 측의 설명은 7건에 없습니다.",
        ],
        "recommend": {
            "label": "중앙일보",
            "why": "일곱 건 가운데 이 일을 '정치 싸움'이 아니라 '제도가 무너지는 문제'로 규정한 유일한 기사이고, "
            "정치권 밖 취재원도 한 명 들어 있습니다.",
            "caveat": "다만 폐지를 추진하는 쪽의 설명은 7건 어디에도 없습니다. 반대편 설명은 이 사안 밖에서 따로 찾아야 합니다.",
        },
    },
    2: {
        "slug": "issue-2",
        "headline": "국민의힘 권영진 의원이 원내대표 멱살을 잡았다 — 당은 거취 정리 요구",
        "shape": "diverge",
        "question": "같은 행동을 뭐라고 불렀나",
        "sub": "여섯 기사 모두 책임은 본인에게 있고 징계가 필요하다고 씁니다. 갈린 것은 그 행동을 부르는 이름이고, "
        "이름이 사안의 무게를 정합니다.",
        "columns": [
            ("‘폭력’이라 부른 곳", ["경향신문", "동아일보", "조선일보"]),
            ("‘항의’·‘신체 접촉’이라 부른 곳", ["문화일보"]),
            ("‘소동’이라 부른 곳", ["중앙일보"]),
            ("행동 대신 혐의 이름을 쓴 곳", ["서울신문"]),
        ],
        "headline_terms": {
            "경향신문": "멱살 항의",
            "동아일보": "정점식 멱살 · 파문",
            "문화일보": "정점식 멱살",
            "서울신문": "제목에 그 행동이 없음",
            "조선일보": "원내대표 멱살",
            "중앙일보": "멱살 소동 · 파문",
        },
        "spot": "경향신문은 제목에서 ‘항의’라 부르고 본문에서는 ‘조폭의 행태’를 인용합니다. 서울신문은 제목에서 그 행동을 아예 "
        "빼고 결과(거취)만 남긴 뒤, 본문에서는 ‘직권남용·강요·폭행’이라는 혐의 이름을 씁니다. 제목과 본문의 무게가 같지 않은 "
        "기사가 있다는 뜻입니다. — 참고로 문화일보와 서울신문은 항목별 분석에서 같은 갈래로 묶였지만, 실제로 고른 낱말은 "
        "이렇게 다릅니다. 이 화면은 분류가 아니라 낱말을 기준으로 나눴습니다.",
        "asked": [
            "상임위 자리 배분이 왜 이런 충돌을 낳는지 — 여섯 건 모두 이번 일만 다룹니다.",
            "이 행동이 법적으로 무엇에 해당하는지 — 고발 요구는 실렸지만, 법률가의 설명은 없습니다.",
            "당사자 본인의 말 — 여섯 건 가운데 한 건에만 직접 발언이 실렸습니다.",
        ],
        "recommend_rule": "opposite_column",
    },
    3: {
        "slug": "issue-3",
        "headline": "경산 아파트 관리사무소 화재로 8명 사상 — 경찰, 방화로 보고 수사",
        "shape": "diverge",
        "question": "이 사건을 무엇의 사건으로 부르나",
        "sub": "네 기사 모두 70대 입주민이 불을 지른 것으로 보고 있습니다. 갈린 것은 이 사건을 ‘8명이 죽거나 다친 피해’로 "
        "두는지, ‘보복이었는지 가리는 문제’로 두는지입니다. 뒤쪽은 형량으로 이어집니다.",
        "columns": [
            ("‘8명이 죽거나 다친 피해’로 둔 곳", ["경향신문", "서울신문"]),
            ("‘보복이었는지 가리는 문제’로 둔 곳", ["국민일보", "한국일보"]),
        ],
        "spot": "보복 여부는 처벌 수위와 이어집니다. 한국일보 본문에는 징역·무기·사형 같은 처벌 어휘가 함께 등장합니다. "
        "같은 화재가 한쪽에서는 피해 사건으로, 다른 쪽에서는 형량 사건으로 놓입니다.",
        "asked": [
            "관리사무소와 입주민 사이 갈등이 왜 여기까지 왔는지 — 네 건 모두 이번 사건만 다룹니다.",
            "고소·신고를 한 사람을 보복에서 어떻게 보호하는지 — 그 절차를 다룬 기사는 없습니다.",
        ],
        "recommend_rule": "opposite_column",
    },
    4: {
        "slug": "issue-4",
        "headline": "권경애 변호사 손해배상, 화해 무산돼 판결로",
        "shape": "diverge",
        "question": "이 일을 뭐라고 부르나",
        "sub": "네 기사 모두 제목에 ‘노쇼’를 썼습니다. 그런데 본문에서 같은 일을 가리키는 말은 갈립니다. "
        "그리고 누구의 불복으로 이 일을 여는지도 둘로 나뉩니다.",
        "columns": [
            ("변호사의 잘못으로 여는 곳", ["조선일보", "국민일보"]),
            ("양측이 모두 거부해 재판으로 갔다고 여는 곳", ["중앙일보", "한국일보"]),
        ],
        "headline_terms": {
            "국민일보": "학폭 소송 노쇼",
            "조선일보": "학폭 재판 노쇼",
            "중앙일보": "학폭 재판 노쇼",
            "한국일보": "재판 노쇼",
        },
        "spot": "제목은 네 곳 모두 구어인 ‘노쇼’를 씁니다. 본문에서는 ‘불출석’(조선일보), ‘불성실한 소송 수행’(국민일보), "
        "‘재판 노쇼’(중앙일보·한국일보)로 갈립니다. 제목이 같아 보여도 본문의 무게는 다릅니다.",
        "asked": [
            "같은 일이 다시 생기지 않게 하는 장치 — 변호사 징계·감독 절차를 다룬 기사는 네 건에 없습니다.",
            "변호사 본인의 말 — 네 건 어디에도 직접 발언은 없습니다.",
        ],
        "recommend_rule": "opposite_column",
    },
    5: {
        "slug": "issue-5",
        "headline": "충북 음성 길거리 집단 싸움에서 흉기 사용 — 1명 사망, 1명 부상",
        "shape": "converge",
        # 국적을 첫 문장에 두는 것 자체가 이 사안에서 살펴볼 선택이라, 사실 문단에서는 뒤로 옮긴다.
        "what_override": "7월 26일 오전 3시쯤 충북 음성군 대소읍 길거리에서 10여 명이 뒤엉켜 싸웠다. "
        "이 과정에서 40대 남성이 흉기를 휘둘러 20대 남성이 숨졌고, 다른 1명도 다쳐 병원으로 옮겨졌다. "
        "40대 남성은 인근 주거지로 달아났다가 1시간여 만에 붙잡혀 살인 등 혐의로 음성경찰서 조사를 받고 있다. "
        "숨진 사람과 붙잡힌 사람은 같은 나라에서 온 외국인이다 — 네 기사는 모두 이 사실을 제목에 올렸고, "
        "그 선택은 아래에서 따로 본다.",
        "common_note": {"왜 이렇게 됐다고 했나": "← 분류로는 같지만 문장은 갈립니다. 아래에서 봅니다."},
        "question": "이 정보는 어디서 나왔나",
        "sub": "네 기사는 사실상 같은 기사입니다. 정보가 한 곳에서 나왔고, 제목이 고른 단어도 같습니다. "
        "그래서 이 사안의 발견은 차이가 아니라 수렴입니다.",
        "banners": [
            ("4건 / 4건", "정보 출처가 경찰입니다. 당사자·목격자·주민의 목소리는 어느 기사에도 없습니다."),
            ("4건 / 4건", "제목에 ‘외국인’이 들어갑니다. 서울신문은 제목 한 줄에 두 번 씁니다."),
            ("4건 / 4건", "제목에 ‘패싸움’을 씁니다. 이 단어를 고르지 않은 기사는 없습니다."),
        ],
        "tag_field": None,
        "tag_note": None,
        "sentence_block": {
            "title": "분류로는 ‘네 곳이 같음’, 문장으로는 갈립니다",
            "lead": "여섯 항목 가운데 ‘왜 이렇게 됐다고 했나’는 네 기사가 모두 같은 갈래로 묶입니다. "
            "그런데 실제로 쓴 문장은 이렇게 다릅니다. 우발이냐 계획이냐가 갈립니다.",
            "dim": "causal_attribution",
            "foot": "괄호 안은 그 서술의 출처 처리 방식입니다. 두 기사는 출처를 밝히지 않은 ‘전해졌다’로 처리했습니다.",
        },
        "asked": [
            "왜 그 지역에서 이런 일이 생기는지 — 네 건 모두 이번 사건만 다룹니다. 분석 기록에도 "
            "“외국인 범죄나 치안 정책 등 구조적 맥락은 다루지 않는다”고 적혀 있습니다.",
            "국적이 이 사건의 원인과 어떤 관계인지 — 설명한 기사는 없는데, 네 곳 모두 제목 앞자리에 국적을 놓았습니다.",
        ],
        "recommend": None,
        "no_recommend": "네 기사는 사실상 같은 기사입니다. 하나 더 읽어도 관점이 늘지 않습니다. "
        "지금 알려진 내용이 경찰 발표 한 곳에서 나왔으니, 후속 수사 결과를 기다리는 편이 낫습니다.",
    },
}

VOICE_KO = {
    "direct_quote": "직접 인용",
    "indirect_source": "간접 인용",
    "journalist_narration": "기자 서술",
    "uncertain_quote": "출처를 밝히지 않은 전언",
}

INDEX_LINE = {
    1: "기사 7건에 실린 발언이 모두 한 진영에서 나왔습니다.",
    2: "‘폭력’과 ‘신체 접촉’ 사이에서 갈립니다.",
    3: "8명이 죽거나 다친 피해냐, 보복이었는지 가리는 문제냐.",
    4: "제목은 네 곳 모두 ‘노쇼’, 본문은 갈립니다.",
    5: "네 기사 모두 경찰 한 곳에서 나왔습니다.",
}


# ─────────────────────────────────────────────────────────── css

CSS = r"""
*{box-sizing:border-box}
:root{color-scheme:light;
 --paper:#f6f5f2; --card:#fff; --ink:#15181c; --ink2:#4a5158; --ink3:#767e86;
 --rule:#e0ddd6; --rule2:#c8c4ba; --mark:#1d4a6e; --wash:#eceae4;
 --g1:#1d4a6e; --g2:#1c6b5f; --g3:#8a4b1e; --g4:#5c3d84;
 --sans:"Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif;
 --mono:ui-monospace,"SF Mono",Consolas,monospace}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;
 --paper:#12141a; --card:#191d24; --ink:#e8eaee; --ink2:#a7b0ba; --ink3:#828b95;
 --rule:#262c35; --rule2:#3b444f; --mark:#8fbadd; --wash:#1e242d;
 --g1:#8fbadd; --g2:#5fc0ae; --g3:#d59a5f; --g4:#b49ae0}}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);
 font-size:16px;line-height:1.72;word-break:keep-all;-webkit-font-smoothing:antialiased}
a{color:var(--mark)}
.wrap{max-width:760px;margin:0 auto;padding:0 22px 96px}
.wide{max-width:960px;margin:0 auto;padding:0 22px}
.top{display:flex;justify-content:space-between;align-items:center;gap:14px;
 padding:18px 0;border-bottom:1px solid var(--rule);font-size:13px}
.top a{color:var(--ink2);text-decoration:none;font-weight:600}
.top a:hover{color:var(--mark)}
.kicker{font-size:12.5px;font-weight:700;letter-spacing:.06em;color:var(--ink3);margin:38px 0 10px}
h1{margin:0;font-size:clamp(23px,3.4vw,31px);line-height:1.34;letter-spacing:-.032em;font-weight:800}
.what{margin:18px 0 0;font-size:16.5px;line-height:1.8;color:var(--ink)}
details.gloss{margin:20px 0 0;border-top:1px solid var(--rule);padding-top:14px}
details.gloss summary{cursor:pointer;font-size:13.5px;font-weight:700;color:var(--ink2);list-style:none}
details.gloss summary::-webkit-details-marker{display:none}
details.gloss summary::before{content:"＋ ";color:var(--ink3)}
details.gloss[open] summary::before{content:"− "}
details.gloss dl{margin:12px 0 0;display:grid;gap:10px}
details.gloss dt{font-size:14.5px;font-weight:700}
details.gloss dd{margin:2px 0 0;font-size:14px;color:var(--ink2)}

section{margin:52px 0 0}
.eyebrow{font-size:12.5px;font-weight:700;letter-spacing:.06em;color:var(--ink3);margin:0 0 12px}
h2{margin:0 0 8px;font-size:20px;font-weight:800;letter-spacing:-.028em}
.lead{margin:0 0 20px;font-size:15px;color:var(--ink2);max-width:44em}

.frame{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media (max-width:700px){.frame{grid-template-columns:1fr}}
.pane{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:18px 20px}
.pane.gone{background:transparent;border-style:dashed}
.pane h3{margin:0 0 12px;font-size:13.5px;font-weight:800;letter-spacing:.02em;color:var(--ink2)}
.pane ul{margin:0;padding:0;list-style:none;display:grid;gap:11px}
.pane li{font-size:14.5px;line-height:1.65}
.pane li b{display:block;font-size:12.5px;font-weight:700;color:var(--ink3);letter-spacing:.02em}
.pane.gone li{color:var(--ink2)}

.qbox{margin:56px 0 0;padding:34px 0 0;border-top:2px solid var(--ink)}
.qbox .q{margin:0;font-size:clamp(26px,4.6vw,40px);line-height:1.28;letter-spacing:-.04em;font-weight:800}
.qbox .qs{margin:16px 0 0;font-size:16px;line-height:1.78;color:var(--ink2);max-width:40em}

.banner{margin:26px 0 0;display:grid;gap:10px}
.brow{display:flex;gap:16px;align-items:baseline;background:var(--card);
 border:1px solid var(--rule);border-left:4px solid var(--mark);border-radius:8px;padding:14px 18px}
.brow b{flex:0 0 auto;font-family:var(--mono);font-size:17px;font-weight:800;letter-spacing:-.02em;color:var(--mark)}
.brow span{font-size:14.5px;line-height:1.62}
@media (max-width:560px){.brow{flex-direction:column;gap:4px}}

.cards{margin:26px 0 0;display:grid;gap:12px}
.card{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:16px 18px}
.card.on{border-color:var(--mark);box-shadow:0 0 0 1px var(--mark) inset}
.card .ch{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.card .ch b{font-size:15.5px;font-weight:800;letter-spacing:-.02em}
.card .ch .tag{font-size:12.5px;font-weight:700;color:var(--mark);background:var(--wash);
 border-radius:4px;padding:1px 8px}
.card .ttl{margin:8px 0 0;font-size:13.5px;color:var(--ink3);line-height:1.55}
.card .said{margin:9px 0 0;font-size:15px;line-height:1.7}
.card .meta{margin:10px 0 0;font-size:13px;color:var(--ink3)}
.card .go{margin:11px 0 0;font-size:13.5px;font-weight:700;display:inline-block}
.words{margin:9px 0 0;display:flex;flex-wrap:wrap;gap:6px}
.w{font-size:14px;font-weight:700;background:var(--wash);border-radius:5px;padding:2px 9px}
.w.q{font-style:normal}

.cols{margin:26px 0 0;display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.col{border:1px solid var(--rule);border-top:4px solid var(--cc);border-radius:10px;background:var(--card);
 padding:16px 18px}
.col h3{margin:0 0 4px;font-size:15px;font-weight:800;letter-spacing:-.02em;color:var(--cc)}
.col .who{font-size:13px;color:var(--ink3);margin:0 0 14px}
.col .item{padding:12px 0 0;border-top:1px solid var(--rule);margin-top:12px}
.col .item:first-of-type{border-top:0;margin-top:0;padding-top:0}
.col .item b{font-size:14.5px;font-weight:800}
.col .item .ttl{margin:5px 0 0;font-size:13px;color:var(--ink3);line-height:1.55}
.col .item .row{margin:7px 0 0;font-size:13.5px;color:var(--ink2)}
.col .item .row i{font-style:normal;color:var(--ink3)}
.col .item .go{margin:8px 0 0;font-size:13px;font-weight:700;display:inline-block}
.col .item.on{background:var(--wash);border-radius:8px;padding:12px 12px 12px;margin-left:-12px;margin-right:-12px}
.col .item.on b::after{content:" — 내가 읽은 기사";font-size:12px;font-weight:700;color:var(--mark)}
.card.on .ch b::after{content:" — 내가 읽은 기사";font-size:12px;font-weight:700;color:var(--mark)}

.spot{margin:22px 0 0;padding:16px 20px;background:var(--wash);border-radius:10px;
 font-size:15px;line-height:1.72}
.sent{margin:26px 0 0;background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:18px 20px}
.sent h3{margin:0 0 6px;font-size:16px;font-weight:800;letter-spacing:-.025em}
.sent p.l{margin:0 0 16px;font-size:14.5px;color:var(--ink2)}
.sent .s{padding:12px 0;border-top:1px solid var(--rule)}
.sent .s b{font-size:14px;font-weight:800}
.sent .s p{margin:4px 0 0;font-size:15px;line-height:1.7}
.sent .s em{font-style:normal;font-size:12.5px;color:var(--ink3)}
.sent .f{margin:14px 0 0;font-size:13px;color:var(--ink3)}

ol.asked{margin:22px 0 0;padding:0 0 0 1.4em;display:grid;gap:12px}
ol.asked li{font-size:15.5px;line-height:1.72}
.rec{margin:26px 0 0;background:var(--card);border:1px solid var(--rule2);border-radius:10px;padding:20px 22px}
.rec .h{font-size:12.5px;font-weight:700;letter-spacing:.06em;color:var(--ink3);margin:0 0 8px}
.rec b.n{font-size:19px;font-weight:800;letter-spacing:-.02em}
.rec p{margin:8px 0 0;font-size:15px;line-height:1.72}
.rec .cav{margin:12px 0 0;padding-top:12px;border-top:1px solid var(--rule);font-size:14px;color:var(--ink2)}
.rec.none{border-style:dashed}
.pick{margin:22px 0 0;display:flex;flex-wrap:wrap;gap:7px;align-items:center}
.pick .pl{font-size:13px;color:var(--ink3);margin-right:4px}
.pick button{font:inherit;font-size:13.5px;font-weight:700;color:var(--ink2);background:var(--card);
 border:1px solid var(--rule2);border-radius:20px;padding:5px 14px;cursor:pointer}
.pick button[aria-pressed=true]{background:var(--mark);border-color:var(--mark);color:var(--paper)}

.how{margin:56px 0 0;padding-top:22px;border-top:1px solid var(--rule);font-size:13.5px;color:var(--ink2)}
.how h2{font-size:15px;margin-bottom:10px}
.how ul{margin:0;padding-left:1.2em;display:grid;gap:8px}
.nav{margin:46px 0 0;display:flex;justify-content:space-between;gap:14px;font-size:14px;
 border-top:1px solid var(--rule);padding-top:20px}
.nav a{font-weight:700;text-decoration:none}
:focus-visible{outline:2px solid var(--mark);outline-offset:3px}

.ilist{margin:34px 0 0;display:grid;gap:12px}
.irow{display:block;background:var(--card);border:1px solid var(--rule);border-radius:10px;
 padding:18px 20px;text-decoration:none;color:inherit}
.irow:hover{border-color:var(--rule2)}
.irow .n{font-family:var(--mono);font-size:12.5px;font-weight:700;color:var(--ink3)}
.irow .q{margin:4px 0 0;font-size:19px;font-weight:800;letter-spacing:-.03em;color:var(--mark)}
.irow .e{margin:5px 0 0;font-size:14.5px;color:var(--ink)}
.irow .m{margin:8px 0 0;font-size:13px;color:var(--ink3)}
"""


def esc(s) -> str:
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def shell(title: str, body: str, wide: bool = False) -> str:
    return (
        "<!DOCTYPE html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        f"<title>{esc(title)}</title>\n<style>{CSS}</style>\n</head>\n<body>\n"
        f"{body}\n</body>\n</html>\n"
    )


def topbar(here: str) -> str:
    return (
        '<div class="wide"><div class="top"><a href="index.html">← 다섯 사안 목록</a>'
        f'<span style="color:var(--ink3)">{esc(here)}</span></div></div>'
    )


def gloss_block(terms) -> str:
    if not terms:
        return ""
    items = "".join(
        f"<dt>{esc(t['term'])}</dt><dd>{esc(t['gloss'])}</dd>" for t in terms
    )
    return (
        '<details class="gloss"><summary>모르는 낱말 풀이</summary>'
        f"<dl>{items}</dl></details>"
    )


def frame_block(issue, ed) -> str:
    # 질문이 통째로 가져가는 항목은 여기서 뺀다 — 같은 줄을 두 번 읽히지 않게.
    own = DIM_KO.get(ed.get("own_dim") or "")
    notes = ed.get("common_note") or {}
    items = []
    for q, v in issue["common"]:
        if q == own:
            continue
        note = notes.get(q)
        tail = f' <i style="font-style:normal;color:var(--mark)">{esc(note)}</i>' if note else ""
        items.append(f"<li><b>{esc(q)}</b>{esc(v)}{tail}</li>")
    common = "".join(items) or '<li style="color:var(--ink3)">공통으로 전한 항목이 없습니다</li>'
    absent = "".join(f"<li>{esc(x)}</li>" for x in issue["absent"])
    n = len(issue["articles"])
    return (
        "<section><p class=\"eyebrow\">함께 만든 틀</p>"
        f"<h2>기사 {n}건이 같게 전한 것, 그리고 어디에도 없는 것</h2>"
        "<p class=\"lead\">기사가 무엇을 보이게 하는지와 무엇을 안 보이게 하는지가 함께 사건의 인상을 만듭니다. "
        "그래서 두 목록을 나란히 둡니다. 왼쪽은 모두 같게 전한 것이고, 오른쪽은 이 기사들에 없는 것입니다.</p>"
        f'<div class="frame"><div class="pane"><h3>모두 같게 전했습니다</h3><ul>{common}</ul></div>'
        f'<div class="pane gone"><h3>이 기사들에 없습니다</h3><ul>{absent}</ul></div></div></section>'
    )


def article_card(a, tag: str = "", said: str = "", extra: str = "") -> str:
    tag_html = f'<span class="tag">{esc(tag)}</span>' if tag else ""
    said_html = f'<p class="said">{esc(said)}</p>' if said else ""
    roles = " · ".join(a["roles"]) or "명시된 취재원 없음"
    return (
        f'<article class="card" data-outlet="{esc(a["label"])}">'
        f'<div class="ch"><b>{esc(a["label"])}</b>{tag_html}</div>'
        f'<p class="ttl">{esc(a["title"])} <span style="opacity:.7">· {esc(a["published"])}</span></p>'
        f"{said_html}{extra}"
        f'<p class="meta">인용된 취재원 유형: {esc(roles)}</p>'
        f'<a class="go" href="{esc(a["url"])}" target="_blank" rel="noopener">원문 보기 ↗</a>'
        "</article>"
    )


def render_converge(issue, ed) -> str:
    banners = "".join(
        f'<div class="brow"><b>{esc(n)}</b><span>{esc(t)}</span></div>'
        for n, t in ed["banners"]
    )
    cards = []
    for a in issue["articles"]:
        tag = ""
        if ed.get("tag_field"):
            fam = (a["dims"].get(ed["tag_field"]) or {}).get("frame_family")
            tag = ed["tag_map"].get(fam, ed["tag_map"].get(None, ""))
        said = (a["dims"].get("actor_visibility") or {}).get("value") or ""
        cards.append(article_card(a, tag=tag, said=said))
    note = (
        f'<p class="lead" style="margin:26px 0 0">{esc(ed["tag_note"])}</p>'
        if ed.get("tag_note")
        else ""
    )
    sent = ""
    sb = ed.get("sentence_block")
    if sb:
        rows = []
        for a in issue["articles"]:
            d = a["dims"].get(sb["dim"]) or {}
            if not d.get("value"):
                continue
            voice = VOICE_KO.get(d.get("voice_kind"), "")
            rows.append(
                f'<div class="s"><b>{esc(a["label"])}</b>'
                f'<p>{esc(d["value"])}<br><em>({esc(voice)})</em></p></div>'
            )
        sent = (
            f'<div class="sent"><h3>{esc(sb["title"])}</h3><p class="l">{esc(sb["lead"])}</p>'
            + "".join(rows)
            + f'<p class="f">{esc(sb["foot"])}</p></div>'
        )
    return (
        f'<div class="qbox"><h2 class="q">{esc(ed["question"])}?</h2>'
        f'<p class="qs">{esc(ed["sub"])}</p></div>'
        f'<div class="banner">{banners}</div>{sent}{note}'
        f'<div class="cards">{"".join(cards)}</div>'
    )


def render_diverge(issue, ed) -> str:
    by_outlet = {a["outlet"]: a for a in issue["articles"]}
    cols = []
    for i, (name, outlets) in enumerate(ed["columns"]):
        items = []
        for o in outlets:
            a = by_outlet[o]
            hterm = (ed.get("headline_terms") or {}).get(o)
            rows = []
            if hterm:
                rows.append(f'<p class="row"><i>제목이 부른 이름</i> {esc(hterm)}</p>')
            if a["terms"]:
                rows.append(
                    '<p class="row"><i>본문이 부른 이름</i> '
                    + " · ".join(f"‘{esc(t)}’" for t in a["terms"])
                    + "</p>"
                )
            items.append(
                f'<div class="item" data-outlet="{esc(a["label"])}"><b>{esc(a["label"])}</b>'
                f'<p class="ttl">{esc(a["title"])}</p>{"".join(rows)}'
                f'<a class="go" href="{esc(a["url"])}" target="_blank" rel="noopener">원문 보기 ↗</a></div>'
            )
        cols.append(
            f'<section class="col" style="--cc:var(--g{i % 4 + 1})"><h3>{esc(name)}</h3>'
            f'<p class="who">{esc(" · ".join(outlets))}</p>{"".join(items)}</section>'
        )
    spot = f'<div class="spot">{esc(ed["spot"])}</div>' if ed.get("spot") else ""
    return (
        f'<div class="qbox"><h2 class="q">{esc(ed["question"])}?</h2>'
        f'<p class="qs">{esc(ed["sub"])}</p></div>'
        f'<div class="cols">{"".join(cols)}</div>{spot}'
    )


def recommend_block(issue, ed) -> str:
    if ed.get("no_recommend"):
        return (
            '<section><p class="eyebrow">더 읽을 가치가 있나</p>'
            '<h2>없습니다</h2>'
            f'<div class="rec none"><p>{esc(ed["no_recommend"])}</p></div></section>'
        )
    if ed.get("recommend"):
        r = ed["recommend"]
        cav = f'<p class="cav">{esc(r["caveat"])}</p>' if r.get("caveat") else ""
        return (
            '<section><p class="eyebrow">더 읽을 가치가 있나</p>'
            "<h2>하나만 더 읽는다면</h2>"
            f'<div class="rec"><p class="h">추천</p><b class="n">{esc(r["label"])}</b>'
            f'<p>{esc(r["why"])}</p>{cav}</div></section>'
        )
    # 갈래가 있는 사안: 내가 읽은 기사를 고르면 반대편 한 건을 지목한다.
    picks = []
    for name, outlets in ed["columns"]:
        for o in outlets:
            picks.append(o)
    chips = "".join(
        f'<button type="button" aria-pressed="false" data-o="{esc(o)}">{esc(o)}</button>'
        for o in picks
    )
    pairs = {}
    for i, (name, outlets) in enumerate(ed["columns"]):
        other = [
            (n2, os2) for j, (n2, os2) in enumerate(ed["columns"]) if j != i
        ]
        target_name, target_outlets = max(other, key=lambda x: len(x[1]))
        for o in outlets:
            pairs[o] = {"pick": target_outlets[0], "group": target_name}
    return (
        '<section><p class="eyebrow">더 읽을 가치가 있나</p>'
        "<h2>하나만 더 읽는다면</h2>"
        '<p class="lead">읽은 기사를 고르면, 같은 사건을 다른 이름으로 쓴 기사 한 건을 지목합니다.</p>'
        f'<div class="pick"><span class="pl">내가 읽은 기사</span>{chips}</div>'
        '<div class="rec" id="rec"><p class="h">추천</p>'
        '<b class="n" id="recName">위에서 읽은 기사를 골라 주세요</b>'
        '<p id="recWhy">고르면 그 기사와 다른 쪽에 선 기사를 한 건만 지목합니다.</p></div>'
        f"<script>var PAIRS={json.dumps(pairs, ensure_ascii=False)};"
        "document.querySelectorAll('.pick button').forEach(function(b){"
        "b.addEventListener('click',function(){"
        "document.querySelectorAll('.pick button').forEach(function(x){x.setAttribute('aria-pressed','false')});"
        "b.setAttribute('aria-pressed','true');"
        "var o=b.dataset.o,p=PAIRS[o];"
        "document.getElementById('recName').textContent=p.pick;"
        "document.getElementById('recWhy').textContent="
        "'\\u2018'+o+'\\u2019와 다른 쪽에 선 기사입니다. '+p.group+'에 속합니다. "
        "같은 사실을 다른 이름으로 쓴 기사를 한 건만 읽으면, 내가 읽은 기사가 고른 이름이 보입니다.';"
        "document.querySelectorAll('[data-outlet]').forEach(function(c){"
        "c.classList.toggle('on',c.dataset.outlet===o||c.dataset.outlet.indexOf(o)===0)});"
        "})});</script>"
        "</section>"
    )


HOW = """<div class="how"><h2>이 페이지가 만들어진 방법</h2><ul>
<li>기사 25건을 <b>AI 코더 2개</b>가 각각 여섯 항목으로 라벨링하고, 다른 모델이 불일치 항목만 다시 보고 확정했습니다.
사람 코더의 이중 코딩은 아직 하지 않았습니다. 그래서 이 결과는 검증을 마친 연구 결과가 아니라 초안입니다.</li>
<li>매체별 답은 <b>코딩된 요약 문장과 기사 제목</b>에서 왔습니다. 기사 본문 문장은 이 화면에 옮기지 않습니다.
확인은 각 기사의 원문 링크로 하십시오.</li>
<li><b>‘없습니다’는 그 기사에 해당 서술이 없다는 뜻</b>이고, 매체가 일부러 뺐다는 뜻이 아닙니다.</li>
<li>표본은 2026년 7월 26일 빅카인즈 상위 이슈에 묶인 <b>전국 종합일간지 기사</b>입니다.
방송·통신·경제지·지역지는 들어 있지 않아, 언론 전체의 경향으로 읽을 수 없습니다.</li>
<li>질문 한 줄, 회색 바탕 문단, ‘아무도 묻지 않은 것’은 위 코딩 결과를 근거로 <b>편집이 쓴 문장</b>입니다.
매체 수·기사 수·기사 제목·인용된 취재원 유형·지칭어·코딩 요약 문장은 <b>데이터에서 그대로</b> 옮겼습니다.</li>
</ul></div>"""


def render_issue(issue, ed) -> str:
    rank = issue["rank"]
    n = len(issue["articles"])
    outlets = len({a["outlet"] for a in issue["articles"]})
    body = render_converge(issue, ed) if ed["shape"] == "converge" else render_diverge(issue, ed)
    asked = "".join(f"<li>{esc(x)}</li>" for x in ed["asked"])
    prev_ = f'<a href="issue-{rank - 1}.html">← {rank - 1}번 사안</a>' if rank > 1 else "<span></span>"
    next_ = f'<a href="issue-{rank + 1}.html">{rank + 1}번 사안 →</a>' if rank < 5 else "<span></span>"
    return shell(
        f"{ed['question']}? — {ed['headline']}",
        topbar(f"{rank}번 사안")
        + '<div class="wrap">'
        + f'<p class="kicker">2026년 7월 26일 보도 · 기사 {n}건 · 매체 {outlets}곳</p>'
        + f"<h1>{esc(ed['headline'])}</h1>"
        + f'<p class="what">{esc(ed.get("what_override") or issue["whatHappened"])}</p>'
        + gloss_block(issue["terms"])
        + frame_block(issue, ed)
        + "</div>"
        + f'<div class="wide">{body}</div>'
        + '<div class="wrap">'
        + '<section><p class="eyebrow">아무도 묻지 않은 것</p>'
        + f"<h2>이 기사 {n}건에 없는 질문</h2>"
        + f'<ol class="asked">{asked}</ol></section>'
        + recommend_block(issue, ed)
        + HOW
        + f'<div class="nav">{prev_}{next_}</div>'
        + "</div>",
    )


def render_index(issues) -> str:
    rows = []
    for rank in range(1, 6):
        ed = EDITORIAL[rank]
        issue = issues[rank]
        n = len(issue["articles"])
        outlets = len({a["outlet"] for a in issue["articles"]})
        rows.append(
            f'<a class="irow" href="{ed["slug"]}.html">'
            f'<span class="n">{rank}번 사안</span>'
            f'<p class="q">{esc(ed["question"])}?</p>'
            f'<p class="e">{esc(INDEX_LINE[rank])}</p>'
            f'<p class="m">{esc(ed["headline"])} · 기사 {n}건 · 매체 {outlets}곳</p></a>'
        )
    return shell(
        "같은 날 같은 사건 — 2026년 7월 26일",
        '<div class="wrap">'
        '<p class="kicker">2026년 7월 26일 보도 · 기사 25건 · 전국 종합일간지</p>'
        "<h1>한 기사만 읽으면 무엇을 놓치나</h1>"
        '<p class="what">그날 가장 많이 보도된 다섯 사안을 골라, 사안마다 질문 하나씩을 뽑았습니다. '
        "질문은 기사별 분석 결과에서 실제로 갈린 지점, 또는 예외 없이 같았던 지점에서 나왔습니다. "
        "사안마다 발견의 종류가 달라서 화면 모양도 다릅니다.</p>"
        f'<div class="ilist">{"".join(rows)}</div>'
        '<div class="how"><h2>읽는 법</h2><ul>'
        "<li>각 사안은 <b>질문 하나</b>로 되어 있습니다. 분석 방법 이름은 알 필요가 없습니다.</li>"
        "<li>먼저 <b>기사들이 같게 전한 것과 어디에도 없는 것</b>을 봅니다. "
        "기사가 다루지 않은 쪽이 사건의 인상을 절반쯤 만듭니다.</li>"
        "<li>마지막 칸은 <b>하나만 더 읽는다면 무엇을 읽을지</b>입니다. 더 읽어도 늘지 않는 사안은 그렇다고 말합니다.</li>"
        "<li>방법별 상세 결과(기사 묶음 군집·정책 분류표·낱말 연결망·형태소 분석)는 이 화면에 넣지 않았습니다. "
        "표본이 하루치라 사안별로 안정적이지 않아 연구자용 화면으로 분리했습니다.</li>"
        "</ul></div></div>",
    )


def main() -> int:
    data_root = Path(sys.argv[1]) if len(sys.argv) > 1 else find_data()
    if data_root is None or not (data_root / "workflow-result.json").is_file():
        print(f"분석 산출물을 찾을 수 없습니다 ({RUN_DIR}). 경로를 인자로 넘겨 주세요.", file=sys.stderr)
        return 1
    issues = load(data_root)
    written = []
    for rank in range(1, 6):
        path = HERE / f"{EDITORIAL[rank]['slug']}.html"
        path.write_text(render_issue(issues[rank], EDITORIAL[rank]), encoding="utf-8")
        written.append(path)
    index = HERE / "index.html"
    index.write_text(render_index(issues), encoding="utf-8")
    written.append(index)
    for p in written:
        print(f"{p.name:16s} {p.stat().st_size:>7,} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
