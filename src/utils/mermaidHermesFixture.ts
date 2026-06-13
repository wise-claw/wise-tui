/** Hermes Agent 架构图 fixture（用户提供的完整 Mermaid 源码）。 */
export const HERMES_AGENT_FLOWCHART = `flowchart TB
    %% ============================================================
    %%  Hermes Agent ☤  —  功能架构总览
    %% ============================================================

    %% ---------- 入口层 ----------
    subgraph ENTRY["① 入口层 (Entry Points)"]
        direction LR
        CLI["hermes CLI
(cli.py 13933 行)"]
        TUI["Terminal UI
(curses_ui + ui-tui)"]
        GATE["hermes gateway
(gateway/run.py 16252 行)"]
        WEB["Web / Dashboard"]
        ACP["ACP Adapter
(Zed / IDE)"]
        BATCH["batch_runner.py
(离线批处理)"]
    end

    %% ---------- Agent 核心 ----------
    subgraph AGENT["② AIAgent 核心 (run_agent.py 5400 行)"]
        direction TB
        LOOP["Conversation Loop
(user → LLM → tools → reply)"]
        CTX["Context Engine
+ Compression
(中部压缩,首尾保护)"]
        CACHE["Prompt Cache
(Anthropic 5min TTL)"]
        AUX["Auxiliary Client
(压缩/curator/标题
独立客户端,不动主 cache)"]
        DIAG["Streaming Diag
+ Think Scrubber
+ Context Fencing"]
    end

    %% ---------- 多模型 Provider ----------
    subgraph PROVIDERS["③ 多模型提供商 (30+ plugin)"]
        direction TB
        TRANS["ProviderTransport ABC
(transports/base.py)"]
        ANTH["anthropic_messages"]
        CHAT["chat_completions
(OpenAI 通用)"]
        CODEX["codex_responses
(Codex App Server)"]
        BEDR["bedrock (AWS)"]
        PLUGINS["Plugin Providers:
Nous / OpenRouter / NVIDIA NIM /
MiMo / GLM / Kimi / MiniMax / HF /
OpenAI / Copilot / Bedrock / …"]
        TRANS --> ANTH & CHAT & CODEX & BEDR
        TRANS --> PLUGINS
    end

    %% ---------- 工具调度 ----------
    subgraph TOOLS["④ 工具调度 (100+ tools)"]
        direction TB
        REG["Tool Registry
(tools/registry.py)"]
        DEL["delegate_task
(子代理 + 上下文隔离)"]
        PTC["execute_code
(PTC / UDS + file RPC)"]
        TERM["terminal
(6 种后端)"]
        SKILL["skill_manage
(技能 CRUD)"]
        MEM["memory + session_search
(三形状: discovery/scroll/browse)"]
        CRON["cron / send_message / clarify
browser / tts / image_gen / …"]
    end

    %% ---------- 终端后端 ----------
    subgraph ENVS["⑤ 终端执行后端 (tools/environments/)"]
        direction LR
        E1["Local
(bash + env sanitize)"]
        E2["Docker
(orphan reaper)"]
        E3["SSH"]
        E4["Singularity
(HPC)"]
        E5["Modal
(serverless + snapshot)"]
        E6["Daytona
(serverless + persistent FS)"]
    end

    %% ---------- 记忆与技能闭环 ----------
    subgraph LEARN["⑥ 自进化闭环 (Self-Improving)"]
        direction TB
        MM["MemoryManager
(单一接入点)"]
        MP["MemoryProvider ABC"]
        H1["builtin MEMORY.md"]
        H2["Honcho
(dialectic Q&A + 跨会话)"]
        H3["Hindsight / Mem0 /
OpenViking / Supermemory /
RetainDB / Holographic / Byterover"]
        CURATOR["Curator
(空闲 ≥2h 且 ≥7 天
自动 fork 巡检技能)"]
        BUNDLE["Skill Bundles
(/backend-dev = N skills)"]
        MM --> MP
        MP --> H1 & H2 & H3
    end

    %% ---------- 会话持久化 ----------
    subgraph PERSIST["⑦ 持久化 (hermes_state.py)"]
        direction TB
        DB[("SQLite + WAL
state.db")]
        FTS[("FTS5
unicode61 + trigram
(解决 CJK)")]
        SESS["SessionStore
(branch / delegate / compress 链)"]
        PII["PII 哈希
(SHA256 12 hex)"]
        DB  FTS
        DB --> SESS
    end

    %% ---------- 消息网关 ----------
    subgraph GW["⑧ 多平台消息网关 (32 adapter + plugin)"]
        direction TB
        BASE["BasePlatformAdapter ABC
connect/disconnect/send"]
        PLAT_A["Telegram / Discord / Slack
WhatsApp / Signal / Matrix
Feishu / WeCom / WeChat / …"]
        PLAT_B["BlueBubbles / SMS / Email
MSGraph / DingTalk / QQBot
Yuanbao / Webhook / APIServer"]
        PLAT_C["Plugin 平台:
google_chat / irc / line
mattermost / ntfy / photon
simplex / teams / homeassistant"]
        CRON_G["Cron Scheduler
(1min tick + 文件锁)"]
        HAND["Session Handoff
(CLI → thread 平台)"]
        BASE --> PLAT_A & PLAT_B & PLAT_C
    end

    %% ---------- 研究 / 训练 ----------
    subgraph RESEARCH["⑨ 研究 & 训练数据 (RL data factory)"]
        direction LR
        BR["batch_runner.py
(checkpoint + provider 路由)"]
        TC["trajectory_compressor.py
(保护首尾 + 只压中部)"]
        MSWE["mini_swe_runner.py
(SWE-bench 风格)"]
        EXP["JSONL 导出 →
下一代工具调用模型 SFT"]
        BR --> TC --> EXP
        MSWE --> EXP
    end

    CLI & TUI & WEB & ACP --> LOOP
    GATE --> LOOP
    BATCH --> LOOP

    LOOP  CTX
    LOOP --> CACHE
    LOOP --> AUX
    LOOP --> DIAG

    LOOP --> TRANS

    LOOP --> REG
    REG --> DEL & PTC & TERM & SKILL & MEM & CRON

    TERM --> E1 & E2 & E3 & E4 & E5 & E6
    SKILL --> CURATOR
    SKILL --> BUNDLE
    MEM --> MM

    LOOP  DB
    MM  DB
    GATE  DB

    PLAT_A & PLAT_B & PLAT_C --> LOOP
    LOOP --> BASE
    CRON_G --> LOOP

    AUX --> CURATOR
    CURATOR -. 自动创建 / 改进 .-> SKILL
    H2 -. 跨会话用户建模 .-> MM
    MEM -. FTS5 检索 .-> DB

    LOOP --> BR

    classDef entryStyle fill:#e3f2fd,stroke:#1565c0,color:#0d47a1
    class CLI,TUI,GATE,WEB,ACP,BATCH entryStyle`;
