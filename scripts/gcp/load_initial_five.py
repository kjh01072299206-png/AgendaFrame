"""Load the 2026-07-26 initial-five analysis into BigQuery and Cloud Storage.

The site already ships this analysis as static artifacts. This script puts the
same result into the Google Cloud ledger the architecture document describes,
so the analysis can be queried rather than only rendered.

What it writes:

  agendaframe.collection_runs   one row describing the 2026-07-26 analysis run
  agendaframe.articles          25 rows of metadata — no body, hash only
  agendaframe.frame_analyses    25 structured frame profiles as JSON
  gs://<bucket>/snapshots/<basis>/<sha>/   the public manifest and issue bundles
  gs://<bucket>/snapshots/current.json     pointer replaced last, atomically

Article bodies never leave the local machine. `articles.jsonl` carries
`body_text` for local analysis; this loader drops it and keeps the sha256 that
the published profile already exposes. A guard rejects the run if a forbidden
key survives into any row, mirroring the site's public contract test.

Dry run by default. Nothing is written without --apply.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parents[2]

PROJECT_ID = "project-40bc06fc-fb4b-46b6-a10"
REGION = "asia-northeast3"
DATASET = "agendaframe"
BUCKET = f"{PROJECT_ID}-agendaframe-private"

BASIS_DATE = "2026-07-26"
SOURCE_POLICY_VERSION = "config/source-policies.yaml"

ARTICLES_JSONL = REPO_ROOT / "tmp" / "initial-five-prepared" / "articles.jsonl"
SEMANTIC_DIRS = [REPO_ROOT / "site" / "data" / f"semantic-rank{rank}-{BASIS_DATE}" for rank in range(1, 6)]
PUBLIC_DIR = REPO_ROOT / "site" / "public" / "initial-five"

# The same list the site's contract test enforces. If any of these reaches a
# row we abort rather than upload — a hash is publishable, a body is not.
FORBIDDEN_KEYS = frozenset(
    {"raw_body", "body_text", "sentence_text", "html", "full_article", "article_content", "full_content"}
)


class LoadError(RuntimeError):
    pass


@dataclass(frozen=True)
class Plan:
    run: dict[str, Any]
    articles: list[dict[str, Any]]
    analyses: list[dict[str, Any]]
    objects: list[tuple[str, Path]]
    snapshot_prefix: str


def _forbidden_paths(value: Any, path: str = "") -> Iterable[str]:
    if isinstance(value, dict):
        for key, child in value.items():
            here = f"{path}.{key}" if path else key
            if key in FORBIDDEN_KEYS:
                yield here
            yield from _forbidden_paths(child, here)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _forbidden_paths(child, f"{path}[{index}]")


def assert_clean(rows: Iterable[dict[str, Any]], label: str) -> None:
    hits = sorted({hit for row in rows for hit in _forbidden_paths(row)})
    if hits:
        raise LoadError(f"{label}: 금지된 키가 남아 있습니다 — {', '.join(hits)}")


def read_articles() -> dict[str, dict[str, Any]]:
    if not ARTICLES_JSONL.exists():
        raise LoadError(f"기사 메타데이터가 없습니다: {ARTICLES_JSONL}")
    out: dict[str, dict[str, Any]] = {}
    for line in ARTICLES_JSONL.read_text(encoding="utf-8").splitlines():
        if line.strip():
            record = json.loads(line)
            out[record["article_id"]] = record
    return out


def read_profiles() -> list[dict[str, Any]]:
    profiles: list[dict[str, Any]] = []
    for directory in SEMANTIC_DIRS:
        if not directory.is_dir():
            raise LoadError(f"시맨틱 프로필 디렉터리가 없습니다: {directory}")
        for path in sorted(directory.glob("*.json")):
            profiles.append(json.loads(path.read_text(encoding="utf-8")))
    return profiles


def build_plan() -> Plan:
    sources = read_articles()
    profiles = read_profiles()
    if len(profiles) != 25:
        raise LoadError(f"프로필이 25건이어야 하는데 {len(profiles)}건입니다")

    analyzed_at = None
    article_rows: list[dict[str, Any]] = []
    analysis_rows: list[dict[str, Any]] = []

    for entry in profiles:
        article_id = entry["articleId"]
        profile = entry["profile"]
        meta = profile["article"]
        lineage = profile["lineage"]
        engine = profile["engine"]
        review = profile.get("review", {})
        source = sources.get(article_id)
        if source is None:
            raise LoadError(f"프로필에 대응하는 기사 메타데이터가 없습니다: {article_id}")

        collected_at = source["collected_at"]
        analyzed_at = analyzed_at or collected_at

        # body_text 는 여기서 버린다. 게시된 프로필이 이미 노출하는 해시만 남긴다.
        article_rows.append(
            {
                "article_id": article_id,
                "source_id": source["source_id"],
                "canonical_url": source["canonical_url"],
                "title": source["title"],
                "published_at": source["published_at"],
                "collected_at": collected_at,
                "section": source.get("section"),
                "body_hash": meta.get("body_sha256"),
                "body_object": None,
                "text_scope": source["text_scope"],
            }
        )

        analysis_rows.append(
            {
                "analysis_key": lineage["approval"]["fingerprint"],
                "article_id": article_id,
                "decision": review.get("analysis_decision", "analyze"),
                "profile_json": json.dumps(profile, ensure_ascii=False),
                "model_id": lineage["model_id"],
                "prompt_version": lineage["prompt_version"],
                "schema_version": int(lineage["model_output_schema_version"]),
                "input_tokens": None,
                "output_tokens": None,
                "review_status": engine.get("status", "semantic_draft"),
                "publication_status": "published",
                "published_at": collected_at,
                "analyzed_at": collected_at,
            }
        )

    assert_clean(article_rows, "articles")
    # profile_json 은 이미 문자열이므로 구조 검사가 통하지 않는다. 원본을 직접 본다.
    assert_clean([entry["profile"] for entry in profiles], "frame_analyses.profile_json")

    manifest_path = PUBLIC_DIR / "manifest.json"
    if not manifest_path.exists():
        raise LoadError(f"공개 매니페스트가 없습니다: {manifest_path} (npm run data:build:initial-five)")
    manifest_bytes = manifest_path.read_bytes()
    snapshot_id = hashlib.sha256(manifest_bytes).hexdigest()[:12]
    prefix = f"snapshots/{BASIS_DATE}/{snapshot_id}"

    objects = [(f"{prefix}/manifest.json", manifest_path)]
    for path in sorted((PUBLIC_DIR / "issues").glob("*.json")):
        objects.append((f"{prefix}/issues/{path.name}", path))

    manifest = json.loads(manifest_bytes)
    run = {
        "run_id": f"initial-five-{BASIS_DATE}-{snapshot_id}",
        "started_at": analyzed_at,
        "finished_at": analyzed_at,
        "status": "succeeded",
        "discovered_articles": int(manifest["articleCount"]),
        "analyzed_articles": len(analysis_rows),
        "estimated_cost_usd": None,
        "source_policy_version": SOURCE_POLICY_VERSION,
        "code_version": manifest["schemaVersion"],
    }

    return Plan(run=run, articles=article_rows, analyses=analysis_rows, objects=objects, snapshot_prefix=prefix)


def describe(plan: Plan) -> None:
    print(f"프로젝트   {PROJECT_ID} ({REGION})")
    print(f"데이터셋   {DATASET}")
    print()
    print(f"  collection_runs  1건    run_id={plan.run['run_id']}")
    print(f"  articles         {len(plan.articles)}건   본문 없음, body_hash 만")
    print(f"  frame_analyses   {len(plan.analyses)}건")
    models = sorted({row["model_id"] for row in plan.analyses})
    print(f"                   모델 {', '.join(models)}")
    print()
    print(f"버킷       gs://{BUCKET}/{plan.snapshot_prefix}/")
    print(f"  객체 {len(plan.objects)}개 + 포인터 snapshots/current.json")
    print()
    print("금지 키 검사 통과. 기사 본문·문장 원문은 어떤 행에도 없습니다.")


def apply(plan: Plan, *, skip_storage: bool) -> None:
    from google.cloud import bigquery, storage

    client = bigquery.Client(project=PROJECT_ID, location=REGION)
    for table, rows in (
        ("collection_runs", [plan.run]),
        ("articles", plan.articles),
        ("frame_analyses", plan.analyses),
    ):
        target = f"{PROJECT_ID}.{DATASET}.{table}"
        errors = client.insert_rows_json(target, rows, row_ids=[None] * len(rows))
        if errors:
            raise LoadError(f"{table} 적재 실패: {errors}")
        print(f"  적재 {table} {len(rows)}건")

    if skip_storage:
        print("  Cloud Storage 업로드는 --skip-storage 로 건너뜁니다")
        return

    bucket = storage.Client(project=PROJECT_ID).bucket(BUCKET)
    for name, path in plan.objects:
        blob = bucket.blob(name)
        blob.cache_control = "public, max-age=31536000, immutable"
        blob.upload_from_filename(str(path), content_type="application/json")
    print(f"  업로드 {len(plan.objects)}개 → gs://{BUCKET}/{plan.snapshot_prefix}/")

    # 포인터는 마지막에 바꾼다. 스냅샷 객체가 다 올라간 뒤라야 유효하다.
    pointer = bucket.blob("snapshots/current.json")
    pointer.cache_control = "no-cache"
    pointer.upload_from_string(
        json.dumps({"basisDate": BASIS_DATE, "prefix": plan.snapshot_prefix}, ensure_ascii=False),
        content_type="application/json",
    )
    print("  포인터 snapshots/current.json 교체")


def main(argv: list[str] | None = None) -> int:
    # 윈도 기본 콘솔은 cp949 라서 한국어 출력이 깨지거나 예외로 죽는다.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="실제로 적재한다. 없으면 계획만 출력한다")
    parser.add_argument("--skip-storage", action="store_true", help="BigQuery 만 적재하고 버킷은 건너뛴다")
    args = parser.parse_args(argv)

    try:
        plan = build_plan()
    except LoadError as error:
        print(f"중단: {error}", file=sys.stderr)
        return 1

    describe(plan)
    if not args.apply:
        print()
        print("계획만 출력했습니다. 실제 적재는 --apply 를 붙이십시오.")
        return 0

    print()
    try:
        apply(plan, skip_storage=args.skip_storage)
    except LoadError as error:
        print(f"중단: {error}", file=sys.stderr)
        return 1
    print("완료.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
