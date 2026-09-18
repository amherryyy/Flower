import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateDocument } from "../packages/kernel/src/index.js";

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")) as unknown;
}

describe("project manifest validation", () => {
  it("accepts the valid project fixture", async () => {
    const [schema, document] = await Promise.all([
      json("../schemas/project/v1.json"),
      json("./fixtures/valid-project/.flower/project.json")
    ]);

    expect(validateDocument(schema as object, document, "project")).toEqual({
      valid: true,
      diagnostics: []
    });
  });

  it("returns stable diagnostics for an invalid project", async () => {
    const [schema, document] = await Promise.all([
      json("../schemas/project/v1.json"),
      json("./fixtures/invalid-project/.flower/project.json")
    ]);
    const result = validateDocument(schema as object, document, "project");

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "project.additionalProperties",
        "project.enum",
        "project.pattern",
        "project.required"
      ])
    );
    expect(result.diagnostics).toEqual(
      [...result.diagnostics].sort(
        (left, right) =>
          left.path.localeCompare(right.path) ||
          left.code.localeCompare(right.code) ||
          left.message.localeCompare(right.message)
      )
    );
  });
});
