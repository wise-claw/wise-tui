; Aligned with GitNexus `gitnexus/src/core/ingestion/tree-sitter-queries.ts` (`JAVA_QUERIES`) — definition captures only.
; Extended with `record_declaration` / `compact_constructor_declaration` (Java 16+).

(class_declaration
  name: (identifier) @name) @definition.class

(interface_declaration
  name: (identifier) @name) @definition.interface

(enum_declaration
  name: (identifier) @name) @definition.enum

(annotation_type_declaration
  name: (identifier) @name) @definition.annotation

(record_declaration
  name: (identifier) @name) @definition.record

(method_declaration
  name: (identifier) @name) @definition.method

(constructor_declaration
  name: (identifier) @name) @definition.constructor

(compact_constructor_declaration
  name: (identifier) @name) @definition.constructor

(field_declaration
  declarator: (variable_declarator
    name: (identifier) @name)) @definition.property

(local_variable_declaration
  declarator: (variable_declarator
    name: (identifier) @name)) @definition.variable
