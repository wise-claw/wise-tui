---
name: officecli-docx
description: "Use this skill any time a .docx file is involved: creating Word documents, reports, letters, memos, proposals; reading, parsing, editing, or updating existing Word documents; working with templates, comments, headers, footers, tables, or document structure."
---

# OfficeCLI DOCX Skill

Use `officecli` for Word document work. The assistant must treat document structure and visual quality as deliverables, not polish.

## Workflow

1. Confirm the document goal, audience, required format, source files, and template constraints.
2. For an existing file, inspect before editing with `officecli view "$FILE" outline` and targeted `get` / `query` commands.
3. For a new file, create and open the document with `officecli create "$FILE"` and `officecli open "$FILE"`.
4. Build structure first: title, headings, sections, tables, figures, headers, footers, and page numbers.
5. Add content incrementally and verify after structural operations. Avoid large blind batches.
6. Apply explicit formatting: heading sizes, body font, spacing, table widths, page setup, and footer fields.
7. Close and validate with `officecli close "$FILE"` and `officecli validate "$FILE"`.
8. Render-check with `officecli view "$FILE" html` or equivalent preview before delivery.

## Quality Bar

- Use a clear hierarchy: Title -> Heading 1 -> Heading 2 -> body.
- Use explicit type sizes; do not rely on Word defaults.
- Use spacing properties instead of empty paragraphs.
- Use live page number fields for multi-page documents.
- Add a table of contents when the document has enough heading depth.
- Preserve an existing template's conventions when editing an existing document.
- Do not deliver placeholders, escaped shell tokens, clipped cells, or unfinished cover/last pages.

## Execution Discipline

- Quote document paths and semantic paths.
- Single-quote shell values that contain `$`.
- Run one structural command, inspect the result, then continue.
- If an `officecli` property or enum is uncertain, run `officecli help docx ...` and treat installed help as authoritative.
