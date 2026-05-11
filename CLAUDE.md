# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Wise** — a desktop application shell built with Tauri 2, Bun, Vite, React 19, and Ant Design 6. Provides sidebar navigation, top bar, content area, and a Rust `invoke` bridge example.

## Key Commands

```bash
bun install              # Install dependencies
bun run dev              # Frontend-only dev server (localhost:16088, no Tauri APIs)
bun run desktop:dev      # Full desktop dev (Vite + Tauri window)
bun run build            # Frontend type-check + Vite production build
bun run desktop:build    # Full Tauri app build (produces .dmg/.msi/AppImage)
bun run preview          # Preview built frontend
bun run tauri            # Direct Tauri CLI access
```

## Architecture

### Frontend (`src/`)

- **React 19 SPA** — components in `src/components/`, pages in `src/pages/`
- **Tauri IPC** via `invoke` from `@tauri-apps/api/core` — all calls wrapped in `src/services/`
- **Dark mode** via Ant Design `theme.darkAlgorithm` / `theme.defaultAlgorithm` with CSS custom properties
- **Locale**: `zh_CN` (antd locale)
- **Styling**: BEM-inspired CSS with `.app-` prefix, Ant Design design tokens, component-scoped `.css` files
- **Current layout**: three-panel (LeftSidebar, MainChat, RightPanel)

### Rust Backend (`src-tauri/`)

- `**src/lib.rs`** — Tauri app builder, registers `greet` command and `tauri_plugin_opener`
- `**src/main.rs**` — entry point, delegates to `lib.rs::run()`
- `**capabilities/default.json**` — window capabilities: `core:default` + `opener:default` on window `"main"`
- `**tauri.conf.json**` — app identifier `com.wise.desktop`, window 1280×800, Vite dev on port 16088

### CI/CD (`.github/workflows/`)

- `**ci.yml**` — on push/PR to master/main: `bun run build` (type-check + Vite build)
- `**desktop-release.yml**` — on `v*` tags: builds across macOS/Ubuntu/Windows via `tauri-action`, creates draft GitHub Release

## Development Notes

- Package manager is **bun** (`packageManager` field in package.json is `bun@1.3.5`) — use `bun` not `npm`/`yarn`/`pnpm`
- Vite server port is **fixed at 16088** (Tauri requirement) — `strictPort: true`
- TypeScript is strict: `noUnusedLocals`, `noUnusedParameters`, `strict: true`
- No test framework is configured; CI only runs type-checking and build

## Coding Standards

### Project Structure

```
src/
├── assets/              # Static assets (images, fonts, icons)
├── components/          # Shared reusable components
│   └── ComponentName/
│       ├── index.tsx    # Component entry
│       └── index.css    # Component-scoped styles (optional)
├── pages/               # Page-level components (one file per page)
├── hooks/               # Custom React hooks
├── types.ts             # Shared TypeScript types
├── utils/               # Pure utility functions
├── services/            # API / Tauri invoke calls
├── styles/              # Global styles, variables, mixins
│   ├── global.css       # Global reset, root styles
│   └── variables.css    # CSS custom properties (design tokens)
├── App.tsx              # Root layout & routing
├── App.css              # App-level shared styles
└── main.tsx             # Entry point
```

### Page Conventions

- Each page lives in `src/pages/` as a single `.tsx` file (e.g., `pages/HomePage.tsx`)
- Page component names use **PascalCase** with `Page` suffix: `HomePage`, `SettingsPage`
- A page is a composition of components from `components/` — it owns no business logic
- Page-level state (data fetching, mutations) stays in the page or is extracted to `hooks/`
- Pages must NOT import other pages; only import from `components/`, `hooks/`, `services/`, `types/`, `utils/`
- A page file should be under ~200 lines; if larger, extract sections into `components/`

Example:

```tsx
// src/pages/HomePage.tsx
import { useRepositoryList } from "../hooks/useRepositoryList";

export function HomePage() {
  const { repositories, loading } = useRepositoryList();
  return <div>{repositories.length} 个仓库</div>;
}
```

### Component Conventions

#### Naming


| Kind             | Convention                      | Example                          |
| ---------------- | ------------------------------- | -------------------------------- |
| React component  | PascalCase, noun or noun phrase | `LeftSidebar`, `ChatMessage`     |
| Hook             | camelCase, `use` prefix         | `useChatMessages`, `useDarkMode` |
| Utility          | camelCase, verb or predicate    | `formatTime`, `isValidEmail`     |
| Type / Interface | PascalCase                      | `ChatMessage`, `SidebarProps`    |
| Constant         | UPPER_SNAKE_CASE                | `DEFAULT_PAGE_SIZE`              |


#### File Organization

- One primary export per file; file name matches component name
- Related small components that are never used independently can share a file (e.g., `TopbarBtn` inside `MainChat.tsx`)
- Private helpers within a component file stay below the main export, separated by `// ── Section ──` comments

#### Component Structure (order within file)

```tsx
import { useState } from "react";
import { Button, Layout } from "antd";
import type { ChatMessage } from "../types";
import { useSomeHook } from "../hooks/useSomeHook";
import { formatTime } from "../utils/format";
import "./ComponentName.css";

// ── Sub-components / SVG Icons ──

function SubComponent() { ... }

// ── Types ──

interface Props {
  value: string;
  onChange: (value: string) => void;
}

// ── Main Component ──

export function ComponentName({ value, onChange }: Props) {
  // 1. hooks
  const [local, setLocal] = useState("");

  // 2. event handlers
  function handleClick() { ... }

  // 3. derived values
  const display = formatTime(value);

  // 4. render
  return <div className="component-name">{display}</div>;
}
```

#### Props

- Always use an explicit `Props` interface (inline `interface Props` for simple components, extracted to `types.ts` for shared props)
- Destructure props in the function signature with type annotation
- Keep prop count under ~8; group related props into an options object if larger
- Use `children?: React.ReactNode` only when the component wraps content
- Prefer `onXxx` naming for callbacks: `onSend`, `onToggleSidebars`
- Boolean props should NOT use `is`/`has` prefix unless it's a state query (e.g., `collapsed` is fine, `isLoading` is fine)

#### SVG Icons

- Inline SVG icons stay in the component file where they are used
- If an icon is used in 2+ components, extract it to `src/components/icons/`
- Use `currentColor` for fill/stroke so icons inherit text color
- SVG icon components are named `IconXxx` or `XxxIcon` and accept no props (or size/color props)

### Style / CSS Conventions

#### Strategy: BEM-inspired CSS Modules with CSS Custom Properties

- Use `**kebab-case**` for CSS class names: `.app-chat-messages`, `.app-right-section-title`
- All class names prefixed with `**.app-**` followed by component/area name: `.app-left-sidebar`, `.app-main-chat`
- Modifiers use **double dash**: `.app-topbar-btn.active` → `.app-topbar-btn--active` or `.app-chat-topbar-left--collapsed`
- Nesting in CSS: use descendant selector pattern, not deep nesting (max 3 levels)

#### Style Separation


| Scope                | Location                                          | Example                     |
| -------------------- | ------------------------------------------------- | --------------------------- |
| Global reset, root   | `src/styles/global.css`                           | html/body height, scrollbar |
| Design tokens        | `src/styles/variables.css`                        | colors, spacing, radii      |
| Component styles     | `src/components/Xxx/Xxx.css` or co-located `.css` | `.app-left-sidebar { ... }` |
| Page-specific styles | `src/pages/XxxPage.css`                           | page-only layout tweaks     |
| App-level shared     | `src/App.css`                                     | cross-component utilities   |


#### CSS Custom Properties (Design Tokens)

- Prefer Ant Design design tokens via `var(--ant-*)` — these already support dark mode automatically
- Custom tokens defined in `src/styles/variables.css` should only fill gaps not covered by Ant Design
- Never hardcode hex colors or pixel spacing in component CSS — use tokens or theme config

#### Dark Mode

- Always use Ant Design theme tokens: `var(--ant-color-bg-container)`, `var(--ant-color-text-secondary)`
- Never write `background: #1a1a1a` or `color: #999` directly — these break in dark/light themes
- Test all new components in both light and dark mode

#### Units & Layout

- Use `px` for precise UI sizing (border-radius, icon sizes, small gaps)
- Use `rem` for typography sizing
- Use `vh`/`vw` for viewport-relative layout only when needed (e.g., `height: 100vh`)
- Use CSS `gap` instead of margin between sibling flex/grid items

### TypeScript Conventions

- **Strict mode**: all new code must pass `noUnusedLocals`, `noUnusedParameters`, `strict`
- No `any` — use `unknown` + type guard, or define a proper interface
- Use `as const` for literal unions and configuration arrays
- Use `type` for unions, intersections, mapped types; use `interface` for object shapes that can be extended
- Avoid `!` non-null assertions; use optional chaining `?.` or nullish coalescing `??`
- Event handlers: use Ant Design types (`React.ChangeEvent<HTMLInputElement>`) or narrow to the specific event
- `import type` for type-only imports when the import is not used at runtime

### React Conventions

- **Functional components only** — no class components
- Custom hooks extract reusable stateful logic; hook file: `src/hooks/useXxx.ts`
- `useState` initializers: inline for simple values, extract to a function for expensive computation
- `useMemo`/`useCallback` only when needed for performance or dependency stability — do not wrap everything
- `useRef` for DOM access and mutable values that don't trigger re-render
- `useMemo` for derived data; `useState` for independent state; avoid deriving state when a computed value suffices
- Components should be pure functions of their props — side effects only in `useEffect` or event handlers

### Tauri IPC Conventions

- All `invoke` calls live in `src/services/` — components never call `invoke` directly
- Each Tauri command gets a typed wrapper:
  ```ts
  // src/services/greet.ts
  import { invoke } from "@tauri-apps/api/core";
  export async function greet(name: string): Promise<string> {
    return invoke<string>("greet", { name });
  }
  ```
- Service functions must handle the non-Tauri (browser) fallback gracefully
- Tauri capabilities in `src-tauri/capabilities/` must be explicitly scoped

### Naming Convention Summary


| Item           | Convention               | Example                   |
| -------------- | ------------------------ | ------------------------- |
| Component file | PascalCase               | `LeftSidebar.tsx`         |
| Component dir  | PascalCase               | `components/LeftSidebar/` |
| CSS class      | kebab-case, .app- prefix | `.app-left-sidebar`       |
| CSS modifier   | double-dash              | `--collapsed`, `--active` |
| Hook           | camelCase, use prefix    | `useDarkMode`             |
| Hook file      | camelCase                | `hooks/useDarkMode.ts`    |
| Type           | PascalCase               | `ChatMessage`             |
| Utility        | camelCase                | `formatTime`              |
| Constant       | UPPER_SNAKE_CASE         | `MAX_RETRIES`             |
| Service        | camelCase                | `src/services/chat.ts`    |


### Git Commit Conventions

- Use **Conventional Commits**: `type(scope): description`
- Types: `feat`, `fix`, `refactor`, `style`, `docs`, `chore`, `perf`, `test`
- Scopes match directory or feature: `components`, `pages`, `tauri`, `styles`, `ci`
- Examples:
  - `feat(components): add right panel with skills and tools`
  - `fix(styles): fix dark mode token usage in chat input`
  - `refactor(pages): extract HomePage from App.tsx`

