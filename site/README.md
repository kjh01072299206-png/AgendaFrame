# AgendaFrame 서비스

5개 전국 종합일간지의 실제 기사 메타데이터를 이슈로 묶고, 의제 점수·언론사별 보도량·6종 프레임·근거 리포트를 제공하는 React 대시보드입니다.

- 공개 서비스: https://agendaframe-capstone.kjh01072299206.chatgpt.site
- 관리자 화면: `/admin`
- 상위 문서: [프로젝트 README](../README.md)

## 현재 구현

- Next.js 16·React 19·TypeScript 사용자/관리자 화면
- BigKinds Excel·CSV 가져오기와 500건 단위 저장
- 19,999건 규모의 실제 기사 제목·원문 링크 조회, 검색, 필터, 페이지네이션
- 제목 토큰 유사도 기반 일일 이슈 클러스터링
- 최대 7일 기간 일괄 분석과 완료·실패·기사 없음 상태 조회
- 이미 완료된 날짜를 건너뛰는 중단 후 재개 실행
- 언론사 커버리지 35%·관측된 배치 30%·기사량 20%·동일 매체 후속 보도량 15%의 관측 의제성 점수
- 갈등·책임·경제·법·정책·시민 영향 프레임 및 근거 제목
- 규칙 기반 관찰 리포트와 분석 한계 공개
- D1에 분석 실행·이슈·기사 연결·프레임·리포트 영속화
- 상위 50개 이슈의 사람 검토와 잘못 묶인 기사·누락 기사 영속화
- 검토 결과 기반 추정 정밀도·재현율·의제·프레임 동의율 산출

현재 분석 공급자는 `rules_local`, 모델 버전은 `agenda-rules-v2`입니다. 별도 유료 API를 호출하지 않습니다. 분석 공급자를 바꾸더라도 [`docs/public-api.schema.json`](docs/public-api.schema.json)의 공개 계약과 결과 계보를 유지하도록 설계했습니다. 본문 근거가 없는 비교·취재원·기사 추천은 생성하지 않습니다.

## 운영 순서

1. BigKinds에서 기간과 한겨레·경향신문·한국일보·중앙일보·조선일보를 선택해 Excel을 내려받습니다.
2. `/admin`에서 `IMPORT_TOKEN`을 입력하고 파일을 가져옵니다.
3. 같은 화면에서 하루 분석 또는 최대 7일 기간 분석을 실행합니다. 기간 분석은 완료된 날짜를 건너뜁니다.
4. 품질 검증에서 상위 이슈 30~50개를 검토하고 오류·누락 기사를 기록합니다.
5. 공개 화면에서 이슈와 원문 링크를 확인합니다.

저장 범위는 제목, 원문 URL, 매체, 섹션, 게시·수집 시각, 확인된 홈페이지 배치·순위입니다. 기사 본문·이미지·댓글·회원 정보는 저장하지 않습니다. 자세한 기준은 [매체 표본과 수집 원칙](docs/source-panel.md)을 참고하세요.

## API

| 경로 | 용도 | 보호 |
| --- | --- | --- |
| `GET /api/health` | 데이터·최근 분석 상태 | 공개 |
| `GET /api/sources` | 분석 대상 매체 | 공개 |
| `GET /api/articles` | 실제 기사 검색·필터 | 공개 |
| `GET /api/issues` | 최신 이슈 랭킹 | 공개 |
| `GET /api/issues/:id` | 이슈·기사·프레임·리포트 상세 | 공개 |
| `POST /api/import` | 기사 메타데이터 가져오기 | Bearer `IMPORT_TOKEN` |
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

`npm run build`는 Vite·vinext로 실제 React 클라이언트와 Workers 호환 서버를 `dist/`에 만들고, Sites용 호스팅 정보와 Drizzle 마이그레이션을 함께 패키징합니다. 비밀값과 서비스 계정 파일은 저장소에 커밋하지 않습니다.
