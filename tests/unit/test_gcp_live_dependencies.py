from __future__ import annotations

import json
import unittest
from datetime import UTC, datetime

from backend.gcp_live_dependencies import FetchedResponse, NewsArticleParser
from backend.gcp_stage_adapters import SourceDefinition

COLLECTED_AT = datetime(2026, 8, 13, 6, 0, tzinfo=UTC)
SOURCE = SourceDefinition("khan", ("khan.co.kr",), ("https://khan.co.kr/rss",))
LONG_BODY = " ".join(
    [
        "The article reports the verified event and identifies the relevant public actors.",
        "It describes the timeline, the stated response, and the consequences for residents.",
        "The remaining paragraphs preserve enough visible article text for transient analysis.",
    ]
)


class FakeFetcher:
    def __init__(self, pages: dict[str, FetchedResponse]) -> None:
        self.pages = pages
        self.calls: list[str] = []

    def fetch(self, url: str, *, source_id: str) -> FetchedResponse:
        del source_id
        self.calls.append(url)
        return self.pages[url]


def rss(*links: tuple[str, str]) -> bytes:
    items = "".join(
        f"<item><title>{title}</title><link>{url}</link>"
        "<pubDate>Thu, 13 Aug 2026 10:00:00 +0900</pubDate></item>"
        for title, url in links
    )
    return f"<?xml version='1.0'?><rss><channel>{items}</channel></rss>".encode()


def article_page(
    *,
    date_published: str | None,
    body: str = LONG_BODY,
    headline: str | None = None,
    html_title: str = "Fallback article title",
) -> bytes:
    jsonld_payload = {"@type": "NewsArticle", "datePublished": date_published}
    if headline is not None:
        jsonld_payload["headline"] = headline
    jsonld = (
        f'<script type="application/ld+json">{json.dumps(jsonld_payload)}</script>'
        if date_published is not None
        else ""
    )
    return (
        f"<html><head><title>{html_title}</title>{jsonld}</head>"
        f"<body><article><p>{body}</p></article></body></html>"
    ).encode()


def parser(fetcher: FakeFetcher) -> NewsArticleParser:
    return NewsArticleParser(
        fetcher,
        collection_start="2026-08-13",
        collection_end="2026-10-31",
    )


class GcpLiveDependencyTests(unittest.TestCase):
    def test_jsonld_date_published_is_verified_and_tracking_query_is_removed(self) -> None:
        canonical = "https://khan.co.kr/article/1"
        fetcher = FakeFetcher(
            {
                canonical: FetchedResponse(
                    canonical,
                    200,
                    "text/html",
                    article_page(date_published="2026-08-13T10:30:00+09:00"),
                )
            }
        )
        response = FetchedResponse(
            "https://khan.co.kr/rss",
            200,
            "application/rss+xml",
            rss(("Event report", canonical + "?utm_source=fixture")),
        )

        rows = parser(fetcher).parse(
            response,
            source=SOURCE,
            endpoint_url=SOURCE.endpoint_urls[0],
            collected_at=COLLECTED_AT,
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(fetcher.calls, [canonical])
        self.assertEqual(rows[0].canonical_url, canonical)
        self.assertEqual(rows[0].published_at, datetime(2026, 8, 13, 1, 30, tzinfo=UTC))
        self.assertEqual(rows[0].body_text, LONG_BODY)
        self.assertEqual(rows[0].text_scope, "authorized_transient_body")
        self.assertEqual(rows[0].title_source, "html_title")

    def test_known_publisher_body_containers_are_extracted(self) -> None:
        cases = (
            ("cont_newstext", "KBS body " + LONG_BODY),
            ("article-body", "Chosun body " + LONG_BODY),
            ("view_body", "Donga body " + LONG_BODY),
        )
        for selector, expected in cases:
            with self.subTest(selector=selector):
                html = (
                    "<html><head><title>Publisher title</title>"
                    "<script type='application/ld+json'>"
                    f"{json.dumps({'@type': 'NewsArticle', 'datePublished': '2026-08-13T10:30:00+09:00'})}"
                    f"</script></head><body><div id='{selector}'><p>{expected}</p>"
                    "</div></body></html>"
                ).encode()
                url = f"https://khan.co.kr/article/{selector}"
                fetcher = FakeFetcher(
                    {
                        url: FetchedResponse(url, 200, "text/html", html),
                    }
                )
                rows = parser(fetcher).parse(
                    FetchedResponse(
                        "https://khan.co.kr/rss",
                        200,
                        "application/rss+xml",
                        rss((selector, url)),
                    ),
                    source=SOURCE,
                    endpoint_url=SOURCE.endpoint_urls[0],
                    collected_at=COLLECTED_AT,
                )
                self.assertEqual(len(rows), 1)
                self.assertIn(expected, rows[0].body_text)

    def test_fusion_metadata_body_is_extracted_when_markup_is_client_rendered(self) -> None:
        canonical = "https://www.chosun.com/international/article/fusion"
        payload = {
            "content_elements": [
                {"type": "image", "url": "https://example.test/image"},
                {"type": "text", "content": LONG_BODY},
            ]
        }
        html = (
            "<html><head><title>Fusion title</title>"
            "<script id='fusion-metadata'>"
            f"window.Fusion.globalContent={json.dumps(payload)};Fusion.contextPath='/pf';"
            "</script><script type='application/ld+json'>"
            f"{json.dumps({'@type': 'NewsArticle', 'datePublished': '2026-08-13T10:30:00+09:00'})}"
            "</script></head><body></body></html>"
        ).encode()
        fetcher = FakeFetcher({canonical: FetchedResponse(canonical, 200, "text/html", html)})
        rows = parser(fetcher).parse(
            FetchedResponse(
                "https://khan.co.kr/rss",
                200,
                "application/rss+xml",
                rss(("Fusion", canonical)),
            ),
            source=SourceDefinition("chosun", ("chosun.com",), ("https://chosun.com/rss",)),
            endpoint_url="https://chosun.com/rss",
            collected_at=COLLECTED_AT,
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].body_text, LONG_BODY)

    def test_jsonld_headline_has_priority_and_is_traced(self) -> None:
        canonical = "https://khan.co.kr/article/headline"
        fetcher = FakeFetcher(
            {
                canonical: FetchedResponse(
                    canonical,
                    200,
                    "text/html",
                    article_page(
                        date_published="2026-08-13T10:30:00+09:00",
                        headline="JSON-LD 검증 헤드라인",
                        html_title="사이트 공통 제목",
                    ),
                )
            }
        )
        response = FetchedResponse(
            "https://khan.co.kr/rss",
            200,
            "application/rss+xml",
            rss(("RSS 후보 제목", canonical)),
        )

        rows = parser(fetcher).parse(
            response,
            source=SOURCE,
            endpoint_url=SOURCE.endpoint_urls[0],
            collected_at=COLLECTED_AT,
        )

        self.assertEqual(rows[0].title, "JSON-LD 검증 헤드라인")
        self.assertEqual(rows[0].title_source, "jsonld_headline")

    def test_html_listing_text_is_not_a_title_fallback(self) -> None:
        canonical = "https://khan.co.kr/article/no-headline"
        fetcher = FakeFetcher(
            {
                canonical: FetchedResponse(
                    canonical,
                    200,
                    "text/html",
                    (
                        "<html><head><script type='application/ld+json'>"
                        f"{json.dumps({'@type': 'NewsArticle', 'datePublished': '2026-08-13T10:30:00+09:00'})}"
                        "</script></head><body><article><p>"
                        f"{LONG_BODY}</p></article></body></html>"
                    ).encode(),
                )
            }
        )
        listing = FetchedResponse(
            "https://khan.co.kr/section",
            200,
            "text/html",
            f'<html><body><a href="{canonical}">본문형 목록 설명을 제목으로 쓰지 않음</a></body></html>'.encode(),
        )

        rows = parser(fetcher).parse(
            listing,
            source=SOURCE,
            endpoint_url="https://khan.co.kr/section",
            collected_at=COLLECTED_AT,
        )

        self.assertEqual(rows, ())

    def test_date_less_html_candidate_is_not_assigned_discovery_time(self) -> None:
        canonical = "https://khan.co.kr/article/date-less"
        fetcher = FakeFetcher(
            {
                canonical: FetchedResponse(
                    canonical,
                    200,
                    "text/html",
                    article_page(date_published=None),
                )
            }
        )
        listing = FetchedResponse(
            "https://khan.co.kr/section",
            200,
            "text/html",
            f'<html><body><a href="{canonical}">A section candidate</a></body></html>'.encode(),
        )

        rows = parser(fetcher).parse(
            listing,
            source=SOURCE,
            endpoint_url="https://khan.co.kr/section",
            collected_at=COLLECTED_AT,
        )

        self.assertEqual(rows, ())
        self.assertEqual(fetcher.calls, [canonical])

    def test_out_of_window_and_short_body_candidates_are_rejected(self) -> None:
        old_url = "https://khan.co.kr/article/old"
        future_url = "https://khan.co.kr/article/future"
        short_url = "https://khan.co.kr/article/short"
        fetcher = FakeFetcher(
            {
                old_url: FetchedResponse(
                    old_url,
                    200,
                    "text/html",
                    article_page(date_published="2026-08-12T23:59:00+09:00"),
                ),
                future_url: FetchedResponse(
                    future_url,
                    200,
                    "text/html",
                    article_page(date_published="2026-11-01T00:00:00+09:00"),
                ),
                short_url: FetchedResponse(
                    short_url,
                    200,
                    "text/html",
                    article_page(
                        date_published="2026-08-13T10:00:00+09:00",
                        body="Too short.",
                    ),
                ),
            }
        )
        response = FetchedResponse(
            "https://khan.co.kr/rss",
            200,
            "application/rss+xml",
            rss(("Old", old_url), ("Future", future_url), ("Short", short_url)),
        )

        rows = parser(fetcher).parse(
            response,
            source=SOURCE,
            endpoint_url=SOURCE.endpoint_urls[0],
            collected_at=COLLECTED_AT,
        )

        self.assertEqual(rows, ())
        self.assertEqual(fetcher.calls, [old_url, future_url, short_url])

    def test_disallowed_and_duplicate_urls_are_not_fetched_twice(self) -> None:
        canonical = "https://khan.co.kr/article/duplicate"
        fetcher = FakeFetcher(
            {
                canonical: FetchedResponse(
                    canonical,
                    200,
                    "text/html",
                    article_page(date_published="2026-08-13T10:00:00+09:00"),
                )
            }
        )
        response = FetchedResponse(
            "https://khan.co.kr/rss",
            200,
            "application/rss+xml",
            rss(
                ("Other domain", "https://evil.example/article/1"),
                ("First", canonical),
                ("Tracking duplicate", canonical + "?gclid=removed"),
            ),
        )

        rows = parser(fetcher).parse(
            response,
            source=SOURCE,
            endpoint_url=SOURCE.endpoint_urls[0],
            collected_at=COLLECTED_AT,
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(fetcher.calls, [canonical])

    def test_article_path_patterns_skip_navigation_candidates(self) -> None:
        canonical = "https://khan.co.kr/article/view/1"
        navigation = "https://khan.co.kr/section"
        source = SourceDefinition(
            SOURCE.source_id,
            SOURCE.domains,
            SOURCE.endpoint_urls,
            article_path_patterns=(r"/article/view/",),
        )
        fetcher = FakeFetcher(
            {
                canonical: FetchedResponse(
                    canonical,
                    200,
                    "text/html",
                    article_page(date_published="2026-08-13T10:00:00+09:00"),
                ),
            }
        )
        response = FetchedResponse(
            "https://khan.co.kr/section",
            200,
            "text/html",
            (f'<a href="{navigation}">Navigation</a><a href="{canonical}">Article</a>').encode(),
        )

        rows = parser(fetcher).parse(
            response,
            source=source,
            endpoint_url="https://khan.co.kr/section",
            collected_at=COLLECTED_AT,
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(fetcher.calls, [canonical])

    def test_source_policy_record_limit_is_respected(self) -> None:
        first = "https://khan.co.kr/article/first"
        second = "https://khan.co.kr/article/second"
        limited_source = SourceDefinition(
            SOURCE.source_id,
            SOURCE.domains,
            SOURCE.endpoint_urls,
            max_records_per_run=1,
        )
        fetcher = FakeFetcher(
            {
                url: FetchedResponse(
                    url,
                    200,
                    "text/html",
                    article_page(date_published="2026-08-13T10:00:00+09:00"),
                )
                for url in (first, second)
            }
        )
        response = FetchedResponse(
            SOURCE.endpoint_urls[0],
            200,
            "application/rss+xml",
            rss(("First", first), ("Second", second)),
        )

        rows = parser(fetcher).parse(
            response,
            source=limited_source,
            endpoint_url=SOURCE.endpoint_urls[0],
            collected_at=COLLECTED_AT,
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(fetcher.calls, [first])

    def test_source_request_limit_bounds_failed_or_empty_candidates(self) -> None:
        urls = [f"https://khan.co.kr/article/request-{index}" for index in range(4)]
        limited_source = SourceDefinition(
            SOURCE.source_id,
            SOURCE.domains,
            SOURCE.endpoint_urls,
            max_records_per_run=20,
            max_requests_per_run=2,
        )
        fetcher = FakeFetcher(
            {
                url: FetchedResponse(
                    url,
                    200,
                    "text/html",
                    article_page(date_published=None),
                )
                for url in urls
            }
        )
        response = FetchedResponse(
            SOURCE.endpoint_urls[0],
            200,
            "application/rss+xml",
            rss(*[(f"Candidate {index}", url) for index, url in enumerate(urls)]),
        )

        rows = parser(fetcher).parse(
            response,
            source=limited_source,
            endpoint_url=SOURCE.endpoint_urls[0],
            collected_at=COLLECTED_AT,
        )

        self.assertEqual(len(rows), 2)
        self.assertEqual(fetcher.calls, urls[:2])


if __name__ == "__main__":
    unittest.main()
