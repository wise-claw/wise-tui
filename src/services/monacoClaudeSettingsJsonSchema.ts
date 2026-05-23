import type * as Monaco from "monaco-editor";
import schemaJson from "../data/claude-code-settings.schema.json";
import { CLAUDE_SETTINGS_ZH_HINTS } from "../data/claudeCodeSettingsZhHints";
import {
  isJsonRootPropertyKeyContext,
  partialJsonPropertyKeyPrefix,
} from "../utils/jsonCursorContext";

const SCHEMA_URI = "https://json.schemastore.org/claude-code-settings.json";
const CLAUDE_SETTINGS_MODEL_URI = "file:///claude-code-settings.json";

type SchemaProperty = { description?: string };
type SettingsSchema = { properties?: Record<string, SchemaProperty> };

const TOP_LEVEL_KEYS = Object.keys((schemaJson as SettingsSchema).properties ?? {});

let configured = false;
let completionDisposable: Monaco.IDisposable | null = null;

export function claudeSettingsEditorModelUri(): string {
  return CLAUDE_SETTINGS_MODEL_URI;
}

export function configureMonacoClaudeSettingsJson(monaco: typeof Monaco): void {
  if (configured) {
    return;
  }
  configured = true;

  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    enableSchemaRequest: false,
    schemas: [
      {
        uri: SCHEMA_URI,
        fileMatch: [CLAUDE_SETTINGS_MODEL_URI, "**/settings.json", "**/.claude/settings.json"],
        schema: schemaJson,
      },
    ],
  });

  completionDisposable?.dispose();
  completionDisposable = monaco.languages.registerCompletionItemProvider("json", {
    triggerCharacters: ['"', ":"],
    provideCompletionItems(model, position) {
      const offset = model.getOffsetAt(position);
      const textBefore = model.getValue().slice(0, offset);
      if (!isJsonRootPropertyKeyContext(textBefore)) {
        return { suggestions: [] };
      }

      const prefix = partialJsonPropertyKeyPrefix(textBefore) ?? "";
      const prefixLower = prefix.toLowerCase();
      const line = model.getLineContent(position.lineNumber);
      const beforeColumn = line.slice(0, position.column - 1);
      const openQuote = beforeColumn.match(/"([^"]*)$/);
      const range = openQuote
        ? {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: position.column - openQuote[0].length,
            endColumn: position.column,
          }
        : {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: position.column,
            endColumn: position.column,
          };

      const schemaProps = (schemaJson as SettingsSchema).properties ?? {};
      const suggestions = TOP_LEVEL_KEYS.filter((key) =>
        key.toLowerCase().startsWith(prefixLower),
      ).map((key) => {
        const zh = CLAUDE_SETTINGS_ZH_HINTS[key];
        const schemaDesc = schemaProps[key]?.description;
        return {
          label: key,
          kind: monaco.languages.CompletionItemKind.Property,
          insertText: `"${key}"`,
          range,
          filterText: key,
          sortText: `0_${key}`,
          detail: zh?.detail ?? schemaDesc?.split("\n")[0] ?? key,
          documentation: zh?.documentation ?? schemaDesc,
        };
      });

      return { suggestions };
    },
  });
}
