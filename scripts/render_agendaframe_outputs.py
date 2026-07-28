from __future__ import annotations

import argparse
import math
import shutil
import uuid
from pathlib import Path
from typing import Sequence

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "outputs"
OUT = DEFAULT_OUT

EXPECTED_OUTPUTS = (
    "wbs_gantt.png",
    "usecase_spec.png",
    "usecase_diagram.png",
    "activity_diagram.png",
    "class_diagram.png",
    "class_diagram_domain.png",
    "class_diagram_implementation.png",
    "sequence_diagram.png",
    "sequence_uc01_uc02.png",
    "sequence_uc03_uc05.png",
    "sequence_uc06.png",
    "sequence_uc07.png",
    "system_architecture.png",
)

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
            line_h = text_size(draw, "가", font_body)[1] + 6
            max_cell_lines = max(1, (h - 12) // line_h)
            draw_wrapped(draw, (cx + 10, cy + 9), cell, font_body, DARK, w - 20, max_lines=max_cell_lines)
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
    from build_agendaframe_submission import render_revised_wbs_png

    render_revised_wbs_png(OUT)
    return

    img, draw = new_canvas("[스크럼 산출물]", "WBS 및 간트차트", "WBS · Gantt Chart")
    draw.text((635, 158), "AgendaFrame WBS 요약", fill=DARK, font=F_SMALL)
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

    draw.text((650, 620), "AgendaFrame 간트차트", fill=DARK, font=F_SMALL)
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
    img, draw = new_canvas("[UML 산출물]", "유스케이스 명세서", "Use Case Specification")
    draw.text((630, 165), "AgendaFrame 주요 유스케이스 명세서", fill=DARK, font=F_SMALL)
    headers = ["ID", "유스케이스", "주요 액터", "목적", "중요도"]
    widths = [90, 280, 220, 625, 80]
    rows = [
        ["UC-01", "분석 조건 설정 및 의제 조회", "일반 사용자\n기자/연구자", "정책 분야, 기간, 언론사, 키워드 조건에 맞는 오늘의 주요 의제를 순위로 확인한다.", "상"],
        ["UC-02", "이슈 상세 조회", "일반 사용자\n기자/연구자", "특정 의제의 요약 설명, 의제 점수 근거, 관련 기사 목록과 원문 링크를 확인한다.", "상"],
        ["UC-03", "언론사별 보도 비교", "일반 사용자\n기자/연구자", "같은 이슈에 대한 언론사별 보도 건수, 제목, 홈페이지 배치 차이를 비교한다.", "상"],
        ["UC-04", "관점/프레임 비교", "일반 사용자\n기자/연구자", "같은 이슈에 대해 언론사별로 어떤 관점과 프레임이 강조되었는지 확인한다.", "상"],
        ["UC-05", "AI 리포트 조회", "사용자\nVertex AI Gemini", "주요 관점, 부족한 관점, 치우침 가능성을 AI 요약 리포트로 확인한다.", "상"],
        ["UC-06", "결과 요약 PDF 내보내기", "일반 사용자\n기자/연구자", "현재 조회 중인 이슈 분석 결과를 PDF 파일로 저장한다.", "하"],
        ["UC-07", "기사 자동 수집 및 분석", "시스템\n외부 서비스", "기사 메타데이터를 수집하고 이슈 클러스터, 의제 점수, 프레임 분석 결과를 생성한다.", "상"],
    ]
    draw_table(draw, 150, 205, widths, [48] + [82] * len(rows), headers, rows, F_BODY, F_HEADER)
    draw.text((150, 890), "※ 정상 흐름, 대안 흐름, 종료 조건을 포함한 상세 명세는 AgendaFrame_유스케이스_명세서.md에 작성한다.", fill=MID, font=F_SMALL)
    img.save(OUT / "usecase_spec.png", quality=95)


def render_usecase_diagram() -> None:
    img, draw = new_canvas("[UML 산출물]", "유스케이스 다이어그램", "Use Case Diagram")
    boundary = (260, 175, 1290, 875)
    draw.rounded_rectangle(boundary, radius=12, outline="#777777", width=3, fill="#fbfbfb")
    draw.text((965, 198), "AgendaFrame System", fill=DARK, font=F_SECTION)

    def usecase(label: str, cx: int, cy: int, w: int = 230, h: int = 68, fill: str = "#eeeeee") -> tuple[int, int, int, int]:
        rect = (cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2)
        draw.ellipse(rect, fill=fill, outline="#cfcfcf", width=2)
        lines = label.split("\n")
        line_h = 19
        start_y = cy - (len(lines) * line_h) // 2
        for idx, line in enumerate(lines):
            tw, _ = text_size(draw, line, F_SMALL)
            draw.text((cx - tw / 2, start_y + idx * line_h), line, fill=DARK, font=F_SMALL)
        return rect

    def external(label: str, x: int, y: int, w: int = 180, h: int = 72) -> tuple[int, int, int, int]:
        rect = (x, y, x + w, y + h)
        draw.rounded_rectangle(rect, radius=8, fill="#fffdf5", outline="#777777", width=2)
        draw.text((x + 18, y + 8), "external", fill=MID, font=F_TINY)
        lines = label.split("\n")
        for idx, line in enumerate(lines):
            tw, _ = text_size(draw, line, F_SMALL)
            draw.text((x + (w - tw) / 2, y + 32 + idx * 18), line, fill=DARK, font=F_SMALL)
        return rect

    def edge_point(rect: tuple[int, int, int, int], target: tuple[int, int]) -> tuple[int, int]:
        cx = (rect[0] + rect[2]) / 2
        cy = (rect[1] + rect[3]) / 2
        dx = target[0] - cx
        dy = target[1] - cy
        if abs(dx) / max(1, rect[2] - rect[0]) > abs(dy) / max(1, rect[3] - rect[1]):
            x = rect[2] if dx > 0 else rect[0]
            y = int(cy + dy * ((x - cx) / dx)) if dx else int(cy)
        else:
            y = rect[3] if dy > 0 else rect[1]
            x = int(cx + dx * ((y - cy) / dy)) if dy else int(cx)
        return int(x), int(y)

    def dashed_line(start: tuple[int, int], end: tuple[int, int], color: str = "#333333", width: int = 2) -> None:
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        length = math.hypot(dx, dy)
        if length == 0:
            return
        ux, uy = dx / length, dy / length
        pos = 0
        dash, gap = 9, 7
        while pos < length:
            seg_end = min(pos + dash, length)
            p1 = (int(start[0] + ux * pos), int(start[1] + uy * pos))
            p2 = (int(start[0] + ux * seg_end), int(start[1] + uy * seg_end))
            draw.line((p1, p2), fill=color, width=width)
            pos += dash + gap

    def relation(src: str, dst: str, label: str, label_xy: tuple[int, int], color: str = "#333333") -> None:
        sr = nodes[src]
        dr = nodes[dst]
        sc = ((sr[0] + sr[2]) // 2, (sr[1] + sr[3]) // 2)
        dc = ((dr[0] + dr[2]) // 2, (dr[1] + dr[3]) // 2)
        start = edge_point(sr, dc)
        end = edge_point(dr, sc)
        dashed_line(start, end, color=color)
        angle = math.atan2(end[1] - start[1], end[0] - start[0])
        size = 10
        p1 = (end[0] - size * math.cos(angle - math.pi / 6), end[1] - size * math.sin(angle - math.pi / 6))
        p2 = (end[0] - size * math.cos(angle + math.pi / 6), end[1] - size * math.sin(angle + math.pi / 6))
        draw.polygon([end, p1, p2], fill=color)
        draw.text(label_xy, label, fill=color, font=F_TINY)

    def association(start: tuple[int, int], dst: str, color: str = "#333333") -> None:
        rect = nodes[dst]
        dc = ((rect[0] + rect[2]) // 2, (rect[1] + rect[3]) // 2)
        end = edge_point(rect, start)
        draw.line((start, end), fill=color, width=3)

    def external_association(src_rect: tuple[int, int, int, int], dst: str) -> None:
        rect = nodes[dst]
        sc = (src_rect[0], (src_rect[1] + src_rect[3]) // 2)
        dc = ((rect[0] + rect[2]) // 2, (rect[1] + rect[3]) // 2)
        end = edge_point(rect, sc)
        draw.line((sc, end), fill="#555555", width=2)

    draw_stick_actor(draw, 95, 330, "사용자")
    scheduler = external("스케줄러", 1370, 795)

    nodes = {
        "UC01": usecase("UC-01\n분석 조건 설정 및\n의제 조회", 520, 230, 250, 78),
        "조건설정": usecase("조회 조건 설정", 835, 230, 205, 56, "#f5f5f5"),
        "UC02": usecase("UC-02\n이슈 상세 조회", 520, 340, 250, 72),
        "UC03": usecase("UC-03\n언론사별 보도 비교", 520, 450, 250, 72),
        "UC04": usecase("UC-04\n관점/프레임 비교", 520, 560, 250, 72),
        "UC05": usecase("UC-05\nAI 리포트 조회", 520, 670, 250, 72),
        "AI생성": usecase("AI 리포트 생성", 835, 670, 205, 56, "#f5f5f5"),
        "UC06": usecase("UC-06\n결과 요약 PDF\n내보내기", 520, 790, 250, 78),
        "PDF생성": usecase("PDF 파일 생성", 835, 790, 205, 56, "#f5f5f5"),
        "UC07": usecase("UC-07\n기사 자동 수집 및\n분석", 1040, 790, 250, 78),
        "기사수집": usecase("기사 메타데이터\n수집", 1040, 670, 220, 60, "#f5f5f5"),
        "분석생성": usecase("이슈·프레임\n분석 결과 생성", 1040, 560, 220, 64, "#f5f5f5"),
    }

    for start, target in [
        ((170, 360), "UC01"),
        ((170, 380), "UC02"),
        ((170, 400), "UC03"),
        ((170, 420), "UC04"),
        ((170, 440), "UC05"),
        ((170, 460), "UC06"),
    ]:
        association(start, target)
    external_association(scheduler, "UC07")

    # Use cases are split into 7 user/system goals. Output widgets are handled in activity/spec documents.
    relation("UC01", "조건설정", "<<include>>", (650, 194))
    relation("UC05", "AI생성", "<<include>>", (650, 630))
    relation("UC06", "PDF생성", "<<include>>", (650, 750))
    relation("UC07", "기사수집", "<<include>>", (930, 710))
    relation("UC07", "분석생성", "<<include>>", (930, 618))
    img.save(OUT / "usecase_diagram.png", quality=95)


def render_activity_diagram() -> None:
    img, draw = new_canvas("[UML 산출물]", "액티비티 다이어그램", "Activity Diagram")
    lanes = [
        ("수집/분석 배치", 95, 290, "#f7f7f7"),
        ("저장소·AI", 590, 290, "#f8fbff"),
        ("사용자 조회", 1085, 290, "#fbfff8"),
    ]
    for title, x, w, fill in lanes:
        draw.rounded_rectangle((x, 175, x + w, 905), radius=10, fill=fill, outline="#dddddd", width=2)
        draw.text((x + 18, 192), title, fill=DARK, font=F_SECTION)

    def node(label: str, cx: int, cy: int, w: int = 245, h: int = 48, fill: str = "white") -> tuple[int, int, int, int]:
        rect = (cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2)
        draw.rounded_rectangle(rect, radius=10, fill=fill, outline="#777777", width=2)
        draw_wrapped(draw, (rect[0] + 12, rect[1] + 11), label, F_SMALL, DARK, w - 24, max_lines=2)
        return rect

    def decision(label: str, cx: int, cy: int, w: int = 150, h: int = 64) -> tuple[int, int, int, int]:
        pts = [(cx, cy - h // 2), (cx + w // 2, cy), (cx, cy + h // 2), (cx - w // 2, cy)]
        draw.polygon(pts, fill=YELLOW, outline="#777777")
        draw_wrapped(draw, (cx - w // 2 + 18, cy - 17), label, F_TINY, DARK, w - 36, max_lines=2)
        return (cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2)

    def center_bottom(rect: tuple[int, int, int, int]) -> tuple[int, int]:
        return ((rect[0] + rect[2]) // 2, rect[3])

    def center_top(rect: tuple[int, int, int, int]) -> tuple[int, int]:
        return ((rect[0] + rect[2]) // 2, rect[1])

    def center_left(rect: tuple[int, int, int, int]) -> tuple[int, int]:
        return (rect[0], (rect[1] + rect[3]) // 2)

    def center_right(rect: tuple[int, int, int, int]) -> tuple[int, int]:
        return (rect[2], (rect[1] + rect[3]) // 2)

    def center_y(rect: tuple[int, int, int, int]) -> int:
        return (rect[1] + rect[3]) // 2

    def poly_arrow(points: list[tuple[int, int]], color: str = "#666666", width: int = 2) -> None:
        for p1, p2 in zip(points, points[1:-1]):
            draw.line((p1, p2), fill=color, width=width)
        arrow(draw, points[-2], points[-1], color, width)

    start = (240, 245)
    draw.ellipse((start[0] - 18, start[1] - 18, start[0] + 18, start[1] + 18), fill=DARK)
    load = node("수집 대상·규칙 조회", 240, 315, fill=BLUE)
    fetch = node("언론사 홈페이지 요청", 240, 385)
    parse = node("기사 메타데이터 추출", 240, 455)
    valid = decision("필수값 유효?", 240, 535)
    dedup = decision("중복 기사?", 240, 620)
    error_log = node("오류·중복 로그 저장", 240, 760, fill="#fff0f0")
    save_article = node("신규 기사 저장", 735, 620, fill=GREEN)
    embed = node("임베딩 생성", 735, 680)
    cluster = node("이슈 클러스터링", 735, 740)
    score = node("의제 점수 산출", 735, 800)
    analysis_save = node("프레임 분석 및\n조회 상태 반영", 735, 865, h=56, fill=GREEN)
    query = node("조회 조건 입력", 1230, 315, fill=BLUE)
    query_valid = decision("조건 유효?", 1230, 395)
    rank = node("의제 랭킹 조회", 1230, 485)
    exists = decision("결과 있음?", 1230, 575)
    detail = node("이슈 상세·비교 데이터 조회", 1230, 665)
    render = node("대시보드 화면 출력", 1230, 765, fill=GREEN)
    end = (1230, 845)
    draw.ellipse((end[0] - 22, end[1] - 22, end[0] + 22, end[1] + 22), outline=DARK, width=3)
    draw.ellipse((end[0] - 11, end[1] - 11, end[0] + 11, end[1] + 11), fill=DARK)

    arrow(draw, (start[0], start[1] + 18), center_top(load), "#666666", 2)
    for a, b in [(load, fetch), (fetch, parse), (parse, valid), (valid, dedup)]:
        arrow(draw, center_bottom(a), center_top(b), "#666666", 2)
    arrow(draw, center_right(dedup), center_left(save_article), "#666666", 2)
    draw.text((323, 590), "아니오: 신규", fill=MID, font=F_TINY)
    poly_arrow([center_left(valid), (135, center_y(valid)), (135, error_log[1]), center_top(error_log)], "#aa5555", 2)
    draw.text((125, 575), "아니오", fill="#aa5555", font=F_TINY)
    arrow(draw, center_bottom(dedup), center_top(error_log), "#aa5555", 2)
    draw.text((176, 685), "예: 중복", fill="#aa5555", font=F_TINY)
    for a, b in [(save_article, embed), (embed, cluster), (cluster, score), (score, analysis_save)]:
        arrow(draw, center_bottom(a), center_top(b), "#666666", 2)
    draw_wrapped(
        draw,
        (900, 835),
        "저장된 분석 결과는 사용자 조회 API의 입력 데이터로 사용된다.",
        F_TINY,
        MID,
        170,
        max_lines=3,
    )
    for a, b in [(query, query_valid), (query_valid, rank), (rank, exists), (exists, detail), (detail, render)]:
        arrow(draw, center_bottom(a), center_top(b), "#666666", 2)
    arrow(draw, center_bottom(render), (end[0], end[1] - 22), "#666666", 2)
    draw.text((1260, 430), "예", fill=MID, font=F_TINY)
    draw.text((1260, 610), "예", fill=MID, font=F_TINY)
    draw.text((1125, 410), "아니오: 오류 안내", fill="#aa5555", font=F_TINY)
    draw.text((1125, 590), "아니오: 빈 상태", fill="#aa5555", font=F_TINY)
    img.save(OUT / "activity_diagram.png", quality=95)


def render_class_diagram() -> None:
    img, draw = new_canvas("[UML 산출물]", "클래스 다이어그램", "Class Diagram")

    def cls(x: int, y: int, w: int, h: int, name: str, attrs: list[str], methods: list[str], fill: str) -> tuple[int, int, int, int]:
        draw.rectangle((x, y, x + w, y + h), fill="white", outline="#555555", width=2)
        draw.rectangle((x, y, x + w, y + 34), fill=fill, outline="#555555", width=2)
        tw, _ = text_size(draw, name, F_BOLD)
        draw.text((x + (w - tw) / 2, y + 7), name, fill=DARK, font=F_BOLD)
        cy = y + 42
        for a in attrs:
            draw.text((x + 10, cy), a, fill=DARK, font=F_TINY)
            cy += 19
        draw.line((x, cy + 4, x + w, cy + 4), fill="#999999", width=1)
        cy += 12
        for m in methods:
            draw.text((x + 10, cy), m, fill="#1f4f7a", font=F_TINY)
            cy += 19
        return (x, y, x + w, y + h)

    def band(y1: int, y2: int, title: str) -> None:
        draw.rounded_rectangle((70, y1, 1530, y2), radius=8, fill="#fbfbfb", outline="#dddddd", width=2)
        draw.text((88, y1 + 8), title, fill=MID, font=F_HEADER)

    def down(src: tuple[int, int, int, int], dst: tuple[int, int, int, int], label: str = "") -> None:
        x1 = (src[0] + src[2]) // 2
        x2 = (dst[0] + dst[2]) // 2
        arrow(draw, (x1, src[3]), (x2, dst[1]), "#777777", 2)
        if label:
            draw.text(((x1 + x2) // 2 + 6, (src[3] + dst[1]) // 2 - 10), label, fill=MID, font=F_TINY)

    def horiz(src: tuple[int, int, int, int], dst: tuple[int, int, int, int], label: str = "") -> None:
        arrow(draw, (src[2], (src[1] + src[3]) // 2), (dst[0], (dst[1] + dst[3]) // 2), "#777777", 2)
        if label:
            draw.text((src[2] + 10, min(src[1], dst[1]) - 18), label, fill=MID, font=F_TINY)

    band(175, 385, "Domain Model")
    band(405, 605, "Application Services / Entry Points")
    band(625, 895, "Repository / External Clients")

    media = cls(105, 225, 205, 140, "MediaOutlet", ["+mediaOutletId", "+name", "+homepageUrl", "+enabled"], [], YELLOW)
    article = cls(340, 225, 230, 140, "Article", ["+articleId", "+title", "+url", "+placement", "+contentHash"], [], YELLOW)
    issue = cls(600, 225, 210, 140, "Issue", ["+issueId", "+title", "+summary", "+categoryId", "+status"], [], YELLOW)
    score = cls(840, 225, 205, 140, "AgendaScore", ["+articleCount", "+mediaCount", "+totalScore"], ["+calculate()"], YELLOW)
    frame = cls(1075, 225, 215, 140, "FrameAnalysis", ["+frameType", "+confidence", "+evidenceText", "+status"], [], YELLOW)
    ai_report = cls(1320, 225, 180, 140, "AIReport", ["+summary", "+missingPerspective", "+biasPossibility"], [], YELLOW)

    dashboard = cls(105, 445, 230, 150, "DashboardController", [], ["+getIssues()", "+getIssueDetail()", "+getReport()"], BLUE)
    job = cls(365, 445, 190, 150, "CollectorJob", [], ["+run()"], BLUE)
    collector = cls(590, 445, 210, 150, "CollectorService", ["+parse()", "+normalizePlacement()"], ["+collect()"], GREEN)
    analysis = cls(830, 445, 235, 150, "AnalysisPipelineService", ["+similarityThreshold", "+frameCodebook"], ["+cluster()", "+score()", "+analyze()"], GREEN)
    report = cls(1100, 445, 205, 150, "ReportService", ["+promptTemplate"], ["+getOrCreate()"], GREEN)
    pdf = cls(1335, 445, 165, 150, "PdfExportService", [], ["+renderIssueReport()"], GREEN)

    article_repo = cls(115, 655, 225, 110, "ArticleRepository", [], ["+save()", "+existsByHash()", "+findByQuery()"], PURPLE)
    issue_repo = cls(385, 655, 215, 110, "IssueRepository", [], ["+findRanked()", "+findDetail()", "+save()"], PURPLE)
    analysis_repo = cls(645, 655, 230, 110, "AnalysisRepository", [], ["+saveFrameAnalysis()", "+findReport()"], PURPLE)
    news_client = cls(930, 655, 190, 110, "NewsSiteClient", [], ["+fetchHomepage()"], PURPLE)
    vertex_client = cls(1160, 655, 190, 110, "VertexAIClient", [], ["+embed()", "+generate()"], PURPLE)
    storage_client = cls(1390, 655, 105, 110, "Storage", [], ["+save()"], PURPLE)

    draw.rounded_rectangle((115, 785, 1485, 880), radius=10, fill="#fffdf5", outline="#dddddd", width=2)
    principles = [
        "구현 원칙: Controller/Job -> Service -> Repository/Client 방향으로만 의존한다.",
        "Article 전문은 저장하지 않고 URL, 제목, 섹션, 배치 위치, 수집 시각 등 메타데이터 중심으로 관리한다.",
        "외부 AI와 저장소는 Client 인터페이스로 분리하여 테스트와 교체가 가능하도록 한다.",
    ]
    cy = 800
    for principle in principles:
        cy = draw_wrapped(draw, (135, cy), principle, F_SMALL, DARK, 1320, max_lines=1) + 2

    horiz(media, article)
    draw.text((315, 250), "1..*", fill=MID, font=F_TINY)
    horiz(article, issue)
    draw.text((575, 250), "cluster", fill=MID, font=F_TINY)
    horiz(issue, score)
    draw.text((815, 250), "1", fill=MID, font=F_TINY)
    horiz(score, frame)
    draw.text((1050, 250), "analysis", fill=MID, font=F_TINY)
    horiz(frame, ai_report)
    draw.text((1295, 250), "report", fill=MID, font=F_TINY)

    img.save(OUT / "class_diagram.png", quality=95)


def render_sequence_diagram() -> None:
    img, draw = new_canvas("[UML 산출물]", "시퀀스 다이어그램", "Sequence Diagram")
    def draw_panel(title: str, y1: int, y2: int) -> None:
        draw.rounded_rectangle((80, y1, 1520, y2), radius=10, fill="#fbfbfb", outline="#dddddd", width=2)
        draw.text((100, y1 + 12), title, fill=DARK, font=F_HEADER)

    def lifelines(names: list[tuple[str, int]], y1: int, y2: int) -> None:
        for name, x in names:
            rounded_box(draw, (x - 78, y1, x + 78, y1 + 42), name, "", fill=HEADER, radius=8, title_font=F_SMALL)
            draw.line((x, y1 + 42, x, y2), fill="#c8c8c8", width=2)

    def msg(x1: int, x2: int, y: int, label: str, dashed: bool = False, label_below: bool = False) -> None:
        if dashed:
            # Small return-message style line.
            dx = x2 - x1
            length = abs(dx)
            step = 12 if dx > 0 else -12
            x = x1
            while (x < x2 if dx > 0 else x > x2):
                x_next = x + step
                if (x_next > x2 and dx > 0) or (x_next < x2 and dx < 0):
                    x_next = x2
                draw.line((x, y, x_next, y), fill="#666666", width=2)
                x += step * 2
            arrow(draw, (x2 - (8 if dx > 0 else -8), y), (x2, y), "#666666", 2)
        else:
            arrow(draw, (x1, y), (x2, y), "#555555", 2)
        tx = min(x1, x2) + 10
        ty = y + 6 if label_below else y - 22
        draw.text((tx, ty), label, fill=DARK, font=F_TINY)

    draw_panel("사용자 조회 및 AI 리포트 생성", 175, 540)
    top_names = [("사용자", 160), ("React UI", 385), ("Dashboard API", 625), ("Repository", 865), ("ReportService", 1110), ("Vertex AI", 1350)]
    lifelines(top_names, 215, 530)
    msg(160, 385, 270, "조회 조건 입력", label_below=True)
    msg(385, 625, 295, "GET /issues")
    msg(625, 865, 320, "findRanked(query)")
    msg(865, 625, 345, "rankedIssues", dashed=True)
    msg(625, 385, 370, "200 issueList", dashed=True)
    msg(385, 160, 395, "의제 랭킹 표시", dashed=True)
    msg(160, 385, 420, "이슈 선택 / 리포트 열기")
    msg(385, 625, 445, "GET /issues/{id}/report")
    msg(625, 1110, 470, "getOrCreate(issueId)")
    msg(1110, 865, 495, "findReport or loadContext")
    msg(1110, 1350, 505, "generate(prompt) when missing")

    draw_panel("기사 자동 수집 및 분석", 560, 920)
    bottom_names = [("Scheduler", 150), ("CollectorJob", 365), ("CollectorService", 600), ("ArticleRepo", 835), ("AnalysisService", 1075), ("Vertex AI", 1310)]
    lifelines(bottom_names, 600, 905)
    msg(150, 365, 640, "run()", label_below=True)
    msg(365, 600, 670, "collectAllEnabledMedia()")
    msg(600, 600, 700, "fetch + parse + normalize")
    msg(600, 835, 730, "existsByHash(hash)")
    msg(835, 600, 760, "false / duplicate", dashed=True)
    msg(600, 835, 790, "save(article)")
    msg(365, 1075, 820, "cluster + score + analyze")
    msg(1075, 1310, 850, "embed / generate")
    msg(1310, 1075, 880, "vectors / frame result", dashed=True)
    msg(1075, 835, 910, "save issues, scores, frames")
    img.save(OUT / "sequence_diagram.png", quality=95)


def _render_legacy_system_architecture() -> None:
    aw, ah = 2200, 1200
    img = Image.new("RGB", (aw, ah), "white")
    draw = ImageDraw.Draw(img)

    def line_arrow(
        start: tuple[int, int],
        end: tuple[int, int],
        color: str = "#243044",
        width: int = 3,
        dashed: bool = False,
    ) -> None:
        if dashed:
            dx = end[0] - start[0]
            dy = end[1] - start[1]
            length = math.hypot(dx, dy)
            if length == 0:
                return
            ux, uy = dx / length, dy / length
            pos = 0
            while pos < length:
                seg_end = min(pos + 12, length)
                p1 = (int(start[0] + ux * pos), int(start[1] + uy * pos))
                p2 = (int(start[0] + ux * seg_end), int(start[1] + uy * seg_end))
                draw.line((p1, p2), fill=color, width=width)
                pos += 22
            arrow(draw, (end[0] - int(12 * ux), end[1] - int(12 * uy)), end, color, width)
        else:
            arrow(draw, start, end, color, width)

    def polyline_arrow(points: list[tuple[int, int]], color: str = "#243044", width: int = 3) -> None:
        for p1, p2 in zip(points, points[1:-1]):
            draw.line((p1, p2), fill=color, width=width)
        arrow(draw, points[-2], points[-1], color, width)

    def box(
        rect: tuple[int, int, int, int],
        title: str,
        body: str = "",
        fill: str = "white",
        outline: str = "#b8c2d0",
        title_color: str = DARK,
        title_font: ImageFont.ImageFont = F_HEADER,
        body_font: ImageFont.ImageFont = F_SMALL,
        radius: int = 12,
        align: str = "center",
    ) -> None:
        draw.rounded_rectangle(rect, radius=radius, fill=fill, outline=outline, width=3)
        x1, y1, x2, _ = rect
        title_y = y1 + 16
        if align == "left":
            draw.text((x1 + 22, title_y), title, fill=title_color, font=title_font)
        else:
            tw, _ = text_size(draw, title, title_font)
            draw.text((x1 + (x2 - x1 - tw) / 2, title_y), title, fill=title_color, font=title_font)
        if body:
            draw_wrapped(draw, (x1 + 24, y1 + 52), body, body_font, DARK, x2 - x1 - 48, max_lines=3)

    def panel(rect: tuple[int, int, int, int], title: str, fill: str, outline: str, title_color: str) -> None:
        draw.rounded_rectangle(rect, radius=14, fill=fill, outline=outline, width=4)
        draw.text((rect[0] + 22, rect[1] + 22), title, fill=title_color, font=F_HEADER)

    def component(
        rect: tuple[int, int, int, int],
        title: str,
        body: str,
        accent: str,
        fill: str,
        outline: str,
    ) -> None:
        draw.rounded_rectangle(rect, radius=12, fill=fill, outline=outline, width=3)
        draw.rounded_rectangle((rect[0] + 18, rect[1] + 22, rect[0] + 48, rect[1] + 52), radius=6, fill=accent)
        draw.text((rect[0] + 62, rect[1] + 24), title, fill=accent, font=F_HEADER)
        draw_wrapped(draw, (rect[0] + 24, rect[1] + 62), body, F_SMALL, DARK, rect[2] - rect[0] - 48, max_lines=3)

    def chip(rect: tuple[int, int, int, int], title: str, body: str = "") -> None:
        draw.rounded_rectangle(rect, radius=8, fill="#f8fafc", outline="#d5dce6", width=3)
        tw, _ = text_size(draw, title, F_SMALL)
        draw.text((rect[0] + (rect[2] - rect[0] - tw) / 2, rect[1] + 11), title, fill=DARK, font=F_SMALL)
        if body:
            draw_wrapped(draw, (rect[0] + 12, rect[1] + 34), body, F_TINY, MID, rect[2] - rect[0] - 24, max_lines=1)

    def user_icon(x: int, y: int, color: str = "#144398") -> None:
        draw.ellipse((x - 22, y, x + 22, y + 44), fill=color)
        draw.polygon([(x - 48, y + 120), (x + 48, y + 120), (x + 30, y + 55), (x - 30, y + 55)], fill=color)
        tw, _ = text_size(draw, "User", F_HEADER)
        draw.text((x - tw / 2, y + 135), "User", fill=color, font=F_HEADER)

    # Title
    draw.rectangle((52, 58, 64, 116), fill="#a7df28")
    draw.text((78, 50), "시스템 아키텍처 및 구현", fill="#111827", font=font("bold", 52))

    # Left deployment / frontend side
    user_icon(95, 360)
    web = (245, 305, 525, 455)
    box(web, "Web UI", "React / Next.js\n대시보드 · 비교 화면 · 리포트", fill="#f8fbff", outline="#4c7fd8", title_color="#184fbb", title_font=F_SECTION)
    vercel = (260, 520, 510, 600)
    box(vercel, "Vercel", "프론트엔드 배포", fill="white", outline="#bbbbbb")
    github = (70, 700, 210, 785)
    actions = (260, 700, 535, 785)
    box(github, "GitHub", "", fill="white", outline="#c6c6c6")
    box(actions, "GitHub Actions", "CI/CD · 수집 배치 트리거", fill="white", outline="#c6c6c6")
    line_arrow((135, 380), (245, 380))
    line_arrow((385, 455), (385, 520))
    line_arrow((210, 742), (260, 742), color="#2166db")
    line_arrow((375, 700), (375, 600), color="#2166db")
    line_arrow((410, 700), (410, 600), color="#2166db")
    draw.text((552, 382), "API 요청", fill=MID, font=F_SMALL)
    draw.text((455, 630), "프론트엔드 배포", fill=MID, font=F_TINY)

    # Backend stack
    backend = (655, 250, 1700, 855)
    draw.rounded_rectangle(backend, radius=16, fill="#fffefd", outline="#d69b6b", width=4)
    draw.text((685, 275), "GCP / PaaS Backend Stack  (Cloud Run · BigQuery · Cloud Storage)", fill="#7b4a1f", font=F_HEADER)

    app_panel = (690, 320, 970, 812)
    ai_panel = (1010, 320, 1290, 812)
    data_panel = (1330, 320, 1658, 812)
    panel(app_panel, "A. Application Layer", "#fff5eb", "#ea7c20", "#d97706")
    panel(ai_panel, "B. AI / ML Layer", "#eef6ff", "#2563eb", "#1d4ed8")
    panel(data_panel, "C. Data Layer", "#effaf4", "#179564", "#168356")

    collector = (720, 390, 940, 500)
    api = (720, 540, 940, 650)
    export = (720, 690, 940, 790)
    component(collector, "Data Collector", "정기 기사 수집\n제목·URL·섹션·배치 추출", "#e87917", "#fffdf8", "#e87917")
    component(api, "FastAPI API Server", "의제 조회·상세 조회\n비교·리포트 라우팅", "#e87917", "#fffdf8", "#e87917")
    component(export, "Report Export", "PDF 생성\n다운로드 응답", "#e87917", "#fffdf8", "#e87917")

    preprocessing = (1040, 390, 1260, 500)
    prediction = (1040, 540, 1260, 650)
    report = (1040, 690, 1260, 790)
    component(preprocessing, "Preprocessing", "기사 정규화\n임베딩 feature 생성", "#2563eb", "#fffbeb", "#d8a300")
    component(prediction, "Agenda Engine", "이슈 클러스터링\n의제 점수 계산", "#2563eb", "#f8fbff", "#2563eb")
    component(report, "Frame / Report AI", "프레임 분석\nAI 요약 설명 생성", "#2563eb", "#f8fbff", "#2563eb")

    bigquery = (1360, 390, 1628, 500)
    storage = (1360, 540, 1628, 650)
    artifacts = (1360, 690, 1628, 790)
    component(bigquery, "BigQuery", "기사·이슈·점수\n프레임 분석 결과", "#209868", "#f8fffb", "#209868")
    component(storage, "Cloud Storage", "HTML 스냅샷\nPDF 산출물", "#209868", "#f8fffb", "#209868")
    component(artifacts, "Analysis Artifacts", "프롬프트·실행 로그\n검증 지표", "#209868", "#f8fffb", "#209868")

    # Internal arrows
    polyline_arrow([(525, 380), (600, 380), (600, 595), (720, 595)])
    line_arrow((940, 445), (1040, 445))
    line_arrow((940, 595), (1040, 595))
    line_arrow((940, 740), (1040, 740))
    line_arrow((1260, 445), (1360, 445))
    line_arrow((1260, 595), (1360, 595))
    line_arrow((1260, 740), (1360, 740))
    line_arrow((830, 500), (830, 540), color="#8a8a8a")
    line_arrow((830, 650), (830, 690), color="#8a8a8a")
    line_arrow((1150, 500), (1150, 540), color="#8a8a8a")
    line_arrow((1150, 650), (1150, 690), color="#8a8a8a")

    # External AI and sources
    llm = (1115, 128, 1420, 200)
    box(llm, "Vertex AI Gemini", "임베딩 · 프레임 분석 · 요약 생성", fill="white", outline="#b6b6b6")
    line_arrow((1265, 200), (1265, 320), dashed=True, color="#5c6470")

    sources = (1760, 330, 2140, 730)
    draw.rounded_rectangle(sources, radius=12, fill="white", outline="#7ba8e8", width=4)
    draw.text((1790, 355), "External Sources", fill="#1d4ed8", font=F_HEADER)
    draw.text((1790, 390), "주요 언론사 홈페이지", fill=MID, font=F_SMALL)
    source_names = ["조선일보", "중앙일보", "동아일보", "한겨레", "경향신문", "KBS/MBC"]
    sx, sy = 1790, 425
    for idx, name in enumerate(source_names):
        col = idx % 2
        row = idx // 2
        chip((sx + col * 170, sy + row * 78, sx + col * 170 + 145, sy + row * 78 + 58), name)
    draw.rounded_rectangle((1790, 668, 2110, 710), radius=8, fill="#f5f9ff", outline="#d5e4fb")
    draw.text((1810, 680), "제목 · URL · 섹션 · 배치 위치 수집", fill="#344054", font=F_TINY)
    line_arrow((1760, 500), (1658, 445), color="#344054", width=2)
    draw.text((1682, 456), "기사 메타데이터 입력", fill=MID, font=F_TINY)

    # Ops support
    ops = (655, 890, 1700, 995)
    draw.rounded_rectangle(ops, radius=12, fill="white", outline="#d4d8df", width=3)
    draw.text((690, 918), "운영 / 인프라 지원", fill="#1d4ed8", font=F_HEADER)
    ops_items = [
        ("GitHub Actions", "CI/CD"),
        ("Cloud Scheduler", "정기 수집 실행"),
        ("Logging", "오류·상태 추적"),
        ("Validation Gate", "데이터 품질 검증"),
        ("Artifacts", "보고서·모델 버전"),
    ]
    ox = 880
    for idx, (title, body) in enumerate(ops_items):
        chip((ox + idx * 160, 914, ox + idx * 160 + 150, 968), title, body)
    line_arrow((535, 742), (655, 742), dashed=True, color="#777777")
    draw.text((545, 682), "배치 실행\n수집·분석 재학습", fill=MID, font=F_TINY)

    # Bottom pipeline
    flow = (480, 1060, 1710, 1122)
    draw.rounded_rectangle(flow, radius=12, fill="#eef7ff", outline="#bfdbfe", width=3)
    flow_text = "기사 수집   →   정제·구조화   →   이슈 클러스터링   →   점수·프레임 분석   →   AI 리포트/PDF   →   대시보드 제공"
    tw, _ = text_size(draw, flow_text, F_HEADER)
    draw.text((flow[0] + (flow[2] - flow[0] - tw) / 2, 1077), flow_text, fill="#1d4ed8", font=F_HEADER)

    img.save(OUT / "system_architecture.png", quality=95)


def render_system_architecture_plan_aligned() -> None:
    aw, ah = 2300, 1280
    img = Image.new("RGB", (aw, ah), "white")
    draw = ImageDraw.Draw(img)

    TITLE = "#111827"
    BLUE_DARK = "#174ea6"
    BLUE_LINE = "#2b6bdc"
    ORANGE = "#e87511"
    GREEN_DARK = "#168356"
    GRAY_LINE = "#303846"

    def dashed_line(start: tuple[int, int], end: tuple[int, int], color: str = "#667085", width: int = 3) -> None:
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        length = math.hypot(dx, dy)
        if not length:
            return
        ux, uy = dx / length, dy / length
        pos = 0
        while pos < length:
            seg_end = min(pos + 16, length)
            p1 = (int(start[0] + ux * pos), int(start[1] + uy * pos))
            p2 = (int(start[0] + ux * seg_end), int(start[1] + uy * seg_end))
            draw.line((p1, p2), fill=color, width=width)
            pos += 28

    def line_arrow(
        start: tuple[int, int],
        end: tuple[int, int],
        color: str = GRAY_LINE,
        width: int = 3,
        dashed: bool = False,
    ) -> None:
        if dashed:
            dashed_line(start, end, color, width)
            angle = math.atan2(end[1] - start[1], end[0] - start[0])
            back = (int(end[0] - 14 * math.cos(angle)), int(end[1] - 14 * math.sin(angle)))
            arrow(draw, back, end, color, width)
        else:
            arrow(draw, start, end, color, width)

    def polyline_arrow(
        points: list[tuple[int, int]],
        color: str = GRAY_LINE,
        width: int = 3,
        dashed: bool = False,
    ) -> None:
        for p1, p2 in zip(points, points[1:-1]):
            if dashed:
                dashed_line(p1, p2, color, width)
            else:
                draw.line((p1, p2), fill=color, width=width)
        line_arrow(points[-2], points[-1], color=color, width=width, dashed=dashed)

    def centered(text: str, rect: tuple[int, int, int, int], fnt: ImageFont.ImageFont, fill: str = DARK, dy: int = 0) -> None:
        tw, th = text_size(draw, text, fnt)
        x1, y1, x2, y2 = rect
        draw.text((x1 + (x2 - x1 - tw) / 2, y1 + (y2 - y1 - th) / 2 + dy), text, fill=fill, font=fnt)

    def box(
        rect: tuple[int, int, int, int],
        title: str,
        body: str = "",
        fill: str = "white",
        outline: str = "#d0d5dd",
        title_color: str = DARK,
        body_color: str = DARK,
        title_font: ImageFont.ImageFont = F_HEADER,
        radius: int = 12,
        width: int = 3,
    ) -> None:
        draw.rounded_rectangle(rect, radius=radius, fill=fill, outline=outline, width=width)
        x1, y1, x2, _ = rect
        tw, _ = text_size(draw, title, title_font)
        draw.text((x1 + (x2 - x1 - tw) / 2, y1 + 18), title, fill=title_color, font=title_font)
        if body:
            draw_wrapped(draw, (x1 + 24, y1 + 56), body, F_SMALL, body_color, x2 - x1 - 48, max_lines=3)

    def panel(rect: tuple[int, int, int, int], title: str, fill: str, outline: str, title_color: str) -> None:
        draw.rounded_rectangle(rect, radius=16, fill=fill, outline=outline, width=4)
        draw.text((rect[0] + 22, rect[1] + 20), title, fill=title_color, font=F_HEADER)

    def card(
        rect: tuple[int, int, int, int],
        title: str,
        body: str,
        accent: str,
        fill: str,
        outline: str,
        max_lines: int = 3,
    ) -> None:
        draw.rounded_rectangle(rect, radius=12, fill=fill, outline=outline, width=3)
        draw.rounded_rectangle((rect[0] + 18, rect[1] + 22, rect[0] + 50, rect[1] + 54), radius=7, fill=accent)
        draw.text((rect[0] + 64, rect[1] + 23), title, fill=accent, font=F_HEADER)
        draw_wrapped(draw, (rect[0] + 24, rect[1] + 66), body, F_TINY, DARK, rect[2] - rect[0] - 48, line_gap=5, max_lines=max_lines)

    def chip(rect: tuple[int, int, int, int], title: str, body: str = "", outline: str = "#d5dce6") -> None:
        draw.rounded_rectangle(rect, radius=9, fill="#f8fafc", outline=outline, width=2)
        centered(title, (rect[0] + 8, rect[1] + 6, rect[2] - 8, rect[1] + 30), F_TINY, DARK)
        if body:
            centered(body, (rect[0] + 8, rect[1] + 30, rect[2] - 8, rect[3] - 4), F_TINY, MID)

    def user_icon(x: int, y: int) -> None:
        color = "#174ea6"
        draw.ellipse((x - 24, y, x + 24, y + 48), fill=color)
        draw.polygon([(x - 54, y + 135), (x + 54, y + 135), (x + 32, y + 62), (x - 32, y + 62)], fill=color)
        centered("User", (x - 70, y + 145, x + 70, y + 180), F_HEADER, color)

    def small_icon(rect: tuple[int, int, int, int], color: str, kind: str) -> None:
        x1, y1, x2, y2 = rect
        if kind == "screen":
            draw.rectangle((x1 + 12, y1 + 9, x2 - 12, y2 - 13), outline=color, width=4)
            for i, h in enumerate([18, 32, 24]):
                bx = x1 + 25 + i * 20
                draw.rectangle((bx, y2 - 24 - h, bx + 10, y2 - 24), fill=color)
            draw.line((x1 + 42, y2 - 5, x2 - 42, y2 - 5), fill=color, width=4)
        elif kind == "repo":
            draw.ellipse((x1 + 12, y1 + 12, x1 + 36, y1 + 36), outline=color, width=4)
            draw.ellipse((x2 - 36, y1 + 12, x2 - 12, y1 + 36), outline=color, width=4)
            draw.ellipse((x1 + 34, y2 - 38, x1 + 58, y2 - 14), outline=color, width=4)
            draw.line((x1 + 34, y1 + 28, x1 + 42, y2 - 28), fill=color, width=4)
            draw.line((x2 - 34, y1 + 28, x1 + 55, y2 - 30), fill=color, width=4)

    # Title
    draw.rectangle((60, 70, 74, 136), fill="#a7df28")
    draw.text((95, 58), "시스템 아키텍처 및 구현", fill=TITLE, font=font("bold", 56))
    draw.text((98, 134), "AgendaFrame MVP 계획서 기준 구조", fill="#475467", font=F_HEADER)

    # Left: user, frontend, deployment
    user_icon(115, 390)
    web = (245, 335, 570, 515)
    box(web, "Web Dashboard", "오늘의 의제 랭킹\n이슈 상세·기사 목록\n언론사별 보도·프레임 비교", fill="#f8fbff", outline="#4c7fd8", title_color=BLUE_DARK, title_font=F_SECTION)
    frontend = (278, 585, 540, 670)
    box(frontend, "Frontend Hosting", "정적 대시보드 배포", fill="white", outline="#bdbdbd")
    github = (70, 780, 220, 880)
    actions = (275, 750, 570, 910)
    box(github, "GitHub", "", fill="white", outline="#c6c6c6")
    box(actions, "GitHub Actions", "CI/CD\n정기 배치 실행\n검증 산출물 관리", fill="white", outline="#c6c6c6")
    line_arrow((140, 430), (245, 430))
    line_arrow((408, 515), (408, 585))
    line_arrow((220, 830), (275, 830), color=BLUE_LINE)
    line_arrow((400, 750), (400, 670), color=BLUE_LINE)
    line_arrow((438, 750), (438, 670), color=BLUE_LINE)

    # Center backend stack
    backend = (635, 260, 1770, 930)
    draw.rounded_rectangle(backend, radius=18, fill="#fffefd", outline="#d99b6b", width=4)
    draw.text((675, 285), "AgendaFrame MVP 구현 구조", fill="#7b4a1f", font=F_SECTION)
    draw.text((675, 320), "계획서 핵심 기능: 수집 기준 설정 → 기사 수집 → 메타데이터 저장 → 이슈/의제 분석 → 프레임/AI 리포트", fill="#7b4a1f", font=F_SMALL)

    collect_panel = (670, 345, 980, 885)
    analysis_panel = (1018, 345, 1335, 885)
    data_panel = (1372, 345, 1732, 885)
    panel(collect_panel, "A. 수집 / API Layer", "#fff5eb", ORANGE, "#d97706")
    panel(analysis_panel, "B. 분석 / AI Layer", "#eef6ff", BLUE_LINE, "#1d4ed8")
    panel(data_panel, "C. Data Layer", "#effaf4", GREEN_DARK, GREEN_DARK)

    collector = (705, 420, 950, 535)
    api = (705, 600, 950, 715)
    scheduler = (705, 775, 950, 855)
    card(collector, "Playwright 수집기", "제목·URL·언론사·섹션\n배치 위치·수집 시각", ORANGE, "#fffdf8", ORANGE, max_lines=2)
    card(api, "Dashboard API", "의제 목록·이슈 상세\n기사 목록·보도 비교", ORANGE, "#fffdf8", ORANGE, max_lines=2)
    card(scheduler, "Batch / Scheduler", "정기 수집 실행\n오류 로그·갱신 시각", ORANGE, "#fffdf8", ORANGE, max_lines=2)

    preprocess = (1052, 420, 1302, 535)
    cluster = (1052, 570, 1302, 685)
    engine = (1052, 720, 1302, 855)
    card(preprocess, "Metadata 정제", "중복 제거·정규화\n기사 전문 미저장", "#d8a300", "#fffbeb", "#d8a300", max_lines=2)
    card(cluster, "이슈 클러스터링", "임베딩 기반 유사 기사 묶기\n대표 이슈 생성", BLUE_LINE, "#f8fbff", BLUE_LINE, max_lines=2)
    card(engine, "의제·프레임 엔진", "의제 점수 산식 적용\nGemini 프레임·AI 리포트", BLUE_LINE, "#f8fbff", BLUE_LINE, max_lines=2)

    meta_db = (1408, 420, 1698, 535)
    issue_db = (1408, 570, 1698, 685)
    report_db = (1408, 720, 1698, 855)
    card(meta_db, "Article Metadata DB", "media · article · collection_log\n제목·URL·섹션·배치", "#209868", "#f8fffb", "#209868", max_lines=2)
    card(issue_db, "Issue / Score DB", "issue · issue_article\nagenda_score · score_basis", "#209868", "#f8fffb", "#209868", max_lines=2)
    card(report_db, "Frame / Report Store", "frame_analysis · evidence\nai_report · validation_sample", "#209868", "#f8fffb", "#209868", max_lines=2)

    # Internal flow
    polyline_arrow([(570, 430), (620, 430), (620, 658), (705, 658)])
    draw.text((585, 396), "API 요청", fill=MID, font=F_TINY)
    polyline_arrow([(570, 830), (620, 830), (620, 815), (705, 815)], dashed=True, color="#667085")
    draw.text((576, 760), "정기 수집·배포 자동화", fill=MID, font=F_TINY)
    line_arrow((950, 477), (1052, 477))
    line_arrow((1302, 477), (1408, 477))
    line_arrow((1177, 535), (1177, 570), color="#777777")
    line_arrow((1302, 627), (1408, 627))
    line_arrow((1177, 685), (1177, 720), color="#777777")
    line_arrow((1302, 787), (1408, 787))
    polyline_arrow([(950, 658), (1000, 658), (1000, 627), (1052, 627)], color="#667085")
    # External Gemini
    llm = (1110, 135, 1480, 215)
    box(llm, "Vertex AI Gemini", "임베딩 보조 · 프레임 분석 · 리포트 생성", fill="white", outline="#b6b6b6", title_color="#111827")
    polyline_arrow([(1295, 215), (1295, 300), (1180, 300), (1180, 420)], dashed=True, color="#667085")

    # Right external sources
    sources = (1840, 360, 2230, 820)
    draw.rounded_rectangle(sources, radius=14, fill="white", outline="#7ba8e8", width=4)
    draw.text((1872, 388), "External Sources", fill=BLUE_DARK, font=F_SECTION)
    draw.text((1875, 430), "주요 언론사 홈페이지 3~5개", fill="#475467", font=F_SMALL)
    source_chips = [
        ("언론사 A", "홈페이지"),
        ("언론사 B", "홈페이지"),
        ("언론사 C", "홈페이지"),
        ("언론사 D", "선택"),
        ("언론사 E", "선택"),
        ("정책 분야", "정치·경제 등"),
    ]
    sx, sy = 1875, 470
    for idx, (title, body) in enumerate(source_chips):
        col = idx % 2
        row = idx // 2
        chip((sx + col * 170, sy + row * 82, sx + col * 170 + 145, sy + row * 82 + 60), title, body, outline="#d5e4fb")
    note = (1875, 740, 2192, 790)
    draw.rounded_rectangle(note, radius=9, fill="#f5f9ff", outline="#d5e4fb", width=2)
    centered("수집 대상: 제목·URL·섹션·배치·시각 / 기사 전문 미저장", note, F_TINY, "#344054")
    line_arrow((1840, 570), (1770, 570), color="#344054", width=3)
    draw.text((1778, 545), "수집 대상", fill=MID, font=F_TINY)

    # Optional extension callout
    extension = (1840, 870, 2230, 940)
    draw.rounded_rectangle(extension, radius=12, fill="#fff7ed", outline="#f1a363", width=3)
    centered("후순위 확장: PDF 저장·공유, 상세 검색, 즐겨찾기", extension, F_HEADER, "#9a4b00")
    polyline_arrow([(1698, 787), (1810, 787), (1810, 905), (1840, 905)], dashed=True, color="#b45309")

    # Operations support
    ops = (635, 965, 1770, 1075)
    draw.rounded_rectangle(ops, radius=14, fill="white", outline="#d4d8df", width=3)
    draw.text((675, 1000), "운영 / 검증 지원", fill=BLUE_DARK, font=F_HEADER)
    ops_items = [
        ("Scheduler", "주기 수집"),
        ("GitHub Actions", "CI/CD"),
        ("Collection Logs", "오류·상태"),
        ("Manual Validation", "클러스터·프레임 검증"),
        ("Artifacts", "모델·보고서 버전"),
    ]
    for idx, (title, body) in enumerate(ops_items):
        chip((902 + idx * 162, 993, 1052 + idx * 162, 1050), title, body)

    # Bottom flow
    flow = (500, 1140, 1835, 1210)
    draw.rounded_rectangle(flow, radius=14, fill="#eef7ff", outline="#bfdbfe", width=3)
    flow_text = "언론사·정책 분야 기준  →  Playwright 수집  →  메타데이터 저장  →  이슈 묶기·의제 점수  →  Gemini 프레임 분석  →  대시보드·AI 리포트"
    centered(flow_text, flow, F_HEADER, "#1d4ed8")

    img.save(OUT / "system_architecture.png", quality=95)


def render_system_architecture() -> None:
    aw, ah = 2200, 1250
    img = Image.new("RGB", (aw, ah), "white")
    draw = ImageDraw.Draw(img)

    navy = "#0b1f3a"
    blue = "#2563eb"
    orange = "#ea7c20"
    green = "#168356"
    amber = "#d8a300"
    line = "#2f3a4a"

    def centered(text: str, rect: tuple[int, int, int, int], fnt: ImageFont.ImageFont, fill: str = DARK) -> None:
        tw, th = text_size(draw, text, fnt)
        x1, y1, x2, y2 = rect
        draw.text((x1 + (x2 - x1 - tw) / 2, y1 + (y2 - y1 - th) / 2), text, fill=fill, font=fnt)

    def box(
        rect: tuple[int, int, int, int],
        title: str,
        body: str = "",
        fill: str = "white",
        outline: str = "#d0d5dd",
        title_color: str = DARK,
        body_color: str = "#475467",
        radius: int = 10,
        title_font: ImageFont.ImageFont = F_HEADER,
        body_font: ImageFont.ImageFont = F_TINY,
        body_lines: int = 2,
    ) -> None:
        draw.rounded_rectangle(rect, radius=radius, fill=fill, outline=outline, width=3)
        x1, y1, x2, _ = rect
        tw, _ = text_size(draw, title, title_font)
        draw.text((x1 + (x2 - x1 - tw) / 2, y1 + 14), title, fill=title_color, font=title_font)
        if body:
            draw_wrapped(draw, (x1 + 18, y1 + 48), body, body_font, body_color, x2 - x1 - 36, line_gap=5, max_lines=body_lines)

    def layer(
        rect: tuple[int, int, int, int],
        label: str,
        desc: str,
        fill: str,
        outline: str,
    ) -> None:
        draw.rounded_rectangle(rect, radius=12, fill=fill, outline=outline, width=3)
        draw.rectangle((rect[0], rect[1], rect[0] + 230, rect[3]), fill=outline)
        draw.text((rect[0] + 24, rect[1] + 26), label, fill="white", font=F_HEADER)
        draw_wrapped(draw, (rect[0] + 24, rect[1] + 60), desc, F_TINY, "white", 180, line_gap=5, max_lines=2)

    def chip(rect: tuple[int, int, int, int], title: str, body: str, accent: str) -> None:
        draw.rounded_rectangle(rect, radius=10, fill="white", outline=accent, width=3)
        draw.rounded_rectangle((rect[0] + 14, rect[1] + 17, rect[0] + 40, rect[1] + 43), radius=6, fill=accent)
        draw.text((rect[0] + 52, rect[1] + 16), title, fill=accent, font=F_HEADER)
        draw_wrapped(draw, (rect[0] + 18, rect[1] + 52), body, F_TINY, DARK, rect[2] - rect[0] - 36, line_gap=4, max_lines=2)

    def line_arrow(start: tuple[int, int], end: tuple[int, int], color: str = line, width: int = 3) -> None:
        arrow(draw, start, end, color, width)

    def dashed_arrow(start: tuple[int, int], end: tuple[int, int], color: str = "#667085", width: int = 3) -> None:
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        length = math.hypot(dx, dy)
        if length == 0:
            return
        ux, uy = dx / length, dy / length
        pos = 0
        while pos < length:
            seg = min(pos + 16, length)
            p1 = (int(start[0] + ux * pos), int(start[1] + uy * pos))
            p2 = (int(start[0] + ux * seg), int(start[1] + uy * seg))
            draw.line((p1, p2), fill=color, width=width)
            pos += 28
        arrow(draw, (end[0] - int(14 * ux), end[1] - int(14 * uy)), end, color, width)

    def table_cell(rect: tuple[int, int, int, int], text: str, fill: str, fnt: ImageFont.ImageFont, color: str = DARK) -> None:
        draw.rectangle(rect, fill=fill, outline="#d8e0ec", width=1)
        draw_wrapped(draw, (rect[0] + 12, rect[1] + 10), text, fnt, color, rect[2] - rect[0] - 24, line_gap=4, max_lines=2)

    # Header
    draw.rectangle((0, 0, aw, 135), fill=navy)
    draw.text((88, 50), "03", fill="white", font=F_HEADER)
    draw.text((150, 38), "기술 구조", fill="white", font=font("bold", 42))

    # Main architecture area
    draw.text((90, 175), "AgendaFrame 시스템 아키텍처", fill="#111827", font=font("bold", 48))
    draw.text((92, 235), "레이어는 시스템 책임 기준으로 나누고, 처리 순서는 하단 파이프라인으로 분리", fill="#667085", font=F_HEADER)

    arch = (70, 280, 1490, 1045)
    draw.rounded_rectangle(arch, radius=0, fill="white", outline="#d7e3f3", width=2)

    layer((95, 310, 1465, 420), "Presentation Layer", "사용자 화면과 결과 조회", "#f8fbff", blue)
    box((360, 330, 690, 400), "React / Firebase Hosting", "의제 랭킹·이슈 상세·프레임 비교·AI 리포트", fill="#ffffff", outline=blue, title_color=blue)
    box((790, 330, 1140, 400), "User Dashboard", "원문 링크 제공, 기사 전문 미저장 정책 노출", fill="#ffffff", outline=blue, title_color=blue)

    layer((95, 440, 1465, 550), "Application / API Layer", "조회 API와 요청 오케스트레이션", "#fff7ed", orange)
    box((360, 460, 675, 530), "Cloud Run API", "의제 목록·상세·비교·리포트 API", fill="#ffffff", outline=orange, title_color=orange)
    box((765, 460, 1080, 530), "Service Orchestrator", "수집 결과 조회, 분석 요청, 응답 조립", fill="#ffffff", outline=orange, title_color=orange)

    layer((95, 570, 1465, 680), "Collection Batch Layer", "정기 기사 메타데이터 수집", "#fff7ed", orange)
    box((360, 590, 675, 660), "Cloud Scheduler", "하루 N회 수집 작업 트리거", fill="#ffffff", outline=orange, title_color=orange)
    box((765, 590, 1080, 660), "Cloud Run Jobs + Playwright", "제목·URL·언론사·섹션·배치·수집시각 추출", fill="#ffffff", outline=orange, title_color=orange)

    layer((95, 700, 1465, 840), "Analysis / AI Layer", "이슈 묶기, 점수 산출, 프레임 분석", "#eef6ff", blue)
    chip((330, 725, 600, 815), "Embeddings", "유사 기사 벡터화", blue)
    chip((635, 725, 905, 815), "Cluster / Score", "이슈 클러스터링·의제 점수", blue)
    chip((940, 725, 1210, 815), "Vertex AI Gemini", "프레임 분석·AI 리포트", blue)

    layer((95, 860, 1465, 1015), "Data Layer", "분석 가능한 데이터 저장", "#effaf4", green)
    chip((330, 890, 615, 985), "BigQuery", "기사 메타데이터·이슈·점수·프레임 결과", green)
    chip((650, 890, 935, 985), "BigQuery Vector Search", "유사 이슈 검색·클러스터 후보", green)
    chip((970, 890, 1255, 985), "Cloud Storage", "리포트 파일·검증 산출물 저장", green)

    # Flow arrows inside layers
    line_arrow((525, 420), (525, 460))
    line_arrow((922, 530), (922, 590))
    line_arrow((922, 660), (922, 725))
    line_arrow((770, 815), (770, 890))
    dashed_arrow((1080, 625), (1245, 625))
    draw.text((1120, 596), "3~5개 언론사", fill="#667085", font=F_TINY)

    # Right panels
    principle = (1535, 280, 2130, 500)
    draw.rounded_rectangle(principle, radius=0, fill="#eaf2ff", outline="#d7e3f3", width=2)
    draw.text((1560, 305), "핵심 설계 원칙", fill="#111827", font=F_SECTION)
    principles = [
        "레이어: 화면 / API / 배치 수집 / 분석 AI / 데이터로 분리",
        "파이프라인: Collect → Store → Cluster → Score → Frame → Report",
        "기사 전문 저장·재게시 금지, 메타데이터와 분석 결과 중심 저장",
        "PDF·상세 검색·즐겨찾기는 후순위 확장 기능으로 분리",
    ]
    py = 355
    for item in principles:
        draw.text((1570, py), "•", fill="#111827", font=F_HEADER)
        draw_wrapped(draw, (1600, py - 2), item, F_TINY, DARK, 470, line_gap=5, max_lines=2)
        py += 38

    tech = (1535, 535, 2130, 965)
    draw.rounded_rectangle(tech, radius=0, fill="white", outline="#d7e3f3", width=2)
    draw.text((1560, 560), "기술 스택 매핑", fill="#111827", font=F_SECTION)
    tx, ty = 1560, 615
    table_cell((tx, ty, tx + 190, ty + 48), "구분", navy, F_SMALL, "white")
    table_cell((tx + 190, ty, tx + 545, ty + 48), "Google 기술 / 구현 요소", navy, F_SMALL, "white")
    rows = [
        ("프론트엔드", "React + Firebase Hosting"),
        ("API 서버", "Cloud Run API"),
        ("스케줄링", "Cloud Scheduler"),
        ("수집 실행", "Cloud Run Jobs + Playwright"),
        ("분석 DB", "BigQuery"),
        ("유사 이슈", "Vertex AI Embeddings + BigQuery Vector Search"),
        ("프레임/리포트", "Vertex AI Gemini"),
        ("파일 산출물", "Cloud Storage"),
    ]
    for i, (left, right) in enumerate(rows):
        y = ty + 48 + i * 42
        fill = "#ffffff" if i % 2 == 0 else "#f5f8fc"
        table_cell((tx, y, tx + 190, y + 42), left, fill, F_TINY)
        table_cell((tx + 190, y, tx + 545, y + 42), right, fill, F_TINY)

    sources = (1535, 990, 2130, 1045)
    draw.rounded_rectangle(sources, radius=10, fill="#f8fafc", outline="#d0d5dd", width=2)
    centered("External Sources: 주요 언론사 홈페이지 3~5개, 제목·URL·섹션·배치 위치만 수집", sources, F_SMALL, "#344054")

    # Bottom pipeline
    pipeline = (70, 1090, 2130, 1190)
    draw.rounded_rectangle(pipeline, radius=12, fill="#eef7ff", outline="#bfdbfe", width=3)
    steps = [
        ("01 Collect", "수집 기준"),
        ("02 Extract", "기사 메타데이터"),
        ("03 Store", "BigQuery 저장"),
        ("04 Cluster", "유사 이슈"),
        ("05 Score", "의제 점수"),
        ("06 Frame", "Gemini 프레임"),
        ("07 Report", "AI 리포트"),
        ("08 Dashboard", "화면 제공"),
    ]
    x = 105
    for idx, (title, body) in enumerate(steps):
        w = 210
        rect = (x, 1115, x + w, 1168)
        fill = navy if idx in (4, 5, 6) else "white"
        outline = navy if idx in (4, 5, 6) else "#cfe0f5"
        text_color = "white" if idx in (4, 5, 6) else "#111827"
        draw.rounded_rectangle(rect, radius=8, fill=fill, outline=outline, width=2)
        centered(title, (rect[0] + 8, rect[1] + 5, rect[2] - 8, rect[1] + 28), F_SMALL, text_color)
        centered(body, (rect[0] + 8, rect[1] + 28, rect[2] - 8, rect[3] - 4), F_TINY, text_color)
        if idx < len(steps) - 1:
            line_arrow((rect[2] + 8, 1141), (rect[2] + 38, 1141), color=blue, width=2)
        x += w + 35

    img.save(OUT / "system_architecture.png", quality=95)


def render_all(output_dir: Path | None = None) -> Path:
    global OUT

    previous_out = OUT
    OUT = (output_dir or DEFAULT_OUT).resolve()
    try:
        OUT.mkdir(parents=True, exist_ok=True)
        render_wbs_gantt()
        render_usecase_spec()
        render_usecase_diagram()
        render_activity_diagram()
        render_class_diagram()
        render_sequence_diagram()
        render_system_architecture()
        # The implementation-aligned package and UC-grouped sequence diagrams are
        # rendered last so the polished deliverables replace the compact drafts.
        from render_uml_diagrams import render_all as render_implementation_uml

        render_implementation_uml(OUT)
        return OUT
    finally:
        OUT = previous_out


def validate_outputs(output_dir: Path) -> None:
    missing = [name for name in EXPECTED_OUTPUTS if not (output_dir / name).is_file()]
    if missing:
        raise RuntimeError(f"missing generated outputs: {', '.join(missing)}")

    for name in EXPECTED_OUTPUTS:
        path = output_dir / name
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            if image.width < 1000 or image.height < 700:
                raise RuntimeError(f"generated output is too small for review: {name} ({image.size})")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render AgendaFrame submission diagrams.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUT,
        help="Directory for generated PNG files (default: repository outputs directory).",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Render into a temporary directory and validate without touching reviewed outputs.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    if args.check:
        check_root = ROOT / "tmp"
        check_root.mkdir(parents=True, exist_ok=True)
        temp_dir = check_root / f"render-check-{uuid.uuid4().hex}"
        temp_dir.mkdir()
        try:
            checked_dir = render_all(temp_dir)
            validate_outputs(checked_dir)
        finally:
            resolved_temp = temp_dir.resolve()
            if resolved_temp.parent == check_root.resolve() and resolved_temp.name.startswith("render-check-"):
                shutil.rmtree(resolved_temp, ignore_errors=True)
        print("AgendaFrame PNG render check passed")
    else:
        written_dir = render_all(args.output_dir)
        validate_outputs(written_dir)
        print(f"PNG outputs written to {written_dir}")
