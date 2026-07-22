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

/// xterm 256-color defaults when the terminal has not overridden the palette entry.
fn named_rgb(named: NamedColor) -> Rgb {
    match named {
        NamedColor::Black | NamedColor::DimBlack => Rgb { r: 0, g: 0, b: 0 },
        NamedColor::Red | NamedColor::DimRed => Rgb { r: 205, g: 49, b: 49 },
        NamedColor::Green | NamedColor::DimGreen => Rgb { r: 13, g: 188, b: 121 },
        NamedColor::Yellow | NamedColor::DimYellow => Rgb { r: 229, g: 229, b: 16 },
        NamedColor::Blue | NamedColor::DimBlue => Rgb { r: 36, g: 114, b: 200 },
        NamedColor::Magenta | NamedColor::DimMagenta => Rgb { r: 188, g: 63, b: 188 },
        NamedColor::Cyan | NamedColor::DimCyan => Rgb { r: 17, g: 168, b: 205 },
        NamedColor::White | NamedColor::DimWhite => Rgb { r: 229, g: 229, b: 229 },
        NamedColor::BrightBlack => Rgb { r: 102, g: 102, b: 102 },
        NamedColor::BrightRed => Rgb { r: 241, g: 76, b: 76 },
        NamedColor::BrightGreen => Rgb { r: 35, g: 209, b: 139 },
        NamedColor::BrightYellow => Rgb { r: 245, g: 245, b: 67 },
        NamedColor::BrightBlue => Rgb { r: 59, g: 142, b: 234 },
        NamedColor::BrightMagenta => Rgb { r: 214, g: 112, b: 214 },
        NamedColor::BrightCyan => Rgb { r: 41, g: 184, b: 219 },
        NamedColor::BrightWhite => Rgb { r: 255, g: 255, b: 255 },
        NamedColor::Foreground | NamedColor::BrightForeground | NamedColor::DimForeground => {
            Rgb {
                r: 0xd4,
                g: 0xd4,
                b: 0xd4,
            }
        }
        NamedColor::Background => Rgb {
            r: 0x1e,
            g: 0x1e,
            b: 0x1e,
        },
        NamedColor::Cursor => Rgb {
            r: 0xae,
            g: 0xaf,
            b: 0xad,
        },
    }
}

fn indexed_rgb(index: u8) -> Rgb {
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
    let cursor_row = (cursor_point.line.0 + display_offset).clamp(0, rows as i32 - 1) as u16;
    let cursor_col = (cursor_point.column.0 as u16).min(cols.saturating_sub(1));
    let cursor_visible = content.mode.contains(TermMode::SHOW_CURSOR);

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
}
