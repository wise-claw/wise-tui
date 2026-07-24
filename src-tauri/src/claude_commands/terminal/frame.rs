//! Serialize alacritty_terminal viewport into a compact DTO for the web canvas renderer.

use alacritty_terminal::event::EventListener;
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::color::Colors;
use alacritty_terminal::term::{Term, TermMode};
use alacritty_terminal::vte::ansi::{Color, NamedColor, Rgb};
use serde::Serialize;

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

/// Wise 内置终端调色板（Catppuccin Mocha 取向）。
/// 与前端 `alacrittyTerminalCanvas.ts` / `TerminalPanel/index.css` 的 `--terminal-*` 保持同步。
pub(crate) fn theme_foreground() -> Rgb {
    Rgb {
        r: 0xcd,
        g: 0xd6,
        b: 0xf4,
    }
}

pub(crate) fn theme_background() -> Rgb {
    Rgb {
        r: 0x1e,
        g: 0x1e,
        b: 0x2e,
    }
}

pub(crate) fn theme_cursor() -> Rgb {
    Rgb {
        r: 0xf5,
        g: 0xe0,
        b: 0xdc,
    }
}

/// xterm 256-color / named color defaults when the terminal has not overridden the palette entry.
pub(crate) fn named_rgb(named: NamedColor) -> Rgb {
    match named {
        // 避免纯黑：作背景时更像「抬升面」，作前景时也不至于彻底消失。
        NamedColor::Black | NamedColor::DimBlack => Rgb {
            r: 0x45,
            g: 0x47,
            b: 0x5a,
        },
        NamedColor::Red | NamedColor::DimRed => Rgb {
            r: 0xf3,
            g: 0x8b,
            b: 0xa8,
        },
        NamedColor::Green | NamedColor::DimGreen => Rgb {
            r: 0xa6,
            g: 0xe3,
            b: 0xa1,
        },
        NamedColor::Yellow | NamedColor::DimYellow => Rgb {
            r: 0xf9,
            g: 0xe2,
            b: 0xaf,
        },
        NamedColor::Blue | NamedColor::DimBlue => Rgb {
            r: 0x89,
            g: 0xb4,
            b: 0xfa,
        },
        NamedColor::Magenta | NamedColor::DimMagenta => Rgb {
            r: 0xcb,
            g: 0xa6,
            b: 0xf7,
        },
        NamedColor::Cyan | NamedColor::DimCyan => Rgb {
            r: 0x94,
            g: 0xe2,
            b: 0xd5,
        },
        NamedColor::White | NamedColor::DimWhite => Rgb {
            r: 0xba,
            g: 0xc2,
            b: 0xde,
        },
        NamedColor::BrightBlack => Rgb {
            r: 0x58,
            g: 0x5b,
            b: 0x70,
        },
        NamedColor::BrightRed => Rgb {
            r: 0xf3,
            g: 0x8b,
            b: 0xa8,
        },
        NamedColor::BrightGreen => Rgb {
            r: 0xa6,
            g: 0xe3,
            b: 0xa1,
        },
        NamedColor::BrightYellow => Rgb {
            r: 0xf9,
            g: 0xe2,
            b: 0xaf,
        },
        NamedColor::BrightBlue => Rgb {
            r: 0x89,
            g: 0xb4,
            b: 0xfa,
        },
        NamedColor::BrightMagenta => Rgb {
            r: 0xf5,
            g: 0xc2,
            b: 0xe7,
        },
        NamedColor::BrightCyan => Rgb {
            r: 0x94,
            g: 0xe2,
            b: 0xd5,
        },
        NamedColor::BrightWhite => Rgb {
            r: 0xa6,
            g: 0xad,
            b: 0xc8,
        },
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
        0..=15 => named_rgb(match index {
            0 => NamedColor::Black,
            1 => NamedColor::Red,
            2 => NamedColor::Green,
            3 => NamedColor::Yellow,
            4 => NamedColor::Blue,
            5 => NamedColor::Magenta,
            6 => NamedColor::Cyan,
            7 => NamedColor::White,
            8 => NamedColor::BrightBlack,
            9 => NamedColor::BrightRed,
            10 => NamedColor::BrightGreen,
            11 => NamedColor::BrightYellow,
            12 => NamedColor::BrightBlue,
            13 => NamedColor::BrightMagenta,
            14 => NamedColor::BrightCyan,
            _ => NamedColor::BrightWhite,
        }),
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
        row_cells[screen_row as usize][col] = (ch, cell_style(&indexed.cell, colors));
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

    #[test]
    fn theme_palette_matches_frontend_hex() {
        let fg = theme_foreground();
        let bg = theme_background();
        let cursor = theme_cursor();
        assert_eq!(rgb_hex(fg), "#cdd6f4");
        assert_eq!(rgb_hex(bg), "#1e1e2e");
        assert_eq!(rgb_hex(cursor), "#f5e0dc");
        assert_eq!(rgb_hex(named_rgb(NamedColor::Green)), "#a6e3a1");
        assert_eq!(rgb_hex(named_rgb(NamedColor::Blue)), "#89b4fa");
        assert_eq!(rgb_hex(default_indexed_rgb(257)), "#1e1e2e");
        assert_eq!(rgb_hex(default_indexed_rgb(2)), "#a6e3a1");
    }
}
