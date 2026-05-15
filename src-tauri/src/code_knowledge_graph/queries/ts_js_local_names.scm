; 同文件可解析的自由调用目标（TS/TSX/JS 语法子集交集，须三种 grammar 均可编译）

(function_declaration
  name: (identifier) @local.fn)

(export_statement
  declaration: (function_declaration
    name: (identifier) @local.fn))

(method_definition
  name: (property_identifier) @local.fn)

(method_definition
  name: (private_property_identifier) @local.fn)

(lexical_declaration
  (variable_declarator
    name: (identifier) @local.fn
    value: (arrow_function)))

(lexical_declaration
  (variable_declarator
    name: (identifier) @local.fn
    value: (function_expression)))

(export_statement
  declaration: (lexical_declaration
    (variable_declarator
      name: (identifier) @local.fn
      value: (arrow_function))))

(export_statement
  declaration: (lexical_declaration
    (variable_declarator
      name: (identifier) @local.fn
      value: (function_expression))))

(variable_declaration
  (variable_declarator
    name: (identifier) @local.fn
    value: (arrow_function)))

(variable_declaration
  (variable_declarator
    name: (identifier) @local.fn
    value: (function_expression)))

(pair
  key: (property_identifier) @local.fn
  value: (arrow_function))

(pair
  key: (property_identifier) @local.fn
  value: (function_expression))

(lexical_declaration
  (variable_declarator
    name: (identifier) @local.fn
    value: (call_expression
      arguments: (arguments
        (arrow_function)))))

(lexical_declaration
  (variable_declarator
    name: (identifier) @local.fn
    value: (call_expression
      arguments: (arguments
        (function_expression)))))

(export_statement
  declaration: (lexical_declaration
    (variable_declarator
      name: (identifier) @local.fn
      value: (call_expression
        arguments: (arguments
          (arrow_function))))))

(export_statement
  declaration: (lexical_declaration
    (variable_declarator
      name: (identifier) @local.fn
      value: (call_expression
        arguments: (arguments
          (function_expression))))))

(variable_declaration
  (variable_declarator
    name: (identifier) @local.fn
    value: (call_expression
      arguments: (arguments
        (arrow_function)))))

(variable_declaration
  (variable_declarator
    name: (identifier) @local.fn
    value: (call_expression
      arguments: (arguments
        (function_expression)))))

(function_expression
  name: (identifier) @local.fn)
