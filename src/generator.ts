export interface PhpGeneratorConfig {
  readonly namespace?: string;
}

export interface PhpGeneratorInput {
  readonly config?: PhpGeneratorConfig;
  readonly modules: readonly SkirModule[];
}

export interface SkirModule {
  readonly path: string;
  readonly records?: readonly (SkirRecord | SkirRecordLocation)[];
  readonly methods?: readonly SkirMethod[];
}

export interface SkirRecordLocation {
  readonly kind: "record-location";
  readonly record: SkirRecord;
}

export interface SkirRecord {
  readonly kind?: string;
  readonly name: string | SkirToken;
  readonly recordType?: "struct" | "enum";
  readonly fields?: readonly SkirField[];
  readonly removedNumbers?: readonly number[];
}

export type SkirField =
  | {
      readonly kind: "field";
      readonly name: string | SkirToken;
      readonly number: number;
      readonly type?: SkirType;
    }
  | {
      readonly kind: "removed";
      readonly number: number;
    };

export type SkirType =
  | string
  | {
      readonly kind: string;
      readonly primitive?: string;
      readonly item?: SkirType;
      readonly other?: SkirType;
      readonly name?: string | SkirToken;
      readonly nameParts?: readonly SkirRecordNamePart[];
    };

export interface SkirToken {
  readonly text: string;
}

export type SkirRecordNamePart =
  | string
  | SkirToken
  | {
      readonly token: string | SkirToken;
    };

export interface SkirMethod {
  readonly kind: "method";
  readonly name: string | SkirToken;
  readonly number: number;
  readonly requestType?: SkirType;
  readonly responseType?: SkirType;
}

export interface GeneratedFile {
  readonly path: string;
  readonly code: string;
}

export function generatePhpFiles(input: PhpGeneratorInput): GeneratedFile[] {
  const namespace = input.config?.namespace ?? "App\\Skir";
  const recordFiles = input.modules.flatMap((module) =>
    (module.records ?? [])
      .map((record) => normalizeRecord(record))
      .filter((record) => isStruct(record) || isEnum(record))
      .map((record) => isEnum(record)
        ? generateEnumFile(namespace, record)
        : generateStructFile(namespace, record)),
  );

  const methods = input.modules.flatMap((module) => module.methods ?? []);

  if (methods.length === 0) {
    return recordFiles;
  }

  return [
    ...recordFiles,
    generateMethodsFile(namespace, methods),
  ];
}

function generateStructFile(namespace: string, record: SkirRecord): GeneratedFile {
  const className = toClassName(tokenText(record.name));
  const fields = collectStructFields(record);

  return {
    path: `${className}.php`,
    code: [
      "<?php",
      "",
      "declare(strict_types=1);",
      "",
      `namespace ${namespace};`,
      "",
      "use LaravelSkir\\Runtime\\DenseJson;",
      "use LaravelSkir\\Runtime\\Field;",
      "use LaravelSkir\\Runtime\\Type;",
      "",
      `final readonly class ${className}`,
      "{",
      indent(generateConstructor(fields)),
      "",
      indent(generateSkirType(record)),
      "",
      indent(generateToArray(fields)),
      "",
      indent(generateFromArray(className, fields)),
      "",
      indent(generateToDenseJson()),
      "",
      indent(generateFromDenseJson(className)),
      "}",
      "",
    ].join("\n"),
  };
}

function generateConstructor(fields: readonly TypedStructField[]): string {
  if (fields.length === 0) {
    return "private function __construct() {}";
  }

  return [
    "public function __construct(",
    ...fields.map((field) => `    public ${phpType(field.type)} $${toPropertyName(field.name)},`),
    ") {}",
  ].join("\n");
}

function generateSkirType(record: SkirRecord): string {
  const entries = collectDeclarations(record, "string")
    .map((declaration) => {
      if (isRemovedDeclaration(declaration)) {
        return `    Field::removed(${declaration.number}),`;
      }

      return `    Field::value('${declaration.name}', ${declaration.number}, ${runtimeTypeExpression(declaration.type ?? "string")}),`;
    })
    .join("\n");

  return [
    "public static function skirType(): Type",
    "{",
    "    return Type::struct([",
    entries,
    "    ]);",
    "}",
  ].join("\n");
}

function generateToArray(fields: readonly TypedStructField[]): string {
  return [
    "/** @return array<string, mixed> */",
    "public function toArray(): array",
    "{",
    "    return [",
    ...fields.map((field) => {
      const property = toPropertyName(field.name);

      return `        '${field.name}' => ${valueToArrayExpression(field.type, `$this->${property}`)},`;
    }),
    "    ];",
    "}",
  ].join("\n");
}

function generateFromArray(className: string, fields: readonly TypedStructField[]): string {
  return [
    "/** @param array<string, mixed> $data */",
    `public static function fromArray(array $data): ${className}`,
    "{",
    "    return new self(",
    ...fields.map((field) => `        ${toPropertyName(field.name)}: ${valueFromArrayExpression(field.type, `$data['${field.name}']`)},`),
    "    );",
    "}",
  ].join("\n");
}

function generateToDenseJson(): string {
  return [
    "public function toDenseJson(): string",
    "{",
    "    return DenseJson::toJson(self::skirType(), $this->toArray());",
    "}",
  ].join("\n");
}

function generateFromDenseJson(className: string): string {
  return [
    `public static function fromDenseJson(string $json): ${className}`,
    "{",
    "    return self::fromArray(DenseJson::fromJson(self::skirType(), $json));",
    "}",
  ].join("\n");
}

function generateEnumFile(namespace: string, record: SkirRecord): GeneratedFile {
  const className = toClassName(tokenText(record.name));
  const variants = collectDeclarations(record);

  return {
    path: `${className}.php`,
    code: [
      "<?php",
      "",
      "declare(strict_types=1);",
      "",
      `namespace ${namespace};`,
      "",
      "use LaravelSkir\\Runtime\\DenseJson;",
      "use LaravelSkir\\Runtime\\EnumValue;",
      "use LaravelSkir\\Runtime\\Type;",
      "use LaravelSkir\\Runtime\\Variant;",
      "",
      `final readonly class ${className}`,
      "{",
      indent("private function __construct(private EnumValue $value) {}"),
      "",
      indent(generateEnumConstructors(variants)),
      "",
      indent(generateEnumSkirType(record)),
      "",
      indent(generateEnumAccessors()),
      "",
      indent(generateEnumToDenseJson()),
      "",
      indent(generateEnumFromDenseJson(className)),
      "}",
      "",
    ].join("\n"),
  };
}

function generateEnumConstructors(variants: readonly StructDeclaration[]): string {
  return variants
    .filter((variant): variant is StructField => !isRemovedDeclaration(variant))
    .map((variant) => {
      if (variant.type === undefined) {
        return [
          `public static function ${toPropertyName(variant.name)}(): self`,
          "{",
          `    return new self(EnumValue::constant('${variant.name}'));`,
          "}",
        ].join("\n");
      }

      return [
        `public static function ${toPropertyName(variant.name)}(${phpType(variant.type)} $value): self`,
        "{",
        `    return new self(EnumValue::wrapper('${variant.name}', $value));`,
        "}",
      ].join("\n");
    })
    .join("\n\n");
}

function generateEnumSkirType(record: SkirRecord): string {
  const entries = collectDeclarations(record)
    .map((declaration) => {
      if (isRemovedDeclaration(declaration)) {
        return null;
      }

      if (declaration.type === undefined) {
        return `    Variant::constant('${declaration.name}', ${declaration.number}),`;
      }

      return `    Variant::wrapper('${declaration.name}', ${declaration.number}, ${runtimeTypeExpression(declaration.type)}),`;
    })
    .filter((entry): entry is string => entry !== null)
    .join("\n");

  return [
    "public static function skirType(): Type",
    "{",
    "    return Type::enum([",
    entries,
    "    ]);",
    "}",
  ].join("\n");
}

function generateEnumAccessors(): string {
  return [
    "public function name(): string",
    "{",
    "    return $this->value->name;",
    "}",
    "",
    "public function payload(): mixed",
    "{",
    "    return $this->value->value;",
    "}",
  ].join("\n");
}

function generateEnumToDenseJson(): string {
  return [
    "public function toDenseJson(): string",
    "{",
    "    return DenseJson::toJson(self::skirType(), $this->value);",
    "}",
  ].join("\n");
}

function generateEnumFromDenseJson(className: string): string {
  return [
    `public static function fromDenseJson(string $json): ${className}`,
    "{",
    "    return new self(DenseJson::fromJson(self::skirType(), $json));",
    "}",
  ].join("\n");
}

function generateMethodsFile(namespace: string, methods: readonly SkirMethod[]): GeneratedFile {
  return {
    path: "SkirMethods.php",
    code: [
      "<?php",
      "",
      "declare(strict_types=1);",
      "",
      `namespace ${namespace};`,
      "",
      "use LaravelSkir\\Runtime\\MethodDescriptor;",
      "",
      "final readonly class SkirMethods",
      "{",
      indent(generateAllMethods(methods)),
      "",
      indent(methods.map((method) => generateMethodDescriptor(method)).join("\n\n")),
      "}",
      "",
    ].join("\n"),
  };
}

function generateAllMethods(methods: readonly SkirMethod[]): string {
  return [
    "/** @return array<string, MethodDescriptor> */",
    "public static function all(): array",
    "{",
    "    return [",
    ...methods.map((method) => `        '${tokenText(method.name)}' => self::${toPropertyName(tokenText(method.name))}(),`),
    "    ];",
    "}",
  ].join("\n");
}

function generateMethodDescriptor(method: SkirMethod): string {
  return [
    `public static function ${toPropertyName(tokenText(method.name))}(): MethodDescriptor`,
    "{",
    "    return new MethodDescriptor(",
    `        name: '${tokenText(method.name)}',`,
    `        number: ${method.number},`,
    `        requestType: ${runtimeTypeExpression(method.requestType ?? "string")},`,
    `        responseType: ${runtimeTypeExpression(method.responseType ?? "string")},`,
    "    );",
    "}",
  ].join("\n");
}

interface StructField {
  readonly name: string;
  readonly number: number;
  readonly type?: SkirType;
}

interface TypedStructField {
  readonly name: string;
  readonly number: number;
  readonly type: SkirType;
}

type StructDeclaration =
  | StructField
  | RemovedDeclaration;

interface RemovedDeclaration {
  readonly kind: "removed";
  readonly number: number;
}

function collectStructFields(record: SkirRecord): TypedStructField[] {
  return collectDeclarations(record, "string")
    .filter((field): field is StructField => !isRemovedDeclaration(field))
    .map((field) => ({
      name: field.name,
      number: field.number,
      type: field.type ?? "string",
    }));
}

function collectDeclarations(record: SkirRecord, defaultMissingType?: SkirType): StructDeclaration[] {
  const declarations: StructDeclaration[] = [];

  for (const field of record.fields ?? []) {
    if (field.kind === "removed") {
      declarations.push({ kind: "removed", number: field.number });

      continue;
    }

    declarations.push({
      name: tokenText(field.name),
      number: field.number,
      type: field.type ?? defaultMissingType,
    });
  }

  for (const removedNumber of record.removedNumbers ?? []) {
    if (!declarations.some((declaration) => declaration.number === removedNumber)) {
      declarations.push({ kind: "removed", number: removedNumber });
    }
  }

  return declarations.sort((left, right) => left.number - right.number);
}

function isStruct(record: SkirRecord): boolean {
  return record.recordType === "struct" || record.kind === "struct";
}

function isEnum(record: SkirRecord): boolean {
  return record.recordType === "enum" || record.kind === "enum";
}

function normalizeRecord(record: SkirRecord | SkirRecordLocation): SkirRecord {
  if ("record" in record) {
    return record.record;
  }

  return record;
}

function isRemovedDeclaration(declaration: StructDeclaration): declaration is RemovedDeclaration {
  return "kind" in declaration && declaration.kind === "removed";
}

function phpType(type: SkirType): string {
  const kind = typeKind(type);

  if (kind === "bool") {
    return "bool";
  }

  if (kind === "int32" || kind === "timestamp") {
    return "int";
  }

  if (kind === "int64" || kind === "hash64") {
    return "int|string";
  }

  if (kind === "float32" || kind === "float64") {
    return "float";
  }

  if (kind === "string" || kind === "bytes") {
    return "string";
  }

  if (kind === "array") {
    return "array";
  }

  if (kind === "optional") {
    return "?".concat(phpType(optionalInnerType(type)));
  }

  if (kind === "record") {
    return toClassName(recordTypeName(type));
  }

  return "mixed";
}

function valueToArrayExpression(type: SkirType, expression: string): string {
  const kind = typeKind(type);

  if (kind === "record") {
    return `${expression}->toArray()`;
  }

  if (kind === "optional") {
    const innerType = optionalInnerType(type);

    if (typeKind(innerType) === "record" || typeKind(innerType) === "array") {
      return `${expression} === null ? null : ${valueToArrayExpression(innerType, expression)}`;
    }

    return expression;
  }

  if (kind === "array") {
    const itemType = arrayItemType(type);

    if (typeKind(itemType) === "record" || typeKind(itemType) === "optional" || typeKind(itemType) === "array") {
      return `array_map(fn (mixed $item): mixed => ${valueToArrayExpression(itemType, "$item")}, ${expression})`;
    }
  }

  return expression;
}

function valueFromArrayExpression(type: SkirType, expression: string): string {
  const kind = typeKind(type);

  if (kind === "record") {
    return `${toClassName(recordTypeName(type))}::fromArray(${expression})`;
  }

  if (kind === "optional") {
    const innerType = optionalInnerType(type);

    if (typeKind(innerType) === "record" || typeKind(innerType) === "array") {
      return `${expression} === null ? null : ${valueFromArrayExpression(innerType, expression)}`;
    }

    return expression;
  }

  if (kind === "array") {
    const itemType = arrayItemType(type);

    if (typeKind(itemType) === "record" || typeKind(itemType) === "optional" || typeKind(itemType) === "array") {
      return `array_map(fn (mixed $item): mixed => ${valueFromArrayExpression(itemType, "$item")}, ${expression})`;
    }
  }

  return expression;
}

function runtimeTypeExpression(type: SkirType): string {
  const kind = typeKind(type);

  if (kind === "array") {
    return `Type::array(${runtimeTypeExpression(arrayItemType(type))})`;
  }

  if (kind === "optional") {
    return `Type::optional(${runtimeTypeExpression(optionalInnerType(type))})`;
  }

  if (kind === "record") {
    return `${toClassName(recordTypeName(type))}::skirType()`;
  }

  return `Type::${kind}()`;
}

function typeKind(type: SkirType): string {
  if (typeof type === "string") {
    return type;
  }

  if (type.kind === "primitive") {
    return type.primitive ?? "string";
  }

  return type.kind;
}

function arrayItemType(type: SkirType): SkirType {
  if (typeof type !== "string" && type.kind === "array" && type.item !== undefined) {
    return type.item;
  }

  return "string";
}

function optionalInnerType(type: SkirType): SkirType {
  if (typeof type !== "string" && type.kind === "optional" && type.other !== undefined) {
    return type.other;
  }

  return "string";
}

function recordTypeName(type: SkirType): string {
  if (typeof type === "string") {
    throw new Error("String primitive types cannot be used as record references.");
  }

  if (type.name !== undefined) {
    return tokenText(type.name);
  }

  if (type.nameParts !== undefined && type.nameParts.length > 0) {
    return recordNamePartText(type.nameParts[type.nameParts.length - 1]);
  }

  throw new Error("Skir record reference is missing a name.");
}

function recordNamePartText(part: SkirRecordNamePart): string {
  if (typeof part === "string") {
    return part;
  }

  if ("token" in part) {
    return tokenText(part.token);
  }

  return tokenText(part);
}

function toClassName(name: string): string {
  return name
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function toPropertyName(name: string): string {
  const className = toClassName(name);

  return className.charAt(0).toLowerCase() + className.slice(1);
}

function tokenText(token: string | SkirToken): string {
  return typeof token === "string" ? token : token.text;
}

function indent(code: string): string {
  return code
    .split("\n")
    .map((line) => (line === "" ? line : `    ${line}`))
    .join("\n");
}
