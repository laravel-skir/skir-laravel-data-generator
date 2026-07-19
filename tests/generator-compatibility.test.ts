import { describe, expect, it } from "vitest";

import { generateLaravelDataFiles } from "../src/generator.js";
import { fullGeneratorInput } from "./fixtures/full-generator-input.js";

describe("Laravel Data compatibility", () => {
  it("keeps no-overlay output byte-for-byte stable", () => {
    expect(generateLaravelDataFiles(fullGeneratorInput)).toMatchSnapshot();
  });
});
