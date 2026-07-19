import { type CodeGenerator } from "skir-internal";

import { GeneratorConfig, GENERATOR_MODULE } from "./config.js";
import { generateLaravelDataFiles } from "./generator.js";

class LaravelDataGenerator implements CodeGenerator<GeneratorConfig> {
  readonly id = GENERATOR_MODULE;
  readonly configType: CodeGenerator<GeneratorConfig>["configType"] = GeneratorConfig;

  generateCode(input: CodeGenerator.Input<GeneratorConfig>): CodeGenerator.Output {
    return {
      files: generateLaravelDataFiles(input),
    };
  }
}

export const GENERATOR = new LaravelDataGenerator();

export { generateLaravelDataFiles };
export { LaravelDataTarget } from "./target.js";
export default GENERATOR;
