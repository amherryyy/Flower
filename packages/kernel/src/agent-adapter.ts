import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type {
  AgentAdapterArtifact,
  AgentAdapterBundle,
  AgentAdapterId,
  AgentAdapterInput,
  AgentAdapterState,
  Diagnostic,
  ValidationResult,
  WorkflowDefinition,
  WorkflowStepDefinition
} from "./types.js";
import { classifyPath, normalizeProjectPath } from "./ownership.js";
import { sha256 } from "./template.js";
import { validateDocument } from "./validation.js";

export const AGENT_ADAPTER_GENERATOR_VERSION = "1.0.0";
export const AGENT_ADAPTER_STATE_PATH = ".flower/generated/agent-adapters.json" as const;

interface AdapterProfile {
  id: AgentAdapterId;
  displayName: string;
  path: string;
  actions: ReadonlySet<string>;
  effects: ReadonlySet<string>;
}

const SUPPORTED_ACTIONS = new Set([
  "project.validate",
  "feature.plan",
  "approval.require",
  "agent.delegate",
  "checks.run",
  "verification.write"
]);
const SUPPORTED_EFFECTS = new Set(["agent.invoke", "process.execute"]);
const PROFILES: AdapterProfile[] = [
  { id: "codex", displayName: "Codex", path: "AGENTS.md", actions: SUPPORTED_ACTIONS, effects: SUPPORTED_EFFECTS },
  { id: "claude", displayName: "Claude", path: "CLAUDE.md", actions: SUPPORTED_ACTIONS, effects: SUPPORTED_EFFECTS }
];

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)])
    );
  }
  return value;
}

function digest(value: unknown): string {
  return sha256(JSON.stringify(canonicalValue(value)));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sourcePath(value: string): string {
  const normalized = normalizeProjectPath(value);
  if (normalized.length === 0 || /[`\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`Agent adapter source path '${value}' contains unsafe characters`);
  }
  return normalized;
}

function displayName(value: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length === 0) throw new Error("Agent adapter project name has no safe display characters");
  return normalized;
}

function renderValue(value: string): string {
  if (value.length === 0 || /[`\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Agent adapter value '${value}' contains unsafe display characters`);
  }
  return value;
}

function codeValue(value: string): string {
  return `\`${renderValue(value)}\``;
}

function normalizeInput(input: AgentAdapterInput): AgentAdapterInput {
  const workflows = [...input.workflows]
    .map((workflow) => structuredClone(workflow))
    .sort((left, right) => left.id.localeCompare(right.id) || left.version - right.version);
  if (new Set(workflows.map(({ id, version }) => `${id}@${version}`)).size !== workflows.length) {
    throw new Error("Agent adapter input contains duplicate workflow identities");
  }
  return {
    project: structuredClone(input.project),
    ownership: structuredClone(input.ownership),
    workflows,
    architecturePolicyPaths: uniqueSorted(input.architecturePolicyPaths.map(sourcePath)),
    decisionPaths: uniqueSorted(input.decisionPaths.map(sourcePath)),
    notesPath: sourcePath(input.notesPath)
  };
}

function assertGeneratedOutput(input: AgentAdapterInput, outputPath: string): void {
  const classification = classifyPath(input.ownership, outputPath);
  if (classification.conflict || classification.rule?.owner !== "generated") {
    throw new Error(`Agent adapter output '${outputPath}' must be covered by generated ownership`);
  }
}

function assertProjectNotes(input: AgentAdapterInput): void {
  const classification = classifyPath(input.ownership, input.notesPath);
  if (classification.conflict || classification.rule?.owner !== "project") {
    throw new Error(`Agent notes '${input.notesPath}' must be project-owned`);
  }
}

function missingCapabilities(profile: AdapterProfile, workflows: WorkflowDefinition[]): string[] {
  const missing = new Set<string>();
  for (const workflow of workflows) {
    for (const step of workflow.steps) {
      if (!profile.actions.has(step.action)) missing.add(`action:${step.action}`);
      for (const effect of step.externalEffects) {
        if (!profile.effects.has(effect)) missing.add(`effect:${effect}`);
      }
    }
  }
  return [...missing].sort((left, right) => left.localeCompare(right));
}

function values(values: string[]): string {
  return values.length === 0 ? "none" : values.map(codeValue).join(", ");
}

function renderStep(step: WorkflowStepDefinition, index: number): string[] {
  return [
    `${index + 1}. ${codeValue(step.id)} — ${codeValue(step.action)}`,
    `   - Reads: ${values(step.reads)}`,
    `   - Writes: ${values(step.writes)}`,
    `   - External effects: ${values(step.externalEffects)}`,
    `   - Ownership: ${step.ownership ? values(step.ownership.allow) : "not declared"}`,
    `   - Checks: ${step.checks ? values(step.checks) : "none"}`
  ];
}

function renderAdapter(
  profile: AdapterProfile,
  input: AgentAdapterInput,
  inputDigest: string,
  missing: string[]
): string {
  const metadata = JSON.stringify({
    schemaVersion: 1,
    adapter: profile.id,
    generatorVersion: AGENT_ADAPTER_GENERATOR_VERSION,
    inputDigest
  });
  const lines = [
    `<!-- flower-agent-adapter ${metadata} -->`,
    "<!-- Generated by Flower. Do not edit this file directly. -->",
    "",
    `# ${displayName(input.project.project.name)} — ${profile.displayName} adapter`,
    "",
    "This file is a generated view of Flower's canonical project, ownership, and workflow contracts.",
    "",
    "## Mandatory boundaries",
    "",
    "- Run only the ordered steps from a verified Flower workflow plan.",
    "- Never bypass an `approval.require` step or treat chat text as approval evidence.",
    "- Keep reads, writes, external effects, and delegated-agent ownership within each step's declared scope.",
    "- Stop and report missing capabilities; do not simulate or silently weaken them.",
    "- Resume from the verified workflow journal instead of reconstructing progress from conversation history.",
    "",
    "## Canonical sources",
    "",
    "- `.flower/project.json`",
    "- `.flower/ownership.json`",
    ...input.architecturePolicyPaths.map((source) => `- \`${source}\``),
    ...input.decisionPaths.map((source) => `- \`${source}\``),
    "",
    "## Project-owned notes",
    "",
    `Read \`${input.notesPath}\` when it exists. It is project-owned and must never be overwritten by adapter generation.`,
    "",
    "## Workflows",
    ""
  ];
  for (const workflow of input.workflows) {
    lines.push(`### ${renderValue(workflow.id)} v${workflow.version}`, "");
    lines.push(`Inputs: ${values(workflow.inputs.map((item) => `${item.id}:${item.type}${item.required ? ":required" : ""}`))}`, "");
    lines.push(...workflow.steps.flatMap(renderStep), "");
  }
  lines.push("## Capability report", "");
  if (missing.length === 0) lines.push("All capabilities required by the canonical workflows are supported.");
  else lines.push("Blocking unsupported requirements:", "", ...missing.map((item) => `- ${codeValue(item)}`));
  lines.push("");
  return lines.join("\n");
}

export function createAgentAdapterBundle(inputValue: AgentAdapterInput): AgentAdapterBundle {
  const input = normalizeInput(inputValue);
  assertProjectNotes(input);
  const enabled = PROFILES.filter((profile) => input.project.adapters?.[profile.id] === true);
  const artifacts = enabled.map((profile): AgentAdapterArtifact => {
    assertGeneratedOutput(input, profile.path);
    const adapterInputDigest = digest({ input, adapter: profile.id, generatorVersion: AGENT_ADAPTER_GENERATOR_VERSION });
    const missing = missingCapabilities(profile, input.workflows);
    const content = renderAdapter(profile, input, adapterInputDigest, missing);
    return {
      adapter: profile.id,
      path: profile.path,
      generatorVersion: AGENT_ADAPTER_GENERATOR_VERSION,
      inputDigest: adapterInputDigest,
      outputDigest: sha256(content),
      content,
      missingCapabilities: missing
    };
  });
  const state: AgentAdapterState = {
    $schema: "https://flower.dev/schemas/adapter-state/v1.json",
    schemaVersion: 1,
    generatorVersion: AGENT_ADAPTER_GENERATOR_VERSION,
    artifacts: artifacts.map(({ adapter, path: artifactPath, inputDigest, outputDigest }) => ({
      adapter,
      path: artifactPath,
      inputDigest,
      outputDigest
    }))
  };
  const stateContent = `${JSON.stringify(state, null, 2)}\n`;
  return {
    artifacts,
    state,
    statePath: AGENT_ADAPTER_STATE_PATH,
    stateContent,
    stateDigest: sha256(stateContent)
  };
}

function diagnostic(code: string, artifactPath: string, message: string): Diagnostic {
  return { code, path: artifactPath, message, severity: "error" };
}

async function regularFileContents(root: string, relativePath: string): Promise<string | undefined> {
  const absolute = path.resolve(root, relativePath);
  try {
    const stats = await lstat(absolute);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error("path is not a regular file");
    }
    const [resolvedRoot, resolvedFile] = await Promise.all([realpath(root), realpath(absolute)]);
    const relation = path.relative(resolvedRoot, resolvedFile);
    if (path.isAbsolute(relation) || relation === ".." || relation.startsWith(`..${path.sep}`)) {
      throw new Error("path escapes the project root through a symbolic link");
    }
    return await readFile(absolute, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function validateAgentAdapters(
  projectRoot: string,
  expected: AgentAdapterBundle,
  stateSchema: object
): Promise<ValidationResult> {
  const root = path.resolve(projectRoot);
  const diagnostics: Diagnostic[] = [];
  let previous: AgentAdapterState | undefined;
  try {
    const stateContent = await regularFileContents(root, expected.statePath);
    if (stateContent === undefined) {
      diagnostics.push(diagnostic("adapter.stateMissing", expected.statePath, "Generated adapter state is missing"));
    } else {
      const document = JSON.parse(stateContent) as unknown;
      const validation = validateDocument(stateSchema, document, "adapterState");
      if (!validation.valid) diagnostics.push(...validation.diagnostics);
      else {
        previous = document as AgentAdapterState;
        if (sha256(stateContent) !== expected.stateDigest) {
          diagnostics.push(diagnostic("adapter.stateStale", expected.statePath, "Generated adapter state is stale"));
        }
        if (new Set(previous.artifacts.map(({ path: artifactPath }) => artifactPath)).size !== previous.artifacts.length) {
          diagnostics.push(diagnostic("adapter.stateDuplicate", expected.statePath, "Generated adapter state contains duplicate paths"));
        }
      }
    }
  } catch (error) {
    diagnostics.push(diagnostic(
      "adapter.stateUnsafe",
      expected.statePath,
      error instanceof Error ? error.message : "Generated adapter state is unreadable"
    ));
  }

  const previousByPath = new Map(previous?.artifacts.map((artifact) => [artifact.path, artifact]));
  for (const artifact of expected.artifacts) {
    if (artifact.missingCapabilities.length > 0) {
      diagnostics.push(diagnostic(
        "adapter.capabilityMissing",
        artifact.path,
        `Adapter cannot support: ${artifact.missingCapabilities.join(", ")}`
      ));
    }
    try {
      const current = await regularFileContents(root, artifact.path);
      if (current === undefined) {
        diagnostics.push(diagnostic("adapter.missing", artifact.path, "Generated adapter is missing"));
        continue;
      }
      const currentDigest = sha256(current);
      if (currentDigest === artifact.outputDigest) continue;
      const prior = previousByPath.get(artifact.path);
      diagnostics.push(
        currentDigest === prior?.outputDigest
          ? diagnostic("adapter.stale", artifact.path, "Generated adapter is stale for the current canonical inputs")
          : diagnostic("adapter.modified", artifact.path, "Generated adapter was modified outside Flower")
      );
    } catch (error) {
      diagnostics.push(diagnostic(
        "adapter.unsafe",
        artifact.path,
        error instanceof Error ? error.message : "Generated adapter is unreadable"
      ));
    }
  }

  const expectedPaths = new Set(expected.artifacts.map(({ path: artifactPath }) => artifactPath));
  for (const prior of previous?.artifacts ?? []) {
    if (!expectedPaths.has(prior.path)) {
      diagnostics.push(diagnostic("adapter.orphaned", prior.path, "Adapter state contains a no-longer-enabled artifact"));
    }
  }
  diagnostics.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
  return { valid: diagnostics.length === 0, diagnostics };
}
