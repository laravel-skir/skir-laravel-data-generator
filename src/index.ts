import { type CodeGenerator } from "skir-internal";
import { z } from "zod";

import { generateLaravelDataFiles } from "./generator.js";

const Config = z.strictObject({
  namespace: z.string().default("App\\Skir"),
});

type Config = z.infer<typeof Config>;

class LaravelDataGenerator implements CodeGenerator<Config> {
  readonly id = "skir-laravel-data-generator";
  readonly configType = Config;

  generateCode(input: CodeGenerator.Input<Config>): CodeGenerator.Output {
    return {
      files: generateLaravelDataFiles(input),
    };
  }
}

export const GENERATOR = new LaravelDataGenerator();

export { generateLaravelDataFiles };
