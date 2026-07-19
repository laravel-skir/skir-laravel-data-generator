import { execFileSync, type StdioOptions } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const COMPOSER_FIXTURE_TEST_TIMEOUT_MS = 180_000;

const CHILD_PROCESS_TIMEOUT_MS = 120_000;
const CHILD_PROCESS_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export interface ComposerFixture {
  readonly composerHomePath: string;
  readonly projectPath: string;
}

export function createComposerFixture(
  prefix: string,
  fixtures: ComposerFixture[],
): ComposerFixture {
  const projectPath = mkdtempSync(join(tmpdir(), prefix));
  const composerHomePath = join(projectPath, ".composer-home");
  const fixture = {
    composerHomePath,
    projectPath,
  };

  fixtures.push(fixture);
  mkdirSync(composerHomePath);

  return fixture;
}

export function removeComposerFixtures(fixtures: ComposerFixture[]): void {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture.projectPath, { recursive: true, force: true });
  }
}

export function executeFixtureCommand(
  fixture: ComposerFixture,
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly stdio?: StdioOptions;
    readonly timeout?: number;
  } = {},
): void {
  execFileSync(command, args, {
    cwd: options.cwd ?? fixture.projectPath,
    env: {
      ...process.env,
      COMPOSER_HOME: fixture.composerHomePath,
    },
    maxBuffer: CHILD_PROCESS_MAX_BUFFER_BYTES,
    stdio: options.stdio ?? "pipe",
    timeout: options.timeout ?? CHILD_PROCESS_TIMEOUT_MS,
  });
}
