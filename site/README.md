# AgendaFrame 서비스

22개 주요 종합일간지·경제매체·뉴스통신사의 실제 온라인 기사 메타데이터를 이슈로 묶고, 의제 점수·언론사별 보도량·프레임 분석·근거 리포트를 제공하는 웹 서비스입니다. TV 편성·영상 리포트와 온라인 기사 배열을 같은 기준으로 비교할 수 없어 방송사는 표본에서 제외합니다.

- 공개 서비스: https://agendaframe-capstone.vercel.app
- 관리자 화면: `/admin`
- 상위 문서: [프로젝트 README](../README.md)

## 현재 구현

- Next.js 16·React 19·TypeScript 사용자/관리자 화면
- BigKinds Excel·CSV 가져오기와 100건 단위의 본문·제공자 발췌 구조화 분석
- 39,023건 규모의 실제 기사 제목·원문 링크 조회, 검색, 필터, 페이지네이션
- 제목 토큰 유사도 기반 일일 이슈 클러스터링
- 최대 7일 기간 일괄 분석과 완료·실패·기사 없음 상태 조회
- 이미 완료된 날짜를 건너뛰는 중단 후 재개 실행
- 독립 미디어그룹 커버리지 45%·기사량 30%·관측된 배치 15%·동일 매체 후속 보도량 10%의 관측 의제성 점수. 관측되지 않은 성분은 제외하고 남은 가중치로 재정규화한 뒤 커버리지 계수를 곱한다(`worker/analysis.mjs`의 `weightedAgendaScore`)
- 문제 정의·원인·책임·평가·해법·취재원 구조와 기사별 근거 위치·비복원 해시
- 매체별 Policy Frames 다중 라벨 구성, 인용원 역할, 기자 서술 범위·평가 표현 비교
- 통제 어휘 기반 한국어 형태소 정규화, 품사·부정 표현·매체별 상위어 집계
- 두 문제 정의 그룹 사이의 이슈별 쟁점 지형과 근거 기반 읽기 리포트
- 시각·뷰포트·좌표를 보존하는 홈페이지 반복 배치 관측 API
- 공개 기사 본문을 Worker 메모리에서만 처리하고 전문·HTML·원문 문장을 남기지 않는 임시 분석
- 규칙 기반 관찰 리포트와 분석 한계 공개
- D1에 분석 실행·이슈·기사 연결·프레임·리포트 영속화
- 상위 50개 이슈의 사람 검토와 잘못 묶인 기사·누락 기사 영속화
- 검토 결과 기반 추정 정밀도·재현율·의제·프레임 동의율 산출

현재 분석 공급자는 `structured_extractive`, 저장소의 분석 모델 버전은 `agenda-structure-v6`, 구조화 엔진은 `korean-evidence-rules-v1`입니다. **라이브 `/api/health`는 아직 `agenda-structure-v5`를 돌려줍니다** — 화면은 Vercel에 최신으로 올라가 있지만 `/api/*`를 받는 레거시 워커를 v6으로 재배포하지 않았기 때문입니다(`docs/deploy.md` 참고). 공개 의제는 정치·경제·사회·국제를 우선하고 스포츠·생활·IT를 뒤에 배치하며, 공통 정책 개념이 확인된 기사 제목은 하나의 건조한 의제명 아래 묶습니다. 별도 유료 API를 호출하지 않습니다. BigKinds 파일에 본문 발췌가 있으면 가져오기 요청 안에서 분석하고 전문·발췌 원문을 저장하지 않으며, 발췌가 없으면 제목 단서로 제한합니다. 분석 공급자를 바꾸더라도 [`docs/public-api.schema.json`](docs/public-api.schema.json)의 공개 계약과 결과 계보를 유지하도록 설계했습니다. 자동 결과는 사람 검토 전 초안으로 표시합니다.

## 운영 순서

1. BigKinds 또는 이용 조건이 확인된 제공처에서 기간과 등록된 22개 매체를 선택해 Excel·CSV를 내려받습니다.
2. `/admin`에서 `IMPORT_TOKEN`을 입력하고 파일을 가져옵니다. `본문` 열이 있으면 100건씩 구조화 분석합니다. `분석제외 여부`가 `예외`, `중복`, `유효 URL 없음`처럼 명시적 제외 상태인 행만 건너뛰며 `본문 확보`는 분석합니다. 검증 범위를 줄일 때는 가져오기 스크립트의 `--date YYYY-MM-DD`를 사용합니다.
3. BigKinds 발췌가 없는 기사만 필요할 때 관리자 화면의 공개 기사 본문 분석을 실행합니다. 미처리 기사를 최대 20건의 안전 배치로 끝까지 이어서 처리하며, 공개 기사 HTML은 메모리에서 본문 단서를 추출한 직후 폐기됩니다.
4. 제목·배치 메타데이터만 다시 계산할 때는 하루 분석 또는 최대 7일 기간 분석을 실행합니다. 기간 분석은 완료된 날짜를 건너뜁니다.
5. 품질 검증에서 상위 이슈 30~50개를 검토하고 오류·누락 기사를 기록합니다.
6. 공개 화면에서 이슈와 원문 링크를 확인합니다.

기본 저장 범위는 제목, 원문 URL, 매체, 섹션, 게시·수집 시각, 확인된 홈페이지 배치 관측과 구조화된 프레임 단서입니다. 가져오기 행은 실제 범위에 따라 `본문 분석` 또는 `제공자 발췌 기반`으로 표시합니다. 자동 분석 경로는 기사 전문·발췌·HTML·원문 문장·토큰 순서를 D1, R2, 로그, 공개 API에 저장하지 않습니다. 형태소 공개 통계도 두 문서·두 독립 미디어그룹 이상에서 관측된 항목만 내보냅니다. 기사 이미지·댓글·회원 정보도 저장하지 않습니다. 정식 라이선스 자료를 별도 보관해야 할 때만 호환용 `POST /api/content`를 사용합니다. 자세한 기준은 [매체 표본과 수집 원칙](docs/source-panel.md)을 참고하세요.

대표 도메인은 빌드 환경의 `NEXT_PUBLIC_SITE_URL`로 설정할 수 있습니다. 커스텀 프록시 도메인에서 관리자 쓰기 API를 사용할 때는 정확한 출처를 `PUBLIC_ORIGINS`에 쉼표로 구분해 등록합니다. `agendaframe.com`과 `www.agendaframe.com`은 기본 신뢰 주소에 포함돼 있으며, 실제 사용 전 도메인 등록과 Vercel DNS 연결이 필요합니다.

## API

`/api/initial-five/*`와 `/version`은 Vercel의 Next 라우트 핸들러가 직접 응답하고, 나머지는 `next.config.ts`의 fallback rewrite로 레거시 워커 오리진에 넘어갑니다.

| 경로 | 용도 | 보호 |
| --- | --- | --- |
| `GET /version` | 배포된 커밋 SHA | 공개 |
| `GET /api/initial-five` | 7/26 상위 5개 의제 매니페스트 | 공개 |
| `GET /api/initial-five/issues/:id` | 의제 하나의 분석 번들 | 공개 |
| `POST /api/initial-five/ask` | 코딩된 분석 항목 기반 근거 응답(외부 모델 호출 없음) | 공개 |

| 경로 | 용도 | 보호 |
| --- | --- | --- |
| `GET /api/health` | 데이터·최근 분석 상태 | 공개 |
| `GET /api/sources` | 분석 대상 매체 | 공개 |
| `GET /api/articles` | 실제 기사 검색·필터 | 공개 |
| `GET /api/issues/dates` | 성공한 날짜별 의제 분석 목록 | 공개 |
| `GET /api/issues` | 최신 이슈 랭킹 | 공개 |
| `GET /api/issues/:id` | 이슈·기사·프레임·리포트 상세 | 공개 |
| `POST /api/import` | 기사 메타데이터 가져오기 | Bearer `IMPORT_TOKEN` |
| `POST /api/import/structured` | BigKinds 기사 메타데이터와 본문/제공자 발췌를 구분해 원문 미저장 구조화 분석 | Bearer `IMPORT_TOKEN` |
| `POST /api/observations/homepage` | 홈페이지 배치 관측 저장 | Bearer `IMPORT_TOKEN` |
| `POST /api/content` | 정식 라이선스 자료의 예외적 비공개 등록 | Bearer `IMPORT_TOKEN` |
| `GET /api/analyze/transient` | 날짜별 본문 분석 성공·실패·남은 기사 상태 | Bearer `IMPORT_TOKEN` |
| `POST /api/analyze/transient` | 미처리 공개 기사 본문을 재개 가능한 배치로 읽고 구조화 결과만 저장 | Bearer `IMPORT_TOKEN` |
| `POST /api/analyze` | 특정 KST 날짜 분석 생성 | Bearer `IMPORT_TOKEN` |
| `GET /api/analysis/runs` | 기간별 최신 분석·기사 상태 | Bearer `IMPORT_TOKEN` |
| `GET /api/quality` | 검증 목록·추정 품질 지표 | Bearer `IMPORT_TOKEN` |
| `GET /api/quality/reviews/:id` | 이슈별 기존 검토 결과 | Bearer `IMPORT_TOKEN` |
| `PUT /api/quality/reviews/:id` | 평가·오류·누락 기사 저장 | Bearer `IMPORT_TOKEN` |

추정 정밀도는 검토한 묶음 기사 중 관련 기사 비율, 추정 재현율은 관련 기사와 직접 등록한 누락 기사를 합친 값 중 시스템이 묶은 관련 기사 비율입니다. 두 지표 모두 정답 데이터셋 전체를 자동 측정한 값이 아니라 **사람 검토 기반 추정치**입니다.

## 로컬 실행과 검증

Node.js 22.13 이상이 필요합니다.

```bash
npm ci
npm run dev
```

```bash
npm exec tsc -- --noEmit
npm run lint
npm test
```

`npm run build`는 먼저 `data:build:initial-five`로 `public/initial-five` 산출물을 만든 뒤 Vite·vinext로 클라이언트와 Workers 호환 서버를 `dist/`에 빌드하고, 호스팅 정보와 Drizzle 마이그레이션을 함께 패키징합니다. 실배포는 Vercel이며 `main`에 push하면 자동으로 올라갑니다. 절차와 관문은 [`docs/deploy.md`](../docs/deploy.md)를 보십시오. 비밀값과 서비스 계정 파일은 저장소에 커밋하지 않습니다.
