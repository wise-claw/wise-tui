; GitNexus `JAVASCRIPT_QUERIES` — call / new / await / this|super（`member_expression` 使用 `property`）

(call_expression
  function: (identifier) @call.name) @call.root

(call_expression
  function: (await_expression
    (identifier) @call.name)) @call.root

(call_expression
  function: (await_expression
    (member_expression
      object: (identifier) @call.recv
      property: (property_identifier) @call.name))) @call.root

(call_expression
  function: (await_expression
    (member_expression
      object: (identifier) @call.recv
      property: (private_property_identifier) @call.name))) @call.root

(call_expression
  function: (await_expression
    (member_expression
      object: (this) @call.recv
      property: (property_identifier) @call.name))) @call.root

(call_expression
  function: (await_expression
    (member_expression
      object: (this) @call.recv
      property: (private_property_identifier) @call.name))) @call.root

(call_expression
  function: (await_expression
    (member_expression
      object: (super) @call.recv
      property: (property_identifier) @call.name))) @call.root

(call_expression
  function: (member_expression
    object: (identifier) @call.recv
    property: (property_identifier) @call.name)) @call.root

(call_expression
  function: (member_expression
    object: (identifier) @call.recv
    property: (private_property_identifier) @call.name)) @call.root

(call_expression
  function: (member_expression
    object: (this) @call.recv
    property: (property_identifier) @call.name)) @call.root

(call_expression
  function: (member_expression
    object: (this) @call.recv
    property: (private_property_identifier) @call.name)) @call.root

(call_expression
  function: (member_expression
    object: (super) @call.recv
    property: (property_identifier) @call.name)) @call.root

(call_expression
  function: (parenthesized_expression
    (identifier) @call.name)) @call.root

(call_expression
  function: (await_expression
    (parenthesized_expression
      (identifier) @call.name))) @call.root

(call_expression
  function: (parenthesized_expression
    (member_expression
      object: (identifier) @call.recv
      property: (property_identifier) @call.name))) @call.root

(call_expression
  function: (parenthesized_expression
    (member_expression
      object: (identifier) @call.recv
      property: (private_property_identifier) @call.name))) @call.root

(call_expression
  function: (parenthesized_expression
    (member_expression
      object: (this) @call.recv
      property: (property_identifier) @call.name))) @call.root

(call_expression
  function: (parenthesized_expression
    (member_expression
      object: (this) @call.recv
      property: (private_property_identifier) @call.name))) @call.root

(call_expression
  function: (parenthesized_expression
    (member_expression
      object: (super) @call.recv
      property: (property_identifier) @call.name))) @call.root

(call_expression
  function: (await_expression
    (parenthesized_expression
      (member_expression
        object: (identifier) @call.recv
        property: (property_identifier) @call.name)))) @call.root

(call_expression
  function: (await_expression
    (parenthesized_expression
      (member_expression
        object: (identifier) @call.recv
        property: (private_property_identifier) @call.name)))) @call.root

(call_expression
  function: (await_expression
    (parenthesized_expression
      (member_expression
        object: (this) @call.recv
        property: (property_identifier) @call.name)))) @call.root

(call_expression
  function: (await_expression
    (parenthesized_expression
      (member_expression
        object: (this) @call.recv
        property: (private_property_identifier) @call.name)))) @call.root

(call_expression
  function: (await_expression
    (parenthesized_expression
      (member_expression
        object: (super) @call.recv
        property: (property_identifier) @call.name)))) @call.root

(new_expression
  constructor: (identifier) @call.name) @call.root
