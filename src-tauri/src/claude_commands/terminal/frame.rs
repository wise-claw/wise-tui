//! Serialize alacritty_terminal viewport into a compact DTO for the web canvas renderer.

use alacritty_terminal::event::EventListener;
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::color::Colors;
use alacritty_terminal::term::{Term, TermMode};
use alacritty_terminal::vte::ansi::{Color, NamedColor, Rgb};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};

/// One styled run within a screen row (adjacent cells with identical attrs coalesced).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalCellRun {
    pub text: String,
    /// `#rrggbb`
    pub fg: String,
    /// `#rrggbb`
    pub bg: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub bold: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub italic: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub underline: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub dim: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub strike: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalCursorDto {
    pub col: u16,
    pub row: u16,
    pub visible: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalFrameDto {
    pub cols: u16,
    pub rows: u16,
    pub cursor: TerminalCursorDto,
    pub lines: Vec<Vec<TerminalCellRun>>,
}

#[derive(Clone, Copy)]
struct StyleKey {
    fg: Rgb,
    bg: Rgb,
    bold: bool,
    italic: bool,
    underline: bool,
    dim: bool,
    strike: bool,
}

impl PartialEq for StyleKey {
    fn eq(&self, other: &Self) -> bool {
        self.fg == other.fg
            && self.bg == other.bg
            && self.bold == other.bold
            && self.italic == other.italic
            && self.underline == other.underline
            && self.dim == other.dim
            && self.strike == other.strike
    }
}

fn rgb_hex(rgb: Rgb) -> String {
    format!("#{:02x}{:02x}{:02x}", rgb.r, rgb.g, rgb.b)
}

const fn rgb(r: u8, g: u8, b: u8) -> Rgb {
    Rgb { r, g, b }
}

/// Wise 内置终端调色板。
/// 与前端 `alacrittyTerminalCanvas.ts` / `TerminalPanel/index.css` 的 `--terminal-*` 保持同步。
struct TerminalPalette {
    foreground: Rgb,
    background: Rgb,
    cursor: Rgb,
    /// 0..=7 普通色，8..=15 亮色，顺序为 black/red/green/yellow/blue/magenta/cyan/white。
    ansi: [Rgb; 16],
}

/// 深色外观：Catppuccin Mocha。
/// black 用 surface1 而非纯黑，作背景时更像「抬升面」，作前景时也不至于彻底消失。
const DARK_PALETTE: TerminalPalette = TerminalPalette {
    foreground: rgb(0xcd, 0xd6, 0xf4),
    background: rgb(0x1e, 0x1e, 0x2e),
    cursor: rgb(0xf5, 0xe0, 0xdc),
    ansi: [
        rgb(0x45, 0x47, 0x5a),
        rgb(0xf3, 0x8b, 0xa8),
        rgb(0xa6, 0xe3, 0xa1),
        rgb(0xf9, 0xe2, 0xaf),
        rgb(0x89, 0xb4, 0xfa),
        rgb(0xcb, 0xa6, 0xf7),
        rgb(0x94, 0xe2, 0xd5),
        rgb(0xba, 0xc2, 0xde),
        rgb(0x58, 0x5b, 0x70),
        rgb(0xf3, 0x8b, 0xa8),
        rgb(0xa6, 0xe3, 0xa1),
        rgb(0xf9, 0xe2, 0xaf),
        rgb(0x89, 0xb4, 0xfa),
        rgb(0xf5, 0xc2, 0xe7),
        rgb(0x94, 0xe2, 0xd5),
        rgb(0xa6, 0xad, 0xc8),
    ],
};

/// 浅色外观：Catppuccin Latte。同色系保证切换主题时 ANSI 观感连续。
const LIGHT_PALETTE: TerminalPalette = TerminalPalette {
    foreground: rgb(0x4c, 0x4f, 0x69),
    background: rgb(0xef, 0xf1, 0xf5),
    cursor: rgb(0xdc, 0x8a, 0x78),
    ansi: [
        rgb(0x5c, 0x5f, 0x77),
        rgb(0xd2, 0x0f, 0x39),
        rgb(0x40, 0xa0, 0x2b),
        rgb(0xdf, 0x8e, 0x1d),
        rgb(0x1e, 0x66, 0xf5),
        rgb(0x88, 0x39, 0xef),
        rgb(0x17, 0x92, 0x99),
        rgb(0xac, 0xb0, 0xbe),
        rgb(0x6c, 0x6f, 0x85),
        rgb(0xd2, 0x0f, 0x39),
        rgb(0x40, 0xa0, 0x2b),
        rgb(0xdf, 0x8e, 0x1d),
        rgb(0x1e, 0x66, 0xf5),
        rgb(0xea, 0x76, 0xcb),
        rgb(0x17, 0x92, 0x99),
        rgb(0xbc, 0xc0, 0xcc),
    ],
};

/// 当前外观。前端跟随系统浅/深切换时通过 `terminal_set_theme` 推下来。
/// 会话在后端长驻，调色板必须是进程级状态，而不是随每帧传参。
static PALETTE_IS_DARK: AtomicBool = AtomicBool::new(true);

/// 返回是否真的发生了变化，调用方据此决定要不要重发帧。
pub(crate) fn set_palette_is_dark(dark: bool) -> bool {
    PALETTE_IS_DARK.swap(dark, Ordering::Relaxed) != dark
}

fn palette() -> &'static TerminalPalette {
    if PALETTE_IS_DARK.load(Ordering::Relaxed) {
        &DARK_PALETTE
    } else {
        &LIGHT_PALETTE
    }
}

pub(crate) fn theme_foreground() -> Rgb {
    palette().foreground
}

pub(crate) fn theme_background() -> Rgb {
    palette().background
}

pub(crate) fn theme_cursor() -> Rgb {
    palette().cursor
}

/// xterm 256-color / named color defaults when the terminal has not overridden the palette entry.
pub(crate) fn named_rgb(named: NamedColor) -> Rgb {
    let ansi = &palette().ansi;
    match named {
        NamedColor::Black | NamedColor::DimBlack => ansi[0],
        NamedColor::Red | NamedColor::DimRed => ansi[1],
        NamedColor::Green | NamedColor::DimGreen => ansi[2],
        NamedColor::Yellow | NamedColor::DimYellow => ansi[3],
        NamedColor::Blue | NamedColor::DimBlue => ansi[4],
        NamedColor::Magenta | NamedColor::DimMagenta => ansi[5],
        NamedColor::Cyan | NamedColor::DimCyan => ansi[6],
        NamedColor::White | NamedColor::DimWhite => ansi[7],
        NamedColor::BrightBlack => ansi[8],
        NamedColor::BrightRed => ansi[9],
        NamedColor::BrightGreen => ansi[10],
        NamedColor::BrightYellow => ansi[11],
        NamedColor::BrightBlue => ansi[12],
        NamedColor::BrightMagenta => ansi[13],
        NamedColor::BrightCyan => ansi[14],
        NamedColor::BrightWhite => ansi[15],
        NamedColor::Foreground | NamedColor::BrightForeground | NamedColor::DimForeground => {
            theme_foreground()
        }
        NamedColor::Background => theme_background(),
        NamedColor::Cursor => theme_cursor(),
    }
}

/// OSC / ColorRequest 用的索引色（含 256/257/258 前景/背景/光标）。
pub(crate) fn default_indexed_rgb(index: usize) -> Rgb {
    match index {
        0..=15 => palette().ansi[index],
        256 | 267 => theme_foreground(),
        257 | 268 => theme_background(),
        258 => theme_cursor(),
        _ => theme_foreground(),
    }
}

fn indexed_rgb(index: u8) -> Rgb {
    match index {
        0..=15 => default_indexed_rgb(index as usize),
        16..=231 => {
            let i = index - 16;
            let r = i / 36;
            let g = (i % 36) / 6;
            let b = i % 6;
            let ramp = |v: u8| if v == 0 { 0 } else { 55 + 40 * v };
            Rgb {
                r: ramp(r),
                g: ramp(g),
                b: ramp(b),
            }
        }
        _ => {
            let gray = 8 + 10 * (index.saturating_sub(232));
            Rgb {
                r: gray,
                g: gray,
                b: gray,
            }
        }
    }
}

fn resolve_color(color: Color, colors: &Colors) -> Rgb {
    match color {
        Color::Spec(rgb) => rgb,
        Color::Named(named) => colors[named].unwrap_or_else(|| named_rgb(named)),
        Color::Indexed(index) => colors[index as usize].unwrap_or_else(|| indexed_rgb(index)),
    }
}

fn cell_style(cell: &alacritty_terminal::term::cell::Cell, colors: &Colors) -> StyleKey {
    let mut fg = resolve_color(cell.fg, colors);
    let mut bg = resolve_color(cell.bg, colors);
    let inverse = cell.flags.contains(Flags::INVERSE);
    if inverse {
        std::mem::swap(&mut fg, &mut bg);
    }
    StyleKey {
        fg,
        bg,
        bold: cell.flags.intersects(Flags::BOLD | Flags::BOLD_ITALIC | Flags::DIM_BOLD),
        italic: cell.flags.intersects(Flags::ITALIC | Flags::BOLD_ITALIC),
        underline: cell.flags.intersects(Flags::ALL_UNDERLINES),
        dim: cell.flags.intersects(Flags::DIM | Flags::DIM_BOLD),
        strike: cell.flags.contains(Flags::STRIKEOUT),
    }
}

pub(crate) fn serialize_frame<T: EventListener>(term: &Term<T>) -> TerminalFrameDto {
    let content = term.renderable_content();
    let cols = term.columns() as u16;
    let rows = term.screen_lines() as u16;
    let colors = content.colors;

    let mut lines: Vec<Vec<TerminalCellRun>> = (0..rows as usize)
        .map(|_| Vec::new())
        .collect();

    // Buffer cells per screen row so we can coalesce runs after iterating.
    let mut row_cells: Vec<Vec<(char, StyleKey)>> = (0..rows as usize)
        .map(|_| vec![(
            ' ',
            StyleKey {
                fg: named_rgb(NamedColor::Foreground),
                bg: named_rgb(NamedColor::Background),
                bold: false,
                italic: false,
                underline: false,
                dim: false,
                strike: false,
            },
        ); cols as usize])
        .collect();

    let display_offset = content.display_offset as i32;
    for indexed in content.display_iter {
        let screen_row = (indexed.point.line.0 + display_offset) as isize;
        if screen_row < 0 || screen_row >= rows as isize {
            continue;
        }
        let col = indexed.point.column.0;
        if col >= cols as usize {
            continue;
        }
        if indexed.cell.flags.contains(Flags::WIDE_CHAR_SPACER)
            || indexed.cell.flags.contains(Flags::LEADING_WIDE_CHAR_SPACER)
            || indexed.cell.flags.contains(Flags::HIDDEN)
        {
            continue;
        }
        let ch = if indexed.cell.c == '\0' {
            ' '
        } else {
            indexed.cell.c
        };
        let style = cell_style(&indexed.cell, colors);
        let row = &mut row_cells[screen_row as usize];
        row[col] = (ch, style);
        // 宽字符（CJK/emoji）横跨两列。右半格若留默认样式，会在前端被切成独立 run
        // 并重绘背景，把字形右半边擦掉；继承左半格样式即可合并进同一个 run。
        if indexed.cell.flags.contains(Flags::WIDE_CHAR) {
            if let Some(spacer) = row.get_mut(col + 1) {
                *spacer = (' ', style);
            }
        }
    }

    for (row_idx, cells) in row_cells.into_iter().enumerate() {
        let mut runs: Vec<TerminalCellRun> = Vec::new();
        let mut current: Option<(StyleKey, String)> = None;
        for (ch, style) in cells {
            match current.as_mut() {
                Some((cur_style, text)) if *cur_style == style => {
                    text.push(ch);
                }
                Some(_) => {
                    if let Some((prev_style, prev_text)) = current.take() {
                        runs.push(TerminalCellRun {
                            text: prev_text,
                            fg: rgb_hex(prev_style.fg),
                            bg: rgb_hex(prev_style.bg),
                            bold: prev_style.bold,
                            italic: prev_style.italic,
                            underline: prev_style.underline,
                            dim: prev_style.dim,
                            strike: prev_style.strike,
                        });
                    }
                    current = Some((style, ch.to_string()));
                }
                None => {
                    current = Some((style, ch.to_string()));
                }
            }
        }
        if let Some((prev_style, prev_text)) = current {
            runs.push(TerminalCellRun {
                text: prev_text,
                fg: rgb_hex(prev_style.fg),
                bg: rgb_hex(prev_style.bg),
                bold: prev_style.bold,
                italic: prev_style.italic,
                underline: prev_style.underline,
                dim: prev_style.dim,
                strike: prev_style.strike,
            });
        }
        lines[row_idx] = runs;
    }

    let cursor_point = content.cursor.point;
    // 滚动进历史时，光标常在视口外；勿 clamp，否则会钉在视口底/顶误显。
    let cursor_screen_row = cursor_point.line.0 + display_offset;
    let cursor_in_viewport =
        cursor_screen_row >= 0 && cursor_screen_row < rows as i32;
    let cursor_col = (cursor_point.column.0 as u16).min(cols.saturating_sub(1));
    let cursor_row = if cursor_in_viewport {
        cursor_screen_row as u16
    } else {
        0
    };
    let cursor_visible =
        content.mode.contains(TermMode::SHOW_CURSOR) && cursor_in_viewport;

    TerminalFrameDto {
        cols,
        rows,
        cursor: TerminalCursorDto {
            col: cursor_col,
            row: cursor_row,
            visible: cursor_visible,
        },
        lines,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alacritty_terminal::event::VoidListener;
    use alacritty_terminal::term::test::TermSize;
    use alacritty_terminal::term::{Config, Term};
    use alacritty_terminal::vte::ansi;

    #[test]
    fn serialize_frame_empty_grid_has_expected_dims() {
        let size = TermSize::new(40, 12);
        let term = Term::new(Config::default(), &size, VoidListener);
        let frame = serialize_frame(&term);
        assert_eq!(frame.cols, 40);
        assert_eq!(frame.rows, 12);
        assert_eq!(frame.lines.len(), 12);
        assert!(frame.cursor.visible);
    }

    #[test]
    fn serialize_frame_captures_plain_text() {
        let size = TermSize::new(20, 4);
        let mut term = Term::new(Config::default(), &size, VoidListener);
        let mut parser: ansi::Processor = ansi::Processor::new();
        parser.advance(&mut term, b"hi");
        let frame = serialize_frame(&term);
        let first = frame.lines[0]
            .iter()
            .map(|run| run.text.as_str())
            .collect::<String>();
        assert!(first.starts_with("hi"), "got {first:?}");
    }

    /// 宽字符右半格若退回默认样式，会在前端切出一个独立 run，
    /// 其背景重绘会把 CJK 字形右半边擦掉（Claude TUI 输入框内尤其明显）。
    #[test]
    fn serialize_frame_wide_char_spacer_shares_left_half_style() {
        let size = TermSize::new(20, 2);
        let mut term = Term::new(Config::default(), &size, VoidListener);
        let mut parser: ansi::Processor = ansi::Processor::new();
        parser.advance(&mut term, "\x1b[44m中\x1b[0m".as_bytes());

        let frame = serialize_frame(&term);
        let first = &frame.lines[0][0];
        assert_eq!(first.text, "中 ", "宽字符应连同右半占位格进同一个 run");
        // 调色板是进程级状态，这里只断言「与后续默认样式 run 分色」，不硬编码色值。
        assert_ne!(
            first.bg, frame.lines[0][1].bg,
            "带背景的宽字符不应与其后的默认样式格同色"
        );

        let flattened = frame.lines[0]
            .iter()
            .map(|run| run.text.chars().count())
            .sum::<usize>();
        assert_eq!(flattened, 20, "每行字符数必须等于列数以保持列对齐");
    }

    #[test]
    fn serialize_frame_hides_cursor_when_scrolled_into_history() {
        use alacritty_terminal::grid::Scroll;
        use alacritty_terminal::term::Config as TermConfig;

        let size = TermSize::new(40, 8);
        let config = TermConfig {
            scrolling_history: 10_000,
            ..TermConfig::default()
        };
        let mut term = Term::new(config, &size, VoidListener);
        let mut parser: ansi::Processor = ansi::Processor::new();
        let mut payload = String::new();
        for i in 0..40 {
            payload.push_str(&format!("line-{i}\r\n"));
        }
        parser.advance(&mut term, payload.as_bytes());

        let live = serialize_frame(&term);
        assert!(live.cursor.visible, "live viewport should show cursor");

        term.scroll_display(Scroll::Delta(5));
        let scrolled = serialize_frame(&term);
        assert!(
            !scrolled.cursor.visible,
            "scrolled history should hide out-of-viewport cursor"
        );
    }

    /// 调色板是进程级全局状态，两套断言必须在同一个 test 内串行跑，
    /// 否则并行的其他 test 会读到被切换过的值。
    #[test]
    fn theme_palette_follows_appearance_and_matches_frontend_hex() {
        set_palette_is_dark(true);
        assert_eq!(rgb_hex(theme_foreground()), "#cdd6f4");
        assert_eq!(rgb_hex(theme_background()), "#1e1e2e");
        assert_eq!(rgb_hex(theme_cursor()), "#f5e0dc");
        assert_eq!(rgb_hex(named_rgb(NamedColor::Green)), "#a6e3a1");
        assert_eq!(rgb_hex(named_rgb(NamedColor::Blue)), "#89b4fa");
        assert_eq!(rgb_hex(default_indexed_rgb(257)), "#1e1e2e");
        assert_eq!(rgb_hex(default_indexed_rgb(2)), "#a6e3a1");

        assert!(set_palette_is_dark(false), "切到浅色应报告已变化");
        assert!(!set_palette_is_dark(false), "重复设置同一外观不应报告变化");
        assert_eq!(rgb_hex(theme_foreground()), "#4c4f69");
        assert_eq!(rgb_hex(theme_background()), "#eff1f5");
        assert_eq!(rgb_hex(theme_cursor()), "#dc8a78");
        assert_eq!(rgb_hex(named_rgb(NamedColor::Green)), "#40a02b");
        assert_eq!(rgb_hex(named_rgb(NamedColor::Blue)), "#1e66f5");
        assert_eq!(rgb_hex(default_indexed_rgb(257)), "#eff1f5");
        assert_eq!(rgb_hex(default_indexed_rgb(2)), "#40a02b");

        set_palette_is_dark(true);
    }
}
