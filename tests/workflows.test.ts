import { readFileSync } from "node:fs";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

interface WorkflowStep {
  readonly name?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly with?: Record<string, unknown>;
}

interface WorkflowJob {
  readonly if?: string;
  readonly needs?: string;
  readonly permissions?: Record<string, string>;
  readonly steps: readonly WorkflowStep[];
}

interface Workflow {
  readonly jobs: Record<string, WorkflowJob>;
  readonly permissions?: Record<string, string>;
}

function readWorkflow(path: string): Workflow {
  return parse(readFileSync(path, "utf8")) as Workflow;
}

function commands(job: WorkflowJob): string {
  return job.steps.flatMap((step) => step.run ?? []).join("\n");
}

describe("GitHub workflows", () => {
  it("runs the coverage gate for pull requests with read-only contents", () => {
    const workflow = readWorkflow(".github/workflows/tests.yml");
    const tests = workflow.jobs.tests!;
    const coverage = workflow.jobs.coverage!;
    const badge = workflow.jobs["coverage-badge"]!;

    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(tests.steps).toContainEqual({
      name: "Test coverage badge publisher",
      run: "bash .github/scripts/publish-coverage-badge.test.sh",
    });
    expect(coverage.if).toBeUndefined();
    expect(coverage.permissions).toEqual({ contents: "read" });
    expect(commands(coverage)).toContain("npm run test:coverage");
    expect(badge.if).toBe("github.ref == 'refs/heads/main'");
    expect(badge.needs).toBe("coverage");
    expect(badge.permissions).toEqual({ contents: "write" });
  });

  it("keeps dependency execution outside the OIDC publish job", () => {
    const workflow = readWorkflow(".github/workflows/release.yml");
    const verify = workflow.jobs.verify!;
    const publish = workflow.jobs.publish!;

    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(verify.permissions).toEqual({ contents: "read" });
    expect(commands(verify)).toContain("npm ci");
    expect(commands(verify)).toContain("npm test");
    expect(publish.needs).toBe("verify");
    expect(publish.permissions).toEqual({
      contents: "read",
      "id-token": "write",
    });
    expect(publish.steps).toEqual([
      {
        name: "Setup Node",
        uses: "actions/setup-node@v4",
        with: {
          "node-version": "24",
          "registry-url": "https://registry.npmjs.org",
          "package-manager-cache": false,
        },
      },
      {
        name: "Download publish tarball",
        uses: "actions/download-artifact@v4",
        with: {
          name: "npm-package",
          path: "build/package",
        },
      },
      {
        name: "Publish",
        run: "npm publish build/package/skir-laravel-data-generator-*.tgz --ignore-scripts --provenance --access public",
      },
    ]);
  });
});
