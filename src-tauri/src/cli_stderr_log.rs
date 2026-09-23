//! 单次 CLI 调用的 stderr 诊断缓冲：保留开头与最近的若干行。
//!
//! 失败诊断既要读开头（如续接会话失效在启动阶段报出），也要读结尾（最后一条可操作错误）；
//! 中间的大量重复输出只丢弃，不再随任务时长无限增长。

use std::collections::VecDeque;

const HEAD_LINES: usize = 64;
const TAIL_LINES: usize = 256;
const MAX_LINE_BYTES: usize = 4096;

#[derive(Debug, Default)]
pub(crate) struct BoundedStderrLog {
    head: Vec<String>,
    tail: VecDeque<String>,
    dropped: usize,
}

impl BoundedStderrLog {
    pub(crate) fn push(&mut self, line: &str) {
        let line = truncate_line(line);
        if self.head.len() < HEAD_LINES {
            self.head.push(line);
            return;
        }
        if self.tail.len() == TAIL_LINES {
            self.tail.pop_front();
            self.dropped += 1;
        }
        self.tail.push_back(line);
    }

    /// 按原始顺序返回保留的行；有丢弃时在中间插入一行说明。
    pub(crate) fn lines(&self) -> Vec<String> {
        let mut out = Vec::with_capacity(self.head.len() + self.tail.len() + 1);
        out.extend(self.head.iter().cloned());
        if self.dropped > 0 {
            out.push(format!("…（省略 {} 行 stderr）…", self.dropped));
        }
        out.extend(self.tail.iter().cloned());
        out
    }
}

fn truncate_line(line: &str) -> String {
    if line.len() <= MAX_LINE_BYTES {
        return line.to_string();
    }
    let mut end = MAX_LINE_BYTES;
    while !line.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &line[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_head_and_tail_with_gap_marker() {
        let mut log = BoundedStderrLog::default();
        let total = HEAD_LINES + TAIL_LINES + 10_000;
        for i in 0..total {
            log.push(&format!("line {i}"));
        }
        let lines = log.lines();
        assert_eq!(lines.len(), HEAD_LINES + TAIL_LINES + 1);
        assert_eq!(lines[0], "line 0");
        assert_eq!(lines[HEAD_LINES - 1], format!("line {}", HEAD_LINES - 1));
        assert!(lines[HEAD_LINES].contains("10000"));
        assert_eq!(lines.last().unwrap(), &format!("line {}", total - 1));
    }

    #[test]
    fn short_logs_are_unchanged_and_long_lines_truncate_on_char_boundary() {
        let mut log = BoundedStderrLog::default();
        log.push("a");
        log.push(&"错".repeat(MAX_LINE_BYTES));
        let lines = log.lines();
        assert_eq!(lines[0], "a");
        assert!(lines[1].len() <= MAX_LINE_BYTES + "…".len());
        assert!(lines[1].ends_with('…'));
    }
}
