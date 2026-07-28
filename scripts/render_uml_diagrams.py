from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "outputs"
OUT = DEFAULT_OUT

INK = "#202939"
MUTED = "#667085"
LINE = "#7D8A9C"
NAVY = "#14233C"
BLUE = "#DCEAFF"
BLUE_LINE = "#4D7EDB"
GREEN = "#DFF4E8"
GREEN_LINE = "#2E9B69"
ORANGE = "#FFF0DE"
ORANGE_LINE = "#E1842D"
PURPLE = "#EEE7FA"
PURPLE_LINE = "#8765B4"
YELLOW = "#FFF6D8"
YELLOW_LINE = "#D7A91F"
PINK = "#F9E3E6"
PINK_LINE = "#BF6B74"
PANEL = "#F8FAFC"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/malgunbd.ttf" if bold else "C:/Windows/Fonts/malgun.ttf"),
        Path("C:/Windows/Fonts/NotoSansKR-Bold.ttf" if bold else "C:/Windows/Fonts/NotoSansKR-Regular.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


F_TITLE = font(42, True)
F_PACKAGE = font(23, True)
F_CLASS = font(21, True)
F_STEREO = font(14)
F_BODY = font(15)
F_BODY_BOLD = font(15, True)
F_SMALL = font(14)
F_SEQ_TITLE = font(36, True)
F_SEQ_HEADER = font(17, True)
F_SEQ = font(16)
F_SEQ_SMALL = font(14)


def text_size(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.ImageFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def wrap(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.ImageFont, max_width: int) -> list[str]:
    result: list[str] = []
    for paragraph in text.split("\n"):
        if not paragraph:
            result.append("")
            continue
        current = ""
        for ch in paragraph:
            trial = current + ch
            if not current or text_size(draw, trial, fnt)[0] <= max_width:
                current = trial
            else:
                result.append(current)
                current = ch
        if current:
            result.append(current)
    return result


def centered_text(
    draw: ImageDraw.ImageDraw,
    rect: tuple[int, int, int, int],
    text: str,
    fnt: ImageFont.ImageFont,
    fill: str = INK,
    gap: int = 4,
) -> None:
    x1, y1, x2, y2 = rect
    lines = wrap(draw, text, fnt, x2 - x1 - 16)
    heights = [text_size(draw, line, fnt)[1] for line in lines]
    total = sum(heights) + gap * max(0, len(lines) - 1)
    cy = y1 + (y2 - y1 - total) / 2
    for line, height in zip(lines, heights):
        width, _ = text_size(draw, line, fnt)
        draw.text((x1 + (x2 - x1 - width) / 2, cy), line, fill=fill, font=fnt)
        cy += height + gap


def dashed_line(
    draw: ImageDraw.ImageDraw,
    start: tuple[int, int],
    end: tuple[int, int],
    fill: str = LINE,
    width: int = 2,
    dash: int = 10,
    gap: int = 7,
) -> None:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = math.hypot(dx, dy)
    if not length:
        return
    ux, uy = dx / length, dy / length
    pos = 0.0
    while pos < length:
        end_pos = min(pos + dash, length)
        draw.line(
            (
                start[0] + ux * pos,
                start[1] + uy * pos,
                start[0] + ux * end_pos,
                start[1] + uy * end_pos,
            ),
            fill=fill,
            width=width,
        )
        pos += dash + gap


def arrow_head(
    draw: ImageDraw.ImageDraw,
    start: tuple[int, int],
    end: tuple[int, int],
    fill: str = INK,
    size: int = 11,
) -> None:
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    left = (
        end[0] - size * math.cos(angle - math.pi / 6),
        end[1] - size * math.sin(angle - math.pi / 6),
    )
    right = (
        end[0] - size * math.cos(angle + math.pi / 6),
        end[1] - size * math.sin(angle + math.pi / 6),
    )
    draw.polygon([end, left, right], fill=fill)


def polyline(
    draw: ImageDraw.ImageDraw,
    points: list[tuple[int, int]],
    fill: str = LINE,
    width: int = 2,
    dashed: bool = False,
    arrow: bool = True,
) -> None:
    for p1, p2 in zip(points, points[1:]):
        if dashed:
            dashed_line(draw, p1, p2, fill, width)
        else:
            draw.line((*p1, *p2), fill=fill, width=width)
    if arrow and len(points) > 1:
        arrow_head(draw, points[-2], points[-1], fill)


def package(
    draw: ImageDraw.ImageDraw,
    rect: tuple[int, int, int, int],
    title: str,
    subtitle: str = "",
) -> None:
    x1, y1, x2, y2 = rect
    draw.rounded_rectangle(rect, radius=6, fill="white", outline="#758195", width=2)
    tab_w = min(x2 - x1 - 20, max(230, text_size(draw, title, F_PACKAGE)[0] + 44))
    draw.rectangle((x1, y1, x1 + tab_w, y1 + 48), fill=PANEL, outline="#758195", width=2)
    draw.text((x1 + 16, y1 + 11), title, fill=INK, font=F_PACKAGE)
    if subtitle:
        draw.text((x1 + tab_w + 16, y1 + 16), subtitle, fill=MUTED, font=F_SMALL)


def class_box(
    draw: ImageDraw.ImageDraw,
    rect: tuple[int, int, int, int],
    stereotype: str,
    name: str,
    fields: list[str],
    methods: list[str],
    fill: str,
    outline: str,
) -> None:
    x1, y1, x2, y2 = rect
    draw.rectangle(rect, fill="white", outline=outline, width=2)
    header_h = 58
    draw.rectangle((x1, y1, x2, y1 + header_h), fill=fill, outline=outline, width=2)
    st_w, _ = text_size(draw, stereotype, F_STEREO)
    draw.text((x1 + (x2 - x1 - st_w) / 2, y1 + 6), stereotype, fill=MUTED, font=F_STEREO)
    name_w, _ = text_size(draw, name, F_CLASS)
    draw.text((x1 + (x2 - x1 - name_w) / 2, y1 + 27), name, fill=INK, font=F_CLASS)
    cy = y1 + header_h + 9
    for field in fields:
        draw.text((x1 + 11, cy), field, fill=INK, font=F_BODY)
        cy += 18
    if fields and methods:
        draw.line((x1, cy + 1, x2, cy + 1), fill="#B9C1CC", width=1)
        cy += 8
    for method in methods:
        draw.text((x1 + 11, cy), method, fill="#245C9E", font=F_BODY)
        cy += 18


def render_class_diagram() -> None:
    width, height = 2400, 1350
    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)

    draw.text((54, 35), "[Class Diagram] AgendaFrame 뉴스 의제·프레임 분석 구현 구조", fill=INK, font=F_TITLE)
    draw.line((54, 95, 2346, 95), fill="#D0D6DF", width=2)

    presentation = (50, 130, 430, 610)
    application = (470, 130, 1515, 690)
    infra = (470, 730, 1515, 1295)
    domain = (1555, 130, 2350, 1295)
    legend = (50, 655, 430, 1250)

    package(draw, presentation, "Presentation Package")
    package(draw, application, "Application / Domain Service Package")
    package(draw, infra, "Infrastructure / Data Package")
    package(draw, domain, "Domain Entity / DTO Package")

    class_box(draw, (92, 190, 388, 325), "<<React View>>", "AgendaDashboardView", ["-filters", "-rankedIssues"], ["+renderRanking()"], PINK, PINK_LINE)
    class_box(draw, (92, 335, 388, 470), "<<React View>>", "IssueDetailView", ["-selectedIssue", "-comparisonMode"], ["+renderDetail()"], PINK, PINK_LINE)
    class_box(draw, (92, 480, 388, 600), "<<React View>>", "ReportExportView", ["-reportState"], ["+requestPdf()"], PINK, PINK_LINE)

    app_cards = [
        ((505, 205, 805, 345), "<<Controller>>", "AgendaAPI", ["+GET /issues", "+GET /issues/{id}"], ["+getRankedIssues()"]),
        ((840, 205, 1140, 345), "<<Controller>>", "AnalysisAPI", ["+GET /comparison", "+GET /frames"], ["+getAnalysis()"]),
        ((1175, 205, 1475, 345), "<<Controller>>", "ReportAPI", ["+GET /report", "+POST /exports/pdf"], ["+exportPdf()"]),
        ((505, 365, 805, 520), "<<Service>>", "IssueQueryService", ["-issueRepository"], ["+findRanked()", "+findDetail()"]),
        ((840, 365, 1140, 520), "<<Service>>", "AgendaScoringService", ["-placementPolicy"], ["+calculateScore()", "+rankIssues()"]),
        ((1175, 365, 1475, 520), "<<Service>>", "FrameAnalysisService", ["-frameCodebook"], ["+analyzeFrames()", "+extractEvidence()"]),
        ((505, 555, 805, 670), "<<Batch Service>>", "ArticleCollectionService", [], ["+collectMetadata()", "+deduplicate()"]),
        ((840, 555, 1140, 670), "<<AI Service>>", "IssueClusteringService", [], ["+createEmbedding()", "+clusterArticles()"]),
        ((1175, 555, 1475, 670), "<<Service>>", "ReportGenerationService", [], ["+getOrCreate()", "+buildPrompt()"]),
    ]
    for rect, stereo, name, fields, methods in app_cards:
        class_box(draw, rect, stereo, name, fields, methods, BLUE, BLUE_LINE)

    infra_cards = [
        ((505, 810, 805, 950), "<<Crawler Adapter>>", "PlaywrightCrawler", ["-crawlRules"], ["+fetchHomepage()", "+parseMetadata()"]),
        ((840, 810, 1140, 950), "<<Repository>>", "BigQueryRepository", ["-datasetId"], ["+saveArticles()", "+findIssueDetail()"]),
        ((1175, 810, 1475, 950), "<<Storage Adapter>>", "CloudStorageClient", ["-bucketName"], ["+saveSnapshot()", "+savePdf()"]),
        ((505, 1000, 805, 1140), "<<AI Adapter>>", "VertexEmbeddingClient", ["-modelName"], ["+embed()", "+batchEmbed()"]),
        ((840, 1000, 1140, 1140), "<<AI Adapter>>", "GeminiClient", ["-promptVersion"], ["+generate()", "+validateOutput()"]),
        ((1175, 1000, 1475, 1140), "<<Scheduled Job>>", "CollectionRunJob", ["-schedule"], ["+run()", "+recordStatus()"]),
    ]
    for rect, stereo, name, fields, methods in infra_cards:
        class_box(draw, rect, stereo, name, fields, methods, PURPLE, PURPLE_LINE)

    domain_cards = [
        ((1590, 205, 1940, 350), "<<Entity>>", "MediaOutlet", ["+mediaOutletId", "+name", "+homepageUrl"], []),
        ((1980, 205, 2315, 350), "<<Value Object>>", "CrawlRule", ["+titleSelector", "+urlSelector", "+placementRule"], []),
        ((1590, 390, 1940, 550), "<<Entity>>", "ArticleMetadata", ["+articleId", "+title", "+url", "+placement", "+contentHash"], []),
        ((1980, 390, 2315, 550), "<<Entity>>", "CollectionRun", ["+runId", "+status", "+collectedCount", "+failedCount"], []),
        ((1590, 590, 1940, 750), "<<Aggregate Root>>", "NewsIssue", ["+issueId", "+title", "+summary", "+issueDate"], []),
        ((1980, 590, 2315, 750), "<<Association Entity>>", "IssueArticle", ["+issueId", "+articleId", "+similarity", "+representative"], []),
        ((1590, 790, 1940, 935), "<<Entity>>", "AgendaScore", ["+articleCount", "+mediaCount", "+totalScore"], []),
        ((1980, 790, 2315, 935), "<<Entity>>", "FrameAnalysis", ["+frameType", "+confidence", "+status"], []),
        ((1590, 975, 1940, 1120), "<<Entity>>", "AIReport", ["+summary", "+missingPerspective", "+generatedAt"], []),
        ((1980, 975, 2315, 1120), "<<Value Object>>", "FrameEvidence", ["+evidenceText", "+sourceUrl", "+confidence"], []),
    ]
    for rect, stereo, name, fields, methods in domain_cards:
        class_box(draw, rect, stereo, name, fields, methods, YELLOW, YELLOW_LINE)

    # Presentation to API associations.
    polyline(draw, [(388, 257), (505, 257)], BLUE_LINE, 2)
    polyline(draw, [(388, 402), (415, 402), (415, 190), (990, 190), (990, 205)], BLUE_LINE, 2)
    polyline(draw, [(388, 540), (402, 540), (402, 180), (1325, 180), (1325, 205)], BLUE_LINE, 2)

    # Controller and service dependencies.
    for x in (655, 990, 1325):
        dashed_line(draw, (x, 345), (x, 365), LINE, 2)
        arrow_head(draw, (x, 345), (x, 365), LINE)
    dashed_line(draw, (655, 520), (655, 555), LINE, 2)
    arrow_head(draw, (655, 520), (655, 555), LINE)
    dashed_line(draw, (990, 520), (990, 555), LINE, 2)
    arrow_head(draw, (990, 520), (990, 555), LINE)
    dashed_line(draw, (1325, 520), (1325, 555), LINE, 2)
    arrow_head(draw, (1325, 520), (1325, 555), LINE)

    # Service to infrastructure dependencies.
    links = [
        ((655, 670), (655, 810)),
        ((990, 670), (990, 810)),
        ((1325, 670), (1325, 810)),
        ((990, 670), (655, 1000)),
        ((1325, 670), (990, 1000)),
    ]
    for start, end in links:
        dashed_line(draw, start, end, LINE, 2)
        arrow_head(draw, start, end, LINE)

    # Domain relationships with multiplicities.
    polyline(draw, [(1940, 272), (1980, 272)], GREEN_LINE, 2)
    draw.text((1938, 246), "1", fill=MUTED, font=F_SMALL)
    draw.text((1962, 246), "1", fill=MUTED, font=F_SMALL)
    polyline(draw, [(1765, 350), (1765, 390)], GREEN_LINE, 2)
    draw.text((1780, 358), "0..*", fill=MUTED, font=F_SMALL)
    polyline(draw, [(1980, 470), (1960, 470), (1960, 670), (1980, 670)], GREEN_LINE, 2)
    draw.text((1948, 485), "0..*", fill=MUTED, font=F_SMALL)
    polyline(draw, [(1940, 670), (1980, 670)], GREEN_LINE, 3)
    draw.polygon([(1940, 670), (1952, 659), (1964, 670), (1952, 681)], fill=GREEN_LINE)
    draw.text((1942, 640), "1", fill=MUTED, font=F_SMALL)
    draw.text((1962, 640), "1..*", fill=MUTED, font=F_SMALL)
    polyline(draw, [(1765, 750), (1765, 790)], GREEN_LINE, 2)
    draw.text((1780, 758), "1", fill=MUTED, font=F_SMALL)
    polyline(draw, [(1765, 750), (1550, 750), (1550, 1045), (1590, 1045)], GREEN_LINE, 2)
    draw.text((1560, 1016), "0..1", fill=MUTED, font=F_SMALL)
    polyline(draw, [(2147, 935), (2147, 975)], GREEN_LINE, 2)
    draw.text((2160, 944), "1..*", fill=MUTED, font=F_SMALL)

    # Cross-package domain dependencies, kept to three clean entry points.
    for y in (415, 455, 495):
        dashed_line(draw, (1475, y), (1555, y), LINE, 2)
        arrow_head(draw, (1475, y), (1555, y), LINE)

    # Relationship legend.
    draw.rounded_rectangle(legend, radius=6, fill="white", outline="#758195", width=2)
    draw.text((72, 680), "관계 표기 범례", fill=INK, font=F_PACKAGE)
    legend_rows = [
        ("Association", "일반 연관 관계", "association"),
        ("Aggregation", "독립 가능한 약한 포함", "aggregation"),
        ("Composition", "생명주기를 공유하는 강한 포함", "composition"),
        ("Generalization", "상속·일반화 관계", "generalization"),
        ("Dependency", "사용·호출 의존 관계", "dependency"),
    ]
    ly = 742
    for label, desc, relation_type in legend_rows:
        if relation_type == "association":
            draw.line((78, ly, 170, ly), fill=BLUE_LINE, width=2)
        elif relation_type == "aggregation":
            draw.polygon(
                [(78, ly), (90, ly - 10), (102, ly), (90, ly + 10)],
                fill="white",
                outline=BLUE_LINE,
            )
            draw.line((102, ly, 170, ly), fill=BLUE_LINE, width=2)
        elif relation_type == "composition":
            draw.polygon(
                [(78, ly), (90, ly - 10), (102, ly), (90, ly + 10)],
                fill=BLUE_LINE,
            )
            draw.line((102, ly, 170, ly), fill=BLUE_LINE, width=2)
        elif relation_type == "generalization":
            draw.line((78, ly, 154, ly), fill=BLUE_LINE, width=2)
            draw.polygon(
                [(170, ly), (154, ly - 11), (154, ly + 11)],
                fill="white",
                outline=BLUE_LINE,
            )
        else:
            dashed_line(draw, (78, ly), (158, ly), BLUE_LINE, 2)
            draw.line((158, ly, 170, ly), fill=BLUE_LINE, width=2)
            draw.line((170, ly, 157, ly - 8), fill=BLUE_LINE, width=2)
            draw.line((170, ly, 157, ly + 8), fill=BLUE_LINE, width=2)
        draw.text((188, ly - 12), label, fill=INK, font=F_BODY_BOLD)
        draw.text((188, ly + 10), desc, fill=MUTED, font=F_SMALL)
        ly += 86
    draw.rounded_rectangle((72, 1170, 408, 1230), radius=7, fill="#F4F7FB", outline="#D6DEE9")
    centered_text(draw, (82, 1176, 398, 1224), "의존 방향: 화면 → API → 서비스 → 저장소/외부 AI", F_SMALL, INK)

    draw.text((50, 1315), "AgendaFrame | 구현 책임과 데이터 관계를 함께 표현한 논리 클래스 다이어그램", fill=MUTED, font=F_SMALL)
    OUT.mkdir(exist_ok=True)
    img.save(OUT / "class_diagram.png", quality=95)


def uml_relation(
    draw: ImageDraw.ImageDraw,
    points: list[tuple[int, int]],
    kind: str,
    label: str = "",
    start_mult: str = "",
    end_mult: str = "",
    label_xy: tuple[int, int] | None = None,
    start_mult_xy: tuple[int, int] | None = None,
    end_mult_xy: tuple[int, int] | None = None,
    color: str = BLUE_LINE,
) -> None:
    if kind == "dependency":
        for p1, p2 in zip(points, points[1:]):
            dashed_line(draw, p1, p2, color, 2)
    else:
        for p1, p2 in zip(points, points[1:]):
            draw.line((*p1, *p2), fill=color, width=2)

    start = points[0]
    end = points[-1]
    if kind in ("aggregation", "composition"):
        next_point = points[1]
        angle = math.atan2(next_point[1] - start[1], next_point[0] - start[0])
        along = (math.cos(angle), math.sin(angle))
        normal = (-along[1], along[0])
        p1 = start
        p2 = (start[0] + along[0] * 14 + normal[0] * 10, start[1] + along[1] * 14 + normal[1] * 10)
        p3 = (start[0] + along[0] * 28, start[1] + along[1] * 28)
        p4 = (start[0] + along[0] * 14 - normal[0] * 10, start[1] + along[1] * 14 - normal[1] * 10)
        draw.polygon([p1, p2, p3, p4], fill=color if kind == "composition" else "white", outline=color)
    elif kind == "generalization":
        prev = points[-2]
        angle = math.atan2(end[1] - prev[1], end[0] - prev[0])
        along = (math.cos(angle), math.sin(angle))
        normal = (-along[1], along[0])
        base = (end[0] - along[0] * 22, end[1] - along[1] * 22)
        p2 = (base[0] + normal[0] * 12, base[1] + normal[1] * 12)
        p3 = (base[0] - normal[0] * 12, base[1] - normal[1] * 12)
        draw.polygon([end, p2, p3], fill="white", outline=color)
    elif kind == "dependency":
        prev = points[-2]
        angle = math.atan2(end[1] - prev[1], end[0] - prev[0])
        left = (end[0] - 14 * math.cos(angle - math.pi / 6), end[1] - 14 * math.sin(angle - math.pi / 6))
        right = (end[0] - 14 * math.cos(angle + math.pi / 6), end[1] - 14 * math.sin(angle + math.pi / 6))
        draw.line((*end, *left), fill=color, width=2)
        draw.line((*end, *right), fill=color, width=2)

    if label:
        lx, ly = label_xy or ((start[0] + end[0]) // 2, (start[1] + end[1]) // 2)
        tw, _ = text_size(draw, label, F_SMALL)
        draw.rectangle((lx - tw / 2 - 5, ly - 2, lx + tw / 2 + 5, ly + 20), fill="white")
        draw.text((lx - tw / 2, ly), label, fill=MUTED, font=F_SMALL)
    if start_mult:
        sx, sy = start_mult_xy or (start[0] + 8, start[1] - 22)
        draw.text((sx, sy), start_mult, fill=MUTED, font=F_SMALL)
    if end_mult:
        ex, ey = end_mult_xy or (end[0] - 32, end[1] - 22)
        draw.text((ex, ey), end_mult, fill=MUTED, font=F_SMALL)


def compact_relationship_legend(
    draw: ImageDraw.ImageDraw,
    rect: tuple[int, int, int, int],
    horizontal: bool = False,
) -> None:
    x1, y1, x2, y2 = rect
    draw.rounded_rectangle(rect, radius=6, fill="white", outline="#758195", width=2)
    draw.text((x1 + 18, y1 + 14), "관계 표기 범례", fill=INK, font=F_PACKAGE)
    rows = [
        ("Association", "association"),
        ("Aggregation", "aggregation"),
        ("Composition", "composition"),
        ("Generalization", "generalization"),
        ("Dependency", "dependency"),
    ]
    if horizontal:
        item_w = (x2 - x1 - 36) // 5
        for idx, (label, kind) in enumerate(rows):
            ix = x1 + 18 + idx * item_w
            iy = y1 + 64
            uml_relation(draw, [(ix, iy), (ix + 80, iy)], kind, color=BLUE_LINE)
            draw.text((ix, iy + 18), label, fill=INK, font=F_BODY_BOLD)
    else:
        iy = y1 + 68
        for label, kind in rows:
            uml_relation(draw, [(x1 + 24, iy), (x1 + 120, iy)], kind, color=BLUE_LINE)
            draw.text((x1 + 142, iy - 11), label, fill=INK, font=F_BODY_BOLD)
            iy += 64


def render_domain_class_diagram() -> None:
    width, height = 2400, 1250
    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)
    draw.text((54, 34), "[Class Diagram 1] AgendaFrame 도메인 모델 및 데이터 관계", fill=INK, font=F_TITLE)
    draw.line((54, 94, 2346, 94), fill="#D0D6DF", width=2)
    draw.text((56, 108), "엔티티의 포함 관계, 생명주기, 다중성을 중심으로 표현", fill=MUTED, font=F_BODY)

    cards = {
        "media": (100, 190, 450, 350),
        "crawl": (650, 190, 1000, 350),
        "run": (1200, 190, 1550, 350),
        "article": (100, 500, 450, 690),
        "issue_article": (650, 500, 1000, 690),
        "issue": (1200, 500, 1550, 690),
        "frame": (100, 850, 450, 1040),
        "evidence": (650, 850, 1000, 1040),
        "score": (1200, 850, 1550, 1070),
        "report": (1700, 850, 2050, 1040),
    }
    specs = [
        ("media", "<<Entity>>", "MediaOutlet", ["+mediaOutletId", "+name", "+homepageUrl", "+enabled"]),
        ("crawl", "<<Value Object>>", "CrawlRule", ["+titleSelector", "+urlSelector", "+sectionSelector", "+placementRule"]),
        ("run", "<<Entity>>", "CollectionRun", ["+runId", "+status", "+collectedCount", "+failedCount"]),
        ("article", "<<Entity>>", "ArticleMetadata", ["+articleId", "+mediaOutletId", "+title", "+url", "+placement", "+contentHash"]),
        ("issue_article", "<<Association Entity>>", "IssueArticle", ["+issueId", "+articleId", "+similarity", "+representative"]),
        ("issue", "<<Aggregate Root>>", "NewsIssue", ["+issueId", "+title", "+summary", "+issueDate"]),
        ("frame", "<<Entity>>", "FrameAnalysis", ["+analysisId", "+analysisVersion", "+frameType", "+confidence", "+status", "+isCurrent"]),
        ("evidence", "<<Value Object>>", "FrameEvidence", ["+evidenceText", "+sourceUrl", "+confidence"]),
        ("score", "<<Entity>>", "AgendaScore", ["+scoreId", "+scoreVersion", "+articleCount", "+mediaCount", "+placementWeight", "+totalScore", "+calculatedAt", "+isCurrent"]),
        ("report", "<<Entity>>", "AIReport", ["+reportId", "+reportVersion", "+summary", "+promptVersion", "+generatedAt", "+isCurrent"]),
    ]
    for key, stereo, name, fields in specs:
        class_box(draw, cards[key], stereo, name, fields, [], YELLOW, YELLOW_LINE)

    uml_relation(draw, [(450, 270), (650, 270)], "composition", "owns rules", "1", "1..*", (550, 238), (458, 242), (610, 242), GREEN_LINE)
    uml_relation(draw, [(275, 350), (275, 500)], "association", "publishes", "1", "0..*", (330, 414), (286, 360), (286, 472), GREEN_LINE)
    uml_relation(
        draw,
        [(1375, 350), (1375, 420), (520, 420), (520, 545), (450, 545)],
        "association",
        "collects",
        "1",
        "0..*",
        (930, 388),
        (1388, 360),
        (458, 517),
        GREEN_LINE,
    )
    uml_relation(draw, [(450, 595), (650, 595)], "association", "assigned to", "1", "0..*", (550, 563), (458, 567), (610, 567), GREEN_LINE)
    uml_relation(draw, [(1200, 595), (1000, 595)], "composition", "contains", "1", "1..*", (1100, 563), (1168, 567), (1008, 567), GREEN_LINE)
    uml_relation(draw, [(275, 690), (275, 850)], "composition", "analysis history", "1", "0..*", (350, 752), (286, 700), (286, 822), GREEN_LINE)
    uml_relation(draw, [(450, 940), (650, 940)], "composition", "contains", "1", "1..*", (550, 908), (458, 912), (610, 912), GREEN_LINE)
    uml_relation(draw, [(1375, 690), (1375, 850)], "composition", "score history", "1", "0..*", (1445, 752), (1386, 700), (1386, 822), GREEN_LINE)
    uml_relation(
        draw,
        [(1550, 595), (1625, 595), (1625, 790), (1875, 790), (1875, 850)],
        "composition",
        "summarized by",
        "1",
        "0..*",
        (1760, 760),
        (1558, 567),
        (1888, 822),
        GREEN_LINE,
    )

    compact_relationship_legend(draw, (1760, 165, 2320, 545), horizontal=False)
    draw.rounded_rectangle((1760, 580, 2320, 770), radius=6, fill="#F4F7FB", outline="#D6DEE9", width=2)
    draw.text((1782, 600), "관계 해석", fill=INK, font=F_PACKAGE)
    notes = [
        "◆ Composition: 부모 삭제 시 자식도 함께 제거",
        "◇ Aggregation: 서로 독립적인 객체를 약하게 포함",
        "분석·점수·리포트는 버전 이력을 보존하고 isCurrent로 최신본 표시",
        "다중성은 각 선 끝의 1, 0..1, 0..*, 1..*로 표기",
    ]
    ny = 646
    for note in notes:
        draw.text((1784, ny), note, fill=MUTED, font=F_BODY)
        ny += 28
    draw.text((1640, 108), "색상은 역할 구분, 선 모양은 UML 관계 유형", fill=MUTED, font=F_SMALL)
    draw.text((54, 1208), "AgendaFrame | Domain Model Class Diagram", fill=MUTED, font=F_SMALL)
    OUT.mkdir(exist_ok=True)
    img.save(OUT / "class_diagram_domain.png", quality=95)


def render_implementation_class_diagram() -> None:
    width, height = 2400, 1350
    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)
    draw.text((54, 34), "[Class Diagram 2] AgendaFrame 애플리케이션 구현 구조", fill=INK, font=F_TITLE)
    draw.line((54, 94, 2346, 94), fill="#D0D6DF", width=2)
    draw.text((56, 108), "화면 → API → 서비스 → 저장소·외부 서비스의 의존 방향을 중심으로 표현", fill=MUTED, font=F_BODY)

    package(draw, (50, 145, 2350, 310), "Presentation Package")
    package(draw, (50, 330, 2350, 510), "Inbound Adapter Package (API / Batch)")
    package(draw, (50, 530, 2350, 820), "Application Service Package")
    package(draw, (50, 840, 2350, 1145), "Infrastructure / Adapter Package")

    presentation_specs = [
        ((100, 190, 420, 290), "AgendaDashboardView", ["-filters"], ["+loadRanking()"]),
        ((480, 190, 800, 290), "IssueDetailView", ["-selectedIssue"], ["+loadComparison()"]),
        ((1030, 190, 1350, 290), "ReportExportView", ["-reportState"], ["+requestPdf()"]),
    ]
    for rect, name, fields, methods in presentation_specs:
        class_box(draw, rect, "<<React View>>", name, fields, methods, PINK, PINK_LINE)

    api_specs = [
        ((100, 390, 420, 505), "AgendaAPI", [], ["+getIssues(query): IssueList", "+getIssueDetail(id): IssueDetail"]),
        ((480, 390, 800, 505), "AnalysisAPI", [], ["+getComparison(id): Comparison", "+getFrames(id): FrameSet"]),
        ((1030, 390, 1350, 505), "ReportAPI", [], ["+getReport(id): AIReport", "+exportPdf(id): PdfFile"]),
    ]
    for rect, name, fields, methods in api_specs:
        class_box(draw, rect, "<<Controller>>", name, fields, methods, BLUE, BLUE_LINE)
    class_box(
        draw,
        (1950, 390, 2250, 505),
        "<<Scheduled Job>>",
        "CollectionRunJob",
        ["-schedule"],
        ["+run()"],
        ORANGE,
        ORANGE_LINE,
    )

    service_positions = [80, 460, 840, 1220, 1600, 1980]
    service_specs = [
        ("IssueQueryService", [], ["+findRanked(query): IssueList", "+findDetail(id): IssueDetail"]),
        ("ComparisonService", [], ["+compareMedia(id): Comparison", "+compareFrames(id): FrameSet"]),
        ("ReportService", ["-repository: BigQueryRepository"], ["+getOrCreate(id): AIReport"]),
        ("PdfExportService", ["-repository: BigQueryRepository"], ["+renderPdf(id): PdfFile"]),
        ("ArticleCollectionService", ["-repository: BigQueryRepository"], ["+collectAll(runId): CollectionResult"]),
        ("AnalysisPipelineService", ["-repository: BigQueryRepository", "-gemini: GeminiClient"], ["+analyzeRun(runId): AnalysisResult"]),
    ]
    service_cards: list[tuple[int, int, int, int]] = []
    for x, (name, fields, methods) in zip(service_positions, service_specs):
        rect = (x, 590, x + 320, 760)
        service_cards.append(rect)
        class_box(draw, rect, "<<Service>>", name, fields, methods, GREEN, GREEN_LINE)
    draw.text(
        (1450, 548),
        "주요 주입 관계는 Association, 보조 주입 관계는 속성 타입으로 표기",
        fill=MUTED,
        font=F_SMALL,
    )

    infra_positions = [80, 840, 1220, 1600, 1980]
    infra_specs = [
        ("BigQueryRepository", ["-datasetId"], ["+query(sql): Row[]", "+save(entity): void"]),
        ("GeminiClient", ["-promptVersion"], ["+generate(prompt): String"]),
        ("CloudStorageClient", ["-bucketName"], ["+savePdf(file): Uri"]),
        ("PlaywrightCrawler", ["-crawlRules"], ["+fetchAndParse(rule): Article[]"]),
        ("VertexEmbeddingClient", ["-modelName"], ["+embed(texts): Vector[]"]),
    ]
    infra_cards: list[tuple[int, int, int, int]] = []
    for x, (name, fields, methods) in zip(infra_positions, infra_specs):
        rect = (x, 900, x + 320, 1070)
        infra_cards.append(rect)
        class_box(draw, rect, "<<Adapter>>", name, fields, methods, PURPLE, PURPLE_LINE)

    # Presentation to controller dependencies.
    uml_relation(draw, [(260, 290), (260, 315), (560, 315), (560, 385), (260, 385), (260, 390)], "dependency", color=BLUE_LINE)
    for x in (640, 1190):
        uml_relation(draw, [(x, 290), (x, 390)], "dependency", color=BLUE_LINE)
    # Controllers to their application services.
    uml_relation(draw, [(260, 505), (260, 520), (430, 520), (430, 580), (240, 580), (240, 590)], "dependency", "queries", label_xy=(350, 520), color=LINE)
    uml_relation(draw, [(640, 505), (620, 590)], "dependency", "compares", label_xy=(690, 530), color=LINE)
    uml_relation(draw, [(1190, 505), (1000, 560), (1000, 590)], "dependency", "creates report", label_xy=(1080, 530), color=LINE)
    uml_relation(draw, [(1190, 505), (1380, 560), (1380, 590)], "dependency", "exports PDF", label_xy=(1300, 530), color=LINE)
    uml_relation(draw, [(2100, 505), (2100, 550), (1760, 550), (1760, 590)], "dependency", "triggers collection", label_xy=(1880, 517), color=ORANGE_LINE)
    uml_relation(draw, [(2100, 505), (2140, 590)], "dependency", "triggers analysis", label_xy=(2200, 535), color=ORANGE_LINE)

    # Primary injected collaborators are structural associations. Secondary
    # collaborators remain explicit as typed fields to keep the overview legible.
    uml_relation(draw, [(240, 760), (240, 810), (520, 810), (520, 950), (400, 950)], "association", "repository", label_xy=(380, 786), color=LINE)
    uml_relation(draw, [(620, 760), (620, 825), (570, 825), (570, 1020), (400, 1020)], "association", "repository", label_xy=(610, 800), color=LINE)
    uml_relation(draw, [(1000, 760), (1000, 900)], "association", "LLM", label_xy=(1045, 814), color=LINE)
    uml_relation(draw, [(1380, 760), (1380, 900)], "association", "storage", label_xy=(1435, 814), color=LINE)
    uml_relation(draw, [(1760, 760), (1760, 900)], "association", "crawler", label_xy=(1815, 814), color=LINE)
    uml_relation(draw, [(2140, 760), (2140, 900)], "association", "embedding", label_xy=(2200, 814), color=LINE)

    draw.text((1640, 108), "색상은 계층 구분, 선 모양은 UML 관계 유형", fill=MUTED, font=F_SMALL)

    compact_relationship_legend(draw, (110, 1180, 2290, 1305), horizontal=True)
    draw.text((54, 1318), "AgendaFrame | Implementation Class Diagram", fill=MUTED, font=F_SMALL)
    OUT.mkdir(exist_ok=True)
    img.save(OUT / "class_diagram_implementation.png", quality=95)
    img.save(OUT / "class_diagram.png", quality=95)


class SequenceCanvas:
    def __init__(self, title: str, subtitle: str, participants: list[str]) -> None:
        self.width = 2500
        self.height = 1700
        self.img = Image.new("RGB", (self.width, self.height), "#171717")
        self.draw = ImageDraw.Draw(self.img)
        self.draw.text((55, 38), title, fill="white", font=F_SEQ_TITLE)
        self.draw.text((58, 85), subtitle, fill="#C6CBD2", font=F_SEQ)
        self.panel = (30, 125, 2470, 1650)
        self.draw.rounded_rectangle(self.panel, radius=3, fill="white")
        margin = 130
        usable = self.width - margin * 2
        self.xs = [int(margin + i * usable / (len(participants) - 1)) for i in range(len(participants))]
        self.names = participants
        self.header_y = 165
        self.life_top = 225
        self.life_bottom = 1625
        for name, x in zip(participants, self.xs):
            header = (x - 112, self.header_y, x + 112, self.header_y + 58)
            self.draw.rounded_rectangle(header, radius=8, fill="#F7F9FC", outline="#9AA6B5", width=2)
            centered_text(self.draw, header, name, F_SEQ_HEADER, INK)
            dashed_line(self.draw, (x, self.life_top), (x, self.life_bottom), "#AAB4C1", 2, 8, 7)

    def note(self, text: str, x1: int = 80, x2: int = 950, y: int = 250, h: int = 76) -> None:
        self.draw.rectangle((x1, y, x2, y + h), fill="#FFF1AA", outline="#E0B818", width=2)
        centered_text(self.draw, (x1 + 12, y + 7, x2 - 12, y + h - 7), text, F_SEQ, INK)

    def activation(self, idx: int, y1: int, y2: int, fill: str = "#DDE8F7") -> None:
        x = self.xs[idx]
        self.draw.rectangle((x - 8, y1, x + 8, y2), fill=fill, outline="#718096", width=1)

    def message(
        self,
        src: int,
        dst: int,
        y: int,
        label: str,
        dashed: bool = False,
        color: str = INK,
    ) -> None:
        x1, x2 = self.xs[src], self.xs[dst]
        start = (x1, y)
        end = (x2, y)
        if src == dst:
            side = 60
            points = [(x1, y), (x1 + side, y), (x1 + side, y + 30), (x1, y + 30)]
            polyline(self.draw, points, color, 2, dashed=False, arrow=True)
            self.draw.text((x1 + 12, y - 22), label, fill=color, font=F_SEQ_SMALL)
            return
        if dashed:
            dashed_line(self.draw, start, end, color, 2, 9, 7)
            arrow_head(self.draw, start, end, color)
        else:
            self.draw.line((*start, *end), fill=color, width=2)
            arrow_head(self.draw, start, end, color)
        max_w = abs(x2 - x1) - 20
        lines = wrap(self.draw, label, F_SEQ_SMALL, max_w)
        cy = y - 24 - (len(lines) - 1) * 16
        left = min(x1, x2) + 10
        for line in lines[:2]:
            self.draw.text((left, cy), line, fill=color, font=F_SEQ_SMALL)
            cy += 17

    def frame(self, label: str, guard: str, y1: int, y2: int, x1: int = 65, x2: int = 2435) -> None:
        self.draw.rectangle((x1, y1, x2, y2), outline="#657184", width=2)
        tab_w = max(95, text_size(self.draw, label, F_SEQ_HEADER)[0] + 35)
        self.draw.polygon(
            [(x1, y1), (x1 + tab_w, y1), (x1 + tab_w - 16, y1 + 32), (x1, y1 + 32)],
            fill="#F4F6F9",
            outline="#657184",
        )
        self.draw.text((x1 + 12, y1 + 6), label, fill=INK, font=F_SEQ_HEADER)
        if guard:
            self.draw.text((x1 + tab_w + 12, y1 + 8), f"[{guard}]", fill=MUTED, font=F_SEQ_SMALL)

    def divider(self, y: int, guard: str) -> None:
        dashed_line(self.draw, (65, y), (2435, y), "#657184", 2, 10, 8)
        self.draw.text((1180, y - 23), f"[{guard}]", fill=MUTED, font=F_SEQ_SMALL)

    def footer(self, text: str) -> None:
        self.draw.text((55, 1662), text, fill="#AEB4BD", font=F_SEQ_SMALL)


def render_sequence_uc01_uc02() -> Image.Image:
    c = SequenceCanvas(
        "1. UC-01~UC-02 의제 조회 및 이슈 상세 조회",
        "사용자 조건 입력부터 의제 랭킹, 이슈 상세·기사 근거 출력까지",
        ["사용자", "AgendaDashboardView", "AgendaAPI", "IssueQueryService", "BigQueryRepository", "BigQuery"],
    )
    c.note("사전 조건: 기사 수집 및 분석 배치가 1회 이상 완료되어 의제 데이터가 존재함", 80, 1110)
    c.message(0, 1, 360, "날짜·분야·언론사 조건 입력")
    c.message(1, 2, 410, "GET /issues?date&category&media")
    c.message(2, 3, 460, "findRanked(query)")
    c.message(3, 4, 510, "findRankedIssues(query)")
    c.message(4, 5, 560, "SELECT issue ranking")
    c.message(5, 4, 610, "ranked issues", dashed=True)
    c.message(4, 3, 660, "IssueSummary[]", dashed=True)
    c.frame("alt", "조회 결과", 700, 920)
    c.message(3, 2, 760, "200 rankedIssues", dashed=True)
    c.message(2, 1, 810, "의제 목록 응답", dashed=True)
    c.message(1, 0, 860, "의제 랭킹 표시", dashed=True)
    c.divider(920, "결과 없음")
    c.message(3, 2, 970, "200 empty list", dashed=True)
    c.message(2, 1, 1020, "빈 상태 응답", dashed=True)
    c.message(1, 0, 1070, "조건을 변경하라는 안내", dashed=True)
    c.message(0, 1, 1140, "의제 항목 선택")
    c.message(1, 2, 1190, "GET /issues/{issueId}")
    c.message(2, 3, 1240, "findDetail(issueId)")
    c.message(3, 4, 1290, "findIssueDetail(issueId)")
    c.message(4, 5, 1340, "SELECT issue, articles, score")
    c.message(5, 4, 1390, "detail rows", dashed=True)
    c.message(4, 3, 1440, "IssueDetail", dashed=True)
    c.message(3, 2, 1490, "200 IssueDetail", dashed=True)
    c.message(2, 1, 1540, "상세 데이터 응답", dashed=True)
    c.message(1, 0, 1580, "요약·점수·관련 기사·원문 링크 출력", dashed=True)
    c.footer("AgendaFrame Sequence Diagram | UC-01~UC-02")
    return c.img


def render_sequence_uc03_uc05() -> Image.Image:
    c = SequenceCanvas(
        "2. UC-03~UC-05 언론사·프레임 비교 및 AI 리포트",
        "비교 데이터 조회와 AI 리포트 캐시·생성·실패 처리를 분리",
        ["사용자", "IssueDetailView", "AnalysisAPI", "ComparisonService", "ReportService", "BigQueryRepository", "Vertex AI Gemini"],
    )
    c.note("사전 조건: UC-02 이슈 상세 조회가 완료되고 선택된 issueId가 존재함", 80, 1020)
    c.message(0, 1, 355, "언론사 비교 또는 프레임 비교 탭 선택")
    c.message(1, 2, 405, "GET /issues/{id}/comparison|frames")
    c.message(2, 3, 455, "getComparison(issueId, mode)")
    c.message(3, 5, 505, "loadComparisonData(issueId)")
    c.message(5, 3, 555, "media counts, placements, frames, evidence", dashed=True)
    c.message(3, 2, 605, "ComparisonResult", dashed=True)
    c.message(2, 1, 655, "200 comparison", dashed=True)
    c.message(1, 0, 705, "언론사별 수치·프레임 비율·근거 문장 출력", dashed=True)
    c.frame("opt", "AI 리포트 열기", 755, 1540)
    c.message(0, 1, 815, "AI 리포트 탭 선택")
    c.message(1, 2, 865, "GET /issues/{id}/report")
    c.message(2, 4, 915, "getOrCreate(issueId)")
    c.message(4, 5, 965, "findReport(issueId)")
    c.frame("alt", "리포트 캐시 상태", 1005, 1415, 100, 2400)
    c.message(5, 4, 1065, "cached AIReport", dashed=True)
    c.divider(1125, "캐시 없음")
    c.message(5, 4, 1175, "report missing", dashed=True)
    c.message(4, 5, 1225, "loadIssueContext(issueId)")
    c.message(5, 4, 1275, "issue, score, frames, evidence", dashed=True)
    c.message(4, 6, 1325, "generateReport(prompt)")
    c.divider(1375, "Gemini 실패 또는 타임아웃")
    c.message(6, 4, 1425, "error / timeout", dashed=True, color="#A33A3A")
    c.message(4, 2, 1475, "fallback summary + retryRequired", dashed=True, color="#A33A3A")
    c.message(4, 2, 1525, "AIReport", dashed=True)
    c.message(2, 1, 1570, "리포트 또는 재시도 상태 응답", dashed=True)
    c.footer("AgendaFrame Sequence Diagram | UC-03~UC-05")
    return c.img


def render_sequence_uc06() -> Image.Image:
    c = SequenceCanvas(
        "3. UC-06 결과 요약 PDF 내보내기",
        "현재 분석 결과 확인, PDF 생성, 파일 저장 및 다운로드 응답",
        ["사용자", "ReportExportView", "ReportAPI", "PdfExportService", "BigQueryRepository", "Cloud Storage", "브라우저 다운로드"],
    )
    c.note("사전 조건: 이슈 상세 또는 AI 리포트가 화면에 출력되어 selectedIssueId가 존재함", 80, 1070)
    c.message(0, 1, 360, "PDF 내보내기 클릭")
    c.message(1, 1, 410, "selectedIssueId 확인")
    c.frame("alt", "선택된 결과 존재 여부", 455, 670)
    c.message(1, 0, 515, "먼저 이슈를 선택하라는 오류 표시", dashed=True, color="#A33A3A")
    c.divider(575, "결과 있음")
    c.message(1, 2, 625, "POST /issues/{id}/exports/pdf")
    c.message(2, 3, 710, "renderIssueReport(issueId)")
    c.message(3, 4, 760, "loadExportContext(issueId)")
    c.message(4, 3, 810, "issue, articles, score, frames, report", dashed=True)
    c.message(3, 3, 860, "HTML 템플릿 렌더링 및 PDF 변환")
    c.message(3, 5, 930, "savePdf(fileBytes)")
    c.frame("alt", "파일 저장 결과", 970, 1510)
    c.message(5, 3, 1030, "downloadUrl", dashed=True)
    c.message(3, 2, 1080, "ExportResult", dashed=True)
    c.message(2, 1, 1130, "201 downloadUrl", dashed=True)
    c.message(1, 6, 1180, "download(downloadUrl)")
    c.message(6, 0, 1230, "파일 저장 창 및 다운로드 완료", dashed=True)
    c.message(1, 0, 1280, "내보내기 완료 상태 표시", dashed=True)
    c.divider(1330, "저장 실패")
    c.message(5, 3, 1380, "storage error", dashed=True, color="#A33A3A")
    c.message(3, 2, 1430, "500 export failed", dashed=True, color="#A33A3A")
    c.message(2, 1, 1480, "다시 시도 안내", dashed=True, color="#A33A3A")
    c.footer("AgendaFrame Sequence Diagram | UC-06")
    return c.img


def render_sequence_uc07() -> Image.Image:
    c = SequenceCanvas(
        "4. UC-07 기사 자동 수집 및 분석",
        "스케줄 실행부터 기사 중복 제거, 이슈 클러스터링, 점수·프레임 분석 저장까지",
        ["Cloud Scheduler", "CollectionRunJob", "ArticleCollectionService", "PlaywrightCrawler", "BigQueryRepository", "AnalysisPipelineService", "Vertex AI", "BigQuery"],
    )
    c.note("트리거: 설정된 수집 시각 도달 또는 운영자의 수동 재실행 요청", 80, 940)
    c.message(0, 1, 355, "runCollection()")
    c.message(1, 2, 405, "collectAll(runId)")
    c.message(2, 4, 455, "findEnabledMediaOutlets()")
    c.message(4, 2, 475, "MediaOutlet + CrawlRule[]", dashed=True)
    c.frame("loop", "활성 언론사별 반복", 520, 950)
    c.message(2, 3, 555, "fetchHomepage(url, crawlRule)")
    c.message(3, 2, 605, "ArticleMetadata[]", dashed=True)
    c.message(2, 4, 655, "existsByHash(contentHash)")
    c.frame("alt", "중복 여부", 700, 925, 100, 2400)
    c.message(4, 2, 755, "true", dashed=True)
    c.message(2, 2, 805, "중복 건수만 기록")
    c.divider(850, "신규 기사")
    c.message(2, 4, 900, "saveArticleMetadata(article)")
    c.message(2, 1, 970, "CollectionResult", dashed=True)
    c.message(1, 5, 1025, "analyzeRun(runId)")
    c.message(5, 4, 1075, "findUnprocessedArticles(runId)")
    c.message(4, 5, 1125, "ArticleMetadata[]", dashed=True)
    c.message(5, 6, 1175, "embed(title + summary)")
    c.message(6, 5, 1225, "embedding vectors", dashed=True)
    c.message(5, 5, 1275, "clusterIssues() + calculateAgendaScore()")
    c.frame("alt", "프레임 분석 호출", 1315, 1515)
    c.message(5, 6, 1370, "analyzeFrames(prompt)")
    c.message(6, 5, 1420, "FrameAnalysis + evidence", dashed=True)
    c.divider(1460, "실패")
    c.message(6, 5, 1510, "retryRequired", dashed=True, color="#A33A3A")
    c.message(5, 7, 1545, "save issues, scores, frames, run status")
    c.message(7, 5, 1585, "saved", dashed=True)
    c.message(5, 1, 1620, "AnalysisResult", dashed=True)
    c.footer("AgendaFrame Sequence Diagram | UC-07")
    return c.img


def render_sequence_diagrams() -> None:
    OUT.mkdir(exist_ok=True)
    diagrams = [
        ("sequence_uc01_uc02.png", render_sequence_uc01_uc02()),
        ("sequence_uc03_uc05.png", render_sequence_uc03_uc05()),
        ("sequence_uc06.png", render_sequence_uc06()),
        ("sequence_uc07.png", render_sequence_uc07()),
    ]
    for filename, image in diagrams:
        image.save(OUT / filename, quality=95)
    diagrams[0][1].save(OUT / "sequence_diagram.png", quality=95)


def render_all(output_dir: Path | None = None) -> None:
    global OUT

    previous_out = OUT
    OUT = (output_dir or DEFAULT_OUT).resolve()
    try:
        OUT.mkdir(parents=True, exist_ok=True)
        render_domain_class_diagram()
        render_implementation_class_diagram()
        render_sequence_diagrams()
    finally:
        OUT = previous_out


if __name__ == "__main__":
    render_all()
    print(f"UML PNG outputs written to {DEFAULT_OUT}")
