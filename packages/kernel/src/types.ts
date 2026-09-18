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
