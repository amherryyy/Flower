import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentAdapterMaterializationError,
  combineValidationResults,
  createAgentAdapterBundle,
  validateAgentAdapters,
  validateDocument,
  validateOwnershipManifest,
  type AgentAdapterBundle,
  type OwnershipManifest,
  type ProjectManifest,
  type ValidationResult,
  type WorkflowDefinition
} from "@flower/kernel";

export interface AgentAdapterCliContext {
  projectRoot: string;
  bundle: AgentAdapterBundle;
  stateSchema: object;
}

function repositoryRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), "../../..");
}

function schemaPath(kind: string): string {
  return path.join(repositoryRoot(), "schemas", kind, "v1.json");
}

function workflowRoot(): string {
  return path.join(repositoryRoot(), "workflows");
}

function projectPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function contained(root: string, target: string): boolean {
  const relation = path.relative(root, target);
  return !path.isAbsolute(relation) && relation !== ".." && !relation.startsWith(`..${path.sep}`);
}

async function assertRegularRoot(root: string): Promise<string> {
  const details = await lstat(root);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new AgentAdapterMaterializationError("Adapter project root is not a regular directory", "adapter.unsafeSource");
  }
  return await realpath(root);
}

async function readRegularFile(root: string, realRoot: string, relativePath: string): Promise<Buffer> {
  const absolute = path.resolve(root, relativePath);
  if (!contained(root, absolute)) {
    throw new AgentAdapterMaterializationError(`Adapter source escapes the project root: ${relativePath}`, "adapter.unsafeSource");
  }
  const details = await lstat(absolute);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new AgentAdapterMaterializationError(`Adapter source is not a regular file: ${relativePath}`, "adapter.unsafeSource");
  }
  const resolved = await realpath(absolute);
  if (!contained(realRoot, resolved)) {
    throw new AgentAdapterMaterializationError(`Adapter source escapes the project root: ${relativePath}`, "adapter.unsafeSource");
  }
  return await readFile(absolute);
}

async function loadJson(filePath: string): Promise<unknown> {
  const details = await lstat(filePath);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new AgentAdapterMaterializationError(`Adapter input is not a regular file: ${filePath}`, "adapter.unsafeSource");
  }
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function loadValidatedProject(root: string, realRoot: string): Promise<{
  project: ProjectManifest;
  ownership: OwnershipManifest;
}> {
  const [projectDocument, ownershipDocument, projectSchema, ownershipSchema] = await Promise.all([
    readRegularFile(root, realRoot, ".flower/project.json").then((value) => JSON.parse(value.toString("utf8")) as unknown),
    readRegularFile(root, realRoot, ".flower/ownership.json").then((value) => JSON.parse(value.toString("utf8")) as unknown),
    loadJson(schemaPath("project")),
    loadJson(schemaPath("ownership"))
  ]);
  const validation = combineValidationResults(
    validateDocument(projectSchema as object, projectDocument, "project"),
    validateOwnershipManifest(ownershipSchema as object, ownershipDocument)
  );
  if (!validation.valid) {
    throw new AgentAdapterMaterializationError(
      "Adapter project manifests are invalid",
      "adapter.invalidProject",
      validation.diagnostics
    );
  }
  return { project: projectDocument as ProjectManifest, ownership: ownershipDocument as OwnershipManifest };
}

async function loadWorkflows(): Promise<WorkflowDefinition[]> {
  const root = workflowRoot();
  const [schema, entries] = await Promise.all([
    loadJson(schemaPath("workflow")),
    readdir(root, { withFileTypes: true })
  ]);
  const files = entries
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (files.length === 0) {
    throw new AgentAdapterMaterializationError("No canonical workflow definitions were found", "adapter.missingWorkflows");
  }
  const workflows: WorkflowDefinition[] = [];
  for (const filename of files) {
    const document = await loadJson(path.join(root, filename));
    const validation = validateDocument(schema as object, document, "workflow");
    if (!validation.valid) {
      throw new AgentAdapterMaterializationError(
        `Canonical workflow is invalid: ${filename}`,
        "adapter.invalidWorkflow",
        validation.diagnostics
      );
    }
    workflows.push(document as WorkflowDefinition);
  }
  return workflows;
}

async function optionalRegularFile(root: string, realRoot: string, relativePath: string): Promise<boolean> {
  try {
    await readRegularFile(root, realRoot, relativePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function assertSafeDirectory(root: string, realRoot: string, relativeDirectory: string): Promise<boolean> {
  let current = root;
  try {
    for (const segment of projectPath(relativeDirectory).split("/")) {
      current = path.join(current, segment);
      const details = await lstat(current);
      if (!details.isDirectory() || details.isSymbolicLink()) {
        throw new AgentAdapterMaterializationError(
          `Adapter source directory is unsafe: ${relativeDirectory}`,
          "adapter.unsafeSource"
        );
      }
    }
    if (!contained(realRoot, await realpath(current))) {
      throw new AgentAdapterMaterializationError(
        `Adapter source directory escapes the project root: ${relativeDirectory}`,
        "adapter.unsafeSource"
      );
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function markdownFiles(root: string, realRoot: string, relativeDirectory: string): Promise<string[]> {
  if (!await assertSafeDirectory(root, realRoot, relativeDirectory)) return [];
  const output: string[] = [];
  const visit = async (relative: string): Promise<void> => {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const child = projectPath(path.posix.join(projectPath(relative), entry.name));
      if (entry.isSymbolicLink()) {
        throw new AgentAdapterMaterializationError(`Adapter source is a symbolic link: ${child}`, "adapter.unsafeSource");
      }
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        await readRegularFile(root, realRoot, child);
        output.push(child);
        if (output.length > 256) {
          throw new AgentAdapterMaterializationError("Adapter source discovery exceeded 256 Markdown files", "adapter.sourceLimit");
        }
      }
    }
  };
  await visit(projectPath(relativeDirectory));
  return output;
}

async function sourcePaths(root: string, realRoot: string): Promise<{
  architecturePolicyPaths: string[];
  decisionPaths: string[];
}> {
  const directPolicies = ["FLOWER_SPEC.md", "FLOWER_ARCHITECTURE_AUDIT.md", "docs/PROJECT_CONTEXT.md"];
  const existingPolicies: string[] = [];
  for (const candidate of directPolicies) {
    if (await optionalRegularFile(root, realRoot, candidate)) existingPolicies.push(candidate);
  }
  const architecture = await markdownFiles(root, realRoot, "docs/architecture");
  const decisions = await markdownFiles(root, realRoot, "docs/decisions");
  return {
    architecturePolicyPaths: [...existingPolicies, ...architecture].sort((left, right) => left.localeCompare(right)),
    decisionPaths: decisions.sort((left, right) => left.localeCompare(right))
  };
}

export async function loadAgentAdapterCliContext(projectRootInput: string): Promise<AgentAdapterCliContext> {
  const projectRoot = path.resolve(projectRootInput);
  const realRoot = await assertRegularRoot(projectRoot);
  const [{ project, ownership }, workflows, paths, stateSchema] = await Promise.all([
    loadValidatedProject(projectRoot, realRoot),
    loadWorkflows(),
    sourcePaths(projectRoot, realRoot),
    loadJson(schemaPath("adapter-state"))
  ]);
  const bundle = createAgentAdapterBundle({
    project,
    ownership,
    workflows,
    ...paths,
    notesPath: "docs/agent-notes.md"
  });
  return { projectRoot, bundle, stateSchema: stateSchema as object };
}

async function adapterStateExists(projectRoot: string): Promise<boolean> {
  try {
    await lstat(path.join(projectRoot, ".flower", "generated", "agent-adapters.json"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function validateProjectAgentAdapters(projectRootInput: string): Promise<ValidationResult> {
  try {
    const projectRoot = path.resolve(projectRootInput);
    const projectDocument = await loadJson(path.join(projectRoot, ".flower", "project.json")) as ProjectManifest;
    const enabled = projectDocument.adapters?.codex === true || projectDocument.adapters?.claude === true;
    if (!enabled && !await adapterStateExists(projectRoot)) return { valid: true, diagnostics: [] };
    const context = await loadAgentAdapterCliContext(projectRoot);
    return await validateAgentAdapters(context.projectRoot, context.bundle, context.stateSchema);
  } catch (error) {
    if (error instanceof AgentAdapterMaterializationError && error.diagnostics.length > 0) {
      return { valid: false, diagnostics: error.diagnostics };
    }
    return {
      valid: false,
      diagnostics: [{
        code: error instanceof AgentAdapterMaterializationError ? error.code : "adapter.validationFailed",
        path: ".flower/generated/agent-adapters.json",
        message: error instanceof Error ? error.message : "Agent adapter validation failed",
        severity: "error"
      }]
    };
  }
}
