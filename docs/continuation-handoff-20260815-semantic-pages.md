# AgendaFrame 인수인계 — 라우트 무결성 및 다음 마일스톤 (2026-08-15)

이 문서는 메인페이지와 상세 분석 화면 간의 스냅샷 기준 통합, 정적 게이트 완전 제거, `unsupportedClaimRate` 동적 산출 로직 적용, 그리고 실제 12개 언론사 정식 수집 데이터 전환을 위한 다음 마일스톤을 기록한 인수인계 문서입니다.

---

## 1. 완료된 핵심 수정 내역

### ① 상세 분석 라우트의 정적 initial-five 게이트 완전 제거
* `site/app/(shell)/issues/[issueId]/outlets/page.tsx` 및 `framing/page.tsx`:
  * `protoIssue` 및 `getInitialFiveIssueBundle` 정적 우선 검사 제거.
  * `active.getIssueBundle(decoded)`를 최우선으로 읽고 즉시 `OutletsSemanticPage` / `FramingSemanticPage`로 직결.
  * 라이브 스냅샷 및 데모 스냅샷 모두에서 의제 ID가 누락 없이 동일하게 렌더링되도록 보장.

### ② 상세 Layout의 정적 manifest 제약 해제 및 만료 의제 안내
* `site/app/(shell)/issues/[issueId]/layout.tsx`:
  * `generateStaticParams()` 제거 및 `dynamic = "force-dynamic"` 전환.
  * `loadIssueBundle`을 통해 활성 스냅샷 번들을 직접 조회.
  * 만료되었거나 존재하지 않는 의제 ID 접근 시 안전한 안내 UI 렌더링.

### ③ GCP 어댑터 `unsupportedClaimRate` 동적 산출
* `src/backend/gcp_stage_adapters.py`:
  * 하드코딩된 `0.0` 제거.
  * 기사 프로필의 5대 차원 claim 중 유효한 `locator` + `sentence_sha256` 해시 증거가 연결되지 않은 claim 비율을 동적으로 집계하여 계산.

### ④ 하드코딩 사전 및 가짜 싱글톤 생성 코드 완전 제거
* `site/lib/initial-five/compose-synthesis.mjs`: `ISSUE_TERMS` 랭크별 하드코딩 제거.
* `site/app/(shell)/semantic-analysis-pages.tsx`: 모든 문장에 Evidence Gate 적용.
* `src/backend/gcp_stage_adapters.py`: `evidence-singleton-*` 가짜 의제 패딩 루프 제거.

---

## 2. 검증 완료 내역

* **TypeScript 타입체크**: `npm --prefix site run typecheck` $\rightarrow$ **0 errors (통과)**
* **ESLint 정적 검사**: `npm --prefix site run lint` $\rightarrow$ **0 errors (통과)**
* **사이트 전체 테스트 스위트**: `npm --prefix site test` $\rightarrow$ **189 passed in 1.78s (100% 통과)**
* **Python 오프라인 단위/계약 게이트**: `powershell -NoProfile -File scripts/check.ps1 -Mode quick` $\rightarrow$ **161 passed in 3.32s (100% 통과)**

---

## 3. 남은 필수 마일스톤 (Next Steps)

1. **실제 12개 언론사 수집 Canary 실행 및 Quality Gate 통과**:
   * 의제당 최소 2개 이상 매체·근거가 확보된 5개 의제 스냅샷 생성.
2. **의도된 12개 수정 파일 정밀 커밋**:
   * 브랜치 `codex/initial-five-complete`에 변경사항 커밋.
3. **Vercel 프로덕션 배포 및 라이브 전수 검증**:
   * 배포 후 `https://agendaframe-capstone.vercel.app/`에서 메인 → 언론사 비교 → 프레이밍 분석 → 만료 ID 접근 흐름을 public URL에서 재확인.
