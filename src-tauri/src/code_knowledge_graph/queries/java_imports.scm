; GitNexus `JAVA_QUERIES`: `(import_declaration (_) @import.source) @import`
; 这里只锚定整条声明，在 Rust 里解析 `scoped_identifier` / `identifier` 并跳过 `.*`。

(import_declaration) @java_import
