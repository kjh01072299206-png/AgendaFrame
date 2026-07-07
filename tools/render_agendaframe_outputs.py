from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Iterable, Sequence

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "outputs"

W, H = 1600, 1000
PINK = "#f00078"
DARK = "#3a3a3a"
MID = "#666666"
LINE = "#b8b8b8"
HEADER = "#d9d9d9"
LIGHT = "#f7f7f7"
BLUE = "#eaf2ff"
GREEN = "#eaf7ef"
YELLOW = "#fff6df"
PURPLE = "#f3edff"


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/malgun.ttf"),
        Path("C:/Windows/Fonts/malgunbd.ttf"),
        Path("C:/Windows/Fonts/NotoSansCJK-Regular.ttc"),
        Path("C:/Windows/Fonts/arial.ttf"),
    ]
    if name == "bold":
        candidates = [
            Path("C:/Windows/Fonts/malgunbd.ttf"),
            Path("C:/Windows/Fonts/malgun.ttf"),
            Path("C:/Windows/Fonts/NotoSansCJK-Bold.ttc"),
            Path("C:/Windows/Fonts/arialbd.ttf"),
        ]
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


F_TITLE = font("bold", 38)
F_SUBTITLE = font("bold", 48)
F_SECTION = font("bold", 26)
F_HEADER = font("bold", 20)
F_BODY = font("regular", 19)
F_SMALL = font("regular", 16)
F_TINY = font("regular", 14)
F_BOLD = font("bold", 19)


def new_canvas(title: str, section: str, footer: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)
    draw.text((60, 45), title, fill=DARK, font=F_TITLE)
    draw.text((150, 92), section, fill=PINK, font=F_SUBTITLE)
    draw.line((60, H - 60, W - 60, H - 60), fill="#eeeeee", width=2)
    draw.text((60, H - 43), footer, fill=DARK, font=F_SMALL)
    draw.text((W - 105, H - 43), "AgendaFrame", fill=DARK, font=F_SMALL)
    return img, draw


def text_size(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.ImageFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def wrap_text(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.ImageFont, max_width: int) -> list[str]:
    if not text:
        return [""]
    lines: list[str] = []
    current = ""
    for part in text.split("\n"):
        current = ""
        for ch in part:
            trial = current + ch
            if text_size(draw, trial, fnt)[0] <= max_width or not current:
                current = trial
            else:
                lines.append(current)
                current = ch
        lines.append(current)
    return lines


def draw_wrapped(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    fnt: ImageFont.ImageFont,
    fill: str,
    max_width: int,
    line_gap: int = 6,
    max_lines: int | None = None,
) -> int:
    x, y = xy
    lines = wrap_text(draw, text, fnt, max_width)
    if max_lines is not None and len(lines) > max_lines:
        lines = lines[:max_lines]
        if lines:
            lines[-1] = lines[-1].rstrip(" .") + "..."
    line_h = text_size(draw, "가", fnt)[1] + line_gap
    for line in lines:
        draw.text((x, y), line, fill=fill, font=fnt)
        y += line_h
    return y


def draw_table(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    widths: Sequence[int],
    row_heights: Sequence[int],
    headers: Sequence[str],
    rows: Sequence[Sequence[str]],
    font_body: ImageFont.ImageFont = F_BODY,
    font_header: ImageFont.ImageFont = F_HEADER,
) -> None:
    cx = x
    for w, htxt in zip(widths, headers):
        draw.rectangle((cx, y, cx + w, y + row_heights[0]), fill=HEADER, outline=LINE)
        draw_wrapped(draw, (cx + 10, y + 10), htxt, font_header, DARK, w - 20, max_lines=2)
        cx += w

    cy = y + row_heights[0]
    for ridx, row in enumerate(rows):
        h = row_heights[ridx + 1]
        cx = x
        fill = "white" if ridx % 2 == 0 else "#fcfcfc"
        for w, cell in zip(widths, row):
            draw.rectangle((cx, cy, cx + w, cy + h), fill=fill, outline=LINE)
            draw_wrapped(draw, (cx + 10, cy + 9), cell, font_body, DARK, w - 20, max_lines=max(1, (h - 12) // 24))
            cx += w
        cy += h


def draw_label(draw: ImageDraw.ImageDraw, text: str, xy: tuple[int, int]) -> None:
    draw.text(xy, text, fill=DARK, font=F_SECTION)


def arrow(draw: ImageDraw.ImageDraw, start: tuple[int, int], end: tuple[int, int], color: str = "#555555", width: int = 3) -> None:
    draw.line((start, end), fill=color, width=width)
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    size = 12
    p1 = (end[0] - size * math.cos(angle - math.pi / 6), end[1] - size * math.sin(angle - math.pi / 6))
    p2 = (end[0] - size * math.cos(angle + math.pi / 6), end[1] - size * math.sin(angle + math.pi / 6))
    draw.polygon([end, p1, p2], fill=color)


def rounded_box(
    draw: ImageDraw.ImageDraw,
    rect: tuple[int, int, int, int],
    title: str,
    body: str = "",
    fill: str = LIGHT,
    outline: str = "#666666",
    title_font: ImageFont.ImageFont = F_BOLD,
    body_font: ImageFont.ImageFont = F_SMALL,
    radius: int = 16,
) -> None:
    draw.rounded_rectangle(rect, radius=radius, fill=fill, outline=outline, width=2)
    x1, y1, x2, _ = rect
    tw, th = text_size(draw, title, title_font)
    draw.text((x1 + (x2 - x1 - tw) / 2, y1 + 12), title, fill=DARK, font=title_font)
    if body:
        draw_wrapped(draw, (x1 + 14, y1 + 44), body, body_font, DARK, x2 - x1 - 28, max_lines=3)


def draw_stick_actor(draw: ImageDraw.ImageDraw, x: int, y: int, label: str) -> None:
    draw.ellipse((x - 16, y, x + 16, y + 32), outline=DARK, width=3)
    draw.line((x, y + 32, x, y + 88), fill=DARK, width=3)
    draw.line((x - 34, y + 52, x + 34, y + 52), fill=DARK, width=3)
    draw.line((x, y + 88, x - 28, y + 128), fill=DARK, width=3)
    draw.line((x, y + 88, x + 28, y + 128), fill=DARK, width=3)
    tw, _ = text_size(draw, label, F_BODY)
    draw.text((x - tw / 2, y + 140), label, fill=DARK, font=F_BODY)


def render_wbs_gantt() -> None:
    img, draw = new_canvas("[스크럼에서의 3가지 산출물]", "10. WBS 및 간트차트", "WBS · Gantt Chart")
    draw.text((620, 158), "표 10-1 AgendaFrame WBS 요약", fill=DARK, font=F_SMALL)
    headers = ["WBS", "상위 작업", "세부 작업", "담당", "산출물", "기간"]
    widths = [90, 220, 420, 110, 260, 145]
    rows = [
        ["1.0", "기획 및 분석 기준", "MVP 기능 확정, 대상 언론사 선정, 정책 분야 정의", "공동", "MVP 범위 정의서", "7/7~7/10"],
        ["1.3", "기획 및 분석 기준", "의제 중요도 점수 산식 정의", "최지우", "의제 점수 산식표", "7/10~7/14"],
        ["2.2", "데이터 수집 및 저장", "Playwright 기반 기사 자동 수집 구현", "강준혁", "기사 수집 코드", "7/14~7/23"],
        ["3.1", "의제 분석 엔진", "유사 기사 클러스터링 구현", "강준혁", "이슈 클러스터링 모듈", "7/28~8/5"],
        ["3.3", "의제 분석 엔진", "Gemini 기반 프레임 분석 구현", "공동", "프레임 분석 결과", "8/5~8/14"],
        ["4.4", "웹 대시보드", "프레임 비교 그래프 및 근거 표시 구현", "강준혁", "프레임 비교 화면", "8/18~8/25"],
        ["5.2", "검증 및 발표", "MVP 통합 테스트 및 오류 수정", "강준혁", "통합 테스트 결과", "8/26~8/31"],
    ]
    draw_table(draw, 150, 190, widths, [42] + [54] * len(rows), headers, rows, F_SMALL, F_HEADER)

    draw.text((625, 620), "표 10-2 AgendaFrame 간트차트", fill=DARK, font=F_SMALL)
    x, y = 150, 660
    task_w = 315
    week_w = 120
    weeks = ["7/7", "7/14", "7/21", "7/28", "8/4", "8/11", "8/18", "8/25", "9/1"]
    tasks = [
        ("기획·분석 기준", 0, 2),
        ("기사 수집·DB", 1, 3),
        ("클러스터링·의제 점수", 3, 5),
        ("프레임 분석·AI 리포트", 4, 7),
        ("대시보드 구현", 3, 8),
        ("검증·발표 준비", 6, 9),
    ]
    draw.rectangle((x, y, x + task_w + week_w * len(weeks), y + 44), fill=HEADER, outline=LINE)
    draw.text((x + 12, y + 11), "작업", fill=DARK, font=F_HEADER)
    for i, wk in enumerate(weeks):
        draw.rectangle((x + task_w + i * week_w, y, x + task_w + (i + 1) * week_w, y + 44), fill=HEADER, outline=LINE)
        draw.text((x + task_w + i * week_w + 36, y + 12), wk, fill=DARK, font=F_HEADER)
    cy = y + 44
    colors = ["#ffd6e7", "#d9ebff", "#dbf5df", "#fff2cc", "#eadcff", "#e2e2e2"]
    for idx, (task, start, end) in enumerate(tasks):
        draw.rectangle((x, cy, x + task_w, cy + 45), fill="white", outline=LINE)
        draw.text((x + 12, cy + 12), task, fill=DARK, font=F_BODY)
        for i in range(len(weeks)):
            draw.rectangle((x + task_w + i * week_w, cy, x + task_w + (i + 1) * week_w, cy + 45), fill="white", outline="#dddddd")
        bar_x1 = x + task_w + start * week_w + 12
        bar_x2 = x + task_w + end * week_w - 12
        draw.rounded_rectangle((bar_x1, cy + 10, bar_x2, cy + 35), radius=10, fill=colors[idx], outline="#999999")
        cy += 45
    img.save(OUT / "wbs_gantt.png", quality=95)


def render_usecase_spec() -> None:
    img, draw = new_canvas("[UML 산출물]", "11-1. 유스케이스 명세서", "Use Case Specification")
    draw.text((625, 165), "표 11-1 AgendaFrame 주요 유스케이스 명세서", fill=DARK, font=F_SMALL)
    headers = ["ID", "유스케이스", "주요 액터", "목적", "중요도"]
    widths = [100, 220, 190, 700, 95]
    rows = [
        ["UC-01", "오늘의 의제 조회", "일반 사용자\n기자/연구자", "오늘 주요 언론사에서 중요하게 다룬 공적 의제를 순위, 점수, 기사 수로 확인한다.", "상"],
        ["UC-02", "이슈 상세 조회", "일반 사용자\n기자/연구자", "선택한 이슈의 요약 설명, 관련 기사 목록, 원문 링크를 확인한다.", "상"],
        ["UC-03", "언론사별 보도 비교", "일반 사용자\n기자/연구자", "같은 이슈에 대한 언론사별 보도 건수, 제목, 홈페이지 배치 차이를 비교한다.", "상"],
        ["UC-04", "관점/프레임 비교", "일반 사용자\n기자/연구자", "갈등, 책임, 경제, 법·제도, 정책효과, 시민영향 프레임 비중과 근거 문장을 확인한다.", "상"],
        ["UC-05", "AI 리포트 조회", "일반 사용자\n기자/연구자", "주요 관점, 부족한 관점, 치우침 가능성, 원문 링크가 포함된 AI 리포트를 확인한다.", "상"],
        ["UC-06", "정책 분야 필터링", "일반 사용자\n기자/연구자", "정치, 경제, 사회, 외교안보, 노동, 복지, 산업정책 분야별 의제를 필터링한다.", "중"],
        ["UC-07", "기사 자동 수집 및 분석", "운영자\n외부 시스템", "정해진 주기마다 기사 메타데이터를 수집하고 이슈 묶음, 의제 점수, 프레임 분석을 수행한다.", "상"],
    ]
    draw_table(draw, 150, 205, widths, [48] + [80] * len(rows), headers, rows, F_BODY, F_HEADER)
    draw.text((150, 835), "※ 유스케이스 명세서는 요구사항 구체화와 UML 다이어그램 작성의 기준 자료로 사용한다.", fill=MID, font=F_SMALL)
    img.save(OUT / "usecase_spec.png", quality=95)


def render_usecase_diagram() -> None:
    img, draw = new_canvas("[UML 산출물]", "11-2. 유스케이스 다이어그램", "Use Case Diagram")
    boundary = (310, 190, 1265, 830)
    draw.rounded_rectangle(boundary, radius=12, outline="#777777", width=3, fill="#fbfbfb")
    draw.text((645, 205), "AgendaFrame System", fill=DARK, font=F_SECTION)

    draw_stick_actor(draw, 140, 290, "일반 사용자")
    draw_stick_actor(draw, 140, 590, "기자/연구자")
    draw_stick_actor(draw, 1420, 300, "운영자")
    draw_stick_actor(draw, 1420, 590, "외부 서비스")

    usecases = [
        ("오늘의 의제 조회", 470, 285),
        ("이슈 상세 조회", 735, 285),
        ("원문 기사 이동", 1000, 285),
        ("언론사별 보도 비교", 470, 455),
        ("관점/프레임 비교", 735, 455),
        ("AI 리포트 조회", 1000, 455),
        ("정책 분야 필터링", 470, 625),
        ("기사 자동 수집", 735, 625),
        ("분석 기준 관리", 1000, 625),
    ]
    centers = {}
    for label, cx, cy in usecases:
        draw.ellipse((cx - 115, cy - 42, cx + 115, cy + 42), fill="white", outline="#666666", width=2)
        centers[label] = (cx, cy)
        draw_wrapped(draw, (cx - 82, cy - 16), label, F_BODY, DARK, 164, max_lines=2)

    for target in ["오늘의 의제 조회", "이슈 상세 조회", "관점/프레임 비교", "AI 리포트 조회", "정책 분야 필터링"]:
        draw.line((210, 355, centers[target][0] - 115, centers[target][1]), fill="#777777", width=2)
    for target in ["언론사별 보도 비교", "관점/프레임 비교", "AI 리포트 조회"]:
        draw.line((210, 655, centers[target][0] - 115, centers[target][1]), fill="#999999", width=2)
    for target in ["기사 자동 수집", "분석 기준 관리"]:
        draw.line((1390, 365, centers[target][0] + 115, centers[target][1]), fill="#777777", width=2)
    for target in ["기사 자동 수집", "AI 리포트 조회"]:
        draw.line((1390, 655, centers[target][0] + 115, centers[target][1]), fill="#999999", width=2)

    arrow(draw, (585, 285), (620, 285), "#999999", 2)
    arrow(draw, (850, 455), (885, 455), "#999999", 2)
    draw.text((600, 260), "<<include>>", fill=MID, font=F_TINY)
    draw.text((860, 430), "<<include>>", fill=MID, font=F_TINY)
    img.save(OUT / "usecase_diagram.png", quality=95)


def render_activity_diagram() -> None:
    img, draw = new_canvas("[UML 산출물]", "11-3. 액티비티 다이어그램", "Activity Diagram")
    steps = [
        ("정기 수집 실행", "Cloud Scheduler가 수집 작업을 실행"),
        ("기사 메타데이터 수집", "제목, URL, 언론사명, 섹션, 배치 위치 추출"),
        ("데이터 저장", "Cloud Storage와 BigQuery에 원본/메타데이터 저장"),
        ("이슈 클러스터링", "유사 기사들을 하나의 이슈로 묶음"),
        ("의제 점수 계산", "언론사 수, 기사 수, 배치 위치, 반복 노출 반영"),
        ("프레임 분석", "Gemini가 갈등·책임·경제 등 프레임 분석"),
        ("AI 리포트 생성", "주요 관점, 부족한 관점, 치우침 가능성 정리"),
        ("대시보드 제공", "사용자가 의제와 분석 결과를 조회"),
    ]
    x = 535
    y = 175
    draw.ellipse((750, 175, 790, 215), fill=DARK)
    prev = (770, 215)
    y = 245
    for i, (title, body) in enumerate(steps):
        rect = (520, y, 1020, y + 70)
        rounded_box(draw, rect, title, body, fill=["#f7f7f7", BLUE, GREEN, YELLOW][i % 4])
        arrow(draw, prev, (770, y), "#777777", 2)
        prev = (770, y + 70)
        y += 90
    arrow(draw, prev, (770, y - 15), "#777777", 2)
    draw.ellipse((748, y - 15, 792, y + 29), outline=DARK, width=3)
    draw.ellipse((758, y - 5, 782, y + 19), fill=DARK)
    img.save(OUT / "activity_diagram.png", quality=95)


def render_class_diagram() -> None:
    img, draw = new_canvas("[UML 산출물]", "11-4. 클래스 다이어그램", "Class Diagram")

    def cls(x: int, y: int, w: int, h: int, name: str, attrs: list[str], methods: list[str], fill: str) -> None:
        draw.rectangle((x, y, x + w, y + h), fill="white", outline="#555555", width=2)
        draw.rectangle((x, y, x + w, y + 38), fill=fill, outline="#555555", width=2)
        tw, _ = text_size(draw, name, F_BOLD)
        draw.text((x + (w - tw) / 2, y + 8), name, fill=DARK, font=F_BOLD)
        draw.line((x, y + 38 + len(attrs) * 23 + 10, x + w, y + 38 + len(attrs) * 23 + 10), fill="#777777", width=1)
        cy = y + 47
        for a in attrs:
            draw.text((x + 12, cy), a, fill=DARK, font=F_SMALL)
            cy += 23
        cy += 12
        for m in methods:
            draw.text((x + 12, cy), m, fill="#1f4f7a", font=F_SMALL)
            cy += 23

    boxes = {
        "User": (90, 185, 230, 155),
        "MediaOutlet": (390, 185, 250, 155),
        "Article": (700, 185, 290, 180),
        "Issue": (1060, 185, 270, 180),
        "AgendaScore": (90, 515, 260, 160),
        "FrameAnalysis": (420, 500, 300, 205),
        "AIReport": (790, 515, 270, 170),
        "Services": (1130, 500, 330, 220),
    }
    cls(*boxes["User"], "User", ["+userId: string", "+role: string"], ["+viewAgenda()", "+selectIssue()"], BLUE)
    cls(*boxes["MediaOutlet"], "MediaOutlet", ["+mediaId: string", "+name: string", "+homepageUrl: string"], ["+getArticles()"], GREEN)
    cls(*boxes["Article"], "Article", ["+articleId: string", "+title: string", "+url: string", "+placement: string"], ["+openOriginal()"], YELLOW)
    cls(*boxes["Issue"], "Issue", ["+issueId: string", "+title: string", "+category: string", "+agendaScore: float"], ["+getRelatedArticles()"], PURPLE)
    cls(*boxes["AgendaScore"], "AgendaScore", ["+mediaCount: int", "+articleCount: int", "+placementWeight: float"], ["+calculateScore()"], "#eeeeee")
    cls(*boxes["FrameAnalysis"], "FrameAnalysis", ["+conflict: float", "+responsibility: float", "+economy: float", "+evidenceText: string"], ["+extractEvidence()"], "#f7e7f1")
    cls(*boxes["AIReport"], "AIReport", ["+summary: string", "+missingPerspective: string", "+biasPossibility: string"], ["+generateReport()"], "#e8f3f0")
    cls(*boxes["Services"], "Service Layer", ["+CollectorService", "+ClusterService", "+ScoringService", "+FrameAnalysisService"], ["+collect()", "+cluster()", "+score()", "+analyze()"], "#f6f0df")

    arrow(draw, (320, 260), (390, 260), "#777777", 2)
    draw.text((330, 235), "조회", fill=MID, font=F_TINY)
    arrow(draw, (640, 260), (700, 260), "#777777", 2)
    draw.text((650, 235), "발행", fill=MID, font=F_TINY)
    arrow(draw, (990, 275), (1060, 275), "#777777", 2)
    draw.text((1000, 250), "포함", fill=MID, font=F_TINY)
    arrow(draw, (1190, 365), (260, 515), "#777777", 2)
    draw.text((720, 405), "점수 산출", fill=MID, font=F_TINY)
    arrow(draw, (845, 365), (560, 500), "#777777", 2)
    draw.text((650, 435), "분석", fill=MID, font=F_TINY)
    arrow(draw, (1190, 365), (925, 515), "#777777", 2)
    draw.text((1020, 440), "리포트", fill=MID, font=F_TINY)
    arrow(draw, (1130, 610), (990, 305), "#777777", 2)
    img.save(OUT / "class_diagram.png", quality=95)


def render_sequence_diagram() -> None:
    img, draw = new_canvas("[UML 산출물]", "11-5. 시퀀스 다이어그램", "Sequence Diagram")
    participants = [
        ("사용자", 170),
        ("React 대시보드", 420),
        ("Cloud Run API", 670),
        ("BigQuery", 920),
        ("Vertex AI Gemini", 1190),
    ]
    top = 190
    bottom = 860
    for name, x in participants:
        rounded_box(draw, (x - 85, top, x + 85, top + 48), name, "", fill=HEADER, radius=8)
        draw.line((x, top + 48, x, bottom), fill="#bbbbbb", width=2)

    messages = [
        (170, 420, "오늘의 의제 목록 조회", 270),
        (420, 670, "GET /issues/today", 330),
        (670, 920, "의제 랭킹 조회", 390),
        (920, 670, "의제 목록 반환", 450),
        (670, 420, "목록 응답", 510),
        (420, 170, "오늘의 의제 표시", 570),
        (170, 420, "특정 이슈 선택", 640),
        (420, 670, "GET /issues/{id}", 700),
        (670, 920, "상세·프레임 결과 조회", 760),
        (670, 1190, "AI 리포트 생성 요청", 820),
    ]
    for x1, x2, label, y in messages:
        arrow(draw, (x1, y), (x2, y), "#555555", 2)
        tx = min(x1, x2) + 25
        draw.text((tx, y - 24), label, fill=DARK, font=F_SMALL)

    rounded_box(draw, (1185, 835, 1490, 900), "응답", "상세 데이터, 프레임 비교, AI 리포트 반환", fill="#fff6df", radius=10)
    arrow(draw, (1190, 835), (670, 835), "#555555", 2)
    arrow(draw, (670, 885), (420, 885), "#555555", 2)
    arrow(draw, (420, 925), (170, 925), "#555555", 2)
    draw.text((450, 900), "이슈 상세 화면 표시", fill=DARK, font=F_SMALL)
    img.save(OUT / "sequence_diagram.png", quality=95)


def render_all() -> None:
    OUT.mkdir(exist_ok=True)
    render_wbs_gantt()
    render_usecase_spec()
    render_usecase_diagram()
    render_activity_diagram()
    render_class_diagram()
    render_sequence_diagram()


if __name__ == "__main__":
    render_all()
    print(f"PNG outputs written to {OUT}")
