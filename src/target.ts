import {
  importClass,
  importClassAs,
  indent,
  renderPhpFile,
  renderUseStatements,
  toClassName,
  toPhpNamespaceSegment,
  toPropertyName,
  type GeneratedFile,
  type NormalizedField,
  type NormalizedRecord,
  type NormalizedType,
  type PhpTargetAdapter,
  type RenderContext,
  type StructRenderRequest,
} from "@php-skir/generator-core";

import { GENERATOR_MODULE } from "./config.js";

const LARAVEL_DATA_STRUCT_IMPORTS = [
  "Skir\\Runtime\\DenseJson",
  "Skir\\Runtime\\Field",
  "Skir\\Runtime\\Type",
  "Spatie\\LaravelData\\Attributes\\DataCollectionOf",
  "Spatie\\LaravelData\\Attributes\\MapInputName",
  "Spatie\\LaravelData\\Data",
] as const;

export class LaravelDataTarget implements PhpTargetAdapter {
  public readonly id = GENERATOR_MODULE;

  public recordClassName(record: NormalizedRecord): string {
    if (record.phpClassName !== undefined) {
      return record.phpClassName;
    }

    const className = toClassName(record.qualifiedName);

    return className.endsWith("Data") ? className : `${className}Data`;
  }

  public structImports(record: NormalizedRecord): readonly string[] {
    return LARAVEL_DATA_STRUCT_IMPORTS;
  }

  public renderStruct({ record, context }: StructRenderRequest): GeneratedFile {
    if (record.recordType !== "struct") {
      throw new Error(`Cannot render non-struct record ${record.identity} as a struct.`);
    }

    const className = classNameForRecord(record, context);
    const denseJson = importClass(context.imports, LARAVEL_DATA_STRUCT_IMPORTS[0]);
    const fieldClass = importClass(context.imports, LARAVEL_DATA_STRUCT_IMPORTS[1]);
    const typeClass = importClass(context.imports, LARAVEL_DATA_STRUCT_IMPORTS[2]);
    const dataCollectionOf = importClass(context.imports, LARAVEL_DATA_STRUCT_IMPORTS[3]);
    const mapInputName = importClass(context.imports, LARAVEL_DATA_STRUCT_IMPORTS[4]);
    const dataClass = importClass(context.imports, LARAVEL_DATA_STRUCT_IMPORTS[5]);
    const fields = record.fields.filter(isStructField);
    const constructor = this.renderConstructor(
      fields,
      context,
      dataCollectionOf,
      mapInputName,
    );
    const members = [
      constructor,
      this.renderSkirType(record, context, fieldClass, typeClass),
      this.renderToSkirArray(fields, context),
      this.renderMakeFromSkirPayload(fields, context),
      this.renderFromSkir(className, denseJson),
      this.renderToSkir(denseJson),
      this.renderToSkirJson(denseJson),
    ].filter((member): member is string => member !== null);
    const body = [
      `final class ${className} extends ${dataClass}`,
      "{",
      ...members.flatMap((member, index) => index === 0
        ? [indent(member)]
        : ["", indent(member)]),
      "}",
    ].join("\n");

    return {
      path: outputPath(context, `${className}.php`),
      code: renderPhpFile({
        namespace: context.namespace,
        imports: renderUseStatements(context.imports, LARAVEL_DATA_STRUCT_IMPORTS),
        body,
      }),
    };
  }

  public phpType(type: NormalizedType, context: RenderContext): string {
    if (type.kind === "bool") {
      return "bool";
    }

    if (type.kind === "int32" || type.kind === "timestamp") {
      return "int";
    }

    if (type.kind === "int64" || type.kind === "hash64") {
      return "int|string";
    }

    if (type.kind === "float32" || type.kind === "float64") {
      return "float";
    }

    if (type.kind === "string" || type.kind === "bytes") {
      return "string";
    }

    if (type.kind === "array") {
      return "array";
    }

    if (type.kind === "optional") {
      return nullablePhpType(this.phpType(type.inner, context));
    }

    if (type.kind === "record") {
      return recordTypeClassName(type, context);
    }

    return "mixed";
  }

  public toSkirExpression(
    type: NormalizedType,
    expression: string,
    context: RenderContext,
  ): string {
    if (type.kind === "record") {
      return type.recordType === "enum"
        ? `${expression}->toSkirValue()`
        : `${expression}->toSkirArray()`;
    }

    if (type.kind === "optional") {
      if (type.inner.kind === "record" || type.inner.kind === "array") {
        return `${expression} === null ? null : ${this.toSkirExpression(type.inner, expression, context)}`;
      }

      return expression;
    }

    if (type.kind === "array") {
      if (isRecursivelyMappedType(type.item)) {
        return `array_map(fn (mixed $item): mixed => ${this.toSkirExpression(type.item, "$item", context)}, ${expression})`;
      }
    }

    return expression;
  }

  public fromSkirExpression(
    type: NormalizedType,
    expression: string,
    context: RenderContext,
  ): string {
    return this.hydrateSkirExpression(type, expression, context);
  }

  public clientResponseExpression(
    type: NormalizedType,
    expression: string,
    context: RenderContext,
  ): string {
    return this.hydrateSkirExpression(type, expression, context);
  }

  public manifestObjectClass(type: NormalizedType, context: RenderContext): string | null {
    if (type.kind !== "record") {
      return null;
    }

    return fullyQualifiedRecordClassName(type, context);
  }

  private renderConstructor(
    fields: readonly NormalizedField[],
    context: RenderContext,
    dataCollectionOf: string,
    mapInputName: string,
  ): string | null {
    if (fields.length === 0) {
      return null;
    }

    return [
      "public function __construct(",
      ...fields.flatMap((field) => [
        ...propertyAttributes(
          field,
          context,
          dataCollectionOf,
          mapInputName,
        ).map((attribute) => `    ${attribute}`),
        `    public ${this.phpType(field.type, context)} $${toPropertyName(field.name)},`,
      ]),
      ") {}",
    ].join("\n");
  }

  private renderSkirType(
    record: NormalizedRecord,
    context: RenderContext,
    fieldClass: string,
    typeClass: string,
  ): string {
    const entries = record.fields.map((field) => {
      if (field.kind === "removed") {
        return `    ${fieldClass}::removed(${field.number}),`;
      }

      if (!field.hasPayload) {
        throw new Error(`Struct field ${field.name} in ${record.identity} has no payload type.`);
      }

      return `    ${fieldClass}::value('${field.name}', ${field.number}, ${runtimeTypeExpression(field.type, context, this, typeClass)}),`;
    }).join("\n");

    return [
      `public static function skirType(): ${typeClass}`,
      "{",
      `    return ${typeClass}::struct([`,
      entries,
      "    ]);",
      "}",
    ].join("\n");
  }

  private renderToSkirArray(
    fields: readonly NormalizedField[],
    context: RenderContext,
  ): string {
    return [
      "/** @return array<string, mixed> */",
      "public function toSkirArray(): array",
      "{",
      "    return [",
      ...fields.map((field) => {
        const property = toPropertyName(field.name);

        return `        '${field.name}' => ${this.toSkirExpression(field.type, `$this->${property}`, context)},`;
      }),
      "    ];",
      "}",
    ].join("\n");
  }

  private renderMakeFromSkirPayload(
    fields: readonly NormalizedField[],
    context: RenderContext,
  ): string {
    return [
      "/** @param array<string, mixed> $data */",
      "public static function makeFromSkirPayload(array $data): self",
      "{",
      "    $payload = [",
      ...fields.map((field) => (
        `        '${field.name}' => ${valueFromSkirPayloadExpression(
          field.type,
          `$data['${field.name}']`,
          context,
          shouldHydrateStructsManually(field.type),
        )},`
      )),
      "    ];",
      "",
      "    return self::factory()->withoutMagicalCreation()->alwaysValidate()->from($payload);",
      "}",
    ].join("\n");
  }

  private renderFromSkir(className: string, denseJson: string): string {
    return [
      `public static function fromSkir(string $json): ${className}`,
      "{",
      `    $data = ${denseJson}::fromJson(self::skirType(), $json);`,
      "",
      "    return self::makeFromSkirPayload($data);",
      "}",
    ].join("\n");
  }

  private renderToSkir(denseJson: string): string {
    return [
      "/** @return array<int, mixed> */",
      "public function toSkir(): array",
      "{",
      `    return ${denseJson}::encode(self::skirType(), $this->toSkirArray());`,
      "}",
    ].join("\n");
  }

  private renderToSkirJson(denseJson: string): string {
    return [
      "public function toSkirJson(): string",
      "{",
      `    return ${denseJson}::toJson(self::skirType(), $this->toSkirArray());`,
      "}",
    ].join("\n");
  }

  private hydrateSkirExpression(
    type: NormalizedType,
    expression: string,
    context: RenderContext,
  ): string {
    if (type.kind === "record") {
      const className = recordTypeClassName(type, context);

      return type.recordType === "enum"
        ? `${className}::fromSkirValue(${expression})`
        : `${className}::makeFromSkirPayload(${expression})`;
    }

    if (type.kind === "optional") {
      if (type.inner.kind === "record" || type.inner.kind === "array") {
        return `${expression} === null ? null : ${this.hydrateSkirExpression(type.inner, expression, context)}`;
      }

      return expression;
    }

    if (type.kind === "array") {
      if (isRecursivelyMappedType(type.item)) {
        return `array_map(fn (mixed $item): mixed => ${this.hydrateSkirExpression(type.item, "$item", context)}, ${expression})`;
      }
    }

    return expression;
  }
}

function nullablePhpType(type: string): string {
  const unionMembers = type.split("|");

  if (type === "mixed" || type.startsWith("?") || unionMembers.includes("null")) {
    return type;
  }

  return unionMembers.length === 1 ? `?${type}` : `${type}|null`;
}

function propertyAttributes(
  field: NormalizedField,
  context: RenderContext,
  dataCollectionOf: string,
  mapInputName: string,
): readonly string[] {
  const attributes: string[] = [];
  const propertyName = toPropertyName(field.name);

  if (propertyName !== field.name) {
    attributes.push(`#[${mapInputName}('${field.name}')]`);
  }

  const collectionClassName = dataCollectionClassName(field.type, context);

  if (collectionClassName !== null) {
    attributes.push(`#[${dataCollectionOf}(${collectionClassName}::class)]`);
  }

  return attributes;
}

function dataCollectionClassName(
  type: NormalizedType,
  context: RenderContext,
): string | null {
  const collectionType = unwrapOptionalType(type);

  if (collectionType.kind !== "array") {
    return null;
  }

  if (collectionType.item.kind !== "record" || collectionType.item.recordType === "enum") {
    return null;
  }

  return recordTypeClassName(collectionType.item, context);
}

function valueFromSkirPayloadExpression(
  type: NormalizedType,
  expression: string,
  context: RenderContext,
  hydrateStructsManually: boolean,
): string {
  if (type.kind === "record") {
    if (type.recordType === "enum") {
      return `${recordTypeClassName(type, context)}::fromSkirValue(${expression})`;
    }

    return hydrateStructsManually
      ? `${recordTypeClassName(type, context)}::makeFromSkirPayload(${expression})`
      : expression;
  }

  if (type.kind === "optional") {
    if (type.inner.kind === "record" || type.inner.kind === "array") {
      return `${expression} === null ? null : ${valueFromSkirPayloadExpression(type.inner, expression, context, hydrateStructsManually)}`;
    }

    return expression;
  }

  if (type.kind === "array") {
    if (isRecursivelyMappedType(type.item)) {
      return `array_map(fn (mixed $item): mixed => ${valueFromSkirPayloadExpression(type.item, "$item", context, hydrateStructsManually)}, ${expression})`;
    }
  }

  return expression;
}

function shouldHydrateStructsManually(type: NormalizedType): boolean {
  const rootType = unwrapOptionalType(type);

  if (rootType.kind === "record") {
    return false;
  }

  if (rootType.kind !== "array") {
    return true;
  }

  return rootType.item.kind !== "record" || rootType.item.recordType === "enum";
}

function unwrapOptionalType(type: NormalizedType): NormalizedType {
  let unwrappedType = type;

  while (unwrappedType.kind === "optional") {
    unwrappedType = unwrappedType.inner;
  }

  return unwrappedType;
}

function isRecursivelyMappedType(type: NormalizedType): boolean {
  return type.kind === "record" || type.kind === "optional" || type.kind === "array";
}

function isStructField(
  field: NormalizedRecord["fields"][number],
): field is NormalizedField {
  return field.kind === "field" && field.hasPayload;
}

function runtimeTypeExpression(
  type: NormalizedType,
  context: RenderContext,
  adapter: LaravelDataTarget,
  typeClass: string,
): string {
  if (type.kind === "array") {
    return `${typeClass}::array(${runtimeTypeExpression(type.item, context, adapter, typeClass)})`;
  }

  if (type.kind === "optional") {
    return `${typeClass}::optional(${runtimeTypeExpression(type.inner, context, adapter, typeClass)})`;
  }

  if (type.kind === "record") {
    return `${adapter.phpType(type, context)}::skirType()`;
  }

  return `${typeClass}::${type.kind}()`;
}

function classNameForRecord(record: NormalizedRecord, context: RenderContext): string {
  const className = context.names.namesByIdentity.get(record.identity);

  if (className === undefined) {
    throw new Error(`No PHP class name was resolved for struct ${record.identity}.`);
  }

  return className;
}

function recordTypeClassName(
  type: Extract<NormalizedType, { readonly kind: "record" }>,
  context: RenderContext,
): string {
  const className = context.names.namesByIdentity.get(type.recordIdentity);

  if (className === undefined) {
    throw new Error(`No PHP class name was resolved for record ${type.recordIdentity}.`);
  }

  const namespace = recordNamespace(type.recordIdentity, context.rootNamespace);

  if (namespace === context.namespace) {
    return className;
  }

  const fullyQualifiedClassName = canonicalRecordClassName(namespace, className);
  const isReserved = [...context.imports.reservedNames].some((reservedName) => (
    reservedName.toLowerCase() === className.toLowerCase()
  ));

  if (isReserved) {
    return `\\${fullyQualifiedClassName}`;
  }

  const existingImport = [...context.imports.imports.entries()]
    .find(([localName]) => localName.toLowerCase() === className.toLowerCase());

  if (existingImport === undefined) {
    return importClassAs(context.imports, fullyQualifiedClassName, className);
  }

  return existingImport[1].toLowerCase() === fullyQualifiedClassName.toLowerCase()
    ? existingImport[0]
    : `\\${fullyQualifiedClassName}`;
}

function fullyQualifiedRecordClassName(
  type: Extract<NormalizedType, { readonly kind: "record" }>,
  context: RenderContext,
): string {
  const className = context.names.namesByIdentity.get(type.recordIdentity);

  if (className === undefined) {
    throw new Error(`No PHP class name was resolved for record ${type.recordIdentity}.`);
  }

  return canonicalRecordClassName(
    recordNamespace(type.recordIdentity, context.rootNamespace),
    className,
  );
}

function canonicalRecordClassName(namespace: string, className: string): string {
  const fullyQualifiedClassName = `${namespace}\\${className}`.replace(/^\\+/u, "");
  const parts = fullyQualifiedClassName.split("\\");

  if (parts.some((part) => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(part))) {
    throw new Error(`Invalid normalized PHP record class name ${fullyQualifiedClassName}.`);
  }

  if (parts.at(-1) !== className) {
    throw new Error(`Invalid normalized PHP record basename ${className}.`);
  }

  return fullyQualifiedClassName;
}

function recordNamespace(recordIdentity: string, rootNamespace: string): string {
  const separatorIndex = recordIdentity.lastIndexOf("::");

  if (separatorIndex === -1) {
    throw new Error(`Invalid normalized record identity ${recordIdentity}.`);
  }

  const modulePath = recordIdentity.slice(0, separatorIndex);
  const namespaceSegments = modulePath
    .split("/")
    .slice(0, -1)
    .map((segment) => toPhpNamespaceSegment(segment))
    .filter((segment) => segment !== "");

  return [rootNamespace, ...namespaceSegments]
    .filter((segment) => segment !== "")
    .join("\\");
}

function outputPath(context: RenderContext, fileName: string): string {
  return context.pathPrefix === "" ? fileName : `${context.pathPrefix}/${fileName}`;
}
