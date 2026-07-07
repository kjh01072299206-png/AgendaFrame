# AgendaFrame

AI 기반 뉴스 의제·프레임 분석 플랫폼

## 프로젝트 개요

AgendaFrame은 주요 언론사의 홈페이지 배치와 보도 빈도를 기반으로 오늘의 공적 의제를 산출하고, 동일 이슈에 대한 언론사별 관점/프레임 차이를 비교하는 캡스톤디자인 프로젝트입니다.

## 핵심 기능

- 오늘의 의제 랭킹
- 기사 자동 수집 및 메타데이터 저장
- 유사 기사 이슈 클러스터링
- 언론사별 보도 빈도·제목·배치 비교
- 갈등, 책임, 경제, 법·제도, 정책효과, 시민영향 프레임 분석
- AI 리포트 생성
- WBS, 간트차트, UML 등 개발 산출물 관리

## 산출물

### 문서

- `AgendaFrame_프로덕트백로그.md`
- `AgendaFrame_스프린트백로그.md`
- `AgendaFrame_10_WBS_간트차트.md`
- `AgendaFrame_11_UML.md`
- `AgendaFrame_선행연구_및_선행서비스_검토.md`
- `AgendaFrame_개발산출물_제작툴_워크플로우.md`

### 제출용 이미지

- `outputs/wbs_gantt.png`
- `outputs/usecase_spec.png`
- `outputs/usecase_diagram.png`
- `outputs/activity_diagram.png`
- `outputs/class_diagram.png`
- `outputs/sequence_diagram.png`

## 디렉터리 구조

```text
.
├── README.md
├── AgendaFrame_*.md
├── outputs/
│   └── *.png
└── tools/
    └── render_agendaframe_outputs.py
```

## 이미지 재생성

```powershell
python tools/render_agendaframe_outputs.py
```

## 주의

신청서, 지원비 서식, 개인정보 포함 문서는 GitHub에 업로드하지 않습니다.

