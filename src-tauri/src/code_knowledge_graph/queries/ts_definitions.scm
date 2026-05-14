; Aligned with GitNexus gitnexus/src/core/ingestion/tree-sitter-queries.ts (TYPESCRIPT_QUERIES) — definition captures only.

(class_declaration
  name: (type_identifier) @name) @definition.class

(abstract_class_declaration
  name: (type_identifier) @name) @definition.class

(interface_declaration
  name: (type_identifier) @name) @definition.interface

(function_declaration
  name: (identifier) @name) @definition.function

(function_signature
  name: (identifier) @name) @definition.function

(method_definition
  name: (property_identifier) @name) @definition.method

(method_definition
  name: (private_property_identifier) @name) @definition.method

(abstract_method_signature
  name: (property_identifier) @name) @definition.method

(method_signature
  name: (property_identifier) @name) @definition.method

(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: (arrow_function))) @definition.function

(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: (function_expression))) @definition.function

(export_statement
  declaration: (lexical_declaration
    (variable_declarator
      name: (identifier) @name
      value: (arrow_function)))) @definition.function

(export_statement
  declaration: (lexical_declaration
    (variable_declarator
      name: (identifier) @name
      value: (function_expression)))) @definition.function

(pair
  key: (property_identifier) @name
  value: (arrow_function)) @definition.function

(pair
  key: (property_identifier) @name
  value: (function_expression)) @definition.function

(pair
  key: (string (string_fragment) @name)
  value: (arrow_function)) @definition.function

(pair
  key: (string (string_fragment) @name)
  value: (function_expression)) @definition.function

(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: (call_expression
      arguments: (arguments
        (arrow_function))))) @definition.function

(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: (call_expression
      arguments: (arguments
        (function_expression))))) @definition.function

(export_statement
  declaration: (lexical_declaration
    (variable_declarator
      name: (identifier) @name
      value: (call_expression
        arguments: (arguments
          (arrow_function)))))) @definition.function

(export_statement
  declaration: (lexical_declaration
    (variable_declarator
      name: (identifier) @name
      value: (call_expression
        arguments: (arguments
          (function_expression)))))) @definition.function

(variable_declaration
  (variable_declarator
    name: (identifier) @name
    value: (call_expression
      arguments: (arguments
        (arrow_function))))) @definition.function

(variable_declaration
  (variable_declarator
    name: (identifier) @name
    value: (call_expression
      arguments: (arguments
        (function_expression))))) @definition.function

(lexical_declaration
  (variable_declarator
    name: (identifier) @name)) @definition.const

(export_statement
  declaration: (lexical_declaration
    (variable_declarator
      name: (identifier) @name))) @definition.const

(variable_declaration
  (variable_declarator
    name: (identifier) @name)) @definition.variable

(public_field_definition
  name: (property_identifier) @name) @definition.property

(public_field_definition
  name: (private_property_identifier) @name) @definition.property

(required_parameter
  (accessibility_modifier)
  pattern: (identifier) @name) @definition.property
