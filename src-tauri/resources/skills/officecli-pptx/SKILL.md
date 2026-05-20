---
name: officecli-pptx
description: "Use this skill any time a .pptx file is involved: creating slide decks, pitch decks, presentations; reading, parsing, editing, updating, combining, or splitting PowerPoint files; working with templates, layouts, speaker notes, comments, visuals, or charts."
---

# OfficeCLI PPTX Skill

Use `officecli` for PowerPoint work. A deck is a visual argument; every slide must pass the three-second comprehension test.

## Workflow

1. Confirm audience, objective, narrative arc, slide count, brand constraints, source files, and template requirements.
2. For an existing deck, inspect first with `officecli view "$FILE" outline`, `view text`, and targeted `get` commands.
3. For a new deck, create and open with `officecli create "$FILE"` and `officecli open "$FILE"`.
4. Build slides in presentation order: cover, agenda, sections, content slides, closing.
5. Use blank layouts for custom designs unless the template requires placeholders.
6. Add one idea per slide, then supporting visuals: shapes, charts, icons, screenshots, diagrams, or image blocks.
7. Add speaker notes for content slides.
8. Close and validate with `officecli close "$FILE"` and deck-specific checks.
9. Render-check each slide and fix overflow, contrast, placeholder, or layout issues before delivery.

## Quality Bar

- One idea per slide.
- Explicit type hierarchy: large titles, readable body text, small captions only where appropriate.
- Every content slide needs a non-text visual except true quote or code slides.
- Use one palette, two fonts max, and strong contrast.
- Keep margins and inter-block gaps consistent.
- Avoid repeated layouts on consecutive slides.
- Do not deliver placeholders, clipped text, overflow past slide edges, low-contrast text, or a blank-looking cover.

## Execution Discipline

- Quote slide paths and shape paths.
- Single-quote shell values that contain `$`.
- Run one structural command, inspect the result, then continue.
- If an `officecli` property or enum is uncertain, run `officecli help pptx ...` and treat installed help as authoritative.
