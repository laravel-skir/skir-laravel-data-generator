import { describe, expect, it } from "vitest";

import { generatePhpFiles } from "../src/generator.js";

describe("generatePhpFiles", () => {
  it("generates a PHP readonly class for a Skir struct", () => {
    const files = generatePhpFiles({
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
    expect(files[0]?.path).toBe("User.php");
    expect(files[0]?.code).toContain("namespace App\\Skir;");
    expect(files[0]?.code).toContain("final readonly class User");
    expect(files[0]?.code).toContain("public int $userId");
    expect(files[0]?.code).toContain("public string $name");
    expect(files[0]?.code).toContain("Field::removed(1)");
    expect(files[0]?.code).toContain("DenseJson::toJson(self::skirType(), $this->toArray())");
  });

  it("generates a PHP readonly class for a Skir enum", () => {
    const files = generatePhpFiles({
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
    expect(files[0]?.path).toBe("SubscriptionStatus.php");
    expect(files[0]?.code).toContain("final readonly class SubscriptionStatus");
    expect(files[0]?.code).toContain("public static function free(): self");
    expect(files[0]?.code).toContain("public static function premiumSince(int $value): self");
    expect(files[0]?.code).toContain("Variant::constant('free', 1)");
    expect(files[0]?.code).toContain("Variant::wrapper('premium_since', 2, Type::timestamp())");
    expect(files[0]?.code).toContain("EnumValue::wrapper('premium_since', $value)");
  });

  it("generates PHP method descriptors for SkirRPC methods", () => {
    const files = generatePhpFiles({
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
    expect(methodFile?.code).toContain("requestType: GetUserRequest::skirType()");
    expect(methodFile?.code).toContain("responseType: User::skirType()");
  });

  it("uses module directories as PHP subnamespaces and output directories", () => {
    const files = generatePhpFiles({
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

    const userFile = files.find((file) => file.path === "Admin/User.php");
    const requestFile = files.find((file) => file.path === "Admin/GetUserRequest.php");
    const methodsFile = files.find((file) => file.path === "Admin/SkirMethods.php");

    expect(userFile?.code).toContain("namespace App\\Skir\\Admin;");
    expect(requestFile?.code).toContain("namespace App\\Skir\\Admin;");
    expect(methodsFile?.code).toContain("namespace App\\Skir\\Admin;");
    expect(methodsFile?.code).toContain("requestType: GetUserRequest::skirType()");
    expect(methodsFile?.code).toContain("responseType: User::skirType()");
  });

  it("types and normalizes generated record fields", () => {
    const files = generatePhpFiles({
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

    const userFile = files.find((file) => file.path === "User.php");

    expect(userFile?.code).toContain("public Address $address");
    expect(userFile?.code).toContain("'address' => $this->address->toArray()");
    expect(userFile?.code).toContain("address: Address::fromArray($data['address'])");
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

    const files = generatePhpFiles({
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

    const envelopeFile = files.find((file) => file.path === "Envelope.php");
    const metadataFile = files.find((file) => file.path === "EnvelopeMetadata.php");

    expect(metadataFile?.code).toContain("final readonly class EnvelopeMetadata");
    expect(envelopeFile?.code).toContain("public EnvelopeMetadata $metadata");
    expect(envelopeFile?.code).toContain("Field::value('metadata', 0, EnvelopeMetadata::skirType())");
    expect(envelopeFile?.code).toContain("metadata: EnvelopeMetadata::fromArray($data['metadata'])");
  });
});
