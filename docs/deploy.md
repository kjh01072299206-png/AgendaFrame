# 배포 방법 (site — Next 앱)

실배포 주소: <https://agendaframe-capstone.vercel.app>

## 누가 어떻게 배포하는가

목표는 하나다: **팀원이 `main` 에 push 하면 실배포가 갱신된다. Vercel 계정도 토큰도
필요 없다.** 그 상태를 만드는 경로가 두 개 있고, **둘 중 하나만 켠다.** 둘 다 켜면
push 한 번에 두 번 배포된다.

| | ① Vercel Git 연결이 배포 | ② Site Gate 워크플로가 배포 |
| --- | --- | --- |
| 소유자가 할 일 | GitHub 앱 설치 (클릭 4번) | 토큰 발급 + 시크릿 붙여넣기 |
| 검사와의 관계 | 배포와 **나란히** 돈다 | 검사를 **통과해야** 배포된다 |
| 빨간불의 뜻 | 배포됐지만 검사에 걸렸다 → 되돌린다 | 배포되지 않았다 |
| 미리보기(PR·브랜치) | 생긴다 | 없다 |

어느 쪽이든 워크플로는 같은 관문을 돌린다.

```
타입검사 → 린트 → 계약·커뮤니티 테스트 → next build
→ 렌더 채점기 (규칙 18 × 라우트 14 × 뷰포트 5)
→ (② 일 때) 프로덕션 배포
→ 라이브에 이 커밋이 떴는지 확인 → 4개 경로 200 확인
```

마지막 확인은 `/version` 을 폴링해 **배포된 커밋 SHA** 를 대조한다(최대 10분).
200 만 보면 Vercel 이 아직 빌드하는 동안 이전 빌드를 초록불로 오인하기 때문이다.

### ① 이 켜져 있다 (2026-08-06 ~)

**팀원은 `main` 에 push 만 하면 된다. Vercel 계정도 토큰도 필요 없다.**
다른 브랜치에 push 하면 미리보기 URL 이 생긴다.

켠 절차는 이랬다.

1. <https://github.com/apps/vercel> → Install → `kjh01072299206-png` 계정 →
   `AgendaFrame` 저장소 접근 허용
2. 저장소 루트에서 `npx vercel git connect`
3. `gh variable set AF_DEPLOY_OWNER --body vercel-git`

확인은 `npx vercel ls agendaframe-capstone` 으로 한다. push 직후 Production 한 줄과
(다른 브랜치도 밀었다면) Preview 한 줄이 새로 생기면 연결이 살아 있는 것이다.

### ② 를 켜는 방법 (검사를 통과한 커밋만 배포)

저장소 Settings → Secrets and variables → Actions

| 종류 | 이름 | 값 | 상태 |
| --- | --- | --- | --- |
| Variable | `VERCEL_ORG_ID` | `team_Ni5Kgag17JWRkgmxRsYgppWS` | 등록됨 |
| Variable | `VERCEL_PROJECT_ID` | `prj_PPcR6Fa5hsyK13daz9G1G9HyIIMX` | 등록됨 |
| Secret | `VERCEL_TOKEN` | <https://vercel.com/account/tokens> 에서 발급 (Scope: 팀 `af`) | **소유자가 넣어야 함** |

토큰이 들어오면 `AF_DEPLOY_OWNER` 는 무시되고 워크플로가 배포를 맡는다.
그때는 ① 을 껐다는 뜻이 되도록 Vercel 대시보드에서 Git 연결을 끊거나,
`site/vercel.json` 에 `"git": { "deploymentEnabled": { "main": false } }` 를 넣는다.

### 빌드가 몇 초 만에 Canceled 로 끝났다면

대개 정상이다. 아래 Ignored Build Step 때문에 **`site/` 아래 파일이 하나도 바뀌지
않은 커밋은 Vercel 이 건너뛴다.** 문서·워크플로만 고친 커밋, 빈 커밋이 그렇다.
라이브는 이전 빌드 그대로 남는다. `site/` 를 고쳤는데도 Canceled 라면 그때가 문제다.

### 손으로 배포해야 할 때

**저장소 루트에서** 실행한다.

```bash
npx vercel deploy --prod --yes    # 저장소 루트. site/ 에서 실행하면 실패한다.
```

Vercel 프로젝트 설정(이미 적용됨):

- Root Directory `site` — 저장소 루트를 받아 `site/` 에서 빌드한다
- Framework `nextjs`
- Ignored Build Step `git diff --quiet HEAD^ HEAD ./` — `site/` 밖만 바뀐 커밋은 빌드 생략

Root Directory 가 `site` 이므로 CLI 도 저장소 루트에서 실행해야 한다(`site/` 에서
실행하면 Vercel 이 `site/site` 를 찾는다). 그러면 저장소 전체가 업로드 대상이 되어
`tmp/` 만으로 파일 한도 15,000 개를 넘기므로, 루트 `.vercelignore` 가 업로드를
`site/` 로 좁힌다(317개). 워크플로의 배포 단계도 같은 이유로 루트에서 돈다.

## 지금 실배포에 뜬 커밋 확인하기

```bash
curl -s https://agendaframe-capstone.vercel.app/version
# {"commit":"f9fe952…","shortCommit":"f9fe952","ref":"…","buildEnv":"production"}
```

`site/app/version/route.ts` 가 빌드 환경의 `VERCEL_GIT_COMMIT_SHA` 를 그대로
돌려준다. 배포 확인이 "200 이 떴다" 에서 멈추면 Vercel 이 아직 빌드하는 동안
이전 빌드를 초록불로 오인하기 때문에, 워크플로는 이 값을 `github.sha` 와 대조한다.

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
