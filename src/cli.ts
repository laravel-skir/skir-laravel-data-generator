#!/usr/bin/env node

import { runConfigureComposerCli } from "@php-skir/generator-core";

import { GeneratorConfig, GENERATOR_MODULE } from "./config.js";

async function main(): Promise<void> {
  try {
    await runConfigureComposerCli({
      argv: process.argv.slice(2),
      bin: "skir-laravel-data-generator",
      module: GENERATOR_MODULE,
      parseConfig: (value) => GeneratorConfig.parse(value),
      namespace: (config) => config.namespace,
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

void main();
