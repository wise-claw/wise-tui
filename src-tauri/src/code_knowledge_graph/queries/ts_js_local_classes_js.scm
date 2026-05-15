; JavaScript grammar：类名为 identifier

(class_declaration
  name: (identifier) @local.class)

(export_statement
  declaration: (class_declaration
    name: (identifier) @local.class))
