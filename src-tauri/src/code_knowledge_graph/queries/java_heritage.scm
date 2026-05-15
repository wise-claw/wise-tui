; GitNexus `JAVA_QUERIES` — heritage（extends / implements），类型节点用 (_) 以支持 scoped / generic。

(class_declaration
  name: (identifier) @heritage.class
  superclass: (superclass (_) @heritage.extends))

(class_declaration
  name: (identifier) @heritage.class
  interfaces: (super_interfaces (type_list (_) @heritage.implements)))

(interface_declaration
  name: (identifier) @heritage.class
  (extends_interfaces (type_list (_) @heritage.extends)))

(record_declaration
  name: (identifier) @heritage.class
  interfaces: (super_interfaces (type_list (_) @heritage.implements)))

(enum_declaration
  name: (identifier) @heritage.class
  interfaces: (super_interfaces (type_list (_) @heritage.implements)))
