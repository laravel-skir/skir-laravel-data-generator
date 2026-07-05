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
});
