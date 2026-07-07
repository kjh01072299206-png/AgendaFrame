# AgendaFrame 개발 산출물 제작 툴 및 워크플로우 조사

작성일: 2026-07-07

## 1. 결론

WBS, 간트차트, UML을 개발자 방식으로 만들 때는 보통 **원본을 편집 가능한 형태로 유지하고, 제출용 이미지만 PNG/PDF로 export**한다.  
즉, 최종 제출물은 PNG일 수 있지만 실제 작업 원본은 아래 중 하나로 관리하는 것이 좋다.

- 표 원본: Notion, Excel, Google Sheets, Markdown
- 일정 원본: Notion Timeline, GitHub Projects Roadmap, Jira Timeline, Mermaid Gantt
- UML 원본: PlantUML, Mermaid, diagrams.net(draw.io)
- 제출 이미지: PNG 또는 SVG export

AgendaFrame 과제에는 다음 조합을 추천한다.

| 산출물 | 추천 원본 툴 | 제출용 변환 | 이유 |
| --- | --- | --- | --- |
| WBS | Notion 표 또는 Excel | PNG/PDF | 작업분해표는 표 기반 관리가 가장 편함 |
| 간트차트 | Notion Timeline 또는 Mermaid Gantt | PNG/SVG | 일정 변경 시 수정이 쉬움 |
| 유스케이스 명세서 | Notion/Markdown 표 | PDF/PNG | 표 형식으로 요구사항 설명 가능 |
| 유스케이스 다이어그램 | diagrams.net 또는 PlantUML | PNG/SVG | UML 모양을 깔끔하게 만들기 좋음 |
| 액티비티 다이어그램 | PlantUML 또는 Mermaid | PNG/SVG | 흐름도 자동 배치 가능 |
| 클래스 다이어그램 | PlantUML | PNG/SVG | 클래스, 속성, 메서드, 관계 표현에 적합 |
| 시퀀스 다이어그램 | PlantUML 또는 Mermaid | PNG/SVG | 메시지 흐름을 코드처럼 관리 가능 |

## 2. 개발자들이 실제로 많이 쓰는 방식

### 2.1 문서 중심 관리: Notion, Confluence, GitHub Wiki

Notion은 WBS 표와 일정 관리를 한 문서 안에서 하기 좋다. Timeline View는 날짜 속성이 있는 데이터베이스를 시간축으로 보여주며, 시작일/종료일을 드래그해 조정할 수 있다.

AgendaFrame에 쓰는 방식:

1. WBS 데이터베이스 생성
2. 속성 추가: `작업명`, `WBS ID`, `담당자`, `시작일`, `종료일`, `상태`, `선행 작업`, `산출물`
3. Table View로 WBS 작성
4. Timeline View로 간트차트 확인
5. 캡처하거나 PDF/PNG로 export

참고: https://www.notion.com/help/timelines

### 2.2 개발 작업 추적: GitHub Projects, Jira, Linear

GitHub Projects는 이슈와 PR을 프로젝트 표, 보드, 로드맵으로 연결할 수 있다. 커스텀 필드로 복잡도, 우선순위, 일정, iteration을 넣을 수 있어 실제 개발 작업 관리에 적합하다.

AgendaFrame에 쓰는 방식:

1. 기능을 GitHub Issue로 등록
2. `Priority`, `Story Point`, `Sprint`, `Start`, `End`, `Owner` 필드 추가
3. Table View로 백로그 관리
4. Roadmap View로 일정 확인

참고: https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects

### 2.3 텍스트 기반 다이어그램: Mermaid

Mermaid는 Markdown처럼 텍스트로 다이어그램을 작성하고, 이를 SVG/PNG로 렌더링한다. 공식 문서에 따르면 Mermaid는 텍스트 정의로 다이어그램을 만들고 수정할 수 있게 해 문서가 개발과 함께 따라가도록 돕는 도구다.

지원 예:

- Flowchart
- Sequence Diagram
- Class Diagram
- Gantt Chart
- Entity Relationship Diagram

AgendaFrame에 쓰는 방식:

1. Markdown 문서 안에 Mermaid 코드 작성
2. Mermaid Live Editor 또는 지원 문서 도구에서 미리보기
3. SVG/PNG로 export
4. PPT, Notion, 보고서에 삽입

참고:

- https://mermaid.js.org/intro/
- https://mermaid.js.org/syntax/gantt.html
- https://mermaid.js.org/syntax/sequenceDiagram.html
- https://mermaid.js.org/syntax/classDiagram.html

### 2.4 UML 전용 텍스트 도구: PlantUML

PlantUML은 간단한 텍스트 언어로 UML 다이어그램을 생성하는 도구다. 공식 문서 기준으로 Sequence, Use Case, Class, Activity, Component, State, Deployment 등 주요 UML 다이어그램을 지원하고, PNG/SVG/PDF 등으로 출력할 수 있다.

AgendaFrame에 쓰는 방식:

1. `.puml` 파일에 UML 코드 작성
2. PlantUML 확장 또는 온라인 서버로 렌더링
3. PNG/SVG로 export
4. 산출물 문서에 삽입

PlantUML이 특히 좋은 경우:

- 유스케이스 다이어그램을 UML 표준 모양으로 만들 때
- 클래스 다이어그램에서 속성/메서드/관계를 명확히 표현할 때
- 시퀀스 다이어그램을 메시지 순서대로 관리할 때

참고:

- https://plantuml.com/
- https://plantuml.com/use-case-diagram
- https://plantuml.com/class-diagram
- https://plantuml.com/sequence-diagram
- https://plantuml.com/activity-diagram-beta

### 2.5 손으로 예쁘게 다듬는 도구: diagrams.net(draw.io)

diagrams.net(draw.io)는 웹 기반 다이어그램 편집기로, UML, 플로우차트, 아키텍처 다이어그램 등을 손으로 배치하고 꾸미기 좋다. PNG, SVG, JPEG, PDF 등으로 export할 수 있고, PNG/SVG 안에 편집 가능한 XML을 포함할 수도 있다.

AgendaFrame에 쓰는 방식:

1. Mermaid/PlantUML로 초안 생성
2. diagrams.net에서 UML 모양과 배치 다듬기
3. PNG/SVG로 export
4. PPT나 Notion에 삽입

참고: https://www.drawio.com/docs/manual/export/export-diagram/

## 3. “양식 PNG로 똑같이” 만들 때의 현실적인 방법

PNG를 똑같이 만드는 데는 두 가지 방식이 있다.

### 방식 A. 발표자료/과제 제출용 시각물 우선

이 방식은 제출 화면이 중요할 때 좋다.

1. PowerPoint 또는 Figma에서 표/다이어그램 양식을 직접 만든다.
2. 기존 예시 PNG와 비슷하게 글꼴, 회색 헤더, 얇은 표선, 여백을 맞춘다.
3. 최종 화면을 PNG로 export한다.

장점:

- 교수님이 보는 결과물이 깔끔하다.
- 예시 PNG와 가장 비슷하게 만들 수 있다.

단점:

- 일정이나 내용이 바뀌면 수작업 수정이 많다.
- 개발 산출물 원본으로 관리하기는 불편하다.

### 방식 B. 개발자식 원본 관리 우선

이 방식은 수정과 재생성이 중요할 때 좋다.

1. WBS와 백로그는 Markdown/CSV/Excel로 관리한다.
2. 간트차트와 UML은 Mermaid 또는 PlantUML 코드로 관리한다.
3. 필요할 때 HTML/CSS 또는 CLI 렌더링으로 PNG를 생성한다.

장점:

- 내용 수정 후 PNG를 다시 뽑기 쉽다.
- Git으로 버전 관리가 가능하다.
- 다이어그램과 문서가 따로 놀 가능성이 줄어든다.

단점:

- 예시 PNG와 완전히 같은 디자인을 만들려면 CSS/템플릿 작업이 필요하다.

## 4. AgendaFrame에 추천하는 최종 제작 루트

우리 과제는 제출용 문서도 필요하고, 개발 산출물처럼 논리도 보여야 하므로 혼합 방식이 가장 좋다.

### 1단계: 원본 정리

- `AgendaFrame_10_WBS_간트차트.md`
- `AgendaFrame_11_UML.md`
- `AgendaFrame_프로덕트백로그.md`
- `AgendaFrame_스프린트백로그.md`

### 2단계: PNG 생성

- 표 산출물: HTML/CSS로 예시 PNG처럼 렌더링 후 캡처
- 간트차트: Mermaid Gantt를 SVG/PNG로 export
- UML: PlantUML 또는 diagrams.net으로 PNG export

### 3단계: 제출용 통합

- PPT에는 PNG 삽입
- Notion에는 표 원본과 PNG 둘 다 첨부
- 발표자료에는 너무 세부적인 표보다 요약형 PNG 사용

## 5. 내가 다음에 만들면 좋은 파일

다음 단계에서 바로 만들 파일은 아래가 적절하다.

| 파일 | 내용 |
| --- | --- |
| `outputs/wbs_gantt.png` | WBS/간트차트 제출용 이미지 |
| `outputs/usecase_spec.png` | 유스케이스 명세서 표 이미지 |
| `outputs/usecase_diagram.png` | 유스케이스 다이어그램 |
| `outputs/activity_diagram.png` | 액티비티 다이어그램 |
| `outputs/class_diagram.png` | 클래스 다이어그램 |
| `outputs/sequence_diagram.png` | 시퀀스 다이어그램 |

## 6. 최종 판단

지금 바로 예시 PNG와 똑같은 이미지를 만들려면 **HTML/CSS 템플릿 + Mermaid/PlantUML 렌더링 + PNG export**가 가장 안정적이다.  
개발자식으로 오래 관리하려면 **Markdown/PlantUML/Mermaid 원본을 유지하고, 제출할 때만 PNG로 뽑는 방식**이 맞다.

