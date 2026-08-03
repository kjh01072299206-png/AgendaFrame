# 이중 코더 라벨링 워크시트 (착수: 2026-08-03)

`../manifest.jsonl`(잠금 holdout 27건·13개 사례)에서 생성한 코더용 작업 파일입니다.
코드북은 [`../codebook-v1.0.0.md`](../codebook-v1.0.0.md)를 따릅니다.

## 파일

- `coder-A.csv` — 코더 A 전용. 코더 B와 상의 없이 독립적으로 작성합니다.
- `coder-B.csv` — 코더 B 전용. 동일 조건.

두 파일은 내용이 같은 빈 양식입니다. 각 코더는 자기 파일만 편집하고, 상대
파일이나 라벨을 보지 않습니다.

## 작성 규칙

1. `url`의 원문을 직접 확인한 뒤 작성합니다.
2. `same_event`: `same_event` / `related_different_event` / `uncertain` 중 하나.
3. 프레임 6개 열(`problem_definition` ~ `actor_visibility`): `supported` /
   `conflicting` / `explicit_not_stated` 중 하나.
4. `supported`·`conflicting`로 판정한 차원은 `evidence_locators`에
   `차원=paragraph:N;sentence:M` 형식으로 기록합니다(여러 개는 `|`로 구분).
   `voice_kind`는 `journalist_narration` / `direct_quote` / `indirect_source` /
   `uncertain_quote` 중 해당 값.
5. `reason`은 판단 근거를 코더 자신의 새 문장으로 씁니다. **기사 문장을
   복사해 붙여넣지 않습니다.** 원문 문장·HTML·스크린샷은 어떤 파일에도 넣지
   않습니다.

## 완료 후 절차

1. 두 코더 제출 → adjudicator가 불일치를 해결하고 사유·코드북 버전을 기록.
2. 확정 라벨을 `../manifest.jsonl`의 `annotation.labels`에 반영하고
   `annotator_ids`, `status`, `agreement`, `adjudicated`를 갱신.
3. 검증: `python scripts/validate_holdout_annotations.py evals/holdout/manifest.jsonl`
4. 일치도 보고서를 작성한 뒤 `python scripts/release_gate.py`로 통과 여부 확인.

## 주의 — 이용 근거(라이선스)

manifest의 `license_basis`가 아직 `pending_confirmation`입니다. 퍼블리셔·데이터
제공자의 이용 허락 또는 적법한 연구 근거가 기록되기 전에는 이 라벨을 출시
증거로 사용할 수 없습니다(내부 라벨링 준비까지만 가능). 라이선스 확정이
라벨링과 병행해야 할 선행 과제입니다.
