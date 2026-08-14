# AgendaFrame 인수인계 — 2026-08-15 목표 모드

다른 모델은 이 문서를 먼저 읽고 `AGENTS.md`와 `git status --short`를 확인한다.
이미 있는 코드를 다시 만들지 않는다. `git reset --hard`, `git checkout --`,
`git add -A` 금지. `docs/next-session-handoff.md`와 `.codex-*`, 로그, `outputs/`,
`.grok/`는 건드리지 않는다.

## 목표 (이것이 제품이다)

언론사 비교·프레이밍 화면은 “근거 있음/없음”이 아니다. 예시 HTML처럼
다음을 기사별 근거와 함께 보여야 한다.

- 같은 사건을 각 언론사가 어떤 문제로 잘랐는지
- 원인을 누구에게 돌리는지
- 책임 주체를 어떻게 배치하는지
- 평가어·강조어를 어떻게 쓰는지
- 어떤 취재원만 반복되는지
- 제도 문제·정치 공방·개인 책임 중 어디에 초점을 두는지
- 거부권·제도 보완·경고 등 대응이 어떻게 다른지

목표 문장 형태:

> A는 대통령의 침묵과 정치적 책임을 앞세웠고,
> B는 보완수사권 폐지에 따른 제도적 안전장치 약화를 앞세웠으며,
> C는 구체적 대응보다 정부·여당의 정치적 손실을 경고했다.

“A는 진보, B는 보수”는 금지. 규칙으로 화면만 흉내 내는 것도 금지.
다만 이미 코딩된 public paraphrase + locator + hash를 사건 단위로 묶는 것은
허용한다. Vertex는 그 문장을 더 자연스럽게 다시 쓸 수 있다.

## 지금 HEAD와 저장 상태

- 브랜치: `codex/initial-five-complete`
- 이전 종합 단계 커밋: `0b8f87d feat: add evidence-bound event synthesis`
- 이 슬라이스에서 추가한 것: 프로필 기반 사건 작성기 + rank-1 실데이터 회귀
- 사용량: 이 환경에서는 주간 사용량 퍼센트를 읽을 수 없다. 목표 슬라이스 하나를
  닫고 여기서 넘긴다. 호출 측에서 50% 잔여를 확인한 뒤 이어서 실행하면 된다.

## 완료된 제품 코드

### 근거 게이트 (`src/ai/event_synthesis.py`)

- `bind_event_synthesis`: 기사 ID + locator + 64-hex 해시가 프로필에 있는
  문장만 공개. 이념 라벨 차단. 캠프가 2개 미만이면 대립 구도 금지.
- `VertexEventSynthesizer`: 공개 프로필만 입력. SDK는 호출 시 lazy import.
- `compose_event_synthesis`: Vertex가 없거나 초안이 실패하면, 이미 코딩된
  프로필 패밀리로 캠프를 만든다. 새 본문을 만들지 않고 public paraphrase를
  재사용한다.
- `source_lens_from_profiles`: 취재원 역할 가시성 집계. 의도 판정 아님.

### 파이프라인 연결 (`src/backend/gcp_stage_adapters.py`)

순서: Vertex 종합 → 실패 시 프로필 작성기 → 둘 다 불능일 때만 옛 고정 문장.
`source_lens.by_outlet`은 더 이상 빈 배열로 두지 않는다.

### 화면

`site/app/(shell)/semantic-analysis-pages.tsx`의 `SynthesisNarrative`가
`comparison.data.synthesis`를 그린다. 라이브 모드에서만 이 경로를 탄다.
데모 이슈 페이지는 여전히 proto JSON을 쓴다.

### 실데이터 증명 (오프라인, 네트워크 없음)

`site/public/initial-five/issues/bigkinds-2026-07-26-top-*.json`에 대해
작성기를 돌리면:

| 이슈 | usable | 대립 | 캠프 |
| --- | --- | --- | --- |
| top-1 보완수사권 | 예 | 예 | 침묵·거부권 / 경고 / 제도 안전장치 **3개** |
| top-2 | 예 | 예 | 수사·책임 추궁 / 경고 |
| top-3 | 예 | 예 | 수사·책임 추궁 / 제도 안전장치 |
| top-4 | 예 | 아니오 | 0 (억지 대립 안 함) |
| top-5 | 예 | 아니오 | 0 (억지 대립 안 함) |

테스트: `tests/unit/test_event_synthesis.py`의
`test_composer_builds_three_camps_from_rank1_profiles`.

## 아직 완료가 아닌 것

- Vertex가 실제로 종합 문장을 쓴 성공 사례 없음
- 성공한 실시간 수집 canary 없음 (`vhs68` 취소). current snapshot 없음
- 공개 initial-five JSON 파일 자체는 아직 다시 쓰지 않았다. 대신 사이트 로더가
  `withEventSynthesis`로 런타임에 붙인다. 데모의 이슈·비교·프레이밍 화면에
  `SynthesisNarrative`가 붙는다.
- Cloud Run reader `/active` 외부 검증 없음
- Workflows / Scheduler / Vercel live env / main push 없음
- `release_eligible: false`

인프라 상태의 긴 기록은 `docs/continuation-handoff-20260814.md`.

## 다음 모델이 할 일 (우선순위)

1. `git status --short`로 시작하고 기존 dirty/untracked를 보존한다.
2. `powershell -NoProfile -File scripts/check.ps1 -Mode quick`로 오프라인 게이트를 한 번 돌린다.
3. GCP `comparison.data` now also carries HTML aliases (`camps`, `agreedLine`,
   `splitLine`, `soWhat`, `factRows`, `splitRows`, `whatHappened`) via
   `public_comparison_payload` / `build_bound_comparison`. Dummy
   `집계합니다` text is only the last-resort fallback when no evidenced
   profile can be composed.
4. Vertex event synthesis now sends a JSON schema and asks for the
   A/B/C split-line shape. Live Vertex success is still unproven; the
   offline rank-1 path already emits the three target camps.
5. 브라우저에서 `/issues/bigkinds-2026-07-26-top-1` `/outlets` `/framing`
   을 확인한다. 라이브 Vertex/canary는 승인 후에만.
5. **라이브는 승인 후에만:** `AGENDAFRAME_MAX_ARTICLES_PER_RUN=12` canary.
   성공 시에만 Workflows → Scheduler → reader 검증 → Vercel live env.
   Cloudflare cron과 GCP를 동시에 켜지 않는다.
6. Vertex 종합은 프로필 작성기를 대체할 수 있지만, 바인딩 게이트를 우회하면 안 된다.

## 이어서 실행할 프롬프트

```text
Read AGENTS.md and docs/continuation-handoff-20260815-goal.md.
Continue AgendaFrame on branch codex/initial-five-complete.
Preserve dirty/untracked files, especially docs/next-session-handoff.md.
Do not rebuild event synthesis binding or the rank-1 composer.

Product goal: example-HTML event comparison (camps, shared/split lines,
four functions, proof rows) with article id + locator + hash on every
public sentence. Rank-1 offline composer already yields the three target
camps (veto/silence, institutional safeguard, warning-only).

Next: attach bound synthesis onto the public initial-five bundles or the
site loader without hand-editing huge JSON; keep no-forced-opposition;
do not call Vertex/GCP unless AGENDAFRAME_LIVE_TESTS=1 and a spend cap
is confirmed. Then, only with approval, run a 12-article canary.

Report changed files, exact tests, external calls (none unless authorized),
and the next task. Never claim live collection or HTML-complete production
without a published snapshot that contains synthesis.usable=true.
```
