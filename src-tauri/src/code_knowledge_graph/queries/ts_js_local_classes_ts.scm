; 仅 TS/TSX grammar 编译（含 abstract）

(class_declaration
  name: (type_identifier) @local.class)

(abstract_class_declaration
  name: (type_identifier) @local.class)

(export_statement
  declaration: (class_declaration
    name: (type_identifier) @local.class))

(export_statement
  declaration: (abstract_class_declaration
    name: (type_identifier) @local.class))
