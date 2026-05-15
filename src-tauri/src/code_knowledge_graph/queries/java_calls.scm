; GitNexus `JAVA_QUERIES` — calls（method_invocation / method_reference / object_creation）
; `object_creation_expression` 首子为 `_unqualified_object_creation_expression`（避免在 query 里写 `type:` 字段解析歧义）。

(method_invocation
  name: (identifier) @call.name) @call.root

(object_creation_expression
  .
  (_) @call.unqual) @call.root

(method_reference) @call.mref_root
