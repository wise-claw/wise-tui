---
name: wise-browse
description: "Use this skill any time the user wants to operate a web browser from the session: open a site, click, fill forms, extract content, take snapshots/screenshots, or automate browsing. Run the `wise browse` CLI; do not invent browser APIs or ask the user to click the top-right icon for day-to-day operations."
---

# Wise Browse Skill

Use `wise browse` (alias `wise-browse`) for all in-session browser automation. The Wise top-right browser icon is **configuration only** (local/cloud/CDP, headed window, model/keys, CLI install). Do not tell the user to operate the page from that icon.

## Workflow

1. Confirm the goal (open a site, click something, extract data, screenshot).
2. Run one CLI command, read JSON stdout, then continue.
3. Prefer natural-language `act` / `extract` / `observe` unless a selector is already known.
4. After navigation or a significant action, `wise browse status` or `wise browse snapshot` to verify.

## Command map

```bash
wise browse open https://www.google.com
wise browse act "click the first search result"
wise browse extract "extract the page title"
wise browse observe "find the login button"
wise browse snapshot
wise browse screenshot --full
wise browse click "css=button.submit"
wise browse fill "css=input[name=q]" "wise tui" --enter
wise browse status
wise browse stop
wise browse help
```

The first command that needs a page auto-starts the shared browser using `~/.wise/stagehand-automation/config.json`. Later commands reuse the same window.

Site aliases work without a full URL: `wise browse open 谷歌`, `open 百度`, `open github`. You can also forward the user's sentence: `wise browse 打开谷歌官网` or `wise browse do "点击登录"`.

## Natural language

- 「打开谷歌官网」→ `wise browse open https://www.google.com`
- 「打开百度」→ `wise browse open https://www.baidu.com`
- 「点一下登录」→ `wise browse act "click the login button"`
- 「把搜索框填成 hello」→ `wise browse act "fill the search box with hello"` or `fill` if a selector is known
- 「这一页标题是什么」→ `wise browse extract "extract the page title"` or `wise browse get title`
- 「截一张图」→ `wise browse screenshot`

If the URL is ambiguous, pick the official homepage and say which URL you opened.

## Execution discipline

- Quote instructions and URLs.
- Run `wise browse help` when unsure of a subcommand; treat installed help as authoritative.
- Cloud / Skills / Functions commands (`wise browse skills …`, `wise browse cloud …`) require the optional `browse` binary (`npm install -g browse`).
- If the CLI is missing, tell the user to open the top-right browser-automation icon and click「安装 CLI」. After install, the current session can call `wise browse` (PATH already includes `~/.wise/bin`).
- Do not start a second unrelated browser with ad-hoc Playwright/Puppeteer scripts when `wise browse` is available.
