import { describe, expect, it } from "vitest";

import { DEFAULT_NAMESPACE, GENERATOR_MODULE, GeneratorConfig } from "../src/config.js";

describe("GeneratorConfig", () => {
  it("uses the Laravel Data module ID and Skir default namespace", () => {
    expect(GENERATOR_MODULE).toBe("skir-laravel-data-generator");
    expect(DEFAULT_NAMESPACE).toBe("Skir");
    expect(GeneratorConfig.parse({})).toEqual({
      namespace: "Skir",
      validation: {},
    });
  });

  it("accepts nested validation overlays without changing omitted defaults", () => {
    expect(GeneratorConfig.parse({
      validation: {
        "admin/users.skir": {
          CreateUser: {
            email: ["email:rfc,dns", "company_email"],
          },
        },
      },
    })).toEqual({
      namespace: "Skir",
      validation: {
        "admin/users.skir": {
          CreateUser: {
            email: ["email:rfc,dns", "company_email"],
          },
        },
      },
    });
    expect(GeneratorConfig.parse({ namespace: "Company\\Contracts" }))
      .toEqual({ namespace: "Company\\Contracts", validation: {} });
  });

  it.each([
    {
      name: "empty rules",
      input: [""],
      path: ["validation", "admin/users.skir", "CreateUser", "email", 0],
      message: "Validation rules must be non-empty strings.",
    },
    {
      name: "non-string rules",
      input: [123],
      path: ["validation", "admin/users.skir", "CreateUser", "email", 0],
      message: "Invalid input: expected string, received number",
    },
    {
      name: "empty rule arrays",
      input: [],
      path: ["validation", "admin/users.skir", "CreateUser", "email"],
      message: "Too small: expected array to have >=1 items",
    },
  ])("rejects $name with a useful validation path", ({ input, path, message }) => {
    const result = GeneratorConfig.safeParse({
      validation: {
        "admin/users.skir": {
          CreateUser: { email: input },
        },
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({ path, message });
    }
  });

  it("is strict and validates canonical ASCII PHP namespaces", () => {
    expect(GeneratorConfig.parse({ namespace: "Company\\Contracts" }))
      .toEqual({ namespace: "Company\\Contracts", validation: {} });
    expect(GeneratorConfig.safeParse({ namespace: "Skir", unexpected: true }).success)
      .toBe(false);
    expect(GeneratorConfig.safeParse({ namespace: "Skir\\Módulo" }).success)
      .toBe(false);
  });
});
