#!/usr/bin/env python3
"""生成 macOS DMG 窗口背景图（与 tauri.conf.json bundle.macOS.dmg.background 对应）。

在 macOS 上运行可使用系统中文字体生成中文文案；无中文字体时自动回退为英文，避免豆腐块。
用法: python3 scripts/generate-dmg-background.py
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src-tauri" / "dmg" / "dmg-background.png"

W, H = 660, 420


def _glyph_width_for_text(font: ImageFont.FreeTypeFont, text: str) -> int:
    im = Image.new("L", (512, 96), 0)
    d = ImageDraw.Draw(im)
    d.text((8, 8), text, font=font, fill=255)
    bb = im.getbbox()
    if not bb:
        return 0
    return bb[2] - bb[0]


def font_supports_cjk(font: ImageFont.FreeTypeFont, sample: str = "将") -> bool:
    return _glyph_width_for_text(font, sample) > 18


def load_truetype(path: str, size: int, indices: Iterable[int] | None = None) -> ImageFont.FreeTypeFont | None:
    p = Path(path)
    if not p.is_file():
        return None
    if indices is None:
        try:
            return ImageFont.truetype(str(p), size)
        except OSError:
            return None
    for i in indices:
        try:
            return ImageFont.truetype(str(p), size, index=i)
        except OSError:
            continue
    return None


def load_cjk_font(size: int) -> ImageFont.FreeTypeFont:
    """优先使用系统中文黑体；PingFang 等 .ttc 必须选对子字体 index，否则会显示豆腐块。"""
    candidates: list[tuple[str, Iterable[int] | None]] = [
        ("/System/Library/Fonts/Hiragino Sans GB.ttc", (0, 1, 2, 3)),
        ("/System/Library/Fonts/PingFang.ttc", range(24)),
        ("/System/Library/Fonts/STHeiti Medium.ttc", (0, 1)),
        ("/System/Library/Fonts/STHeiti Light.ttc", (0, 1)),
        ("/Library/Fonts/Arial Unicode.ttf", None),
    ]
    for path, indices in candidates:
        p = Path(path)
        if not p.is_file():
            continue
        idxs: Iterable[int]
        if indices is None:
            idxs = (0,)
        else:
            idxs = indices
        for i in idxs:
            try:
                font = ImageFont.truetype(str(p), size, index=i)
            except OSError:
                continue
            if path.endswith("Arial Unicode.ttf") or font_supports_cjk(font):
                return font
    return ImageFont.load_default()


def load_title_font(size: int) -> ImageFont.FreeTypeFont:
    for path in (
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
    ):
        font = load_truetype(path, size, (0, 1, 2, 3) if path.endswith(".ttc") else None)
        if font is not None:
            return font
    return ImageFont.load_default()


def draw_arrow(draw: ImageDraw.ImageDraw, y: int) -> None:
    """在应用图标与「应用程序」之间绘制柔和箭头（与 tauri.conf 中 x≈150 / 468 对齐）。"""
    x1, x2 = 248, 412
    color = (118, 128, 146)
    shadow = (200, 206, 218)
    w = 3
    ah = 11

    for dx, dy, col in ((1, 1, shadow), (0, 0, color)):
        draw.line([(x1 + dx, y + dy), (x2 - ah + dx, y + dy)], fill=col, width=w)
        draw.polygon(
            [
                (x2 + dx, y + dy),
                (x2 - ah + dx, y - ah // 2 + dy),
                (x2 - ah + dx, y + ah // 2 + dy),
            ],
            fill=col,
        )


def main() -> None:
    img = Image.new("RGB", (W, H), "#fafcff")
    draw = ImageDraw.Draw(img)

    for y in range(H):
        t = y / max(H - 1, 1)
        r = int(254 - 28 * t)
        g = int(255 - 24 * t)
        b = int(255 - 20 * t)
        draw.line([(0, y), (W, y)], fill=(r, g, b))

    # 中部浅色衬板，衬托图标与箭头
    draw.rounded_rectangle(
        (48, 178, W - 48, 302),
        radius=20,
        fill=(248, 249, 252),
        outline=(232, 235, 242),
        width=1,
    )

    # 顶部分区细线
    draw.line([(40, 118), (W - 40, 118)], fill=(220, 223, 230), width=1)

    title_font = load_title_font(34)
    cjk_font = load_cjk_font(15)
    cjk_sm = load_cjk_font(13)

    title = "Wise"
    line1 = "将 Wise 拖入「应用程序」"
    line2 = "安装完成后可在启动台或「应用程序」中打开"

    tw = _glyph_width_for_text(title_font, title)
    draw.text(((W - tw) / 2, 34), title, fill=(28, 28, 30), font=title_font)

    if font_supports_cjk(cjk_font, "将"):
        l1w = _glyph_width_for_text(cjk_font, line1)
        l2w = _glyph_width_for_text(cjk_sm, line2)
        draw.text(((W - l1w) / 2, 86), line1, fill=(72, 72, 78), font=cjk_font)
        draw.text(((W - l2w) / 2, 108), line2, fill=(120, 120, 128), font=cjk_sm)
    else:
        en1 = "Drag Wise to Applications"
        en2 = "Then open it from Launchpad or the Applications folder"
        f = load_truetype("/System/Library/Fonts/SFNS.ttf", 14) or cjk_font
        f2 = load_truetype("/System/Library/Fonts/SFNS.ttf", 12) or cjk_sm
        draw.text(((W - _glyph_width_for_text(f, en1)) / 2, 86), en1, fill=(72, 72, 78), font=f)
        draw.text(((W - _glyph_width_for_text(f2, en2)) / 2, 108), en2, fill=(120, 120, 128), font=f2)

    # 与 128×128 图标垂直中心大致对齐（create-dmg 默认 icon size 128，位置 y=168）
    draw_arrow(draw, 224)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "PNG", optimize=True)
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
