# 배포 방법 (site — Next 앱)

실배포 주소: <https://agendaframe-capstone.vercel.app>

## 누가 어떻게 배포하는가

프로덕션은 **GitHub Actions 의 `Site Gate` 워크플로**가 소유한다. `main` 에 push 하면
아래 관문을 전부 통과한 뒤에만 프로덕션에 나간다. 통과하지 못하면 배포되지 않는다.

```
타입검사 → 린트 → 계약·커뮤니티 테스트 → next build
→ 렌더 채점기 (규칙 18 × 라우트 14 × 뷰포트 5)
→ 프로덕션 배포 → 라이브 4개 경로 200 확인
```

팀원은 **Vercel 계정도 토큰도 필요 없다.** `main` 에 push 하거나, 저장소 Actions 탭에서
`Site Gate` → `Run workflow` 를 누르면 된다.

Vercel Git 연결은 **미리보기 전용**이다. `main` 은 `site/vercel.json` 의
`git.deploymentEnabled.main = false` 로 자동 배포를 끄고, 다른 브랜치와 PR 에서만
미리보기 URL 을 만든다. 프로덕션 배포 경로를 하나로 유지해 push 한 번에 두 번
배포되는 일을 막는다.

> Git 연결이 프로덕션까지 담당하게 하려면 `site/vercel.json` 의 `git` 블록만 지우면
> 된다. 그때는 관문을 통과하지 않은 커밋도 그대로 나간다는 점을 감수하는 것이다.

## 한 번만 하는 설정

저장소 Settings → Secrets and variables → Actions

| 종류 | 이름 | 값 | 상태 |
| --- | --- | --- | --- |
| Variable | `VERCEL_ORG_ID` | `team_Ni5Kgag17JWRkgmxRsYgppWS` | 등록됨 |
| Variable | `VERCEL_PROJECT_ID` | `prj_PPcR6Fa5hsyK13daz9G1G9HyIIMX` | 등록됨 |
| Secret | `VERCEL_TOKEN` | <https://vercel.com/account/tokens> 에서 발급 (Scope: 팀 `af`) | **소유자가 넣어야 함** |

`VERCEL_TOKEN` 이 없으면 워크플로는 검사만 하고 배포 단계를 건너뛴다(실패가 아니다).
그동안 프로덕션 배포는 소유자가 로컬에서 한다.

Vercel 프로젝트 설정(이미 적용됨):

- Root Directory `site` — 저장소 루트가 아니라 앱 디렉터리에서 빌드한다
- Framework `nextjs`
- Ignored Build Step `git diff --quiet HEAD^ HEAD ./` — `site/` 밖만 바뀐 커밋은 빌드 생략

Vercel Git 연결(미리보기)은 GitHub 앱 설치가 필요하다: <https://github.com/apps/vercel>
설치 후 `npx vercel git connect` 로 연결한다.

## 배포 전에 로컬에서 같은 검사 돌리기

```bash
cd site
npm ci
npm run typecheck && npm run lint && npm test
npx playwright install chromium          # 렌더 채점기용 브라우저 (한 번만)
npx next build && npx next start -p 3000 &
node scripts/audit-site.mjs --url http://127.0.0.1:3000
```

채점기는 `error` 가 하나라도 있으면 종료 코드 1 이다. 윈도·맥·리눅스에서 모두 돌아간다
(브라우저를 `PLAYWRIGHT_BROWSERS_PATH`, `%LOCALAPPDATA%/ms-playwright`,
`~/.cache/ms-playwright` 순으로 찾는다).

## 커뮤니티·자가점검 저장소는 별개 배포다

`/api/community/*`, `/api/self-check` 는 이 Next 앱이 아니라 워커(+D1)에 있고,
`site/next.config.ts` 의 fallback rewrite 로 그 오리진에 넘어간다. 그 워커를 올리고
마이그레이션 `site/drizzle/0009_community_service.sql`, `0010_reaction_rate_limit.sql` 을
적용해야 커뮤니티가 실데이터로 뜬다. Vercel 배포로는 해결되지 않는다.

워커의 전역 라우트가 배포된 뒤 Vercel 환경변수 `NEXT_PUBLIC_COMMUNITY_API=1` 을 켜면
화면이 예시 모드에서 실데이터로 전환된다.
