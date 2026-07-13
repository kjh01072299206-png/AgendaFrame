# AgendaFrame 협업 규칙

AgendaFrame는 `main`과 짧게 사용하는 작업 브랜치만 운영합니다. 모든 변경은 Pull Request(PR)를 통해 `main`에 병합합니다.

## 브랜치 구조

| 브랜치 | 용도 | 예시 |
| --- | --- | --- |
| `main` | 발표·제출·배포가 가능한 안정 버전 | `main` |
| `feature/<작업명>` | 새 기능 | `feature/23-news-collector` |
| `fix/<작업명>` | 버그 수정 | `fix/41-duplicate-articles` |
| `docs/<작업명>` | 문서·설계 산출물 | `docs/12-update-uml` |
| `chore/<작업명>` | 설정·빌드·도구 작업 | `chore/8-add-ci` |

- 브랜치 이름은 영문 소문자와 숫자를 사용하고, 단어는 `-`로 구분합니다.
- GitHub Issue가 있으면 작업명 앞에 이슈 번호를 붙입니다.
- 브랜치 하나에는 이슈 하나만 담습니다.
- 팀원 이름별 장기 브랜치는 만들지 않습니다.
- 긴급 수정도 규모가 작다면 `fix/`를 사용합니다. `hotfix/`, `release/`, `develop`은 필요해질 때만 추가합니다.

## 작업 순서

1. GitHub Issue를 만들고 담당자를 정합니다.
2. 최신 `main`에서 작업 브랜치를 만듭니다.

   ```bash
   git switch main
   git pull origin main
   git switch -c feature/23-news-collector
   ```

3. 기능, 테스트, 문서를 가능한 작은 단위로 커밋합니다.
4. 브랜치를 원격에 올리고 `main`을 대상으로 PR을 만듭니다.

   ```bash
   git push -u origin feature/23-news-collector
   ```

5. 최소 1명의 리뷰 승인을 받은 뒤 **Squash and merge**로 병합합니다.
6. 병합된 작업 브랜치는 로컬과 원격에서 삭제합니다.

## 커밋 메시지

커밋 제목은 `<종류>: <변경 내용>` 형식을 사용합니다.

```text
feat: 뉴스 수집기 추가
fix: 중복 기사 저장 방지
docs: 클래스 다이어그램 갱신
chore: 테스트 실행 명령 추가
refactor: 기사 분류 로직 분리
test: 언론사 필터 테스트 추가
```

제목은 변경 결과를 한 문장으로 적고, 서로 관련 없는 변경은 별도 커밋으로 나눕니다.

## PR 규칙

- PR 제목도 커밋 메시지와 같은 형식을 사용합니다.
- 본문에 관련 이슈를 `Closes #이슈번호`로 연결합니다.
- 작성자는 리뷰 요청 전에 직접 변경 내용을 다시 확인합니다.
- 기능 변경에는 확인 방법이나 테스트 결과를 적습니다.
- 화면 또는 산출물 변경에는 필요할 때 비교 이미지나 파일을 첨부합니다.
- 리뷰 의견과 충돌을 모두 해결한 뒤 병합합니다.
- `main`에는 직접 push하지 않습니다.

## 충돌 처리

PR에 충돌이 생기면 작업 브랜치에서 최신 `main`을 병합하고, 해결 결과를 다시 push합니다.

```bash
git fetch origin
git switch feature/23-news-collector
git merge origin/main
git push
```

충돌 해결이 익숙하지 않으면 혼자 강제 push하지 말고 팀원과 함께 확인합니다.

## GitHub 권장 설정

저장소 관리자 권한이 있는 팀원은 `main` 브랜치에 다음 보호 규칙을 설정합니다.

- Pull Request 없이 병합 금지
- 승인 리뷰 1개 이상 요구
- 모든 리뷰 대화 해결 요구
- CI가 있다면 상태 검사 통과 요구
- 강제 push와 브랜치 삭제 금지
- 병합 방식은 **Squash merging**만 허용

API 키, 비밀번호, 개인정보, 저작권 문제가 있는 원문 데이터는 커밋하지 않습니다.
