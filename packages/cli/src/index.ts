#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FLOWER_VERSION,
  InitializationError,
  LATEST_PROJECT_SCHEMA_VERSION,
  ModuleAddError,
  ModuleDispositionError,
  applyModuleDispositionPlan,
  applyModuleAddPlan,
  applyInitPlan,
  checkProjectSecurity,
  combineValidationResults,
  createInitPlan,
  createModuleAddPlan,
  createModuleDispositionPlan,
  loadModuleCatalog,
  loadAndVerifyTemplate,
  projectSchemaVersion,
  spawnCommand,
  validateDocument,
  validateModuleManifest,
  validateOwnershipManifest,
  type Diagnostic,
  type OwnershipManifest,
  type ProjectManifest,
  type SecurityCheckResult,
  type ValidationResult
} from "@flower/kernel";

const EXIT = {
  success: 0,
  failure: 1,
  invalidArguments: 2,
  securityPolicy: 6,
  partial: 8
} as const;

interface ParsedArguments {
  command?: string;
  target?: string;
  json: boolean;
  version: boolean;
  help: boolean;
  dryRun: boolean;
  install: boolean;
  initializeGit: boolean;
  values: Record<string, string>;
  unknownOptions: string[];
}

interface DoctorCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

function parseArguments(argv: string[]): ParsedArguments {
  const valueOptions = new Set(["--name", "--id", "--template", "--package-manager", "--project", "--catalog"]);
  const flagOptions = new Set(["--json", "--version", "-v", "--help", "-h", "--dry-run", "--skip-install", "--git"]);
  const values: Record<string, string> = {};
  const positional: string[] = [];
  const unknownOptions: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (valueOptions.has(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) throw new Error(`${argument} requires a value`);
      values[argument.slice(2)] = value;
      index += 1;
    } else if (!argument.startsWith("-")) {
      positional.push(argument);
    } else if (!flagOptions.has(argument)) {
      unknownOptions.push(argument);
    }
  }
  const command = positional[0];
  const target = positional[1];
  return {
    ...(command ? { command } : {}),
    ...(target ? { target } : {}),
    json: argv.includes("--json"),
    version: argv.includes("--version") || argv.includes("-v"),
    help: argv.includes("--help") || argv.includes("-h"),
    dryRun: argv.includes("--dry-run"),
    install: !argv.includes("--skip-install"),
    initializeGit: argv.includes("--git"),
    values,
    unknownOptions
  };
}

function schemaRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), "../../../schemas");
}

function templateRoot(templateId: string): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), "../../../templates", templateId);
}

function defaultModuleCatalogRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), "../../../modules");
}

function defaultProjectId(target: string): string {
  return path.basename(path.resolve(target)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function defaultProjectName(projectId: string): string {
  return projectId.split("-").filter(Boolean).map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
}

function unsupportedValueOptions(args: ParsedArguments, allowed: string[]): string[] {
  return Object.keys(args.values).filter((option) => !allowed.includes(option)).sort();
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
  kind: "project" | "ownership" | "template" | "module" | "migration" | "security"
): Promise<ValidationResult> {
  try {
    const [document, schema] = await Promise.all([loadJson(filePath), loadJson(schemaPath)]);
    if (kind === "ownership") return validateOwnershipManifest(schema as object, document);
    if (kind === "module") return validateModuleManifest(schema as object, document);
    return validateDocument(schema as object, document, kind);
  } catch (error) {
    return sourceDiagnostic(`${kind}.read`, filePath, error);
  }
}

async function validateTarget(targetInput: string): Promise<ValidationResult> {
  const target = path.resolve(targetInput);
  const extension = path.extname(target).toLowerCase();

  if (extension === ".json") {
    const basename = path.basename(target);
    let declaredSchema: string | undefined;
    try {
      const document = await loadJson(target) as { $schema?: unknown };
      if (typeof document.$schema === "string") declaredSchema = document.$schema;
    } catch {
      // validateFile reports the stable read diagnostic below.
    }
    const kind = basename === "ownership.json"
      ? "ownership"
      : basename === "flower.template.json"
        ? "template"
        : basename === "flower.module.json"
          ? "module"
          : declaredSchema === "https://flower.dev/schemas/migration/v1.json"
            ? "migration"
            : declaredSchema === "https://flower.dev/schemas/security/v1.json"
              ? "security"
            : "project";
    return validateFile(
      target,
      path.join(schemaRoot(), kind, "v1.json"),
      kind
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

function printSecurity(result: SecurityCheckResult, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(result.secure ? "Flower security check passed.\n" : "Flower security check failed.\n");
  result.diagnostics.forEach((entry) => process.stdout.write(`${formatDiagnostic(entry)}\n`));
  process.stdout.write(`Scanned ${result.summary.filesScanned} text files and ${result.summary.packageManifestsScanned} package manifests.\n`);
  process.stdout.write("Live vulnerability database: not configured (offline baseline only).\n");
}

function printHelp(): void {
  process.stdout.write(`Flower ${FLOWER_VERSION}\n\n`);
  process.stdout.write("Usage:\n");
  process.stdout.write("  flower --version\n");
  process.stdout.write("  flower validate [project-or-json-path] [--json]\n");
  process.stdout.write("  flower doctor [project-path] [--json]\n");
  process.stdout.write("  flower status [project-path] [--json]\n");
  process.stdout.write("  flower security check [--project <path>] [--json]\n");
  process.stdout.write("  flower init <target> [--name <name>] [--id <id>] [--template next-supabase]\n");
  process.stdout.write("              [--package-manager npm] [--dry-run] [--skip-install] [--git] [--json]\n");
  process.stdout.write("  flower add <module> [--project <path>] [--catalog <path>] [--dry-run] [--json]\n");
  process.stdout.write("  flower remove <module> [--project <path>] [--catalog <path>] [--dry-run] [--json]\n");
  process.stdout.write("  flower eject <module> [--project <path>] [--catalog <path>] [--dry-run] [--json]\n");
}

async function main(): Promise<number> {
  const args = parseArguments(process.argv.slice(2));

  if (args.unknownOptions.length > 0) {
    process.stderr.write(`Unknown option${args.unknownOptions.length === 1 ? "" : "s"}: ${args.unknownOptions.join(", ")}\n`);
    return EXIT.invalidArguments;
  }

  if (args.version) {
    process.stdout.write(`${FLOWER_VERSION}\n`);
    return EXIT.success;
  }

  if (args.help || !args.command) {
    printHelp();
    return EXIT.success;
  }

  if (args.command === "init") {
    if (!args.target) {
      process.stderr.write("flower init requires a target directory\n");
      return EXIT.invalidArguments;
    }
    const unsupported = unsupportedValueOptions(args, ["name", "id", "template", "package-manager"]);
    if (unsupported.length > 0) {
      process.stderr.write(`Unsupported option for flower init: --${unsupported.join(", --")}\n`);
      return EXIT.invalidArguments;
    }
    const templateId = args.values.template ?? "next-supabase";
    const projectId = args.values.id ?? defaultProjectId(args.target);
    const projectName = args.values.name ?? defaultProjectName(projectId);
    const packageManagerId = args.values["package-manager"] ?? "npm";
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(templateId)) {
      process.stderr.write("Template id must be a lowercase kebab-case identifier\n");
      return EXIT.invalidArguments;
    }
    if (packageManagerId !== "npm") {
      process.stderr.write(`Unsupported package manager '${packageManagerId}'. Supported package managers: npm\n`);
      return EXIT.invalidArguments;
    }

    try {
      const templateSchema = await loadJson(path.join(schemaRoot(), "template", "v1.json"));
      const template = await loadAndVerifyTemplate(templateRoot(templateId), templateSchema as object);
      const plan = await createInitPlan({
        target: args.target,
        projectId,
        projectName,
        templateId,
        packageManager: packageManagerId,
        install: args.install,
        initializeGit: args.initializeGit
      }, template);

      if (args.dryRun) {
        if (args.json) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
        else {
          process.stdout.write(`Initialization plan ${plan.planId}\n`);
          process.stdout.write(`Target: ${plan.target}\n`);
          process.stdout.write(`Template: ${plan.template.id}@${plan.template.version} (${plan.template.digest})\n`);
          plan.actions.forEach((action) => process.stdout.write(`- ${action.kind}${action.path ? ` ${action.path}` : ""}${action.command ? `: ${action.command}` : ""}\n`));
        }
        return EXIT.success;
      }

      const result = await applyInitPlan(plan, template, spawnCommand);
      if (args.json) process.stdout.write(`${JSON.stringify({ plan, result }, null, 2)}\n`);
      else {
        process.stdout.write(`Initialized ${projectName} at ${result.target}.\n`);
        process.stdout.write(`Plan: ${result.planId}\n`);
      }
      return EXIT.success;
    } catch (error) {
      if (args.json) {
        process.stdout.write(`${JSON.stringify({
          success: false,
          code: error instanceof InitializationError ? error.code : "init.failed",
          message: error instanceof Error ? error.message : "Initialization failed"
        }, null, 2)}\n`);
      } else {
        process.stderr.write(`${error instanceof Error ? error.message : "Initialization failed"}\n`);
      }
      return error instanceof InitializationError && !error.rollbackComplete ? EXIT.partial : EXIT.failure;
    }
  }

  if (args.command === "add") {
    if (!args.target) {
      process.stderr.write("flower add requires a module id\n");
      return EXIT.invalidArguments;
    }
    const unsupported = unsupportedValueOptions(args, ["project", "catalog"]);
    if (unsupported.length > 0 || !args.install || args.initializeGit) {
      const option = unsupported[0] ? `--${unsupported[0]}` : !args.install ? "--skip-install" : "--git";
      process.stderr.write(`Unsupported option for flower add: ${option}\n`);
      return EXIT.invalidArguments;
    }
    const projectRoot = args.values.project ?? ".";
    const catalogRoot = args.values.catalog ?? defaultModuleCatalogRoot();
    try {
      const [moduleSchema, migrationSchema] = await Promise.all([
        loadJson(path.join(schemaRoot(), "module", "v1.json")),
        loadJson(path.join(schemaRoot(), "migration", "v1.json"))
      ]);
      const catalog = await loadModuleCatalog(catalogRoot, moduleSchema as object, migrationSchema as object);
      const plan = await createModuleAddPlan(projectRoot, [args.target], catalog);
      if (args.dryRun) {
        if (args.json) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
        else {
          process.stdout.write(`Module add plan ${plan.planId}\n`);
          process.stdout.write(`Project: ${plan.projectRoot}\n`);
          process.stdout.write(`Modules: ${plan.modules.length ? plan.modules.map((module) => `${module.id}@${module.version}`).join(", ") : "unchanged"}\n`);
          plan.files.forEach((file) => process.stdout.write(`- generate ${file.path}\n`));
        }
        return EXIT.success;
      }
      const result = await applyModuleAddPlan(plan, catalog);
      if (args.json) process.stdout.write(`${JSON.stringify({ plan, result }, null, 2)}\n`);
      else process.stdout.write(result.status === "unchanged" ? "Requested modules are already installed.\n" : `Installed modules: ${result.installedModules.join(", ")}\n`);
      return EXIT.success;
    } catch (error) {
      if (args.json) {
        process.stdout.write(`${JSON.stringify({
          success: false,
          code: error instanceof ModuleAddError ? error.code : "module.addFailed",
          message: error instanceof Error ? error.message : "Module installation failed",
          diagnostics: error instanceof ModuleAddError ? error.diagnostics : []
        }, null, 2)}\n`);
      } else {
        process.stderr.write(`${error instanceof Error ? error.message : "Module installation failed"}\n`);
      }
      return error instanceof ModuleAddError && !error.rollbackComplete ? EXIT.partial : EXIT.failure;
    }
  }

  if (args.command === "remove" || args.command === "eject") {
    if (!args.target) {
      process.stderr.write(`flower ${args.command} requires a module id\n`);
      return EXIT.invalidArguments;
    }
    const unsupported = unsupportedValueOptions(args, ["project", "catalog"]);
    if (unsupported.length > 0 || !args.install || args.initializeGit) {
      const option = unsupported[0] ? `--${unsupported[0]}` : !args.install ? "--skip-install" : "--git";
      process.stderr.write(`Unsupported option for flower ${args.command}: ${option}\n`);
      return EXIT.invalidArguments;
    }
    const projectRoot = args.values.project ?? ".";
    const catalogRoot = args.values.catalog ?? defaultModuleCatalogRoot();
    try {
      const [moduleSchema, migrationSchema] = await Promise.all([
        loadJson(path.join(schemaRoot(), "module", "v1.json")),
        loadJson(path.join(schemaRoot(), "migration", "v1.json"))
      ]);
      const catalog = await loadModuleCatalog(catalogRoot, moduleSchema as object, migrationSchema as object);
      const plan = await createModuleDispositionPlan(projectRoot, args.target, args.command, catalog);
      if (args.dryRun) {
        if (args.json) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
        else {
          process.stdout.write(`Module ${args.command} plan ${plan.planId}\n`);
          process.stdout.write(`Project: ${plan.projectRoot}\n`);
          process.stdout.write(`Module: ${plan.state === "unchanged" ? "unchanged" : `${plan.module.id}@${plan.module.version}`}\n`);
          plan.files.forEach((file) => process.stdout.write(`- ${args.command === "remove" ? "delete" : "retain as project-owned"} ${file.path}\n`));
        }
        return EXIT.success;
      }
      const result = await applyModuleDispositionPlan(plan, catalog);
      if (args.json) process.stdout.write(`${JSON.stringify({ plan, result }, null, 2)}\n`);
      else process.stdout.write(result.status === "unchanged" ? `Module '${args.target}' is not installed.\n` : `${args.command === "remove" ? "Removed" : "Ejected"} module: ${args.target}\n`);
      return EXIT.success;
    } catch (error) {
      if (args.json) {
        process.stdout.write(`${JSON.stringify({
          success: false,
          code: error instanceof ModuleDispositionError ? error.code : `module.${args.command}Failed`,
          message: error instanceof Error ? error.message : `Module ${args.command} failed`,
          diagnostics: error instanceof ModuleDispositionError ? error.diagnostics : []
        }, null, 2)}\n`);
      } else {
        process.stderr.write(`${error instanceof Error ? error.message : `Module ${args.command} failed`}\n`);
      }
      return error instanceof ModuleDispositionError && !error.rollbackComplete ? EXIT.partial : EXIT.failure;
    }
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

  if (args.command === "security") {
    if (args.target !== "check") {
      process.stderr.write("Usage: flower security check [--project <path>] [--json]\n");
      return EXIT.invalidArguments;
    }
    const unsupported = unsupportedValueOptions(args, ["project"]);
    if (unsupported.length > 0 || args.dryRun || !args.install || args.initializeGit) {
      const option = unsupported[0]
        ? `--${unsupported[0]}`
        : args.dryRun
          ? "--dry-run"
          : !args.install
            ? "--skip-install"
            : "--git";
      process.stderr.write(`Unsupported option for flower security check: ${option}\n`);
      return EXIT.invalidArguments;
    }
    const result = await checkProjectSecurity(
      args.values.project ?? ".",
      await loadJson(path.join(schemaRoot(), "security", "v1.json")) as object
    );
    printSecurity(result, args.json);
    return result.secure ? EXIT.success : EXIT.securityPolicy;
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
