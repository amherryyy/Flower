import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentSkillError,
  loadAndVerifyAgentSkill
} from "../packages/kernel/src/index.js";

const temporaryDirectories: string[] = [];
const understandProjectRoot = path.resolve("agentic/skills/understand-project");
const planFeatureRoot = path.resolve("agentic/skills/plan-feature");

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function schema(): Promise<object> {
  return JSON.parse(await readFile("schemas/skill/v1.json", "utf8")) as object;
}

async function copyBundledSkill(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "flower-agent-skill-"));
  temporaryDirectories.push(root);
  await Promise.all([
    copyFile(path.join(understandProjectRoot, "skill.json"), path.join(root, "skill.json")),
    copyFile(path.join(understandProjectRoot, "SKILL.md"), path.join(root, "SKILL.md"))
  ]);
  return root;
}

describe("bounded agent skill packages", () => {
  it("loads the bundled inspect-only project understanding skill", async () => {
    const skill = await loadAndVerifyAgentSkill(understandProjectRoot, await schema(), "0.1.0", "codex");

    expect(skill.manifest.id).toBe("flower/understand-project");
    expect(skill.manifest.capabilities).toEqual(expect.objectContaining({
      writes: [],
      network: false,
      externalEffects: [],
      approvals: []
    }));
    expect(skill.files.map((file) => file.path)).toEqual(["SKILL.md"]);
    expect(skill.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("loads the bundled inspect-only feature planning skill", async () => {
    const skill = await loadAndVerifyAgentSkill(planFeatureRoot, await schema(), "0.1.0", "claude");

    expect(skill.manifest.id).toBe("flower/plan-feature");
    expect(skill.manifest.capabilities).toEqual(expect.objectContaining({
      writes: [],
      network: false,
      externalEffects: [],
      approvals: []
    }));
    expect(await readFile(skill.files[0]!.sourcePath, "utf8")).toContain("QUICK, STANDARD, or CRITICAL");
  });

  it("rejects content drift and undeclared files", async () => {
    const drifted = await copyBundledSkill();
    await writeFile(path.join(drifted, "SKILL.md"), "changed instructions\n");
    await expect(loadAndVerifyAgentSkill(drifted, await schema(), "0.1.0", "claude"))
      .rejects.toMatchObject<Partial<AgentSkillError>>({ code: "skill.digestMismatch" });

    const expanded = await copyBundledSkill();
    await mkdir(path.join(expanded, "resources"));
    await writeFile(path.join(expanded, "resources", "hidden.md"), "undeclared\n");
    await expect(loadAndVerifyAgentSkill(expanded, await schema(), "0.1.0"))
      .rejects.toMatchObject<Partial<AgentSkillError>>({ code: "skill.fileSetInvalid" });
  });

  it("rejects incompatible Flower versions before exposing instructions", async () => {
    await expect(loadAndVerifyAgentSkill(understandProjectRoot, await schema(), "0.2.0", "codex"))
      .rejects.toMatchObject<Partial<AgentSkillError>>({ code: "skill.incompatibleFlower" });
  });
});
