; GitNexus `JAVA_QUERIES` — field write（`=` / `+=` 等均在 assignment_expression）

(assignment_expression
  left: (field_access
    object: (_) @assignment.receiver
    field: (identifier) @assignment.property)
  right: (_)) @assignment.root
