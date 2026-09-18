import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  classifyPath,
  normalizeProjectPath,
  validateMutationOwnership,
  validateOwnershipCoverage,
  validateOwnershipManifest,
  type OwnershipManifest
} from "../packages/kernel/src/index.js";

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")) as unknown;
}

describe("ownership validation", () => {
  it("classifies project paths consistently across path separators", async () => {
    const manifest = (await json(
      "./fixtures/valid-project/.flower/ownership.json"
    )) as OwnershipManifest;

    const classification = classifyPath(manifest, "src\\domain\\leases\\service.ts");
    expect(classification.conflict).toBe(false);
    expect(classification.rule?.owner).toBe("project");
    expect(classification.path).toBe("src/domain/leases/service.ts");
  });

  it("rejects traversal and absolute paths", () => {
    expect(() => normalizeProjectPath("../outside.txt")).toThrow(/traverse/);
    expect(() => normalizeProjectPath(process.platform === "win32" ? "C:\\outside.txt" : "/outside.txt")).toThrow(
      /relative/
    );
  });

  it("detects conflicting rules for the same pattern", async () => {
    const [schema, document] = await Promise.all([
      json("../schemas/ownership/v1.json"),
      json("./fixtures/conflicting-ownership/.flower/ownership.json")
    ]);
    const result = validateOwnershipManifest(schema as object, document);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ownership.patternConflict" })
    );
  });

  it("reports paths that have no declared owner", async () => {
    const manifest = (await json(
      "./fixtures/valid-project/.flower/ownership.json"
    )) as OwnershipManifest;
    const result = validateOwnershipCoverage(manifest, [
      "src/domain/leases/service.ts",
      "unmanaged/file.txt"
    ]);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "ownership.unclassifiedPath",
        path: "unmanaged/file.txt"
      })
    );
  });

  it("denies writes outside the owners allowed by an operation", async () => {
    const manifest = (await json(
      "./fixtures/valid-project/.flower/ownership.json"
    )) as OwnershipManifest;
    const result = validateMutationOwnership(manifest, [
      "src/domain/leases/service.ts",
      ".flower/generated/context.md"
    ]);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "ownership.writeDenied",
        path: ".flower/generated/context.md"
      })
    );
  });
});
