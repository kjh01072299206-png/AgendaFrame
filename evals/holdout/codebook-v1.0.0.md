# AgendaFrame 라벨링 코드북 v1.0.0

코더는 기사 원문을 직접 확인하고 아래 항목을 독립적으로 기록합니다. 기사 문장은 저장하지 않고 문단·문장 위치와 비복원 해시만 남깁니다.

## 1. 사건 동일성

- `same_event`: 핵심 행위·대상·시점이 같은 사건
- `related_different_event`: 같은 의제이지만 발표·반응·후속 조치가 다른 사건
- `uncertain`: 원문만으로 판정하기 어려움

## 2. 프레임 차원

각 차원은 `supported`, `conflicting`, `explicit_not_stated` 중 하나입니다.

- `problem_definition`: 무엇을 핵심 문제로 규정하는가
- `causal_attribution`: 왜 발생했다고 설명하는가
- `responsibility_attribution`: 책임을 누구에게 귀속하는가
- `evaluation`: 행위·상태를 어떻게 평가하는가
- `treatment_recommendation`: 어떤 대응·해법을 제시하는가
- `actor_visibility`: 누구의 목소리가 등장하거나 미관측되는가

`explicit_not_stated`는 “기사에 없다”가 아니라, 이용 가능한 본문에서 해당 판단을 직접 뒷받침하는 서술을 확인하지 못했다는 뜻입니다.

## 3. 증거 기록

각 `supported` 또는 `conflicting` 라벨에는 다음을 기록합니다.

```json
{
  "article_id": "원문 식별자",
  "locator": "paragraph:4;sentence:2",
  "evidence_hash": "문장 비복원 SHA-256",
  "voice_kind": "journalist_narration|direct_quote|indirect_source|uncertain_quote"
}
```

원문 문장·HTML·스크린샷은 라벨 파일에 넣지 않습니다. `reason`은 판단 근거를 코더가 새 문장으로 기록합니다.

## 4. 합의와 출시

코더 A/B가 독립 라벨을 제출한 뒤 adjudicator가 불일치를 해결합니다. 사례별 `adjudicated: true`, 일치도 보고서 경로와 코드북 버전을 기록하고, 이용 근거가 확인된 잠금 holdout만 `release_gate.py`에 통과시킵니다.
