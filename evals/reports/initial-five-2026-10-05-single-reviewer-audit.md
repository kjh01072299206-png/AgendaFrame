# 2026-10-05 기사 군집 전수검토

검토 대상은 KST 2026-10-05에 수집된 아카이브의 중복 제거 기사 92건이다. 10개 매체에서 모였고, 기사 본문은 열람하지 않고 제목·매체·게시 시각·사건 맥락으로 군집을 판단했다. 아래 표의 기사 원문 링크는 사용자가 판정을 직접 재확인할 수 있도록 붙였다.

## 판정 결과

- 9개 사건 묶음, 48건: 같은 사건으로 판단한 기사
- 5건: 제목만으로 같은 사건인지 단정하기 어려워 보류
- 2건: 사설과 운세 기사로 뉴스 사건 군집 평가 범위에서 제외
- 37건: 다른 기사와 묶지 않은 개별 기사
- 상위 5개 배포 묶음은 38건이며, 본문 프레이밍 분석을 실행할 대상이다. 나머지 54건은 사건 군집 전수검토에는 포함하지만 현재 사이트의 상위 5개 분석 화면에는 싣지 않는다.

이 판정은 한 명이 제목 자료만으로 한 사후 임시 검토다. 두 명의 독립 코딩, 합의 판정, 잠금 holdout은 없다. 따라서 이 결과는 공식 gold 데이터셋이 아니다. 사설·운세 제외 2건과 보류 5건을 뺀 85건만 아래 예비 페어 지표에 사용했다.

## 시험한 AI 군집의 예비 지표

| 지표 | 값 | 계산 |
|---|---:|---|
| 평가 대상 기사 | 85 | 92건 - 보류 5건 - 범위 밖 2건 |
| 사람 기준 positive pairs | 159 | 같은 사람 검토 군집 안의 모든 기사 쌍 |
| AI positive pairs | 248 | Gemini가 same_event로 둔 기사 쌍 |
| TP / FP / FN / TN | 111 / 137 / 48 / 3274 | 페어 단위 |
| Pairwise precision | 0.4476 | TP / (TP + FP) |
| Pairwise recall | 0.6981 | TP / (TP + FN) |
| Pairwise F1 | 0.5455 | 조화 평균 |
| 과병합률 | 0.5524 | FP / (TP + FP) |
| 미병합률 | 0.3019 | FN / (TP + FN) |
| 전체 negative pair 특이도 | 0.9598 | TN / (TN + FP) |
| 공식 hard-negative 정확도 | 산출 안 함 | 잠금 hard-negative 목록과 독립 이중 검토가 없어 대체하지 않음 |

현재 `evals/thresholds.yaml`의 clustering 기준과 단순 대조하면 예비 pairwise F1 0.90 미달, 과병합률 0.05 초과, 미병합률 0.10 초과다. 전체 negative pair 특이도는 공식 hard-negative 정확도와 다른 지표다. 단일 검토자 표본이므로 세 지표는 진단용이며 공식 release benchmark 결과로 해석할 수 없다.

시험 대상 Gemini 출력은 Gemini 2.5 Flash-Lite, clustering prompt 2.3.0, 2회 시도에서 문법 검증을 통과했다. 의미 판단은 다음 오류 때문에 공개에 사용하지 않았다. 공개판은 아래 임시 사람 검토 파티션을 사용하고, 이를 AI 군집이라고 표시하지 않는다.

## 오류 양상

| AI 군집 | 사람 검토 기준과 비교 |
|---|---|
| 0: North Korea's DMZ Mine Incident and South Korea's Response (16건) | DMZ 지뢰 사건 외에 탄도미사일·MRBM 보도와 통신장비 기사를 함께 묶었고, DMZ 관련 일부 기사는 누락했다. 사람 검토 기준 교차집계: 북한 DMZ 지뢰 매설·제거와 군의 대응 11건; 북한 탄도미사일·MRBM 능력 보도 2건; 개별 기사 2건. |
| 1: President Lee's Statements on Extremism and Political Reform (15건) | 무극파 발언과 검찰개혁 인사·수사 경고라는 별도 발언을 합쳤고, 여론·과거 사건·부동산 발언도 포함했다. 사람 검토 기준 교차집계: 이 대통령의 ‘무극파’·극단주의 경계 발언 7건; 개별 기사 4건; 검찰개혁을 내세운 인사·수사 개입 경고 4건. |
| 2: Controversy over the film 'Assassins(s)' (9건) | 영화 논란 보도에 유해진 소속사의 별도 신변 안전 입장 발표를 합쳤고, 영화 논란 기사 일부는 누락했다. 사람 검토 기준 교차집계: 영화 《암살자(들)》 논란과 정당 대응 8건; 유해진 소속사의 신변 위협 대응 입장 1건. |
| 3: AI Development and Regulation (3건) | 평가 범위 밖 사설을 미국 AI 정책 기사 및 앤트로픽·오픈AI 안전 철학 기사와 함께 묶었다. 사람 검토 기준 교차집계: 개별 기사 2건. |
| 4: Ukraine Conflict and International Relations (3건) | 젤렌스키의 북한군 관련 발언을 한국 외교 일반 및 우크라이나 전쟁 영웅 발언과 함께 묶었다. 사람 검토 기준 교차집계: 개별 기사 2건. |

## 상위 5개 배포 후보

| 순위 | 사건 묶음 | 기사 수 | 매체 수 | 관측 점수 |
|---:|---|---:|---:|---:|
| 1 | 북한 DMZ 지뢰 매설·제거와 군의 대응 | 13 | 9 | 70.2 |
| 2 | 영화 《암살자(들)》 논란과 정당 대응 | 9 | 6 | 44.0 |
| 3 | 이 대통령의 ‘무극파’·극단주의 경계 발언 | 7 | 6 | 41.6 |
| 4 | 검찰개혁을 내세운 인사·수사 개입 경고 | 5 | 4 | 26.1 |
| 5 | 리얼미터 대통령·정당 지지율 조사 | 4 | 4 | 24.1 |

상위 순위는 매체 수·기사 수 기반 제품 점수의 산출 순서이며, 사건의 사회적 중요도나 진실성을 뜻하지 않는다. 이 다섯 묶음에는 38건이 포함된다. 배포 후 실제 본문 분석 성공 건수는 별도로 확인해 기록한다.

## 사람 검토 92건 전체 명부

표의 `사람 검토` 값은 사건 묶음 이름, `개별`(다른 제목과 묶지 않음), `보류`, `범위 밖` 중 하나다. `시험 AI 군집`은 비공개 Gemini 시험의 same_event 배정이고, `-`는 AI가 전역 보류·미군집으로 둔 건이다. 괄호의 FP/FN은 해당 기사와 관련된 페어 오류 수로 각 틀린 페어는 두 기사 행에 한 번씩 표시된다.

대상 92건 · 10개 매체 · 매체별: 동아일보 12, 한겨레 9, 한국일보 2, 중앙일보 6, 경향신문 21, 국민일보 3, 문화일보 12, SBS 8, 세계일보 9, 서울신문 10.

| # | 기사 제목 | 매체 | 게시(KST) | 사람 검토 | 시험 AI 군집 | FP/FN 페어 |
|---:|---|---|---|---|---|---:|
| 1 | [\[사설\] AI 해킹 서막일 수도… 국가 차원의 방어막 대응해야](<https://www.seoul.co.kr/news/editOpinion/editorial/2026/10/05/20261005027008>)<br><small>b041572d54086314225929874e70aca4</small> | 서울신문 | 00:08 | 범위 밖 | 3: AI Development and Regulation | 0/0 |
| 2 | [李 “근거없는 선동 유행처럼 번져…좌든 우든 극단주의 경계해야”](<https://www.joongang.co.kr/article/25467126>)<br><small>1c6ec538b7f9ab75149413298af227bb</small> | 중앙일보 | 00:32 | 이 대통령의 ‘무극파’·극단주의 경계 발언 | 1: President Lee's Statements on Extremism and Political Reform | 8/0 |
| 3 | [국힘, ‘암살자(들)’ 국제영화제 개막작 철회 요구…민주 “영틀막 정당”](<https://www.segye.com/newsView/20261004509281>)<br><small>d455d12f3d2102403ba0ca806a8bfdb5</small> | 세계일보 | 00:37 | 영화 《암살자(들)》 논란과 정당 대응 | 2: Controversy over the film 'Assassins(s)' | 1/1 |
| 4 | [한동훈, 김지용에 "옛 인연 생각해 방법 알려준다…민주당 충성 맹세하면 시켜줄 것"](<https://www.munhwa.com/article/11621365>)<br><small>4742432e22153100b1f25e52c5f1686e</small> | 문화일보 | 00:47 | 개별 | AI 모호 | 0/0 |
| 5 | [\[김동완의 오늘의 운세\] 2026년 10월 5일](<https://www.seoul.co.kr/news/life/culture-news/fortune-today/2026/10/05/20261005500001>)<br><small>1fbd00f7f012f15406ef677667e27a27</small> | 서울신문 | 01:05 | 범위 밖 | - | 0/0 |
| 6 | [김정은, 韓과 대화 거부 다음날 탄도미사일 도발](<https://www.donga.com/news/Politics/article/all/20261005/134784565/2>)<br><small>265d2380d8e82513be6d9b22278d2157</small> | 동아일보 | 01:40 | 북한 탄도미사일·MRBM 능력 보도 | 0: North Korea's DMZ Mine Incident and South Korea's Response | 13/0 |
| 7 | [北, 지뢰 뭉개고 美 관심끌기… 트럼프 “핵미사일 112개, 잘 지내야”](<https://www.donga.com/news/Politics/article/all/20261005/134784452/2>)<br><small>585e1bbf0ad8581f7746ebd3e14eb8b8</small> | 동아일보 | 01:40 | 보류 | 0: North Korea's DMZ Mine Incident and South Korea's Response | 0/0 |
| 8 | [北 “파도식 비행-AI 도입-경로 변경” 주장… 괌 사정권 MRBM, 한미 요격 무력화 위협](<https://www.donga.com/news/Politics/article/all/20261005/134784449/2>)<br><small>7339c4cde5f55e8ec8d745754c875ede</small> | 동아일보 | 01:40 | 북한 탄도미사일·MRBM 능력 보도 | 0: North Korea's DMZ Mine Incident and South Korea's Response | 13/0 |
| 9 | [\[단독\]‘北 지뢰 폭발’ 주내 최종 발표… 첨단 무기 시연 등 상응조치 검토](<https://www.donga.com/news/Politics/article/all/20261005/134784269/2>)<br><small>dcf671d7d9a022c870a86870915f077f</small> | 동아일보 | 01:40 | 북한 DMZ 지뢰 매설·제거와 군의 대응 | 0: North Korea's DMZ Mine Incident and South Korea's Response | 4/2 |
| 10 | ["군대 안간다" 금메달 따고도 고개숙인 축구대표 주장 이기혁…"반성, 또 반성"](<https://www.munhwa.com/article/11621366>)<br><small>87682e7e9342e29150e482256976094a</small> | 문화일보 | 03:09 | 개별 | AI 모호 | 0/0 |
| 11 | ['도대체 어떻게 경찰이 됐을까?'…지인 나체 허위 성착취물 제작·유포한 현직 경찰관 구속](<https://www.munhwa.com/article/11621367>)<br><small>c7f52982b2ddbe35f94608f37c3027f5</small> | 문화일보 | 04:05 | 개별 | AI 모호 | 0/0 |
| 12 | [이 대통령 9월 SNS 글, 전월 대비 216% 급증... '선택적 소통' 우려도](<https://www.hankookilbo.com/news/article/A2026100214570000516>)<br><small>3e08a7f9c6b3a2bd8e571687d3bc9a0f</small> | 한국일보 | 04:30 | 개별 | 1: President Lee's Statements on Extremism and Political Reform | 14/0 |
| 13 | [“한국, 동맹 의존·몰입 벗어나 자강 중심 국제연대 고민해야”](<https://www.hani.co.kr/arti/politics/diplomacy/1280889.html>)<br><small>d96dfbe17c5f151cad59d13a9139df14</small> | 한겨레 | 05:00 | 개별 | 4: Ukraine Conflict and International Relations | 1/0 |
| 14 | [MB “청와대 담 넘어도 절대…” 광우병 그때, 경찰에 내린 엄명](<https://www.joongang.co.kr/article/25467129>)<br><small>f67b113666b69d9d6ac5d46137b2d7c3</small> | 중앙일보 | 05:00 | 개별 | 1: President Lee's Statements on Extremism and Political Reform | 14/0 |
| 15 | [한국 경고에도… 젤렌스키 또 北 언급하며 “매우 위험한 순간”](<https://www.kmib.co.kr/article/view.asp?arcid=9000019822&code=61111411&sid1=pol>)<br><small>be5cedd14ddf841f7c8fff18af51a0c5</small> | 국민일보 | 05:15 | 보류 | 4: Ukraine Conflict and International Relations | 0/0 |
| 16 | [“암살자(들) 상영 멈춰라”… 장동혁, 오늘 육영수 생가 방문](<https://www.kmib.co.kr/article/view.asp?arcid=9000019823&code=61111111&sid1=pol>)<br><small>a231eda66095ac31a16f3ad6e4060220</small> | 국민일보 | 05:21 | 영화 《암살자(들)》 논란과 정당 대응 | 2: Controversy over the film 'Assassins(s)' | 1/1 |
| 17 | ['개문발차' 공소청, 버스기사 때린 60대 영장 기각, 왜?…"증거있어 구속 불필요"](<https://www.munhwa.com/article/11621368>)<br><small>356f4833bc415c15ff34f1664038b845</small> | 문화일보 | 05:25 | 개별 | AI 모호 | 0/0 |
| 18 | [\[단독\] “北 해킹 제재”“지뢰와 뭔 상관”…조현·정동영 고성 충돌](<https://www.joongang.co.kr/article/25467135>)<br><small>96cd017e4a92adf1775d876f0d703ebd</small> | 중앙일보 | 06:00 | 북한 DMZ 지뢰 매설·제거와 군의 대응 | 0: North Korea's DMZ Mine Incident and South Korea's Response | 4/2 |
| 19 | [\[올앳부동산\]서울 골목 어딜 가봐도 차로 ‘빽빽’ 왜?···도쿄와 비교해보니](<https://www.khan.co.kr/article/202610050600001/>)<br><small>86f3e6886c78854ac1a31c886de93549</small> | 경향신문 | 06:00 | 개별 | AI 모호 | 0/0 |
| 20 | [트럼프 “미국 선두 유지” 슈퍼지능TF 발족···AI 차르에 국가정보국장 임명](<https://www.khan.co.kr/article/202610050742001/>)<br><small>2b5ffc0493225c2b5e32791bb7d1a514</small> | 경향신문 | 07:42 | 개별 | 3: AI Development and Regulation | 1/0 |
| 21 | [李 지지도 37.4%, 3주만에 하락…민주 42.5% 국힘 38.4%\[리얼미터\]](<https://www.joongang.co.kr/article/25467149>)<br><small>9cd6f814860437d66ac802fdc017508d</small> | 중앙일보 | 08:52 | 리얼미터 대통령·정당 지지율 조사 | - | 0/3 |
| 22 | [\[속보\]이 대통령 지지율 37.4%, 3주만 소폭 하락…민주 42.5%·국힘 38.4% 오차 내 \[리얼미터\]](<https://www.munhwa.com/article/11621380>)<br><small>76acfa399e16ebd0d8c09b2fb05b74c2</small> | 문화일보 | 09:07 | 리얼미터 대통령·정당 지지율 조사 | - | 0/3 |
| 23 | [‘무극파’ 직격한 李…“개혁성과 독차지하겠단 이기심”](<https://www.donga.com/news/Politics/article/all/20261005/134785219/1>)<br><small>7314c5bc0faadaf89a6a46411a95fd31</small> | 동아일보 | 09:08 | 이 대통령의 ‘무극파’·극단주의 경계 발언 | 1: President Lee's Statements on Extremism and Political Reform | 8/0 |
| 24 | [젤렌스키 “한국이 北 군인 넘겨달라 요청”…비공개 합의 파기는 언급 안 해](<https://www.donga.com/news/Inter/article/all/20261005/134785354/1>)<br><small>b5af3c679a5866e10c856c8f898a6257</small> | 동아일보 | 09:44 | 보류 | AI 모호 | 0/0 |
| 25 | [이 대통령 지지율 ‘37.4%’ 3주 만에 소폭 하락···“김지용·DMZ 지뢰 폭발 사건 영향”\[리얼미터\]](<https://www.khan.co.kr/article/202610050957001/>)<br><small>1cf624e7b6d0b1a0352fbf2ce37c8091</small> | 경향신문 | 09:57 | 리얼미터 대통령·정당 지지율 조사 | AI 모호 | 0/3 |
| 26 | [지진 등 통신두절 때 어쩌려고···재외공관 절반 ‘비상위성통신장비’ 없다](<https://www.khan.co.kr/article/202610051001001/>)<br><small>cb1923e5c4a8c22dbe8ef3c9fff47dd2</small> | 경향신문 | 10:01 | 개별 | 0: North Korea's DMZ Mine Incident and South Korea's Response | 14/0 |
| 27 | [\[속보\]李대통령, '무극파' 직격…"개혁 성과 독차지하려는 이기심"](<https://www.munhwa.com/article/11621385>)<br><small>e678b8189b8009939a6ed604753e61ba</small> | 문화일보 | 10:02 | 이 대통령의 ‘무극파’·극단주의 경계 발언 | 1: President Lee's Statements on Extremism and Political Reform | 8/0 |
| 28 | [이 대통령, 범여권 강경파 겨냥 “‘무극파’ 경계해야···개혁 성과 독차지하겠다는 이기심”](<https://www.khan.co.kr/article/202610051008001/>)<br><small>fe9c9d4331595377366b2cc648388f6a</small> | 경향신문 | 10:08 | 이 대통령의 ‘무극파’·극단주의 경계 발언 | 1: President Lee's Statements on Extremism and Political Reform | 8/0 |
| 29 | [큐로셀·토모큐브 등 6개사 출격···대전 바이오, 국내외 연구자 앞에 선다](<https://www.khan.co.kr/article/202610051012001/>)<br><small>f1e1740f5aa11e436fca3d66c2910b4d</small> | 경향신문 | 10:12 | 개별 | AI 모호 | 0/0 |
| 30 | [장동혁, 오늘 육영수 생가 방문…영화 '암살자(들)' 공세 계속](<https://news.sbs.co.kr/news/endPage.do?news_id=N1008783262&plink=RSSLINK&cooper=RSSREADER>)<br><small>7c7713e4be908e66dcbd1c982a48cc1f</small> | SBS | 10:14 | 영화 《암살자(들)》 논란과 정당 대응 | 2: Controversy over the film 'Assassins(s)' | 1/1 |
| 31 | [샘 올트먼 “AI 일부 위험 감수해야”…앤트로픽과 ‘안전 철학’ 선 긋기](<https://www.khan.co.kr/article/202610051028001/>)<br><small>3dbe722af07856307b5e30c2388021ec</small> | 경향신문 | 10:28 | 개별 | 3: AI Development and Regulation | 1/0 |
| 32 | [국감장 서는 수입차 대표들, 4명 중 2명만 증인 나온다…‘팔고 나면 끝’ 사후관리 도마](<https://www.khan.co.kr/article/202610051031001/>)<br><small>21ff8c695d31a0bfdbb0921df8eabe1d</small> | 경향신문 | 10:31 | 개별 | AI 모호 | 0/0 |
| 33 | [이재명 대통령 "좌우 어디서나 무책임한 극단주의 경계해야"](<https://www.segye.com/newsView/20261005503664>)<br><small>bf95d8b98feadd721eac126ce7e1821d</small> | 세계일보 | 10:32 | 이 대통령의 ‘무극파’·극단주의 경계 발언 | 1: President Lee's Statements on Extremism and Political Reform | 8/0 |
| 34 | [이 대통령 "무책임 극단주의 '무극파' 경계…근거없이 혹세무민"](<https://news.sbs.co.kr/news/endPage.do?news_id=N1008783289&plink=RSSLINK&cooper=RSSREADER>)<br><small>8f33594f53f066a860a369c3de1af8da</small> | SBS | 10:39 | 이 대통령의 ‘무극파’·극단주의 경계 발언 | 1: President Lee's Statements on Extremism and Political Reform | 8/0 |
| 35 | [이 대통령 "무책임 극단주의 '무극파' 경계…근거없이 혹세무민"](<https://news.sbs.co.kr/news/endPage.do?news_id=N1008783274&plink=RSSLINK&cooper=RSSREADER>)<br><small>f9341906a6947ba0c6f0b8a48a7a3c63</small> | SBS | 10:43 | 이 대통령의 ‘무극파’·극단주의 경계 발언 | 1: President Lee's Statements on Extremism and Political Reform | 8/0 |
| 36 | [여학생 성추행한 중학생…法 “부모가 1800만원 배상”](<https://www.seoul.co.kr/news/society/2026/10/05/20261005500030>)<br><small>c23a4b976fcea0121c94d2278cca9a05</small> | 서울신문 | 10:46 | 개별 | AI 모호 | 0/0 |
| 37 | [\[속보\]처음 본 20대 여성 뒤통수에 돌덩이 '퍽' 50대…男 "술 취해 기억 안 나"](<https://www.munhwa.com/article/11621391>)<br><small>c7b77eee6525e071d218c82cae958f0d</small> | 문화일보 | 10:47 | 개별 | AI 모호 | 0/0 |
| 38 | [북한군 코앞인데…‘실탄 미장착’ 빈총 전방군단 또 있었다](<https://www.joongang.co.kr/article/25467163>)<br><small>c9b14c3062e0d10ef779e12373d1ea97</small> | 중앙일보 | 10:54 | 전방 부대 실탄 미장착·빈 총 경계 논란 | AI 모호 | 0/2 |
| 39 | [지뢰 사고·우크라·김지용 논란에 상승하던 李 지지율 다시 ‘불안불안’…3주 만에 소폭 하락세로](<https://www.segye.com/newsView/20261005504072>)<br><small>f7866b7c1d07b63e01c03e71882b0581</small> | 세계일보 | 11:05 | 리얼미터 대통령·정당 지지율 조사 | AI 모호 | 0/3 |
| 40 | [국힘 권영진 “한동훈의 비생산적 ‘노무현’ 공방…나는 빼달라”](<https://www.hani.co.kr/arti/politics/politics_general/1280918.html>)<br><small>1668b2354d0088540c387bb579925c61</small> | 한겨레 | 11:10 | 개별 | AI 모호 | 0/0 |
| 41 | [‘암살자(들)’ 유해진 소속사 “신변위협·명예훼손 엄중…배우 안전 위해 모든 조치”](<https://www.seoul.co.kr/news/life/2026/10/05/20261005500044>)<br><small>25901bec8cc9ccab36799b36d6faaa43</small> | 서울신문 | 11:20 | 유해진 소속사의 신변 위협 대응 입장 | 2: Controversy over the film 'Assassins(s)' | 8/1 |
| 42 | [유용원 “북 MDL 침범, 전방 여러 곳에서 발생”…정부에 실태 공개 촉구](<https://www.hani.co.kr/arti/politics/politics_general/1280920.html>)<br><small>7890753bcc50f36a09b3d4154237bc46</small> | 한겨레 | 11:21 | 개별 | 0: North Korea's DMZ Mine Incident and South Korea's Response | 14/0 |
| 43 | [이 대통령 “검찰개혁 빙자해 사심으로 인사·수사 좌지우지 안 돼”](<https://www.hani.co.kr/arti/politics/bluehouse/1280921.html>)<br><small>8fa31b90f0b55d7ef603c3b18822741d</small> | 한겨레 | 11:24 | 검찰개혁을 내세운 인사·수사 개입 경고 | 1: President Lee's Statements on Extremism and Political Reform | 11/1 |
| 44 | [‘집값 담합’ 의혹 신고해도 지자체 넘어가니 66%가 ‘무혐의 종결’···“소극적 법 해석·위법 방치”](<https://www.khan.co.kr/article/202610051127001/>)<br><small>41e737d08ee31dbbf95ec6b3f3f0190b</small> | 경향신문 | 11:27 | 개별 | AI 모호 | 0/0 |
| 45 | [민주당 “조희대, 얇은 의견서 뒤에 숨지 말고, 국감장 증인 출석하라”](<https://www.segye.com/newsView/20261005504412>)<br><small>ad1d7684ea36bf4a3b6c9b0c17c8649b</small> | 세계일보 | 11:31 | 조희대 대법원장 국정감사 출석 공방 | AI 모호 | 0/2 |
| 46 | [빈 총 논란 이후…'실탄 미장착' 전방군단 추가 확인](<https://news.sbs.co.kr/news/endPage.do?news_id=N1008783339&plink=RSSLINK&cooper=RSSREADER>)<br><small>6828eef4c8693e9ca4c7779aba158f32</small> | SBS | 11:33 | 전방 부대 실탄 미장착·빈 총 경계 논란 | AI 모호 | 0/2 |
| 47 | [대통령경호처, 日 경호기관과 교류 확대 나서…“상호 협력 필요성 더욱 커져”](<https://www.segye.com/newsView/20261005504486>)<br><small>869ed453e5d235671b202527fca9c176</small> | 세계일보 | 11:35 | 개별 | AI 모호 | 0/0 |
| 48 | [\[속보\]유해진 측 "신변 위협·명예훼손 엄중 대응…가능한 모든 조치"](<https://www.munhwa.com/article/11621398>)<br><small>82b2ccf061bd89350eb68b78232bef4b</small> | 문화일보 | 11:36 | 유해진 소속사의 신변 위협 대응 입장 | - | 0/1 |
| 49 | [장동혁 “우크라엔 분노조절 장애, 北엔 분노조절 잘 해“…李 비판](<https://www.donga.com/news/Politics/article/all/20261005/134785836/1>)<br><small>0eee82d65090296c14ed16e6eaede0d6</small> | 동아일보 | 11:42 | 개별 | - | 0/0 |
| 50 | [‘정부 지원은 없지만’ 대전 시민 안전위해 ‘방사선 감시’ 강화](<https://www.seoul.co.kr/news/society/2026/10/05/20261005500051>)<br><small>313d3c4a7c701e7f1ecedf89f3db1647</small> | 서울신문 | 11:44 | 개별 | AI 모호 | 0/0 |
| 51 | [與 “조희대, 국감 나온다 해놓고 말바꿔…거부시 형사처벌”](<https://www.donga.com/news/Politics/article/all/20261005/134785857/1>)<br><small>d5d0ac4d73fd98b9676a7e20556cebb5</small> | 동아일보 | 11:46 | 조희대 대법원장 국정감사 출석 공방 | AI 모호 | 0/2 |
| 52 | [농림장관 “경자유전 유효…‘나라가 땅 뺏기’는 가짜뉴스”](<https://www.seoul.co.kr/news/economy/2026/10/05/20261005500052>)<br><small>c0aacb24c6fe7b49f59622108aa53619</small> | 서울신문 | 11:52 | 개별 | AI 모호 | 0/0 |
| 53 | [신동욱 “‘전두환 내란 부정’ 김태규, 진행자에 낚여”…민주 “제명 동참하라”](<https://www.hani.co.kr/arti/politics/politics_general/1280922.html>)<br><small>2b47a334ed539f4c6acfb0280e13db36</small> | 한겨레 | 11:53 | 개별 | AI 모호 | 0/0 |
| 54 | [李 “검찰개혁 빙자해 사심으로 인사 좌지우지하려 해선 안 돼”](<https://www.donga.com/news/Society/article/all/20261005/134786008/1>)<br><small>06db1bd9e835a563466ddae6658a62c0</small> | 동아일보 | 12:35 | 검찰개혁을 내세운 인사·수사 개입 경고 | 1: President Lee's Statements on Extremism and Political Reform | 11/1 |
| 55 | [이 대통령 “검찰개혁 빙자해 사심으로 인사 좌우하려 해선 안 돼” 여권 강경파 겨냥 경고](<https://www.khan.co.kr/article/202610051249001/>)<br><small>4df1b96fe5df66cb3d7002a4f9dc0075</small> | 경향신문 | 12:49 | 검찰개혁을 내세운 인사·수사 개입 경고 | 1: President Lee's Statements on Extremism and Political Reform | 11/1 |
| 56 | [李 “검찰개혁 빙자해 사심으로 인사 좌우하려 해선 안 돼” 경고](<https://www.joongang.co.kr/article/25467181>)<br><small>ddddaa7559a0491feaa86e87ce257ea1</small> | 중앙일보 | 13:09 | 검찰개혁을 내세운 인사·수사 개입 경고 | 1: President Lee's Statements on Extremism and Political Reform | 11/1 |
| 57 | [최전방서 '빈 총' 들고 경계… 국방부, 전방 부대 무더기 기관경고](<https://www.hankookilbo.com/news/article/A2026100513220004301>)<br><small>c683056f5ea48cc748d9fc24d5d7bd6c</small> | 한국일보 | 14:15 | 전방 부대 실탄 미장착·빈 총 경계 논란 | AI 모호 | 0/2 |
| 58 | [이재명 정부 2년 차 국정감사 6일 시작…첫날 최대 쟁점은 ‘조희대’](<https://www.khan.co.kr/article/202610051516001/>)<br><small>add57411eab0a37ebedda67f5943d150</small> | 경향신문 | 15:16 | 조희대 대법원장 국정감사 출석 공방 | - | 0/2 |
| 59 | [李 “‘부동산 투기 공화국’ 탈출 약속 반드시 지킬 것”](<https://www.donga.com/news/Politics/article/all/20261005/134787142/1>)<br><small>ebfc4498f3487eec5f4dba3181178ba0</small> | 동아일보 | 15:48 | 개별 | 1: President Lee's Statements on Extremism and Political Reform | 14/0 |
| 60 | [\[속보\]‘北, MDL 남쪽에 지뢰 매설’ 최종판단…軍 “제거작전 수행”](<https://www.donga.com/news/Politics/article/all/20261005/134787295/1>)<br><small>a158c72c695ac158e2cd87f042f25264</small> | 동아일보 | 16:09 | 북한 DMZ 지뢰 매설·제거와 군의 대응 | 0: North Korea's DMZ Mine Incident and South Korea's Response | 4/2 |
| 61 | [합참 “DMZ 사고 원인은 北 지뢰…오늘 제거”](<https://www.kmib.co.kr/article/view.asp?arcid=9000019910&code=61111911&sid1=pol>)<br><small>d7a4ce4a5c082233cf75a260aedd7adf</small> | 국민일보 | 16:13 | 북한 DMZ 지뢰 매설·제거와 군의 대응 | 0: North Korea's DMZ Mine Incident and South Korea's Response | 4/2 |
| 62 | [민주당, 국민의힘의 <암살자(들)> 공세에 “검열” “한 번 더 보기 캠페인”](<https://www.khan.co.kr/article/202610051615001/>)<br><small>e958e013243a4b637960b7838be283ce</small> | 경향신문 | 16:15 | 영화 《암살자(들)》 논란과 정당 대응 | 2: Controversy over the film 'Assassins(s)' | 1/1 |
| 63 | [\[속보\] 군 “북한, 자발적 제거 안 하면 제거 작전 지속”···DMZ 사고 현장 북한 지뢰지대 제거](<https://www.khan.co.kr/article/202610051616001/>)<br><small>34863f66f35572c178b8f76f5d718d48</small> | 경향신문 | 16:16 | 북한 DMZ 지뢰 매설·제거와 군의 대응 | 0: North Korea's DMZ Mine Incident and South Korea's Response | 4/2 |
| 64 | [3분기 부가세 26일까지 신고·납부···홈플러스·호우 피해 사업자에는 기한 2개월 연장](<https://www.khan.co.kr/article/202610051624011/>)<br><small>d7f772bfb099313ab25a8f4b2d5f0566</small> | 경향신문 | 16:24 | 개별 | AI 모호 | 0/0 |
| 65 | [이 대통령, 조국·유시민 과거 영상 공유하며 ‘검찰개혁 비판’에 직접 반박](<https://www.khan.co.kr/article/202610051625001/>)<br><small>04d9bbe30b4a1264886c579d4114b0f9</small> | 경향신문 | 16:25 | 개별 | 1: President Lee's Statements on Extremism and Political Reform | 14/0 |
| 66 | ["펑!" 지뢰 제거 작전 영상 공개…"이게 북한군 지뢰, 국과수 감정 결과 보면…"](<https://news.sbs.co.kr/news/endPage.do?news_id=N1008783520&plink=RSSLINK&cooper=RSSREADER>)<br><small>9d2de50066b70aaca4d57a029777bd87</small> | SBS | 16:28 | 북한 DMZ 지뢰 매설·제거와 군의 대응 | 0: North Korea's DMZ Mine Incident and South Korea's Response | 4/2 |
| 67 | [“과거 임진강 北 지뢰와 동일…12개월 이전에 인위적 설치”](<https://www.donga.com/news/Politics/article/all/20261005/134787367/1>)<br><small>5a0305708b07711fa8286bddbd35e35e</small> | 동아일보 | 16:35 | 북한 DMZ 지뢰 매설·제거와 군의 대응 | 0: North Korea's DMZ Mine Incident and South Korea's Response | 4/2 |
| 68 | [‘BTS도 가는데’ 재점화된 병역 특례 논란…여야 모두 50년 넘은 제도 개선 촉구](<https://www.khan.co.kr/article/202610051639001/>)<br><small>1e72358532bd24ad565c6396bc77fc38</small> | 경향신문 | 16:39 | 개별 | AI 모호 | 0/0 |
| 69 | [이 대통령, 검찰개혁 ‘강경파’에 잇단 경고…“인사·수사 좌지우지 말라”](<https://www.hani.co.kr/arti/politics/bluehouse/1280961.html>)<br><small>136b6c1e275a030f35b44f291fcb6435</small> | 한겨레 | 16:47 | 검찰개혁을 내세운 인사·수사 개입 경고 | AI 모호 | 0/4 |
| 70 | [장동혁, 육영수 생가 찾아 "암살자(들), 대한민국 정통성 부정"](<https://news.sbs.co.kr/news/endPage.do?news_id=N1008783534&plink=RSSLINK&cooper=RSSREADER>)<br><small>7da8fca91a9b3cf9c25778aeed30e19e</small> | SBS | 16:47 | 영화 《암살자(들)》 논란과 정당 대응 | 2: Controversy over the film 'Assassins(s)' | 1/1 |
| 71 | [합참 "北 국경선 요새화 작업으로 DMZ 지뢰 폭발 최종 확인"](<https://www.segye.com/newsView/20261005508630>)<br><small>0d8df662ab45fecd87ad1e55b0a8a019</small> | 세계일보 | 16:50 | 북한 DMZ 지뢰 매설·제거와 군의 대응 | 0: North Korea's DMZ Mine Incident and South Korea's Response | 4/2 |
| 72 | [軍, DMZ 북한군 지뢰 제거 성공…“북한, 즉각 사과·추가 지뢰 제거하라”](<https://www.segye.com/newsView/20261005509055>)<br><small>78805b5135060fe1ea8dca7e2e6c3dfb</small> | 세계일보 | 16:51 | 북한 DMZ 지뢰 매설·제거와 군의 대응 | 0: North Korea's DMZ Mine Incident and South Korea's Response | 4/2 |
| 73 | [장동혁 "대통령, 대북송금 이상의 뭔가 있어 북한에 절절매"](<https://news.sbs.co.kr/news/endPage.do?news_id=N1008783542&plink=RSSLINK&cooper=RSSREADER>)<br><small>2f9e23722b5ca2ab63b39ffd9084b751</small> | SBS | 16:53 | 개별 | - | 0/0 |
| 74 | [장동혁, 육영수 생가 방문 “국민이 문화·역사전쟁 나서달라”…보수 결집 ‘치트키’ 된 박근혜·박정희](<https://www.khan.co.kr/article/202610051657001/>)<br><small>35da8ee754361ce92099af3d18cef649</small> | 경향신문 | 16:57 | 영화 《암살자(들)》 논란과 정당 대응 | 2: Controversy over the film 'Assassins(s)' | 1/1 |
| 75 | [장동혁, 육영수 여사 생가 찾아 “‘암살자(들)’, 대한민국 정통성 부정”](<https://www.hani.co.kr/arti/politics/politics_general/1280965.html>)<br><small>6a978f4e9ac12d72f930c712f6b7ab2e</small> | 한겨레 | 17:05 | 영화 《암살자(들)》 논란과 정당 대응 | - | 0/8 |
| 76 | [망분리했지만 ‘뒷문’ 못 막았다…‘보안 ABC’ 놓쳐, 망분리 완화론도 제기](<https://www.khan.co.kr/article/202610051705001/>)<br><small>847f52a3db9066a3722f5d1c30073800</small> | 경향신문 | 17:05 | 개별 | - | 0/0 |
| 77 | [\[속보\]장동혁, 육영수 생가서 "'암살자(들)'은 대한민국 정통성 부정"…"역사 왜곡 불이익 보여줘야"](<https://www.munhwa.com/article/11621440>)<br><small>8c4e418700bf440a375f90b6f1f5cef6</small> | 문화일보 | 17:06 | 영화 《암살자(들)》 논란과 정당 대응 | 2: Controversy over the film 'Assassins(s)' | 1/1 |
| 78 | [‘금메달 군 면제’ 자랑이 부른 후폭풍…여야 “53년 된 병역특례 개선해야”](<https://www.hani.co.kr/arti/politics/politics_general/1280967.html>)<br><small>02fe219254031d13655bc21b49045e8c</small> | 한겨레 | 17:09 | 개별 | AI 모호 | 0/0 |
| 79 | [\[단독\] 北, 탈레반과 군사 논의… 러·中 넘어 중앙·서남亞로 접촉 확장](<https://www.segye.com/newsView/20261005508998>)<br><small>9201038e898a5e391cb16ec89b3a7bf0</small> | 세계일보 | 17:16 | 개별 | AI 모호 | 0/0 |
| 80 | [“금융 교육으로 소비의 간절함을 알게 해주고 싶었어요”…‘병원학교’ 금융교육 현장 가보니](<https://www.khan.co.kr/article/202610051718001/>)<br><small>5d7863083998ced619fee2f0cb80ccbc</small> | 경향신문 | 17:18 | 개별 | AI 모호 | 0/0 |
| 81 | [군 "북한 지뢰로 우리 장병 부상 최종 판단"…지뢰 제거 작전 전격 단행](<https://news.sbs.co.kr/news/endPage.do?news_id=N1008783569&plink=RSSLINK&cooper=RSSREADER>)<br><small>ee98c0ee93d95c990cf5ef9b62496714</small> | SBS | 17:19 | 북한 DMZ 지뢰 매설·제거와 군의 대응 | - | 0/12 |
| 82 | [재선충에 쓰러진 소나무, 목재로 살린다···충남도 ‘산업화 방제’ 본격화](<https://www.khan.co.kr/article/202610051730001/>)<br><small>8261e3d671cebfa3f64a27368eba32c1</small> | 경향신문 | 17:30 | 개별 | AI 모호 | 0/0 |
| 83 | ["李대통령, 누구를 위협할 처지 아냐"…우크라 전쟁영웅 발언에 논란](<https://www.munhwa.com/article/11621441>)<br><small>cfd8c25e4afe1eaa756810af1857c01e</small> | 문화일보 | 17:30 | 개별 | 4: Ukraine Conflict and International Relations | 1/0 |
| 84 | ['대북 송금' 유죄 확정 이화영, 결국 재심 카드 꺼내나](<https://www.munhwa.com/article/11621442>)<br><small>d9a8f2179b50382db062ab9b59ac9308</small> | 문화일보 | 17:41 | 개별 | AI 모호 | 0/0 |
| 85 | [합참, ‘MDL 이남’ 북한군 매설 지뢰 폭파…북에 “즉시 제거 촉구”](<https://www.hani.co.kr/arti/politics/defense/1280977.html>)<br><small>fb62e646fc5eecd6cf7f7c24a9fa64e7</small> | 한겨레 | 17:47 | 북한 DMZ 지뢰 매설·제거와 군의 대응 | - | 0/12 |
| 86 | [\[단독\]조원태 ‘배임’ 혐의…경찰, 27년 전 ‘기아 사건’처럼 본다](<https://www.seoul.co.kr/news/economy/2026/10/05/20261005500113>)<br><small>b392a3019e2dbd594668c053ccdc0a03</small> | 서울신문 | 17:50 | 보류 | AI 모호 | 0/0 |
| 87 | [재단 돈 1100억 끌어와 경영권 방어 시도…조원태, 비판 여론에 철회](<https://www.seoul.co.kr/news/economy/2026/10/05/20261005500114>)<br><small>2b55252ee0a938b1cde7a23a821d0e8b</small> | 서울신문 | 17:51 | 보류 | AI 모호 | 0/0 |
| 88 | [육영수 생가 방문한 장동혁 “‘암살자(들)’ 역사왜곡, 맞서 싸우겠다”](<https://www.segye.com/newsView/20261005509497>)<br><small>341ca115ca0f2e358f361feeed63d595</small> | 세계일보 | 17:52 | 영화 《암살자(들)》 논란과 정당 대응 | 2: Controversy over the film 'Assassins(s)' | 1/1 |
| 89 | [中 철강·차 과잉 공급 압박… 한국 ‘차이나 딜레마’](<https://www.seoul.co.kr/news/economy/industry/2026/10/05/20261005500115>)<br><small>504ac58717a146c753a8f3aed27b35c5</small> | 서울신문 | 17:54 | 개별 | AI 모호 | 0/0 |
| 90 | [“北 매설 지뢰 맞다”…직접 제거 나선 軍](<https://www.seoul.co.kr/news/politics/diplomacy/2026/10/06/20261006001001>)<br><small>d382eb943b52aeb133cdb9d07a399f9d</small> | 서울신문 | 17:54 | 북한 DMZ 지뢰 매설·제거와 군의 대응 | 0: North Korea's DMZ Mine Incident and South Korea's Response | 4/2 |
| 91 | [\[속보\]軍 "北지뢰 도발사건 2주 만에 지뢰제거작전 첫 단행…연쇄 제거작전" 예고](<https://www.munhwa.com/article/11621443>)<br><small>e38153fb6f394ebf70937f0a9a89f12e</small> | 문화일보 | 17:56 | 북한 DMZ 지뢰 매설·제거와 군의 대응 | 0: North Korea's DMZ Mine Incident and South Korea's Response | 4/2 |
| 92 | [농식품부 고위직 모친 소유 농지 3필지 ‘휴경’···“전수조사 재검토해야”](<https://www.khan.co.kr/article/202610051757001/>)<br><small>541164fcc8fa0b537528b64503021ab2</small> | 경향신문 | 17:57 | 개별 | AI 모호 | 0/0 |

## 제한과 다음 검증

이 검토는 제목 단계에서 사건 후보를 보수적으로 가른 것이다. 본문 분석의 프레이밍 정확도, 각 문장 근거의 실제 지지 여부, 두 독립 검토자 간 일치도는 이 표에서 측정하지 않았다. 공식 clustering gate를 통과했다고 주장하지 않는다. 배포판에서 상위 5개 묶음의 실제 프레이밍은 38개 기사 본문을 대상으로 한 Vertex 결과의 성공·보류 수와 근거 coverage를 따로 집계하고, 공개 URL의 snapshot/run ID로 재확인한다.
