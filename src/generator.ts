export interface PhpGeneratorConfig {
  readonly namespace?: string;
}

export interface PhpGeneratorInput {
  readonly config?: PhpGeneratorConfig;
  readonly modules: readonly SkirModule[];
  readonly recordMap?: ReadonlyMap<string, SkirRecordLocation>;
}

export interface SkirModule {
  readonly path: string;
  readonly records?: readonly (SkirRecord | SkirRecordLocation)[];
  readonly methods?: readonly SkirMethod[];
}

export interface SkirRecordLocation {
  readonly kind: "record-location";
  readonly record: SkirRecord;
  readonly recordAncestors?: readonly SkirRecord[];
  readonly modulePath?: string;
}

export interface SkirRecord {
  readonly kind?: string;
  readonly key?: unknown;
  readonly name: string | SkirToken;
  readonly recordType?: "struct" | "enum";
  readonly fields?: readonly SkirField[];
  readonly removedNumbers?: readonly number[];
  readonly phpClassName?: string;
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
      readonly key?: unknown;
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

interface ModuleOutputContext {
  readonly rootNamespace: string;
  readonly namespace: string;
  readonly pathPrefix: string;
  readonly recordMap?: ReadonlyMap<string, SkirRecordLocation>;
  readonly classNames?: ClassNameRegistry;
  readonly imports?: ImportRegistry;
}

interface ClassNameRegistry {
  readonly namesByIdentity: ReadonlyMap<string, string>;
  readonly namesByRecordKey: ReadonlyMap<string, string>;
}

interface ImportRegistry {
  readonly reservedNames: ReadonlySet<string>;
  readonly imports: Map<string, string>;
}

export function generatePhpFiles(input: PhpGeneratorInput): GeneratedFile[] {
  const namespace = input.config?.namespace ?? "App\\Skir";
  const classNames = buildClassNameRegistry(namespace, input.modules);
  const methodGroups = new Map<string, { context: ModuleOutputContext; methods: SkirMethod[] }>();
  const recordFiles: GeneratedFile[] = [];

  for (const module of input.modules) {
    const context = outputContextForModule(namespace, module, input.recordMap, classNames);

    recordFiles.push(
      ...(module.records ?? [])
        .map((record, index) => normalizeRecord(record, module, index, classNames))
        .filter((record) => isStruct(record) || isEnum(record))
        .map((record) => isEnum(record)
          ? generateEnumFile(context, record)
          : generateStructFile(context, record)),
    );

    const methods = module.methods ?? [];

    if (methods.length > 0) {
      const groupKey = `${context.namespace}\n${context.pathPrefix}`;
      const existingGroup = methodGroups.get(groupKey);

      if (existingGroup !== undefined) {
        existingGroup.methods.push(...methods);
      } else {
        methodGroups.set(groupKey, {
          context,
          methods: [...methods],
        });
      }
    }
  }

  return [
    ...recordFiles,
    ...Array.from(methodGroups.values()).map((group) => generateMethodsFile(group.context, group.methods)),
  ];
}

function generateStructFile(context: ModuleOutputContext, record: SkirRecord): GeneratedFile {
  const className = classNameForRecord(record);
  const fields = collectStructFields(record);
  const runtimeImports = [
    "LaravelSkir\\Runtime\\DenseJson",
    "LaravelSkir\\Runtime\\Field",
    "LaravelSkir\\Runtime\\Type",
  ];
  const fileContext = fileOutputContext(context, className, runtimeImports);
  const constructor = generateConstructor(fields, fileContext);
  const skirType = generateSkirType(record, fileContext);
  const fromArray = generateFromArray(className, fields, fileContext);

  return {
    path: outputPath(context, `${className}.php`),
    code: [
      "<?php",
      "",
      "declare(strict_types=1);",
      "",
      `namespace ${context.namespace};`,
      "",
      ...generateUseStatements(fileContext, runtimeImports),
      "",
      `final readonly class ${className}`,
      "{",
      indent(constructor),
      "",
      indent(skirType),
      "",
      indent(generateToArray(fields)),
      "",
      indent(fromArray),
      "",
      indent(generateToDenseJson()),
      "",
      indent(generateFromDenseJson(className)),
      "}",
      "",
    ].join("\n"),
  };
}

function generateConstructor(fields: readonly TypedStructField[], context: ModuleOutputContext): string {
  if (fields.length === 0) {
    return "private function __construct() {}";
  }

  return [
    "public function __construct(",
    ...fields.map((field) => `    public ${phpType(field.type, context)} $${toPropertyName(field.name)},`),
    ") {}",
  ].join("\n");
}

function generateSkirType(record: SkirRecord, context: ModuleOutputContext): string {
  const entries = collectDeclarations(record, "string")
    .map((declaration) => {
      if (isRemovedDeclaration(declaration)) {
        return `    Field::removed(${declaration.number}),`;
      }

      return `    Field::value('${declaration.name}', ${declaration.number}, ${runtimeTypeExpression(declaration.type ?? "string", context)}),`;
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

function generateFromArray(className: string, fields: readonly TypedStructField[], context: ModuleOutputContext): string {
  return [
    "/** @param array<string, mixed> $data */",
    `public static function fromArray(array $data): ${className}`,
    "{",
    "    return new self(",
    ...fields.map((field) => `        ${toPropertyName(field.name)}: ${valueFromArrayExpression(field.type, `$data['${field.name}']`, context)},`),
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

function generateEnumFile(context: ModuleOutputContext, record: SkirRecord): GeneratedFile {
  const className = classNameForRecord(record);
  const variants = collectDeclarations(record);
  const runtimeImports = [
    "LaravelSkir\\Runtime\\DenseJson",
    "LaravelSkir\\Runtime\\EnumValue",
    "LaravelSkir\\Runtime\\Type",
    "LaravelSkir\\Runtime\\Variant",
  ];
  const fileContext = fileOutputContext(context, className, runtimeImports);
  const constructors = generateEnumConstructors(variants, fileContext);
  const skirType = generateEnumSkirType(record, fileContext);

  return {
    path: outputPath(context, `${className}.php`),
    code: [
      "<?php",
      "",
      "declare(strict_types=1);",
      "",
      `namespace ${context.namespace};`,
      "",
      ...generateUseStatements(fileContext, runtimeImports),
      "",
      `final readonly class ${className}`,
      "{",
      indent("private function __construct(private EnumValue $value) {}"),
      "",
      indent(constructors),
      "",
      indent(skirType),
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

function generateEnumConstructors(variants: readonly StructDeclaration[], context: ModuleOutputContext): string {
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
        `public static function ${toPropertyName(variant.name)}(${phpType(variant.type, context)} $value): self`,
        "{",
        `    return new self(EnumValue::wrapper('${variant.name}', $value));`,
        "}",
      ].join("\n");
    })
    .join("\n\n");
}

function generateEnumSkirType(record: SkirRecord, context: ModuleOutputContext): string {
  const entries = collectDeclarations(record)
    .map((declaration) => {
      if (isRemovedDeclaration(declaration)) {
        return null;
      }

      if (declaration.type === undefined) {
        return `    Variant::constant('${declaration.name}', ${declaration.number}),`;
      }

      return `    Variant::wrapper('${declaration.name}', ${declaration.number}, ${runtimeTypeExpression(declaration.type, context)}),`;
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

function generateMethodsFile(context: ModuleOutputContext, methods: readonly SkirMethod[]): GeneratedFile {
  const runtimeImports = [
    "LaravelSkir\\Runtime\\MethodDescriptor",
  ];
  const fileContext = fileOutputContext(context, "SkirMethods", runtimeImports);
  const descriptors = methods.map((method) => generateMethodDescriptor(method, fileContext)).join("\n\n");

  return {
    path: outputPath(context, "SkirMethods.php"),
    code: [
      "<?php",
      "",
      "declare(strict_types=1);",
      "",
      `namespace ${context.namespace};`,
      "",
      ...generateUseStatements(fileContext, runtimeImports),
      "",
      "final readonly class SkirMethods",
      "{",
      indent(generateAllMethods(methods)),
      "",
      indent(descriptors),
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

function generateMethodDescriptor(method: SkirMethod, context: ModuleOutputContext): string {
  return [
    `public static function ${toPropertyName(tokenText(method.name))}(): MethodDescriptor`,
    "{",
    "    return new MethodDescriptor(",
    `        name: '${tokenText(method.name)}',`,
    `        number: ${method.number},`,
    `        requestType: ${runtimeTypeExpression(method.requestType ?? "string", context)},`,
    `        responseType: ${runtimeTypeExpression(method.responseType ?? "string", context)},`,
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

interface ClassNameCandidate {
  readonly identity: string;
  readonly recordKey?: string;
  readonly namespace: string;
  readonly modulePath: string;
  readonly baseClassName: string;
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

function buildClassNameRegistry(rootNamespace: string, modules: readonly SkirModule[]): ClassNameRegistry {
  const candidates = modules.flatMap((module) =>
    (module.records ?? []).map((record, index): ClassNameCandidate => {
      const modulePath = modulePathForRecord(module, record);
      const baseClassName = "record" in record
        ? classNameForRecordLocation(record)
        : classNameForRecord(record);

      return {
        identity: recordIdentity(module, record, index),
        recordKey: recordKeyForRecord(record),
        namespace: outputContextForModulePath(rootNamespace, modulePath).namespace,
        modulePath,
        baseClassName,
      };
    }),
  );
  const candidatesByClass = new Map<string, ClassNameCandidate[]>();

  for (const candidate of candidates) {
    const groupKey = `${candidate.namespace}\\${candidate.baseClassName}`;
    const existingCandidates = candidatesByClass.get(groupKey);

    if (existingCandidates !== undefined) {
      existingCandidates.push(candidate);
    } else {
      candidatesByClass.set(groupKey, [candidate]);
    }
  }

  const namesByIdentity = new Map<string, string>();
  const namesByRecordKey = new Map<string, string>();

  for (const groupedCandidates of candidatesByClass.values()) {
    for (const candidate of groupedCandidates) {
      const className = groupedCandidates.length > 1
        ? `${moduleClassPrefix(candidate.modulePath)}${candidate.baseClassName}`
        : candidate.baseClassName;

      namesByIdentity.set(candidate.identity, className);

      if (candidate.recordKey !== undefined) {
        namesByRecordKey.set(candidate.recordKey, className);
      }
    }
  }

  return {
    namesByIdentity,
    namesByRecordKey,
  };
}

function modulePathForRecord(module: SkirModule, record: SkirRecord | SkirRecordLocation): string {
  if ("record" in record) {
    return record.modulePath ?? module.path;
  }

  return module.path;
}

function recordIdentity(module: SkirModule, record: SkirRecord | SkirRecordLocation, index: number): string {
  return recordKeyForRecord(record) ?? `${module.path}:${index}`;
}

function recordKeyForRecord(record: SkirRecord | SkirRecordLocation): string | undefined {
  const recordKey = "record" in record
    ? record.record.key
    : record.key;

  return typeof recordKey === "string" ? recordKey : undefined;
}

function classNameFromRegistry(classNames: ClassNameRegistry | undefined, identity: string | undefined, recordKey: unknown): string | undefined {
  if (classNames === undefined) {
    return undefined;
  }

  if (typeof recordKey === "string") {
    const className = classNames.namesByRecordKey.get(recordKey);

    if (className !== undefined) {
      return className;
    }
  }

  if (identity !== undefined) {
    return classNames.namesByIdentity.get(identity);
  }

  return undefined;
}

function moduleClassPrefix(modulePath: string): string {
  const moduleFileName = modulePath.split("/").at(-1) ?? modulePath;
  const moduleName = moduleFileName.replace(/\.skir$/, "");

  return toClassName(moduleName);
}

function normalizeRecord(record: SkirRecord | SkirRecordLocation, module: SkirModule, index: number, classNames: ClassNameRegistry): SkirRecord {
  if ("record" in record) {
    return {
      ...record.record,
      phpClassName: classNameFromRegistry(
        classNames,
        recordIdentity(module, record, index),
        record.record.key,
      ) ?? classNameForRecordLocation(record),
    };
  }

  return {
    ...record,
    phpClassName: classNameFromRegistry(
      classNames,
      recordIdentity(module, record, index),
      record.key,
    ) ?? record.phpClassName,
  };
}

function isRemovedDeclaration(declaration: StructDeclaration): declaration is RemovedDeclaration {
  return "kind" in declaration && declaration.kind === "removed";
}

function phpType(type: SkirType, context: ModuleOutputContext): string {
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
    return "?".concat(phpType(optionalInnerType(type), context));
  }

  if (kind === "record") {
    return recordTypeClassName(type, context);
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

function valueFromArrayExpression(type: SkirType, expression: string, context: ModuleOutputContext): string {
  const kind = typeKind(type);

  if (kind === "record") {
    return `${recordTypeClassName(type, context)}::fromArray(${expression})`;
  }

  if (kind === "optional") {
    const innerType = optionalInnerType(type);

    if (typeKind(innerType) === "record" || typeKind(innerType) === "array") {
      return `${expression} === null ? null : ${valueFromArrayExpression(innerType, expression, context)}`;
    }

    return expression;
  }

  if (kind === "array") {
    const itemType = arrayItemType(type);

    if (typeKind(itemType) === "record" || typeKind(itemType) === "optional" || typeKind(itemType) === "array") {
      return `array_map(fn (mixed $item): mixed => ${valueFromArrayExpression(itemType, "$item", context)}, ${expression})`;
    }
  }

  return expression;
}

function runtimeTypeExpression(type: SkirType, context: ModuleOutputContext): string {
  const kind = typeKind(type);

  if (kind === "array") {
    return `Type::array(${runtimeTypeExpression(arrayItemType(type), context)})`;
  }

  if (kind === "optional") {
    return `Type::optional(${runtimeTypeExpression(optionalInnerType(type), context)})`;
  }

  if (kind === "record") {
    return `${recordTypeClassName(type, context)}::skirType()`;
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

function recordTypeClassName(type: SkirType, context: ModuleOutputContext): string {
  if (typeof type === "string") {
    throw new Error("String primitive types cannot be used as record references.");
  }

  if (typeof type.key === "string" && context.recordMap !== undefined) {
    const recordLocation = context.recordMap.get(type.key);

    if (recordLocation !== undefined) {
      return classNameForRecordReference(context, recordLocation);
    }
  }

  if (type.name !== undefined) {
    return toClassName(tokenText(type.name));
  }

  if (type.nameParts !== undefined && type.nameParts.length > 0) {
    return classNameFromParts(type.nameParts.map((part) => recordNamePartText(part)));
  }

  throw new Error("Skir record reference is missing a name.");
}

function classNameForRecord(record: SkirRecord): string {
  return record.phpClassName ?? toClassName(tokenText(record.name));
}

function classNameForRecordReference(context: ModuleOutputContext, recordLocation: SkirRecordLocation): string {
  const className = classNameFromRegistry(
    context.classNames,
    undefined,
    recordLocation.record.key,
  ) ?? classNameForRecordLocation(recordLocation);
  const recordContext = outputContextForModulePath(
    context.rootNamespace,
    recordLocation.modulePath ?? "",
    context.recordMap,
    context.classNames,
  );

  if (recordContext.namespace === context.namespace) {
    return className;
  }

  return importedClassName(context, `${recordContext.namespace}\\${className}`);
}

function outputContextForModule(rootNamespace: string, module: SkirModule, recordMap?: ReadonlyMap<string, SkirRecordLocation>, classNames?: ClassNameRegistry): ModuleOutputContext {
  return outputContextForModulePath(rootNamespace, module.path, recordMap, classNames);
}

function outputContextForModulePath(rootNamespace: string, modulePath: string, recordMap?: ReadonlyMap<string, SkirRecordLocation>, classNames?: ClassNameRegistry): ModuleOutputContext {
  const directoryParts = modulePath
    .split("/")
    .slice(0, -1)
    .map((part) => toClassName(part))
    .filter((part) => part !== "");

  if (directoryParts.length === 0) {
    return {
      rootNamespace,
      namespace: rootNamespace,
      pathPrefix: "",
      recordMap,
      classNames,
    };
  }

  return {
    rootNamespace,
    namespace: [rootNamespace, ...directoryParts].join("\\"),
    pathPrefix: directoryParts.join("/"),
    recordMap,
    classNames,
  };
}

function outputPath(context: ModuleOutputContext, fileName: string): string {
  if (context.pathPrefix === "") {
    return fileName;
  }

  return `${context.pathPrefix}/${fileName}`;
}

function fileOutputContext(context: ModuleOutputContext, className: string, runtimeImports: readonly string[]): ModuleOutputContext {
  const reservedNames = new Set([
    className,
    ...runtimeImports.map((importName) => shortClassName(importName)),
  ]);

  return {
    ...context,
    imports: {
      reservedNames,
      imports: new Map(),
    },
  };
}

function generateUseStatements(context: ModuleOutputContext, runtimeImports: readonly string[]): string[] {
  const generatedImports = Array.from(context.imports?.imports.values() ?? []).sort();

  return [
    ...runtimeImports,
    ...generatedImports,
  ].map((importName) => `use ${importName};`);
}

function importedClassName(context: ModuleOutputContext, fullyQualifiedClassName: string): string {
  const shortName = shortClassName(fullyQualifiedClassName);

  if (context.imports === undefined) {
    return `\\${fullyQualifiedClassName}`;
  }

  if (context.imports.reservedNames.has(shortName)) {
    return `\\${fullyQualifiedClassName}`;
  }

  const existingImport = context.imports.imports.get(shortName);

  if (existingImport === undefined) {
    context.imports.imports.set(shortName, fullyQualifiedClassName);

    return shortName;
  }

  if (existingImport === fullyQualifiedClassName) {
    return shortName;
  }

  return `\\${fullyQualifiedClassName}`;
}

function shortClassName(fullyQualifiedClassName: string): string {
  return fullyQualifiedClassName.split("\\").at(-1) ?? fullyQualifiedClassName;
}

function classNameForRecordLocation(record: SkirRecordLocation): string {
  if (record.recordAncestors !== undefined && record.recordAncestors.length > 0) {
    return classNameFromParts(record.recordAncestors.map((ancestor) => tokenText(ancestor.name)));
  }

  return toClassName(tokenText(record.record.name));
}

function classNameFromParts(parts: readonly string[]): string {
  return parts.map((part) => toClassName(part)).join("");
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
