import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import type { Diagnostic, ValidationResult } from "./types.js";

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: true
  });
  ajv.addFormat("uri-reference", {
    type: "string",
    validate: (value: string) => !/\s/.test(value)
  });
  return ajv;
}

function stableDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.sort((left, right) => {
    return (
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message)
    );
  });
}

function errorPath(error: ErrorObject): string {
  if (error.keyword === "required") {
    const missing = (error.params as { missingProperty?: string }).missingProperty;
    return `${error.instancePath || ""}/${missing ?? ""}` || "/";
  }

  return error.instancePath || "/";
}

export function validateDocument(
  schema: object,
  document: unknown,
  codePrefix: string
): ValidationResult {
  const validate = createAjv().compile(schema);
  const valid = validate(document);
  const diagnostics: Diagnostic[] = (validate.errors ?? []).map((error) => ({
    code: `${codePrefix}.${error.keyword}`,
    path: errorPath(error),
    message: error.message ?? "Schema validation failed",
    severity: "error"
  }));

  return {
    valid: Boolean(valid),
    diagnostics: stableDiagnostics(diagnostics)
  };
}

export function assertValidJsonSchema(schema: object): void {
  createAjv().compile(schema);
}

export function combineValidationResults(
  ...results: ValidationResult[]
): ValidationResult {
  const diagnostics = stableDiagnostics(results.flatMap((result) => result.diagnostics));
  return {
    valid: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    diagnostics
  };
}
