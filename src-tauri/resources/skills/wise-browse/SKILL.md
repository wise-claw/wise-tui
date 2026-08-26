---
name: wise-browse
description: "Use this skill any time the user wants to operate a web browser from the session: open a site, click, fill forms, extract content, take snapshots/screenshots, run automated tests, or accept a page against a checklist. Run the `wise browse` CLI; do not invent browser APIs or ask the user to click the top-right icon for day-to-day operations."
---

# Wise Browse Skill

Use `wise browse` (alias `wise-browse`) for all in-session browser automation, including **automated testing** and **acceptance checks**. The Wise top-right browser icon is **configuration only** (local/cloud/CDP, headed window, model/keys, CLI install). Do not tell the user to operate the page from that icon.

## Workflow

1. Confirm the goal (open a site, click, extract, **assert**, or **accept** a page).
2. Run one CLI command, read JSON stdout (`summary`, `passed`, `reportPath`), then continue.
3. Prefer deterministic `assert` for tests. Use `expect` / `accept` for natural-language acceptance.
4. After navigation or a failed check, `wise browse screenshot --full` or rely on suite `screenshotOnFail`.

## Command map

```bash
wise browse open https://www.google.com
wise browse act "click the first search result"
wise browse extract "extract the page title"
wise browse assert title contains Google
wise browse assert visible css=input[name=q]
wise browse expect "页面有搜索框"
wise browse accept --url https://www.google.com --check "title contains Google" --check "visible css=input[name=q]"
wise browse accept --init login.accept.json
wise browse test --file ./login.accept.json
wise browse report
wise browse auth wait
wise browse auth save
wise browse auth status
wise browse snapshot
wise browse screenshot --full
wise browse status
wise browse help
```

The first command that needs a page auto-starts the shared browser using `~/.wise/stagehand-automation/config.json`. Later commands reuse the same window. Local mode **persists login state** in `~/.wise/stagehand-automation/profiles/<档案>` (default `default`). Turn this off in the top-right config if you need a clean session.

## Login state

Sites that need a logged-in user:

1. Keep「显示窗口」on. Open the login page (`wise browse open …`).
2. Ask the user to sign in in that window, then run `wise browse auth wait` (or `wise browse 等待登录`). It waits until the URL leaves `/login` or a session cookie appears, then saves a snapshot.
3. If the user already finished login, `wise browse auth save` (or「保存登录态」).
4. Later sessions reuse the Chromium profile automatically. Cloud / headless-without-profile can `wise browse auth load`.

```bash
wise browse auth status
wise browse auth save [档案名]
wise browse auth load [档案名]
wise browse auth wait [--timeout 180000]
wise browse auth clear [档案名]
```

Do not paste passwords into the CLI. Prefer the headed window or CDP attach to an already-logged-in Chrome.

Site aliases work without a full URL: `wise browse open 谷歌`, `open 百度`, `open github`. You can also forward the user's sentence: `wise browse 打开谷歌官网`, `wise browse 断言标题包含 Google`, `wise browse 验收当前页有登录按钮`.

## Automated testing

Deterministic. No model required.

- `assert title|url|text|html|value contains|equals|matches <expected>`
- `assert visible|hidden|checked <selector>`
- Chinese: `wise browse 标题应该包含 Google`, `wise browse 标题不能包含 Error`
- Failed asserts exit code `1` and include `passed: false` plus `actual` / `expected`.

## Automated acceptance

Natural-language checks need a model key (top-right config). Mix them with asserts in a suite:

```json
{
  "name": "登录页验收",
  "url": "https://example.com/login",
  "screenshotOnFail": true,
  "retries": 1,
  "steps": [
    { "open": "https://example.com/login" },
    { "wait": { "selector": "css=form", "state": "visible", "timeout": 5000 } },
    { "assert": "title contains 登录" },
    { "assert": { "visible": "css=button[type=submit]" } },
    { "screenshot": true },
    { "expect": "页面有用户名和密码输入框", "soft": true }
  ]
}
```

`wise browse accept --init login.accept.json` writes that template. `wise browse accept --file login.accept.json` runs it and writes:

- `~/.wise/stagehand-automation/reports/<iso>-acceptance.json`
- sibling `.md` markdown
- `reports/latest.json` pointer

`wise browse report` / `wise browse 查看最近验收报告` prints the latest result without starting the browser. Failed suites still exit `1`. Soft asserts (`soft: true`) count as failures but do not stop the suite even with `stopOnFail`.

## Natural language

- 「打开谷歌官网」→ `wise browse open https://www.google.com`
- 「断言标题包含 Google」/「标题应该包含 Google」→ `wise browse assert title contains Google`
- 「验收当前页有登录按钮」→ `wise browse expect "当前页有登录按钮"`
- 「初始化验收套件」→ `wise browse accept --init login.accept.json`
- 「按套件验收 login.accept.json」→ `wise browse accept --file login.accept.json`
- 「查看最近验收报告」→ `wise browse report`
- 「点一下登录」→ `wise browse act "click the login button"`
- 「截一张图」→ `wise browse screenshot`
- 「等待登录」→ `wise browse auth wait`
- 「保存登录态」→ `wise browse auth save`

If the URL is ambiguous, pick the official homepage and say which URL you opened.

## Execution discipline

- Quote instructions and URLs.
- Run `wise browse help` when unsure of a subcommand; treat installed help as authoritative.
- Treat `passed: false` as a failed test/acceptance step; do not claim success.
- Cloud / Skills / Functions commands (`wise browse skills …`, `wise browse cloud …`) require the optional `browse` binary (`npm install -g browse`).
- If the CLI is missing, tell the user to open the top-right browser-automation icon and click「一键安装」. After install, the current session can call `wise browse` (PATH already includes `~/.wise/bin`; login shells also get that directory appended).
- Do not start a second unrelated browser with ad-hoc Playwright/Puppeteer scripts when `wise browse` is available.
