import {
  DEFAULT_NAMESPACE,
  PhpNamespace,
  ValidationConfig,
} from "@php-skir/generator-core";
import { z } from "zod";

export const GENERATOR_MODULE = "skir-laravel-data-generator";
export { DEFAULT_NAMESPACE, PhpNamespace };

export const GeneratorConfig = z.strictObject({
  namespace: PhpNamespace.default(DEFAULT_NAMESPACE),
  validation: ValidationConfig.optional(),
});

export type GeneratorConfig = z.infer<typeof GeneratorConfig>;
export type GeneratorConfigInput = z.input<typeof GeneratorConfig>;
