import assert from "node:assert/strict";
import test from "node:test";

import {
  ArticleExtractionError,
  extractArticleBody,
  extractArticleTopic,
} from "../worker/article-extractor.mjs";

function paragraphs(prefix, count = 10) {
  return Array.from(
    { length: count },
    (_, index) =>
      `${prefix} ${index + 1}문단입니다. 정부와 국회, 시민단체의 설명을 함께 전하며 사건의 배경과 쟁점, 이후 절차를 구체적으로 설명합니다.`,
  );
}

test("prefers a free NewsArticle JSON-LD body over page-shell text", () => {
  const body = paragraphs("구조화 본문").join("\n");
  const html = `
    <html>
      <head>
        <script type="application/ld+json">${JSON.stringify({
          "@context": "https://schema.org",
          "@type": "NewsArticle",
          isAccessibleForFree: true,
          articleBody: body,
        })}</script>
      </head>
      <body><nav>홈 정치 경제 사회 로그인</nav><article>짧은 기사 요약</article></body>
    </html>`;
  const result = extractArticleBody(html);
  assert.equal(result.bodyText, body);
  assert.equal(result.strategy, "json-ld");
  assert.ok(result.quality >= 0.8);
});

test("rejects an explicit structured paywall instead of using an embedded body", () => {
  const body = paragraphs("유료 기사").join("\n");
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "NewsArticle",
    isAccessibleForFree: false,
    articleBody: body,
  })}</script>`;
  assert.throws(
    () => extractArticleBody(html),
    (error) => error instanceof ArticleExtractionError && error.code === "ACCESS_RESTRICTED",
  );
});

test("extracts a Chosun-style body and removes nested ads and recommendations", () => {
  const body = paragraphs("조선일보 공개 기사");
  const html = `
    <main>
      <div id="news_body_id">
        <p>${body[0]}</p>
        <div class="article-ad"><a href="/ad">광고 상품 구매하기</a></div>
        ${body.slice(1).map((paragraph) => `<p>${paragraph}</p>`).join("")}
        <section class="related-news"><a href="/other">관련 기사 열두 건 보기</a></section>
        <script>window.secret = "본문 아님";</script>
      </div>
    </main>`;
  const result = extractArticleBody(html, { hostname: "www.chosun.com", sourceId: "chosun" });
  assert.equal(result.strategy, "source-selector");
  assert.match(result.bodyText, /조선일보 공개 기사 10문단/);
  assert.doesNotMatch(result.bodyText, /광고 상품|관련 기사|window\.secret/);
  assert.ok(result.quality >= 0.75);
});

test("maps structured article sections only to the four approved research topics", () => {
  const html = (articleSection) => `<script type="application/ld+json">${JSON.stringify({
    "@type": "NewsArticle",
    articleSection,
  })}</script>`;
  assert.equal(extractArticleTopic(html("정치")), "politics");
  assert.equal(extractArticleTopic(html("경제")), "economy");
  assert.equal(extractArticleTopic(html("사회")), "society");
  assert.equal(extractArticleTopic(html("국제")), "international");
  assert.equal(extractArticleTopic(html("문화")), "excluded");
  assert.equal(
    extractArticleTopic('<script type="application/ld+json">{malformed}</script><a class="category-name" href="/news/pc/category/category.do?ctcd&#x3D;0006">분류</a>'),
    "international",
  );
  assert.equal(extractArticleTopic("<html></html>"), null);
});

test("extracts current Chosun and Donga body containers", () => {
  const chosunBody = paragraphs("조선일보 공개 기사", 9);
  const chosun = extractArticleBody(
    `<div id="article">${chosunBody.map((paragraph) => `<p>${paragraph}</p>`).join("")}</div>`,
    { hostname: "www.chosun.com", sourceId: "chosun" },
  );
  assert.equal(chosun.strategy, "source-selector");
  assert.match(chosun.bodyText, /조선일보 공개 기사 9문단/);

  const dongaBody = paragraphs("동아일보 공개 기사", 9);
  const donga = extractArticleBody(
    `<div class="view_body">${dongaBody.map((paragraph) => `<p>${paragraph}</p>`).join("")}</div>`,
    { hostname: "www.donga.com", sourceId: "donga" },
  );
  assert.equal(donga.strategy, "source-selector");
  assert.match(donga.bodyText, /동아일보 공개 기사 9문단/);
});

test("extracts a Hankookilbo article-view-content-div body", () => {
  const body = paragraphs("한국일보 공개 기사", 9);
  const html = `
    <div class="article-view-content-div">
      ${body.map((paragraph) => `<p class="editor-p">${paragraph}</p>`).join("")}
      <div class="reporter"><span>홍길동 기자</span><span>writer@example.test</span></div>
      <footer>무단 전재 및 재배포 금지</footer>
    </div>`;
  const result = extractArticleBody(html, {
    hostname: "www.hankookilbo.com",
    sourceId: "hankookilbo",
  });
  assert.equal(result.strategy, "source-selector");
  assert.match(result.bodyText, /한국일보 공개 기사 9문단/);
  assert.doesNotMatch(result.bodyText, /writer@example|무단 전재/);
});

test("extracts only article-shaped fields from inert Next.js JSON state", () => {
  const body = paragraphs("상태 데이터 기사", 8).map((paragraph) => `<p>${paragraph}</p>`).join("");
  const html = `
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          article: {
            title: "기사 제목",
            body,
          },
          navigation: { content: "홈 정치 경제 사회 문화 로그인 회원가입" },
        },
      },
    })}</script>`;
  const result = extractArticleBody(html);
  assert.equal(result.strategy, "script-state");
  assert.match(result.bodyText, /상태 데이터 기사 8문단/);
  assert.doesNotMatch(result.bodyText, /회원가입/);
});

test("extracts Chosun Arc text elements from inert Fusion metadata without evaluating JavaScript", () => {
  const body = paragraphs("조선일보 Fusion 기사", 9);
  const globalContent = {
    type: "story",
    content_elements: body.map((content) => ({ type: "text", content: `<p>${content}</p>` })),
    related_content: { content: "관련 기사 본문은 섞이면 안 됩니다." },
  };
  const html = `
    <div id="article"></div>
    <script id="fusion-metadata" type="application/javascript">
      window.Fusion = window.Fusion || {};
      Fusion.globalContent = ${JSON.stringify(globalContent)};
      window.mustNotRun = true;
    </script>`;
  const result = extractArticleBody(html, { hostname: "www.chosun.com", sourceId: "chosun" });
  assert.equal(result.strategy, "script-state");
  assert.match(result.bodyText, /조선일보 Fusion 기사 9문단/);
  assert.doesNotMatch(result.bodyText, /관련 기사 본문|mustNotRun/);
});

test("rejects a visible subscription gate and a contaminated article shell", () => {
  const gated = `
    <article><p>${paragraphs("미리보기", 3).join("</p><p>")}</p></article>
    <div class="paywall"><strong>기사를 계속 읽으시려면 로그인 후 구독해 주세요.</strong></div>`;
  assert.throws(
    () => extractArticleBody(gated),
    (error) => error instanceof ArticleExtractionError && error.code === "ACCESS_RESTRICTED",
  );

  const shell = `
    <article>
      <nav>${Array.from({ length: 40 }, (_, index) => `<a href="/${index}">메뉴 ${index}</a>`).join("")}</nav>
      <p>짧은 화면 요약만 제공됩니다.</p>
      <section class="popular-news">많이 본 뉴스 관련 기사 추천 기사</section>
    </article>`;
  assert.throws(
    () => extractArticleBody(shell),
    (error) => error instanceof ArticleExtractionError && error.code === "BODY_UNAVAILABLE",
  );
});
