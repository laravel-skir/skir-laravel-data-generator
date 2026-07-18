import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { GENERATOR_MODULE } from "../src/config.js";
import { generateLaravelDataFiles } from "../src/generator.js";
import { LaravelDataTarget } from "../src/target.js";

describe("LaravelDataTarget", () => {
  it("preserves authoritative PHP class names in files, references, and manifests", () => {
    const files = generateLaravelDataFiles({
      config: { namespace: "App\\Skir" },
      modules: [{
        path: "common/models.skir",
        records: [{
          kind: "struct",
          key: "user",
          name: "User",
          phpClassName: "LegacyUser",
          fields: [],
        }, {
          kind: "struct",
          name: "Envelope",
          fields: [{
            kind: "field",
            name: "user",
            number: 1,
            type: { kind: "record", key: "user", recordType: "struct" },
          }],
        }],
        methods: [{
          kind: "method",
          name: "ResolveUser",
          number: 1,
          requestType: { kind: "record", key: "user", recordType: "struct" },
          responseType: { kind: "record", name: "Envelope", recordType: "struct" },
        }],
      }],
    });
    const envelope = fileCode(files, "Common/EnvelopeData.php");
    const manifest = JSON.parse(fileCode(files, "skir-server-manifest.json"));

    expect(files.map((file) => file.path)).toContain("Common/LegacyUser.php");
    expect(files.map((file) => file.path)).not.toContain("Common/LegacyUserData.php");
    expect(envelope).toContain("public LegacyUser $user");
    expect(envelope).toContain("Field::value('user', 1, LegacyUser::skirType())");
    expect(manifest.modules[0].methods[0]).toMatchObject({
      requestType: "App\\Skir\\Common\\LegacyUser",
      requestClass: "App\\Skir\\Common\\LegacyUser",
      responseType: "App\\Skir\\Common\\EnvelopeData",
      responseClass: "App\\Skir\\Common\\EnvelopeData",
    });
  });

  it("preserves authoritative PHP class names in collision fallbacks", () => {
    const commonAddress = {
      ...record("common-address", "RemoteAddress"),
      phpClassName: "AddressData",
    };
    const commonLocation = location(commonAddress, "common/address.skir");
    const files = generateLaravelDataFiles({
      config: { namespace: "App\\Skir" },
      modules: [{ path: "common/address.skir", records: [commonLocation] }, {
        path: "admin/address.skir",
        records: [{
          kind: "struct",
          name: "Address",
          fields: [{
            kind: "field",
            name: "common_address",
            number: 1,
            type: { kind: "record", key: "common-address", recordType: "struct" },
          }],
        }],
        methods: [{
          kind: "method",
          name: "ResolveAddress",
          number: 1,
          requestType: { kind: "record", key: "common-address", recordType: "struct" },
          responseType: "bool",
        }],
      }],
      recordMap: new Map([["common-address", commonLocation]]),
    });
    const localAddress = fileCode(files, "Admin/AddressData.php");
    const manifest = JSON.parse(fileCode(files, "skir-server-manifest.json"));

    expect(files.map((file) => file.path)).toContain("Common/AddressData.php");
    expect(localAddress).not.toContain("use App\\Skir\\Common\\AddressData;");
    expect(localAddress).toContain("public \\App\\Skir\\Common\\AddressData $commonAddress");
    expect(manifest.modules[0].methods[0]).toMatchObject({
      requestType: "App\\Skir\\Common\\AddressData",
      requestClass: "App\\Skir\\Common\\AddressData",
    });
  });

  it("preplans struct runtime imports that collide with emitted class names", () => {
    const files = generateLaravelDataFiles({
      config: { namespace: "App\\Skir" },
      modules: [{
        path: "collisions.skir",
        records: [{
          kind: "struct",
          name: "RuntimeData",
          phpClassName: "Data",
          fields: [],
        }, {
          kind: "struct",
          key: "child",
          name: "Child",
          fields: [],
        }, {
          kind: "struct",
          name: "CollectionAttribute",
          phpClassName: "DataCollectionOf",
          fields: [{
            kind: "field",
            name: "children",
            number: 1,
            type: {
              kind: "array",
              item: { kind: "record", key: "child", recordType: "struct" },
            },
          }],
        }, {
          kind: "struct",
          name: "MapAttribute",
          phpClassName: "MapInputName",
          fields: [{ kind: "field", name: "user_id", number: 1, type: "int32" }],
        }],
      }],
    });
    const collisionFiles = [
      fileCode(files, "Data.php"),
      fileCode(files, "DataCollectionOf.php"),
      fileCode(files, "MapInputName.php"),
    ];

    for (const code of collisionFiles) {
      const dataImport = code.match(/use Spatie\\LaravelData\\Data as ([A-Za-z_][A-Za-z0-9_]*);/u);

      expect(dataImport).not.toBeNull();
      expect(code).toContain(`extends ${dataImport?.[1]}`);
      lintPhp(code);
    }

    expect(collisionFiles[1]).toMatch(
      /use Spatie\\LaravelData\\Attributes\\DataCollectionOf as [A-Za-z_][A-Za-z0-9_]*;/u,
    );
    expect(collisionFiles[2]).toMatch(
      /use Spatie\\LaravelData\\Attributes\\MapInputName as [A-Za-z_][A-Za-z0-9_]*;/u,
    );
  });

  it("hydrates nullable-item and nested struct arrays manually without unsupported collection metadata", () => {
    const files = generateLaravelDataFiles({
      config: { namespace: "App\\Skir" },
      modules: [{
        path: "collections.skir",
        records: [{
          kind: "struct",
          key: "child",
          name: "Child",
          fields: [{ kind: "field", name: "value", number: 1, type: "string" }],
        }, {
          kind: "struct",
          name: "CollectionEnvelope",
          fields: [{
            kind: "field",
            name: "direct_children",
            number: 1,
            type: arrayOf(recordReference("child")),
          }, {
            kind: "field",
            name: "optional_children",
            number: 2,
            type: optional(arrayOf(recordReference("child"))),
          }, {
            kind: "field",
            name: "nullable_children",
            number: 3,
            type: arrayOf(optional(recordReference("child"))),
          }, {
            kind: "field",
            name: "nested_children",
            number: 4,
            type: arrayOf(arrayOf(recordReference("child"))),
          }, {
            kind: "field",
            name: "optional_nested_children",
            number: 5,
            type: optional(arrayOf(arrayOf(recordReference("child")))),
          }],
        }],
      }],
    });
    const envelope = fileCode(files, "CollectionEnvelopeData.php");

    expect(envelope).toContain(
      "#[MapInputName('direct_children')]\n        #[DataCollectionOf(ChildData::class)]\n        public array $directChildren,",
    );
    expect(envelope).toContain(
      "#[MapInputName('optional_children')]\n        #[DataCollectionOf(ChildData::class)]\n        public ?array $optionalChildren,",
    );
    expect(envelope).toContain(
      "#[MapInputName('nullable_children')]\n        public array $nullableChildren,",
    );
    expect(envelope).toContain(
      "#[MapInputName('nested_children')]\n        public array $nestedChildren,",
    );
    expect(envelope).toContain(
      "#[MapInputName('optional_nested_children')]\n        public ?array $optionalNestedChildren,",
    );
    expect(envelope).toContain(
      "'direct_children' => array_map(fn (mixed $item): mixed => $item, $data['direct_children'])",
    );
    expect(envelope).toContain(
      "'optional_children' => $data['optional_children'] === null ? null : array_map(fn (mixed $item): mixed => $item, $data['optional_children'])",
    );
    expect(envelope).toContain(
      "'nullable_children' => array_map(fn (mixed $item): mixed => $item === null ? null : ChildData::makeFromSkirPayload($item), $data['nullable_children'])",
    );
    expect(envelope).toContain(
      "'nested_children' => array_map(fn (mixed $item): mixed => array_map(fn (mixed $item): mixed => ChildData::makeFromSkirPayload($item), $item), $data['nested_children'])",
    );
    expect(envelope).toContain(
      "'optional_nested_children' => $data['optional_nested_children'] === null ? null : array_map(fn (mixed $item): mixed => array_map(fn (mixed $item): mixed => ChildData::makeFromSkirPayload($item), $item), $data['optional_nested_children'])",
    );
    expect(envelope).toContain(
      "'nullable_children' => array_map(fn (mixed $item): mixed => $item === null ? null : $item->toSkirArray(), $this->nullableChildren)",
    );
    expect(envelope).toContain(
      "'nested_children' => array_map(fn (mixed $item): mixed => array_map(fn (mixed $item): mixed => $item->toSkirArray(), $item), $this->nestedChildren)",
    );
    expect(envelope).toContain(
      "return self::factory()->withoutMagicalCreation()->alwaysValidate()->from($payload);",
    );
    expect(envelope).not.toContain(
      "#[MapInputName('nullable_children')]\n        #[DataCollectionOf(ChildData::class)]",
    );
    expect(envelope).not.toContain("#[DataCollectionOf(array::class)]");
    expect(envelope).not.toContain("$this->nestedChildren->toSkirArray()");
  });

  it("preserves Laravel Data rendering, hydration, conversions, and manifest classes", () => {
    const files = generateLaravelDataFiles({
      config: { namespace: "App\\Skir" },
      modules: [{
        path: "models/types.skir",
        records: [{
          kind: "struct",
          key: "child",
          name: "Child",
          fields: [{ kind: "field", name: "value", number: 1, type: "string" }],
        }, {
          kind: "struct",
          key: "existing-data",
          name: "ExistingData",
          fields: [],
        }, {
          kind: "enum",
          key: "status",
          name: "Status",
          fields: [{ kind: "field", name: "ready", number: 1 }],
        }, {
          kind: "struct",
          key: "payload",
          name: "Payload",
          removedNumbers: [9],
          fields: [{
            kind: "field",
            name: "user_id",
            number: 1,
            type: "int64",
          }, {
            kind: "field",
            name: "checksum",
            number: 2,
            type: "hash64",
          }, {
            kind: "field",
            name: "created_at",
            number: 3,
            type: "timestamp",
          }, {
            kind: "field",
            name: "blob",
            number: 4,
            type: "bytes",
          }, {
            kind: "field",
            name: "children",
            number: 5,
            type: {
              kind: "array",
              item: { kind: "record", key: "child", recordType: "struct" },
            },
          }, {
            kind: "field",
            name: "statuses",
            number: 6,
            type: {
              kind: "optional",
              other: {
                kind: "array",
                item: {
                  kind: "array",
                  item: { kind: "record", key: "status", recordType: "enum" },
                },
              },
            },
          }],
        }],
        methods: [{
          kind: "method",
          name: "Exchange",
          number: 1,
          requestType: { kind: "record", key: "payload", recordType: "struct" },
          responseType: {
            kind: "optional",
            other: { kind: "record", key: "payload", recordType: "struct" },
          },
        }],
      }],
    });
    const payload = fileCode(files, "Models/PayloadData.php");
    const existingData = fileCode(files, "Models/ExistingData.php");
    const client = fileCode(files, "Models/SkirRpcClient.php");
    const provider = fileCode(files, "Models/SkirProcedureProvider.php");
    const manifest = JSON.parse(fileCode(files, "skir-server-manifest.json"));
    const php = files.filter((file) => file.path.endsWith(".php"))
      .map((file) => file.code)
      .join("\n");

    expect(new LaravelDataTarget().id).toBe(GENERATOR_MODULE);
    expect(payload).toContain("final class PayloadData extends Data");
    expect(existingData).toContain("final class ExistingData extends Data");
    expect(files.map((file) => file.path)).not.toContain("Models/ExistingDataData.php");
    expect(payload).toContain("#[MapInputName('user_id')]");
    expect(payload).toContain("#[DataCollectionOf(ChildData::class)]");
    expect(payload).toContain("public int|string $userId");
    expect(payload).toContain("public int|string $checksum");
    expect(payload).toContain("public int $createdAt");
    expect(payload).toContain("public string $blob");
    expect(payload).toContain("Field::removed(9)");
    expect(payload).toContain("public function toSkirArray(): array");
    expect(payload).toContain("public static function makeFromSkirPayload(array $data): self");
    expect(payload).toContain("public static function fromSkir(string $json): PayloadData");
    expect(payload).toContain("public function toSkir(): array");
    expect(payload).toContain("public function toSkirJson(): string");
    expect(payload).toContain(
      "'statuses' => $this->statuses === null ? null : array_map(fn (mixed $item): mixed => array_map(fn (mixed $item): mixed => $item->toSkirValue(), $item), $this->statuses)",
    );
    expect(client).toContain("$this->client->invoke(SkirMethods::exchange(), $request->toSkirArray())");
    expect(client).toContain("return $response === null ? null : PayloadData::makeFromSkirPayload($response);");
    expect(provider).toContain("PayloadData::makeFromSkirPayload($request)");
    expect(provider).toContain("return $response === null ? null : $response->toSkirArray();");
    expect(manifest.modules[0].methods[0]).toMatchObject({
      requestClass: "App\\Skir\\Models\\PayloadData",
      responseClass: "App\\Skir\\Models\\PayloadData",
    });
    expect(php).not.toMatch(/Validation|WithValidation|rules\(\)|Required|Nullable/u);
  });

  it("preserves local and two-external same-basename collision fallbacks", () => {
    const commonAddress = record("common-address", "Address");
    const billingAddress = record("billing-address", "Address");
    const commonLocation = location(commonAddress, "common/address.skir");
    const billingLocation = location(billingAddress, "billing/address.skir");
    const files = generateLaravelDataFiles({
      config: { namespace: "App\\Skir" },
      modules: [{ path: "common/address.skir", records: [commonLocation] }, {
        path: "billing/address.skir",
        records: [billingLocation],
      }, {
        path: "admin/order.skir",
        records: [{
          kind: "struct",
          name: "Order",
          fields: [{
            kind: "field",
            name: "shipping_address",
            number: 1,
            type: { kind: "record", key: "common-address", recordType: "struct" },
          }, {
            kind: "field",
            name: "billing_address",
            number: 2,
            type: { kind: "record", key: "billing-address", recordType: "struct" },
          }],
        }],
      }, {
        path: "admin/address.skir",
        records: [{
          kind: "struct",
          name: "Address",
          fields: [{
            kind: "field",
            name: "common_address",
            number: 1,
            type: { kind: "record", key: "common-address", recordType: "struct" },
          }],
        }],
      }],
      recordMap: new Map([
        ["common-address", commonLocation],
        ["billing-address", billingLocation],
      ]),
    });
    const order = fileCode(files, "Admin/OrderData.php");
    const localAddress = fileCode(files, "Admin/AddressData.php");

    expect(order).toContain("use App\\Skir\\Common\\AddressData;");
    expect(order).not.toContain("use App\\Skir\\Billing\\AddressData");
    expect(order).toContain("public AddressData $shippingAddress");
    expect(order).toContain("public \\App\\Skir\\Billing\\AddressData $billingAddress");
    expect(localAddress).not.toContain("use App\\Skir\\Common\\AddressData");
    expect(localAddress).toContain("public \\App\\Skir\\Common\\AddressData $commonAddress");
  });

  it("renders valid nullable unions across Data structs and RPC signatures", () => {
    const files = generateNullableTypeFiles();
    const values = fileCode(files, "Models/NullableValuesData.php");
    const rpc = files.filter((file) => file.path.startsWith("Models/Skir"))
      .map((file) => file.code)
      .join("\n");
    const php = files.filter((file) => file.path.endsWith(".php"))
      .map((file) => file.code)
      .join("\n");

    expect(values).toContain("public int|string|null $optionalInt64");
    expect(values).toContain("public int|string|null $optionalHash64");
    expect(values).toContain("public mixed $optionalMixed");
    expect(values).toContain("public int|string|null $nestedOptionalInt64");
    expect(values).toContain("public ?string $optionalString");
    expect(values).toContain("public ?array $optionalStrings");
    expect(values).toContain("public ?MarkerData $optionalMarker");
    expect(rpc).toContain("echoInt64(int|string|null $request): int|string|null");
    expect(rpc).toContain("echoMixed(mixed $request): mixed");
    expect(rpc).toContain("echoNested(int|string|null $request): int|string|null");
    expect(php).not.toMatch(/\?int\|string|\?mixed|\?\?|null\|null/u);
  });

  const phpProbe = spawnSync("php", ["-v"], { stdio: "ignore" });
  const phpUnavailable = phpProbe.error !== undefined
    && "code" in phpProbe.error
    && phpProbe.error.code === "ENOENT";
  const phpLintIt = phpUnavailable ? it.skip : it;

  phpLintIt("passes php -l for generated nullable Data and RPC files", () => {
    const outputPath = mkdtempSync(join(tmpdir(), "skir-laravel-data-nullable-"));

    try {
      for (const file of generateNullableTypeFiles().filter((file) => file.path.endsWith(".php"))) {
        const filePath = join(outputPath, file.path);

        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, file.code);
        execFileSync("php", ["-l", filePath], { stdio: "pipe" });
      }
    } finally {
      rmSync(outputPath, { recursive: true, force: true });
    }
  });
});

function generateNullableTypeFiles() {
  const marker = record("marker", "Marker");
  const nullableValues = {
    kind: "record" as const,
    key: "nullable-values",
    name: "NullableValues",
    recordType: "struct" as const,
    fields: [{
      kind: "field" as const,
      name: "optional_int64",
      number: 1,
      type: optional("int64"),
    }, {
      kind: "field" as const,
      name: "optional_hash64",
      number: 2,
      type: optional("hash64"),
    }, {
      kind: "field" as const,
      name: "optional_mixed",
      number: 3,
      type: optional("mixed"),
    }, {
      kind: "field" as const,
      name: "nested_optional_int64",
      number: 4,
      type: optional(optional("int64")),
    }, {
      kind: "field" as const,
      name: "optional_string",
      number: 5,
      type: optional("string"),
    }, {
      kind: "field" as const,
      name: "optional_strings",
      number: 6,
      type: optional({ kind: "array", item: "string" }),
    }, {
      kind: "field" as const,
      name: "optional_marker",
      number: 7,
      type: optional({ kind: "record", key: "marker", recordType: "struct" as const }),
    }],
  };
  const markerLocation = location(marker, "models/types.skir");
  const valuesLocation = location(nullableValues, "models/types.skir");

  return generateLaravelDataFiles({
    config: { namespace: "App\\Skir" },
    modules: [{
      path: "models/types.skir",
      records: [markerLocation, valuesLocation],
      methods: [{
        kind: "method",
        name: "EchoInt64",
        number: 1,
        requestType: optional("int64"),
        responseType: optional("hash64"),
      }, {
        kind: "method",
        name: "EchoMixed",
        number: 2,
        requestType: optional("mixed"),
        responseType: optional(optional("mixed")),
      }, {
        kind: "method",
        name: "EchoNested",
        number: 3,
        requestType: optional(optional("int64")),
        responseType: optional(optional("hash64")),
      }],
    }],
    recordMap: new Map([
      ["marker", markerLocation],
      ["nullable-values", valuesLocation],
    ]),
  });
}

function record(key: string, name: string) {
  return {
    kind: "record" as const,
    key,
    name,
    recordType: "struct" as const,
    fields: [],
  };
}

function location<SkirRecord extends ReturnType<typeof record> | Record<string, unknown>>(
  skirRecord: SkirRecord,
  modulePath: string,
) {
  return {
    kind: "record-location" as const,
    record: skirRecord,
    recordAncestors: [skirRecord],
    modulePath,
  };
}

function optional<Type>(other: Type) {
  return { kind: "optional" as const, other };
}

function arrayOf<Type>(item: Type) {
  return { kind: "array" as const, item };
}

function recordReference(key: string) {
  return { kind: "record" as const, key, recordType: "struct" as const };
}

function lintPhp(code: string): void {
  const outputPath = mkdtempSync(join(tmpdir(), "skir-laravel-data-lint-"));
  const filePath = join(outputPath, "Generated.php");

  try {
    writeFileSync(filePath, code);
    execFileSync("php", ["-l", filePath], { stdio: "pipe" });
  } finally {
    rmSync(outputPath, { recursive: true, force: true });
  }
}

function fileCode(
  files: readonly { readonly path: string; readonly code: string }[],
  path: string,
): string {
  return files.find((file) => file.path === path)?.code ?? "";
}
