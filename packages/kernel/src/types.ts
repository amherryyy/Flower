export const FLOWER_VERSION = "0.1.0";

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  code: string;
  path: string;
  message: string;
  severity: DiagnosticSeverity;
}

export interface ValidationResult {
  valid: boolean;
  diagnostics: Diagnostic[];
}

export type ProjectMode = "framework" | "project" | "module";

export interface ProjectManifest {
  $schema?: string;
  schemaVersion: number;
  mode: ProjectMode;
  project: {
    id: string;
    name: string;
    description?: string;
    domain?: string;
  };
  flower: {
    version: string;
    channel: "stable" | "preview" | "development";
  };
  stack: {
    language: string;
    runtime: string;
    web?: string;
    database?: string;
    packageManager: string;
  };
  modules?: Record<string, string>;
  capabilities?: Record<string, boolean>;
  quality?: {
    minimumCoverage?: number;
    requireArchitectureCheck?: boolean;
    requireSecurityCheck?: boolean;
  };
  adapters?: Record<string, boolean>;
}

export type OwnershipKind =
  | "framework"
  | "generated"
  | "project"
  | "protected"
  | "local";

export type OwnershipPolicy =
  | "package-managed"
  | "replace-if-unmodified"
  | "never-overwrite"
  | "migration-engine-only"
  | "never-commit";

export interface OwnershipRule {
  pattern: string;
  owner: OwnershipKind;
  policy: OwnershipPolicy;
}

export interface OwnershipManifest {
  version: number;
  rules: OwnershipRule[];
}

export interface PathClassification {
  path: string;
  matches: OwnershipRule[];
  rule?: OwnershipRule;
  conflict: boolean;
}

export interface ManifestMigrationStep {
  from: number;
  to: number;
  description: string;
}

export interface ManifestMigrationResult {
  fromVersion: number;
  toVersion: number;
  changed: boolean;
  document: Record<string, unknown>;
  steps: ManifestMigrationStep[];
}

export interface JournalEntry {
  id: string;
  timestamp: string;
  command: string;
  flowerVersion: string;
  status: "started" | "completed" | "failed" | "partial";
  planId?: string;
  changedPaths?: string[];
  result?: Record<string, unknown>;
  errorCode?: string;
}

export type PackageManagerId = "npm";

export interface TemplateFile {
  source: string;
  target: string;
  digest: string;
  render?: boolean;
}

export interface TemplateManifest {
  $schema?: string;
  schemaVersion: 1;
  id: string;
  version: string;
  description: string;
  stack: {
    language: string;
    runtime: string;
    web: string;
    database: string;
  };
  files: TemplateFile[];
  verificationScripts: string[];
}

export interface VerifiedTemplate {
  root: string;
  manifest: TemplateManifest;
  digest: string;
}

export interface InitOptions {
  target: string;
  projectId: string;
  projectName: string;
  templateId: string;
  packageManager: PackageManagerId;
  install: boolean;
  initializeGit: boolean;
}

export interface InitPlanAction {
  kind: "reserve-directory" | "write-file" | "install-dependencies" | "initialize-git" | "run-script" | "write-journal";
  path?: string;
  command?: string;
}

export interface InitPlan {
  schemaVersion: 1;
  planId: string;
  digest: string;
  command: "init";
  state: "create" | "unchanged";
  target: string;
  project: { id: string; name: string };
  template: { id: string; version: string; digest: string };
  packageManager: PackageManagerId;
  install: boolean;
  initializeGit: boolean;
  actions: InitPlanAction[];
}

export interface CommandInvocation {
  executable: string;
  args: string[];
  cwd: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (invocation: CommandInvocation) => Promise<CommandResult>;

export interface InitResult {
  status: "completed" | "unchanged";
  planId: string;
  target: string;
  changedPaths: string[];
  journalPath?: string;
}

export interface ModuleManifest {
  $schema?: string;
  schemaVersion: 1;
  id: string;
  version: string;
  compatibleFlower: string;
  dependsOn: Record<string, string>;
  conflictsWith: string[];
  provides: string[];
  configurationSchema: string;
  migrations: string[];
  generatedPaths: string[];
  requiredChecks: string[];
}

export interface ModulePlanAction {
  kind: "install" | "retain";
  moduleId: string;
  version: string;
}

export interface ModuleResolutionPlan {
  valid: boolean;
  requested: string[];
  resolved: string[];
  actions: ModulePlanAction[];
  diagnostics: Diagnostic[];
}

export interface VerifiedModuleArtifact {
  path: string;
  sourcePath: string;
  sourceDigest: string;
}

export interface VerifiedModuleMigration {
  id: string;
  sourcePath: string;
  sourceDigest: string;
}

export interface VerifiedModulePackage {
  root: string;
  manifestPath: string;
  manifestDigest: string;
  configurationPath: string;
  configurationDigest: string;
  manifest: ModuleManifest;
  digest: string;
  artifacts: VerifiedModuleArtifact[];
  migrations: VerifiedModuleMigration[];
}

export interface AppliedMigration {
  id: string;
  moduleId: string;
  moduleVersion: string;
  sourceDigest: string;
}

export interface MigrationPlanAction {
  ordinal: number;
  id: string;
  moduleId: string;
  moduleVersion: string;
  sourceDigest: string;
}

export interface MigrationPlan {
  schemaVersion: 1;
  planId: string;
  digest: string;
  command: "migrate";
  state: "apply" | "unchanged";
  requestedModules: string[];
  resolvedModules: string[];
  applied: AppliedMigration[];
  actions: MigrationPlanAction[];
}

export interface ModuleAddPlanFile {
  moduleId: string;
  path: string;
  sourceDigest: string;
  outputDigest: string;
}

export interface ModuleAddPlan {
  schemaVersion: 1;
  planId: string;
  digest: string;
  command: "add";
  state: "apply" | "unchanged";
  projectRoot: string;
  requested: string[];
  resolved: string[];
  packages: Array<{ id: string; version: string; digest: string }>;
  modules: Array<{ id: string; version: string; digest: string }>;
  files: ModuleAddPlanFile[];
  preconditions: {
    projectManifestDigest: string;
    lockDigest: string;
    ownershipDigest: string;
  };
}

export interface ModuleAddResult {
  status: "completed" | "unchanged";
  planId: string;
  projectRoot: string;
  installedModules: string[];
  changedPaths: string[];
  journalPath?: string;
}

export type ModuleDisposition = "remove" | "eject";

export interface ModuleDispositionPlanFile {
  path: string;
  currentDigest: string;
  managedDigest: string;
}

export interface ModuleDispositionPlan {
  schemaVersion: 1;
  planId: string;
  digest: string;
  command: ModuleDisposition;
  state: "apply" | "unchanged";
  projectRoot: string;
  module: { id: string; version: string; digest: string };
  packages: Array<{ id: string; version: string; digest: string }>;
  files: ModuleDispositionPlanFile[];
  preconditions: {
    projectManifestDigest: string;
    lockDigest: string;
    ownershipDigest: string;
  };
}

export interface ModuleDispositionResult {
  status: "completed" | "unchanged";
  planId: string;
  projectRoot: string;
  moduleId: string;
  command: ModuleDisposition;
  changedPaths: string[];
  journalPath?: string;
}
