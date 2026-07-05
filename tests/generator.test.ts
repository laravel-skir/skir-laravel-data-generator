import { describe, expect, it } from "vitest";

import { generateLaravelDataFiles } from "../src/generator.js";

describe("generateLaravelDataFiles", () => {
  it("generates a Laravel Data class for a Skir struct", () => {
    const files = generateLaravelDataFiles({
      config: {
        namespace: "App\\Skir",
      },
      modules: [
        {
          path: "user.skir",
          records: [
            {
              kind: "struct",
              name: "User",
              fields: [
                { kind: "field", name: "user_id", number: 0, type: { kind: "int32" } },
                { kind: "removed", number: 1 },
                { kind: "field", name: "name", number: 2, type: { kind: "string" } },
              ],
            },
          ],
        },
      ],
    });

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("UserData.php");
    expect(files[0]?.code).toContain("namespace App\\Skir;");
    expect(files[0]?.code).toContain("use Spatie\\LaravelData\\Data;");
    expect(files[0]?.code).toContain("final class UserData extends Data");
    expect(files[0]?.code).toContain("#[MapInputName('user_id')]");
    expect(files[0]?.code).toContain("public int $userId");
    expect(files[0]?.code).toContain("public string $name");
    expect(files[0]?.code).toContain("Field::removed(1)");
    expect(files[0]?.code).toContain("public static function fromSkir(string $json): UserData");
    expect(files[0]?.code).toContain("return self::factory()->withoutMagicalCreation()->alwaysValidate()->from($payload);");
    expect(files[0]?.code).toContain("DenseJson::toJson(self::skirType(), $this->toSkirArray())");
  });

  it("generates instantiable Laravel Data classes for empty Skir structs", () => {
    const files = generateLaravelDataFiles({
      config: {
        namespace: "App\\Skir",
      },
      modules: [
        {
          path: "health.skir",
          records: [
            {
              kind: "struct",
              name: "HealthCheckRequest",
              fields: [],
            },
          ],
        },
      ],
    });

    expect(files[0]?.path).toBe("HealthCheckRequestData.php");
    expect(files[0]?.code).toContain("final class HealthCheckRequestData extends Data");
    expect(files[0]?.code).not.toContain("__construct");
  });

  it("generates a PHP wrapper class for a Skir enum", () => {
    const files = generateLaravelDataFiles({
      config: {
        namespace: "App\\Skir",
      },
      modules: [
        {
          path: "subscription-status.skir",
          records: [
            {
              recordType: "enum",
              name: "SubscriptionStatus",
              fields: [
                { kind: "field", name: "free", number: 1 },
                { kind: "field", name: "premium_since", number: 2, type: { kind: "timestamp" } },
              ],
              removedNumbers: [3],
            },
          ],
        },
      ],
    });

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("SubscriptionStatusData.php");
    expect(files[0]?.code).toContain("final readonly class SubscriptionStatusData");
    expect(files[0]?.code).toContain("public static function free(): self");
    expect(files[0]?.code).toContain("public static function premiumSince(int $value): self");
    expect(files[0]?.code).toContain("Variant::constant('free', 1)");
    expect(files[0]?.code).toContain("Variant::wrapper('premium_since', 2, Type::timestamp())");
    expect(files[0]?.code).toContain("EnumValue::wrapper('premium_since', $value)");
    expect(files[0]?.code).toContain("public function toSkirValue(): EnumValue");
    expect(files[0]?.code).toContain("public static function fromSkirValue(EnumValue $value): SubscriptionStatusData");
    expect(files[0]?.code).toContain("public function toDenseValue(): int|array");
    expect(files[0]?.code).toContain("public static function fromDenseValue(int|array $value): SubscriptionStatusData");
  });

  it("generates PHP method descriptors for SkirRPC methods", () => {
    const files = generateLaravelDataFiles({
      config: {
        namespace: "App\\Skir",
      },
      modules: [
        {
          path: "users.skir",
          records: [
            {
              kind: "struct",
              name: "GetUserRequest",
              fields: [
                { kind: "field", name: "user_id", number: 0, type: { kind: "int32" } },
              ],
            },
            {
              kind: "struct",
              name: "User",
              fields: [
                { kind: "field", name: "name", number: 0, type: { kind: "string" } },
              ],
            },
          ],
          methods: [
            {
              kind: "method",
              name: "GetUser",
              number: 3180856469,
              requestType: { kind: "record", name: "GetUserRequest" },
              responseType: { kind: "record", name: "User" },
            },
          ],
        },
      ],
    });

    const methodFile = files.find((file) => file.path === "SkirMethods.php");

    expect(methodFile?.code).toContain("use LaravelSkir\\Runtime\\MethodDescriptor;");
    expect(methodFile?.code).toContain("public static function getUser(): MethodDescriptor");
    expect(methodFile?.code).toContain("name: 'GetUser'");
    expect(methodFile?.code).toContain("number: 3180856469");
    expect(methodFile?.code).toContain("requestType: GetUserRequestData::skirType()");
    expect(methodFile?.code).toContain("responseType: UserData::skirType()");
  });

  it("uses module directories as PHP subnamespaces and output directories", () => {
    const files = generateLaravelDataFiles({
      config: {
        namespace: "App\\Skir",
      },
      modules: [
        {
          path: "admin/users.skir",
          records: [
            {
              kind: "struct",
              name: "GetUserRequest",
              fields: [
                { kind: "field", name: "user_id", number: 0, type: { kind: "int32" } },
              ],
            },
            {
              kind: "struct",
              name: "User",
              fields: [
                { kind: "field", name: "name", number: 0, type: { kind: "string" } },
              ],
            },
          ],
          methods: [
            {
              kind: "method",
              name: "GetUser",
              number: 3180856469,
              requestType: { kind: "record", name: "GetUserRequest" },
              responseType: { kind: "record", name: "User" },
            },
          ],
        },
      ],
    });

    const userFile = files.find((file) => file.path === "Admin/UserData.php");
    const requestFile = files.find((file) => file.path === "Admin/GetUserRequestData.php");
    const methodsFile = files.find((file) => file.path === "Admin/SkirMethods.php");

    expect(userFile?.code).toContain("namespace App\\Skir\\Admin;");
    expect(requestFile?.code).toContain("namespace App\\Skir\\Admin;");
    expect(methodsFile?.code).toContain("namespace App\\Skir\\Admin;");
    expect(methodsFile?.code).toContain("requestType: GetUserRequestData::skirType()");
    expect(methodsFile?.code).toContain("responseType: UserData::skirType()");
  });

  it("qualifies record references from other module namespaces", () => {
    const addressRecord = {
      kind: "record",
      recordType: "struct" as const,
      name: "Address",
      fields: [
        { kind: "field" as const, name: "city", number: 0, type: { kind: "primitive", primitive: "string" } },
      ],
    };

    const files = generateLaravelDataFiles({
      config: {
        namespace: "App\\Skir",
      },
      recordMap: new Map([
        [
          "common/address.skir:0",
          {
            kind: "record-location",
            record: addressRecord,
            recordAncestors: [addressRecord],
            modulePath: "common/address.skir",
          },
        ],
      ]),
      modules: [
        {
          path: "admin/users.skir",
          records: [
            {
              kind: "struct",
              name: "User",
              fields: [
                {
                  kind: "field",
                  name: "address",
                  number: 0,
                  type: {
                    kind: "record",
                    key: "common/address.skir:0",
                    nameParts: [{ token: { text: "Address" } }],
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const userFile = files.find((file) => file.path === "Admin/UserData.php");

    expect(userFile?.code).toContain("use App\\Skir\\Common\\AddressData;");
    expect(userFile?.code).toContain("public AddressData $address");
    expect(userFile?.code).toContain("Field::value('address', 0, AddressData::skirType())");
    expect(userFile?.code).toContain("'address' => $data['address']");
    expect(userFile?.code).not.toContain("\\App\\Skir\\Common\\AddressData");
  });

  it("keeps fully qualified record references when an import would collide", () => {
    const addressRecord = {
      kind: "record",
      recordType: "struct" as const,
      name: "Address",
      fields: [
        { kind: "field" as const, name: "city", number: 0, type: { kind: "primitive", primitive: "string" } },
      ],
    };

    const files = generateLaravelDataFiles({
      config: {
        namespace: "App\\Skir",
      },
      recordMap: new Map([
        [
          "common/address.skir:0",
          {
            kind: "record-location",
            record: addressRecord,
            recordAncestors: [addressRecord],
            modulePath: "common/address.skir",
          },
        ],
      ]),
      modules: [
        {
          path: "admin/address.skir",
          records: [
            {
              kind: "struct",
              name: "Address",
              fields: [
                {
                  kind: "field",
                  name: "billing_address",
                  number: 0,
                  type: {
                    kind: "record",
                    key: "common/address.skir:0",
                    nameParts: [{ token: { text: "Address" } }],
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const addressFile = files.find((file) => file.path === "Admin/AddressData.php");

    expect(addressFile?.code).not.toContain("use App\\Skir\\Common\\AddressData;");
    expect(addressFile?.code).toContain("public \\App\\Skir\\Common\\AddressData $billingAddress");
    expect(addressFile?.code).toContain("Field::value('billing_address', 0, \\App\\Skir\\Common\\AddressData::skirType())");
  });

  it("disambiguates duplicate class names in the same PHP namespace", () => {
    const usersUserRecord = {
      kind: "record",
      key: "admin/users.skir:0",
      recordType: "struct" as const,
      name: "User",
      fields: [
        { kind: "field" as const, name: "email", number: 0, type: { kind: "primitive", primitive: "string" } },
      ],
    };

    const profilesUserRecord = {
      kind: "record",
      key: "admin/profiles.skir:0",
      recordType: "struct" as const,
      name: "User",
      fields: [
        { kind: "field" as const, name: "display_name", number: 0, type: { kind: "primitive", primitive: "string" } },
      ],
    };

    const auditRecord = {
      kind: "record",
      key: "admin/audits.skir:0",
      recordType: "struct" as const,
      name: "Audit",
      fields: [
        {
          kind: "field" as const,
          name: "actor",
          number: 0,
          type: {
            kind: "record",
            key: "admin/users.skir:0",
            nameParts: [{ token: { text: "User" } }],
          },
        },
      ],
    };

    const files = generateLaravelDataFiles({
      config: {
        namespace: "App\\Skir",
      },
      recordMap: new Map([
        [
          "admin/users.skir:0",
          {
            kind: "record-location",
            record: usersUserRecord,
            recordAncestors: [usersUserRecord],
            modulePath: "admin/users.skir",
          },
        ],
        [
          "admin/profiles.skir:0",
          {
            kind: "record-location",
            record: profilesUserRecord,
            recordAncestors: [profilesUserRecord],
            modulePath: "admin/profiles.skir",
          },
        ],
        [
          "admin/audits.skir:0",
          {
            kind: "record-location",
            record: auditRecord,
            recordAncestors: [auditRecord],
            modulePath: "admin/audits.skir",
          },
        ],
      ]),
      modules: [
        {
          path: "admin/users.skir",
          records: [
            {
              kind: "record-location",
              record: usersUserRecord,
              recordAncestors: [usersUserRecord],
              modulePath: "admin/users.skir",
            },
          ],
        },
        {
          path: "admin/profiles.skir",
          records: [
            {
              kind: "record-location",
              record: profilesUserRecord,
              recordAncestors: [profilesUserRecord],
              modulePath: "admin/profiles.skir",
            },
          ],
        },
        {
          path: "admin/audits.skir",
          records: [
            {
              kind: "record-location",
              record: auditRecord,
              recordAncestors: [auditRecord],
              modulePath: "admin/audits.skir",
            },
          ],
        },
      ],
    });

    const usersUserFile = files.find((file) => file.path === "Admin/UsersUserData.php");
    const profilesUserFile = files.find((file) => file.path === "Admin/ProfilesUserData.php");
    const auditFile = files.find((file) => file.path === "Admin/AuditData.php");

    expect(files.map((file) => file.path)).not.toContain("Admin/UserData.php");
    expect(usersUserFile?.code).toContain("final class UsersUserData extends Data");
    expect(profilesUserFile?.code).toContain("final class ProfilesUserData extends Data");
    expect(auditFile?.code).toContain("public UsersUserData $actor");
    expect(auditFile?.code).toContain("Field::value('actor', 0, UsersUserData::skirType())");
  });

  it("types and normalizes generated record fields", () => {
    const files = generateLaravelDataFiles({
      config: {
        namespace: "App\\Skir",
      },
      modules: [
        {
          path: "user.skir",
          records: [
            {
              kind: "struct",
              name: "Address",
              fields: [
                { kind: "field", name: "city", number: 0, type: { kind: "string" } },
              ],
            },
            {
              kind: "struct",
              name: "User",
              fields: [
                { kind: "field", name: "address", number: 0, type: { kind: "record", name: "Address" } },
              ],
            },
          ],
        },
      ],
    });

    const userFile = files.find((file) => file.path === "UserData.php");

    expect(userFile?.code).toContain("public AddressData $address");
    expect(userFile?.code).toContain("'address' => $this->address->toSkirArray()");
    expect(userFile?.code).toContain("'address' => $data['address']");
  });

  it("normalizes generated enum fields through Skir runtime values", () => {
    const files = generateLaravelDataFiles({
      config: {
        namespace: "App\\Skir",
      },
      modules: [
        {
          path: "user.skir",
          records: [
            {
              recordType: "enum",
              name: "SubscriptionStatus",
              fields: [
                { kind: "field", name: "free", number: 1 },
              ],
            },
            {
              kind: "struct",
              name: "User",
              fields: [
                { kind: "field", name: "subscription_status", number: 0, type: { kind: "record", name: "SubscriptionStatus", recordType: "enum" } },
              ],
            },
          ],
        },
      ],
    });

    const userFile = files.find((file) => file.path === "UserData.php");

    expect(userFile?.code).toContain("'subscription_status' => $this->subscriptionStatus->toSkirValue()");
    expect(userFile?.code).toContain("'subscription_status' => SubscriptionStatusData::fromSkirValue($data['subscription_status'])");
    expect(userFile?.code).not.toContain("$this->subscriptionStatus->toArray()");
    expect(userFile?.code).not.toContain("SubscriptionStatusData::fromArray($data['subscription_status'])");
  });

  it("normalizes optional generated enum fields through Skir runtime values", () => {
    const files = generateLaravelDataFiles({
      config: {
        namespace: "App\\Skir",
      },
      modules: [
        {
          path: "user.skir",
          records: [
            {
              recordType: "enum",
              name: "SubscriptionStatus",
              fields: [
                { kind: "field", name: "free", number: 1 },
              ],
            },
            {
              kind: "struct",
              name: "User",
              fields: [
                {
                  kind: "field",
                  name: "subscription_status",
                  number: 0,
                  type: {
                    kind: "optional",
                    other: {
                      kind: "record",
                      name: "SubscriptionStatus",
                      recordType: "enum",
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const userFile = files.find((file) => file.path === "UserData.php");

    expect(userFile?.code).toContain("'subscription_status' => $this->subscriptionStatus === null ? null : $this->subscriptionStatus->toSkirValue()");
    expect(userFile?.code).toContain("'subscription_status' => $data['subscription_status'] === null ? null : SubscriptionStatusData::fromSkirValue($data['subscription_status'])");
    expect(userFile?.code).not.toContain("$this->subscriptionStatus->toArray()");
    expect(userFile?.code).not.toContain("SubscriptionStatusData::fromArray($data['subscription_status'])");
  });

  it("flattens nested Skir record locations into stable PHP class names", () => {
    const envelopeRecord = {
      kind: "record",
      recordType: "struct" as const,
      name: "Envelope",
      fields: [
        {
          kind: "field" as const,
          name: "metadata",
          number: 0,
          type: {
            kind: "record",
            nameParts: [
              { token: { text: "Envelope" } },
              { token: { text: "Metadata" } },
            ],
          },
        },
      ],
    };

    const metadataRecord = {
      kind: "record",
      recordType: "struct" as const,
      name: "Metadata",
      fields: [
        { kind: "field" as const, name: "trace_id", number: 0, type: { kind: "string" } },
      ],
    };

    const files = generateLaravelDataFiles({
      config: {
        namespace: "App\\Skir",
      },
      modules: [
        {
          path: "envelope.skir",
          records: [
            {
              kind: "record-location",
              record: metadataRecord,
              recordAncestors: [envelopeRecord, metadataRecord],
            },
            {
              kind: "record-location",
              record: envelopeRecord,
              recordAncestors: [envelopeRecord],
            },
          ],
        },
      ],
    });

    const envelopeFile = files.find((file) => file.path === "EnvelopeData.php");
    const metadataFile = files.find((file) => file.path === "EnvelopeMetadataData.php");

    expect(metadataFile?.code).toContain("final class EnvelopeMetadataData extends Data");
    expect(envelopeFile?.code).toContain("public EnvelopeMetadataData $metadata");
    expect(envelopeFile?.code).toContain("Field::value('metadata', 0, EnvelopeMetadataData::skirType())");
    expect(envelopeFile?.code).toContain("'metadata' => $data['metadata']");
  });
});
