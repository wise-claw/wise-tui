# MCP Setup

ABCoder is recommended when bootstrapping Trellis specs because it exposes AST context to the agent. It is a tool choice, not a platform requirement. Configure it through whatever MCP mechanism your agent host provides.

## ABCoder

ABCoder parses code into UniAST and gives precise package, file, and node-level structure. Use it for signatures, type shapes, implementations, dependencies, and reverse references.

### Install

```bash
go install github.com/cloudwego/abcoder@latest
abcoder --help
```

### Parse Repositories

```bash
abcoder parse /absolute/path/to/package \
  --lang typescript \
  --name package-name \
  --output ~/abcoder-asts
```

For monorepos, parse each package with a stable `--name` so task notes can reference the same repository names.

### MCP Server Command

Use this server command in the host's MCP configuration:

```bash
abcoder mcp ~/abcoder-asts
```

### Useful Tools

| Tool | Layer | Purpose |
|------|-------|---------|
| `list_repos` | 1 | List parsed repositories |
| `get_repo_structure` | 2 | Inspect packages and files |
| `get_package_structure` | 3 | Inspect nodes within a package |
| `get_file_structure` | 3 | Inspect functions, classes, types, and signatures in a file |
| `get_ast_node` | 4 | Retrieve code, dependencies, references, and implementations |

## Verification

After configuration, verify from the agent host that the MCP server is visible. Then run one simple query before starting the spec writing pass.

```bash
ls ~/abcoder-asts/*.json
```
