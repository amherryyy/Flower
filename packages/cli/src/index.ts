#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FLOWER_VERSION,
  LATEST_PROJECT_SCHEMA_VERSION,
  combineValidationResults,
  projectSchemaVersion,
  validateDocument,
  validateOwnershipManifest,
  type Diagnostic,
  type OwnershipManifest,
  type ProjectManifest,
  type ValidationResult
} from "@flower/kernel";

const EXIT = {
  success: 0,
  failure: 1,
  invalidArguments: 2
} as const;

interface ParsedArguments {
  command?: string;
  target?: string;
  json: boolean;
  version: boolean;
  help: boolean;
}

interface DoctorCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

function parseArguments(argv: string[]): ParsedArguments {
  const positional = argv.filter((argument) => !argument.startsWith("-"));
  const command = positional[0];
  const target = positional[1];
  return {
    ...(command ? { command } : {}),
    ...(target ? { target } : {}),
    json: argv.includes("--json"),
    version: argv.includes("--version") || argv.includes("-v"),
    help: argv.includes("--help") || argv.includes("-h")
  };
}

function schemaRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), "../../../schemas");
}

async function loadJson(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as unknown;
}

function sourceDiagnostic(code: string, filePath: string, error: unknown): ValidationResult {
  return {
    valid: false,
    diagnostics: [
      {
        code,
        path: filePath.replaceAll("\\", "/"),
        message: error instanceof Error ? error.message : "Unable to read JSON document",
        severity: "error"
      }
    ]
  };
}

async function validateFile(
  filePath: string,
  schemaPath: string,
  kind: "project" | "ownership"
): Promise<ValidationResult> {
  try {
    const [document, schema] = await Promise.all([loadJson(filePath), loadJson(schemaPath)]);
    return kind === "ownership"
      ? validateOwnershipManifest(schema as object, document)
      : validateDocument(schema as object, document, "project");
  } catch (error) {
    return sourceDiagnostic(`${kind}.read`, filePath, error);
  }
}

async function validateTarget(targetInput: string): Promise<ValidationResult> {
  const target = path.resolve(targetInput);
  const extension = path.extname(target).toLowerCase();

  if (extension === ".json") {
    const ownership = path.basename(target) === "ownership.json";
    return validateFile(
      target,
      path.join(schemaRoot(), ownership ? "ownership" : "project", "v1.json"),
      ownership ? "ownership" : "project"
    );
  }

  const controlDirectory = path.basename(target) === ".flower" ? target : path.join(target, ".flower");
  const [projectResult, ownershipResult] = await Promise.all([
    validateFile(
      path.join(controlDirectory, "project.json"),
      path.join(schemaRoot(), "project", "v1.json"),
      "project"
    ),
    validateFile(
      path.join(controlDirectory, "ownership.json"),
      path.join(schemaRoot(), "ownership", "v1.json"),
      "ownership"
    )
  ]);

  return combineValidationResults(projectResult, ownershipResult);
}

function controlDirectoryFor(targetInput: string): string {
  const target = path.resolve(targetInput);
  return path.basename(target) === ".flower" ? target : path.join(target, ".flower");
}

async function isReadable(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function doctorTarget(targetInput: string): Promise<{
  healthy: boolean;
  checks: DoctorCheck[];
  diagnostics: Diagnostic[];
}> {
  const controlDirectory = controlDirectoryFor(targetInput);
  const projectPath = path.join(controlDirectory, "project.json");
  const ownershipPath = path.join(controlDirectory, "ownership.json");
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  const [projectReadable, ownershipReadable] = await Promise.all([
    isReadable(projectPath),
    isReadable(ownershipPath)
  ]);
  const checks: DoctorCheck[] = [
    {
      id: "runtime.node",
      status: nodeMajor >= 22 ? "pass" : "fail",
      message: `Node.js ${process.versions.node} ${nodeMajor >= 22 ? "is supported" : "is unsupported; Flower requires Node.js 22 or newer"}.`
    },
    {
      id: "manifest.project",
      status: projectReadable ? "pass" : "fail",
      message: projectReadable ? "Project manifest is readable." : `Project manifest is missing or unreadable: ${projectPath}`
    },
    {
      id: "manifest.ownership",
      status: ownershipReadable ? "pass" : "fail",
      message: ownershipReadable
        ? "Ownership manifest is readable."
        : `Ownership manifest is missing or unreadable: ${ownershipPath}`
    }
  ];

  if (projectReadable) {
    try {
      const version = projectSchemaVersion(await loadJson(projectPath));
      checks.push({
        id: "manifest.schema-version",
        status: version === LATEST_PROJECT_SCHEMA_VERSION ? "pass" : version < LATEST_PROJECT_SCHEMA_VERSION ? "warn" : "fail",
        message:
          version === LATEST_PROJECT_SCHEMA_VERSION
            ? `Project manifest uses the current schema version (${version}).`
            : version < LATEST_PROJECT_SCHEMA_VERSION
              ? `Project manifest schema version ${version} can be migrated to ${LATEST_PROJECT_SCHEMA_VERSION}.`
              : `Project manifest schema version ${version} is newer than this Flower release supports.`
      });
    } catch (error) {
      checks.push({
        id: "manifest.schema-version",
        status: "fail",
        message: error instanceof Error ? error.message : "Project schema version is invalid."
      });
    }
  }

  const validation = await validateTarget(targetInput);
  checks.push({
    id: "manifest.validation",
    status: validation.valid ? "pass" : "fail",
    message: validation.valid ? "Flower manifests are valid." : "One or more Flower manifests are invalid."
  });

  return {
    healthy: checks.every((check) => check.status !== "fail"),
    checks,
    diagnostics: validation.diagnostics
  };
}

async function statusTarget(targetInput: string): Promise<{
  valid: boolean;
  project?: Pick<ProjectManifest["project"], "id" | "name"> & { mode: ProjectManifest["mode"] };
  flowerVersion?: string;
  schemaVersion?: number;
  modules?: string[];
  ownershipRules?: number;
  diagnostics: Diagnostic[];
}> {
  const validation = await validateTarget(targetInput);
  if (!validation.valid) {
    return { valid: false, diagnostics: validation.diagnostics };
  }

  const controlDirectory = controlDirectoryFor(targetInput);
  const [project, ownership] = (await Promise.all([
    loadJson(path.join(controlDirectory, "project.json")),
    loadJson(path.join(controlDirectory, "ownership.json"))
  ])) as [ProjectManifest, OwnershipManifest];

  return {
    valid: true,
    project: {
      id: project.project.id,
      name: project.project.name,
      mode: project.mode
    },
    flowerVersion: project.flower.version,
    schemaVersion: project.schemaVersion,
    modules: Object.keys(project.modules ?? {}).sort(),
    ownershipRules: ownership.rules.length,
    diagnostics: []
  };
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`;
}

function printValidation(result: ValidationResult, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.valid) {
    process.stdout.write("Flower validation passed.\n");
    return;
  }

  process.stdout.write("Flower validation failed.\n");
  result.diagnostics.forEach((diagnostic) => {
    process.stdout.write(`${formatDiagnostic(diagnostic)}\n`);
  });
}

function printDoctor(result: Awaited<ReturnType<typeof doctorTarget>>, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(result.healthy ? "Flower doctor found no blocking problems.\n" : "Flower doctor found blocking problems.\n");
  result.checks.forEach((check) => {
    process.stdout.write(`${check.status.toUpperCase()} ${check.id}: ${check.message}\n`);
  });
  result.diagnostics.forEach((diagnostic) => {
    process.stdout.write(`${formatDiagnostic(diagnostic)}\n`);
  });
}

function printStatus(result: Awaited<ReturnType<typeof statusTarget>>, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (!result.valid || !result.project) {
    process.stdout.write("Flower project status is unavailable because validation failed.\n");
    result.diagnostics.forEach((diagnostic) => {
      process.stdout.write(`${formatDiagnostic(diagnostic)}\n`);
    });
    return;
  }

  process.stdout.write(`${result.project.name} (${result.project.id})\n`);
  process.stdout.write(`Mode: ${result.project.mode}\n`);
  process.stdout.write(`Flower: ${result.flowerVersion}\n`);
  process.stdout.write(`Schema: ${result.schemaVersion}\n`);
  process.stdout.write(`Modules: ${result.modules?.length ? result.modules.join(", ") : "none"}\n`);
  process.stdout.write(`Ownership rules: ${result.ownershipRules}\n`);
}

function printHelp(): void {
  process.stdout.write(`Flower ${FLOWER_VERSION}\n\n`);
  process.stdout.write("Usage:\n");
  process.stdout.write("  flower --version\n");
  process.stdout.write("  flower validate [project-or-json-path] [--json]\n");
  process.stdout.write("  flower doctor [project-path] [--json]\n");
  process.stdout.write("  flower status [project-path] [--json]\n");
}

async function main(): Promise<number> {
  const args = parseArguments(process.argv.slice(2));

  if (args.version) {
    process.stdout.write(`${FLOWER_VERSION}\n`);
    return EXIT.success;
  }

  if (args.help || !args.command) {
    printHelp();
    return EXIT.success;
  }

  if (args.command === "validate") {
    const result = await validateTarget(args.target ?? ".");
    printValidation(result, args.json);
    return result.valid ? EXIT.success : EXIT.failure;
  }

  if (args.command === "doctor") {
    const result = await doctorTarget(args.target ?? ".");
    printDoctor(result, args.json);
    return result.healthy ? EXIT.success : EXIT.failure;
  }

  if (args.command === "status") {
    const result = await statusTarget(args.target ?? ".");
    printStatus(result, args.json);
    return result.valid ? EXIT.success : EXIT.failure;
  }

  process.stderr.write(`Unknown command: ${args.command}\n`);
  printHelp();
  return EXIT.invalidArguments;
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Unexpected Flower error"}\n`);
    process.exitCode = EXIT.failure;
  });
