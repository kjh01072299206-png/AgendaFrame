# 언론사 비교·프레이밍 개선 검증 — 2026-10-03

전체 목표는 미완료다. 로컬 구현과 오프라인 검증, 저장 제목의 제한된 편집 검토를 수행했다. 새 외부 AI 본문 재분석과 공개 배포는 하지 않았다.

## 작업 기준과 변경 보존

- 루트 main HEAD dc831d97593f4d1d2f5192d53d0947b352e052b8의 기존 변경은 보존했다.
- 별도 후보 작업트리에서 최신 origin/main c75d753을 기준으로 codex/fine-grained-comparison-20261003을 만들었다. 이전 후보 HEAD 2a0d2ff를 최신 배포로 간주하지 않았다.
- 현재 공개 /version 읽기 확인: c75d753bbfde21768e69d5599ac8eacb46518cc9. 이번 변경의 커밋·배포 증거가 아니다.
- 커뮤니티·수집·랭킹·스케줄러는 수정하지 않았다. 공용 CSS의 모바일 메뉴 변경도 #sec-fine-comparison이 존재하는 두 분석 페이지에만 한정했다.
- evidence-first-workflow로 구현·실제 자료·로컬·공개 증거를 분리했다. impeccable 검토에서 구분선 토큰, 글자 크기 상속, 요약의 좁은 3열, 모바일 메뉴 높이를 수정했다.

## 제거한 병목

| 위치 | 이전 | 변경 |
|---|---|---|
| 기사 분석 지침·파서 | 차원별 설명 하나·160자·첫 항목만 보존 | 차원별 최대 8개의 독립 설명·900자·근거 최대 8개, 모든 항목 보존 |
| 종합 입력 | 기자 서술만 남김 | 인용·간접 전언·기자 서술을 발화 정보와 함께 보존 |
| 실제 모델 응답 스키마 | 분석 축 2개 × 항목 3개 | 핵심 축 5개 × 항목 6개; 별도 세밀 관측 8축·최대 24개 |
| 비교 상태 | 공통 핵심이면 세부 관측 소실, 루트 보류가 전체 차단 | 공통 핵심과 세부 관측 분리, 유효한 형제 항목 유지 |
| 근거 연결 | 공개 locator 연결만으로 채택 가능 | 기사/매체 매핑, 본문 해시, 실행·프롬프트·스키마, 지원 항목·발화 종류 검증 |
| 설명 표시 | 비교 문장이 기사마다 반복, 4기능 표 셀마다 첫 설명만 표시 | 기사 고유 의역, 유효한 설명 모두 기본 노출; 기술 ID·해시만 접음 |
| 화면 | 13.5px 설명, 좁은 3열 요약, 작은 링크 터치 영역 | 주요 설명 14.5–15px, 2열 요약, 44px 링크; 모바일 세로 A/B 설명 |

핵심 계약 comparison-v1.0.0과 기존 프로필의 버전·본문 해시는 바꾸지 않았다. 새 관측은 fine-comparison-v1.0.0이라는 추가 계약이다. 새 요청용 sentence-anchor-v1.3.0 및 event-synthesis-transport-v1.4.0을 등록했지만, 기존 응답이 이 버전으로 재실행됐다는 주장은 하지 않는다.

## 실제 저장 자료에서 확인한 전후 사례

### 2위: 건조 승인

이전 화면은 핵심 조치와 투자 조건 위주 비교로, 같은 핵심 안의 제목 초점을 자세한 독립 A/B 설명으로 제공하지 않았다.

수정 화면은 KBS 뉴스 c9cbff31423a96c117439ef5663bdfa4와 국민일보 a828f0bb6b754162dcfbf8f6f6ae733d의 저장 제목을 직접 대조했다. KBS는 승인과 최대 2척 규모를, 국민일보는 조치에 K조선 수혜 기대를 추가한다. 공통 조치·각 기사 설명·구체적 차이·중요도·해석 범위·제한을 별도 문단으로 보여 준다. 선박/군함 표현만으로 정책 대상 차이나 찬반 대립을 만들지 않는다.

### 5위: 재산분할 재상고

이전 원인 비교 obs-2는 세계일보 09825dacd9c1cbad99e8a68a3872447f와 중앙일보 fcc2203e3461734e9b1378589e8b4725에 뉴스1·국민일보라는 잘못된 이름을 붙였다. 해당 원인 비교를 제거·보류하고 editorial_quarantine에 원 응답과 사유·출처 실행을 보존했다. 실제 매체명으로 단순 치환해 검증된 본문 비교인 것처럼 만들지 않았다.

별도 제목 관측은 두 제목의 재산분할 불복·대법원 절차라는 공통 사실과 세계일보의 ‘세기의 이혼’ 추가 명명을 구분한다. 법리·상고 이유 대립 또는 이혼 당사자에 대한 매체 평가로 확대하지 않는다.

두 사례의 producer는 editorial-title-review이며 status는 expression_only다. 공개 프로필의 제목 지문은 단순 제목 해시가 아니라 SHA-256(`agendaframe:title:v2:{article_id}:{title}`)다. 오프라인 검토 스크립트에서 저장 제목으로 재계산해 일치 여부를 검증했다. 원문 링크와 저장된 발행 시점을 유지했으며, 정확한 원문 수집 시점은 이번 저장 자료로 확인하지 못했다. 이를 발행 시점이나 검토일로 대체하지 않았다. 새 본문·리드·반론·배치·주변 문맥은 확보하지 않았다.

## 검증 결과

- Python full: 단위·계약 236 통과, 기존 pilot 입력 부재 1 건너뜀; 통합·오프라인 E2E 3 통과. 의존성·평가 자산 검사 통과.
- 평가 상태는 synthetic_schema_only, model_quality_measured=false, release_eligible=false, 인간 holdout 미라벨이다. 통과 숫자를 모델 성능 개선이나 정상 운영 릴리스 자격으로 해석하지 않는다.
- site typecheck 및 Next production build 통과. ESLint 오류 0, 범위 밖 기존 경고 4.
- 분석 회귀 54 통과; initial-five/community 계약 17 통과; 페이지·live 품질·active snapshot 계약 25 통과.
- 합성 회귀는 8축의 자료 계약, 해시·버전·ID·매체·발화 오류, 중복 설명, 입력 잘림의 부재 주장 차단을 검증한다. 실제 미세 차이 발견 정확도, 오탐률, 주변 문맥 해석 성능을 측정한 자료는 아니다.
- 전체 렌더: 최종 계약 연결 수정까지 포함해 26경로 × 5조건, 139초; 첫 화면 측정 10개·모바일 상호작용 5개. error 0 / warn 0 / waived 0. 최신 검증 주소는 localhost:4194이며 결과 파일은 tmp/render-fine-20261003.json. 터치 영역·첫 화면·기존 잘못된 매체 비교·내부 메뉴 폭 문제를 수정한 뒤 재검사했으며 실패 결과를 통과로 처리하지 않았다.
- 화면 비교: 원본 시안, 이전 공개 화면, 수정 로컬 화면을 1440×900 및 390×844에서 상·중·하로 72장 저장. 비교 대상 로컬 이슈 1·2·5는 보류·공통 핵심·제목 관측 상태를 포함한다. 전체 가로 넘침 0. 자세한 본문·목차는 길게 이어지므로 주요 영역은 상단에, 전체 내용은 아래에 둔다.

## 화면 증거

화면은 같은 작업트리의 tmp/fine-screen-comparison-20261003에 있다. metrics.json이 화면별 상태·높이·글자 크기를 기록한다. 원본의 가상 기사·정치 구도를 서비스 데이터로 복사하지 않았다.

| 구분 | PC 상단 | 모바일 중간 |
|---|---|---|
| 원본 언론사 비교 | prototype-1-outlets-1440-top.png | prototype-1-outlets-390-middle.png |
| 수정 언론사 비교 | local-2-outlets-1440-top.png | local-2-outlets-390-middle.png |
| 원본 프레이밍 | prototype-1-framing-1440-top.png | prototype-1-framing-390-middle.png |
| 수정 프레이밍 | local-2-framing-1440-top.png | local-2-framing-390-middle.png |

동일한 이름에서 top/middle/bottom을 바꿔 각 위치를 확인할 수 있다. baseline-2 및 baseline-5는 이번 실행 중 실제 공개 페이지를 읽어 저장한 이전 화면이다. 수정 화면은 localhost:4194의 로컬 결과이지 공개 서비스가 아니다. 기존 4193 서버의 작업 핸들이 없어 새 포트에서 최신 빌드를 실행했다.

빠른 화면 링크:

- [원본 언론사 비교 PC](C:/Users/강준혁/Desktop/구글캡디_문서/.codex-worktrees/comparison-framing-release-20261001/tmp/fine-screen-comparison-20261003/prototype-1-outlets-1440-top.png) · [수정 언론사 비교 PC](C:/Users/강준혁/Desktop/구글캡디_문서/.codex-worktrees/comparison-framing-release-20261001/tmp/fine-screen-comparison-20261003/local-2-outlets-1440-top.png)
- [원본 프레이밍 PC](C:/Users/강준혁/Desktop/구글캡디_문서/.codex-worktrees/comparison-framing-release-20261001/tmp/fine-screen-comparison-20261003/prototype-1-framing-1440-top.png) · [수정 프레이밍 PC](C:/Users/강준혁/Desktop/구글캡디_문서/.codex-worktrees/comparison-framing-release-20261001/tmp/fine-screen-comparison-20261003/local-2-framing-1440-top.png)
- [수정 언론사 비교 모바일 설명](C:/Users/강준혁/Desktop/구글캡디_문서/.codex-worktrees/comparison-framing-release-20261001/tmp/fine-screen-comparison-20261003/local-2-outlets-390-middle.png) · [수정 프레이밍 모바일 설명](C:/Users/강준혁/Desktop/구글캡디_문서/.codex-worktrees/comparison-framing-release-20261001/tmp/fine-screen-comparison-20261003/local-2-framing-390-middle.png)
- [세계일보·중앙일보 실제 제목 비교](C:/Users/강준혁/Desktop/구글캡디_문서/.codex-worktrees/comparison-framing-release-20261001/tmp/fine-screen-comparison-20261003/local-5-framing-1440-middle.png)

## 남은 조건

추가 계약 연결 검증: 서버가 rejected 목록으로 제외한 관측의 사유가 화면에서 사라지는 문제를 수정했다. impeccable의 오류 안내 지침에 따라 이유 코드를 한국어로 표시하고 유효한 A/B 설명을 유지한다. 오래된 run ID의 제외 기록은 현재 결과에 섞지 않는다. React 렌더 회귀에서도 이를 확인했다. 제목 선택 관측도 실제 AI 응답 계약에 title_selection/title_basis로 연결하고, 모델 입력에 기사 ID와 제목을 포함한 지문을 제공한다. 모델이 만든 임의 지문은 수용하지 않는다. 제목 지문의 변경·다른 축·기자 서술 오인 등 6개 경우와 실제 입력 전달을 합성 계약 테스트로 검증했으며 새 AI 실험을 한 것은 아니다.

1. 새 외부 AI는 명시적인 live opt-in, 비운영 프로젝트 지정/확인, 비용 제한 확인 이후에만 실행한다. 기존 최대 $10 승인이 있다고 운영 여부·새 호출 승인을 임의로 추정하지 않는다.
2. 본문 원문과 문맥을 확보해 실제 사례로 재분석하고 미세 관측의 발견·오탐·발화 오인·근거 연결을 검토해야 한다. 현재 실제 개선 사례는 제목 두 쌍에 한정된다.
3. 이전 데모 평가 예외는 지난 릴리스에만 적용됐으며 이후 릴리스 정책을 변경하지 않는다. 이번 예외 배포 승인은 별도로 요청했다.
4. 배포 시 reviewed immutable commit과 새 snapshot staging·health·rollback을 확인해야 한다. production live reader는 저장소 JSON과 별개의 현재 snapshot을 읽으므로 코드 배포만으로 새 데이터 배포를 주장할 수 없다.
5. 공개 /version의 새 SHA와 실제 두 화면을 확인하기 전까지 공개 배포 완료로 표시하지 않는다. 이번 작업은 아직 commit/push/PR/production promotion을 하지 않았다.

## 2026-10-04 재확인

사용자가 이후 “배포까ㅈ지 ㄱㄱ”라고 지시했다. 직전 답변의 평가 완료 전 데모 예외 배포 질문에 대한 승인으로 적용한다. 이번 비교·프레이밍 변경의 배포에만 정식 평가 자료 미완성 예외를 적용하며, 일반 품질 기준은 변경하지 않는다. 실제 본문 재분석은 이번 배포 범위에 포함하지 않는다. 새 모델 호출·비용 증가·프로젝트 변경을 하지 않고, 검토된 저장 제목 관측과 기존 본문 분석을 구분해 게시한다. 근거 계약·오프라인 full·화면·immutable staging·rollback·공개 SHA 검증은 예외가 아니다. 아래의 미승인·미배포 기록은 해당 승인 이전 상태다.

- 공개 /version을 다시 읽었으며 production SHA는 여전히 c75d753bbfde21768e69d5599ac8eacb46518cc9다. 이번 로컬 변경은 공개 배포되지 않았다.
- Google 프로젝트 project-40bc06fc-fb4b-46b6-a10의 읽기 전용 조회는 성공했고 lifecycleState는 ACTIVE다. labels는 반환되지 않았다. 이것은 Google 오류나 운영 프로젝트라는 증거가 아니며, 비운영 프로젝트 조건을 확인할 자료가 없다는 뜻이다.
- 기존 $10 비용 승인과 2026-10-01 데모 릴리스 한정 예외를 확인했다. 이번 새 AI 호출의 비운영 프로젝트 조건과 이번 릴리스 평가 예외를 임의로 승인된 것으로 처리하지 않았다.
- 기존 변경과 화면·검증 산출물은 보존했다. 이번 재확인에서 게이트 전체를 재실행하거나 AI·결제·배포 설정을 변경하지 않았다. 전체 목표는 미완료이며, 재개에는 테스트 프로젝트 지정 및 live 호출 확인이 필요하다. 실제 품질 평가를 끝내기 전에 배포하려면 이번 릴리스에 대한 별도 예외 승인이 필요하다.
