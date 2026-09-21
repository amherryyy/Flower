import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentAdapterMaterializationError,
  applyAgentAdapterMaterializationPlan,
  createAgentAdapterBundle,
  createAgentAdapterMaterializationPlan,
  type AgentAdapterInput,
  type OwnershipManifest,
  type ProjectManifest,
  type WorkflowDefinition
} from "../packages/kernel/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "flower-adapter-materialization-"));
  temporaryDirectories.push(root);
  return root;
}

async function json(relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8")) as unknown;
}

function project(name = "Sample App", claude = true): ProjectManifest {
  return {
    schemaVersion: 1,
    mode: "project",
    project: { id: "sample-app", name },
    flower: { version: "0.1.0", channel: "development" },
    stack: { language: "typescript", runtime: "node", packageManager: "npm" },
    adapters: { codex: true, claude }
  };
}

function ownership(): OwnershipManifest {
  return {
    version: 1,
    rules: [
      { pattern: ".flower/generated/**", owner: "generated", policy: "replace-if-unmodified" },
      { pattern: "AGENTS.md", owner: "generated", policy: "replace-if-unmodified" },
      { pattern: "CLAUDE.md", owner: "generated", policy: "replace-if-unmodified" },
      { pattern: "docs/**", owner: "project", policy: "never-overwrite" },
      { pattern: "**", owner: "project", policy: "never-overwrite" }
    ]
  };
}

async function input(name?: string, claude = true): Promise<AgentAdapterInput> {
  return {
    project: project(name, claude),
    ownership: ownership(),
    workflows: [await json("../workflows/feature.json") as WorkflowDefinition],
    architecturePolicyPaths: ["FLOWER_SPEC.md", "docs/architecture.md"],
    decisionPaths: ["docs/decisions/0025-deterministic-agent-adapters.md"],
    notesPath: "docs/agent-notes.md"
  };
}

async function stateSchema(): Promise<object> {
  return await json("../schemas/adapter-state/v1.json") as object;
}

async function missing(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

describe("transactional agent adapter materialization", () => {
  it("creates deterministic dry-run actions, applies them, and then plans a no-op", async () => {
    const root = await temporaryRoot();
    const bundle = createAgentAdapterBundle(await input());
    const schema = await stateSchema();
    const first = await createAgentAdapterMaterializationPlan(root, bundle, schema);
    const second = await createAgentAdapterMaterializationPlan(root, bundle, schema);

    expect(first).toEqual(second);
    expect(first.state).toBe("apply");
    expect(first.actions.map(({ kind, path: actionPath }) => [kind, actionPath])).toEqual([
      ["create", "AGENTS.md"],
      ["create", "CLAUDE.md"],
      ["create", ".flower/generated/agent-adapters.json"]
    ]);
    expect(await missing(path.join(root, "AGENTS.md"))).toBe(true);

    const result = await applyAgentAdapterMaterializationPlan(first, bundle, schema);
    expect(result.status).toBe("completed");
    expect(result.changedPaths).toEqual(first.actions.map(({ path: actionPath }) => actionPath));
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toBe(bundle.artifacts[0]!.content);
    expect(await readFile(path.join(root, bundle.statePath), "utf8")).toBe(bundle.stateContent);
    expect(result.journalPath).toMatch(/\.flower[\\/]journal[\\/]local/);

    const repeated = await createAgentAdapterMaterializationPlan(root, bundle, schema);
    expect(repeated.state).toBe("unchanged");
    await expect(applyAgentAdapterMaterializationPlan(repeated, bundle, schema)).resolves.toEqual({
      status: "unchanged",
      planId: repeated.planId,
      projectRoot: root,
      changedPaths: []
    });
  });

  it("replaces stale pristine adapters and records the new state last", async () => {
    const root = await temporaryRoot();
    const schema = await stateSchema();
    const oldBundle = createAgentAdapterBundle(await input("Old Name"));
    await applyAgentAdapterMaterializationPlan(
      await createAgentAdapterMaterializationPlan(root, oldBundle, schema),
      oldBundle,
      schema
    );

    const current = createAgentAdapterBundle(await input("Current Name"));
    const plan = await createAgentAdapterMaterializationPlan(root, current, schema);
    expect(plan.actions.map(({ kind, path: actionPath }) => [kind, actionPath])).toEqual([
      ["replace", "AGENTS.md"],
      ["replace", "CLAUDE.md"],
      ["replace", ".flower/generated/agent-adapters.json"]
    ]);
    await applyAgentAdapterMaterializationPlan(plan, current, schema);
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toContain("# Current Name — Codex adapter");
  });

  it("removes a disabled adapter only while its recorded output remains pristine", async () => {
    const root = await temporaryRoot();
    const schema = await stateSchema();
    const both = createAgentAdapterBundle(await input());
    await applyAgentAdapterMaterializationPlan(
      await createAgentAdapterMaterializationPlan(root, both, schema),
      both,
      schema
    );

    const codexOnly = createAgentAdapterBundle(await input(undefined, false));
    const plan = await createAgentAdapterMaterializationPlan(root, codexOnly, schema);
    expect(plan.actions).toContainEqual(expect.objectContaining({ kind: "remove", path: "CLAUDE.md" }));
    await applyAgentAdapterMaterializationPlan(plan, codexOnly, schema);
    expect(await missing(path.join(root, "CLAUDE.md"))).toBe(true);
    expect(JSON.parse(await readFile(path.join(root, codexOnly.statePath), "utf8")).artifacts).toHaveLength(1);
  });

  it("refuses untracked collisions and manually modified generated files", async () => {
    const collisionRoot = await temporaryRoot();
    const schema = await stateSchema();
    const bundle = createAgentAdapterBundle(await input());
    await writeFile(path.join(collisionRoot, "AGENTS.md"), "project-owned content\n");
    await expect(createAgentAdapterMaterializationPlan(collisionRoot, bundle, schema)).rejects.toMatchObject({
      code: "adapter.unmanagedCollision"
    });

    const modifiedRoot = await temporaryRoot();
    await applyAgentAdapterMaterializationPlan(
      await createAgentAdapterMaterializationPlan(modifiedRoot, bundle, schema),
      bundle,
      schema
    );
    await writeFile(path.join(modifiedRoot, "AGENTS.md"), "manual edit\n");
    const next = createAgentAdapterBundle(await input("New Name"));
    await expect(createAgentAdapterMaterializationPlan(modifiedRoot, next, schema)).rejects.toMatchObject({
      code: "adapter.modified"
    });
  });

  it("rejects tampered plans and bundles with unsupported capabilities", async () => {
    const root = await temporaryRoot();
    const schema = await stateSchema();
    const bundle = createAgentAdapterBundle(await input());
    const plan = await createAgentAdapterMaterializationPlan(root, bundle, schema);
    await expect(applyAgentAdapterMaterializationPlan({ ...plan, projectRoot: `${root}-other` }, bundle, schema))
      .rejects.toMatchObject({ code: "adapter.invalidPlan" });

    const unsupportedInput = await input();
    unsupportedInput.workflows[0]!.steps.push({
      id: "deploy",
      action: "deployment.publish",
      reads: [],
      writes: [],
      externalEffects: ["production.deploy"]
    });
    const unsupported = createAgentAdapterBundle(unsupportedInput);
    await expect(createAgentAdapterMaterializationPlan(root, unsupported, schema)).rejects.toMatchObject({
      code: "adapter.capabilityMissing"
    });
  });

  it("rechecks the filesystem after planning", async () => {
    const root = await temporaryRoot();
    const schema = await stateSchema();
    const bundle = createAgentAdapterBundle(await input());
    const plan = await createAgentAdapterMaterializationPlan(root, bundle, schema);
    await writeFile(path.join(root, "AGENTS.md"), "appeared after planning\n");
    await expect(applyAgentAdapterMaterializationPlan(plan, bundle, schema)).rejects.toBeInstanceOf(
      AgentAdapterMaterializationError
    );
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toBe("appeared after planning\n");
    expect(await missing(path.join(root, "CLAUDE.md"))).toBe(true);
  });

  it("rolls back every completed mutation when a later action fails", async () => {
    const root = await temporaryRoot();
    const schema = await stateSchema();
    const bundle = createAgentAdapterBundle(await input());
    const plan = await createAgentAdapterMaterializationPlan(root, bundle, schema);

    await expect(applyAgentAdapterMaterializationPlan(plan, bundle, schema, {
      afterAction: (_action, index) => {
        if (index === 1) throw new Error("injected failure");
      }
    })).rejects.toMatchObject({ code: "adapter.rolledBack", rollbackComplete: true });
    expect(await missing(path.join(root, "AGENTS.md"))).toBe(true);
    expect(await missing(path.join(root, "CLAUDE.md"))).toBe(true);
    expect(await missing(path.join(root, bundle.statePath))).toBe(true);
  });

  it("rejects invalid prior state without touching adapter files", async () => {
    const root = await temporaryRoot();
    const bundle = createAgentAdapterBundle(await input());
    await mkdir(path.join(root, ".flower", "generated"), { recursive: true });
    await writeFile(path.join(root, bundle.statePath), "{not-json\n");
    await expect(createAgentAdapterMaterializationPlan(root, bundle, await stateSchema())).rejects.toMatchObject({
      code: "adapter.invalidState"
    });
    expect(await missing(path.join(root, "AGENTS.md"))).toBe(true);
  });
});
