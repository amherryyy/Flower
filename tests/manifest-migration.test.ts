import { describe, expect, it } from "vitest";
import {
  LATEST_PROJECT_SCHEMA_VERSION,
  migrateProjectManifest,
  projectSchemaVersion
} from "../packages/kernel/src/index.js";

describe("project manifest migrations", () => {
  it("migrates a legacy manifest to the current version without mutating the source", () => {
    const legacy = {
      frameworkVersion: "0.0.9",
      project: { id: "sample-project", name: "Sample Project" },
      stack: { language: "typescript", runtime: "node", packageManager: "npm" }
    };

    const result = migrateProjectManifest(legacy);

    expect(projectSchemaVersion(legacy)).toBe(0);
    expect(result.changed).toBe(true);
    expect(result.toVersion).toBe(LATEST_PROJECT_SCHEMA_VERSION);
    expect(result.document).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        mode: "project",
        flower: { version: "0.0.9", channel: "development" }
      })
    );
    expect(result.document).not.toHaveProperty("frameworkVersion");
  });

  it("leaves an up-to-date manifest unchanged", () => {
    const manifest = { schemaVersion: 1 };
    const result = migrateProjectManifest(manifest);

    expect(result.changed).toBe(false);
    expect(result.document).toEqual(manifest);
    expect(result.document).not.toBe(manifest);
  });

  it("rejects manifests newer than the running Flower version supports", () => {
    expect(() => migrateProjectManifest({ schemaVersion: 2 })).toThrow(/newer than supported/);
  });
});
