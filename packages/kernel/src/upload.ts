import path from "node:path";
import type { Diagnostic, ValidationResult } from "./types.js";

export interface UploadPolicy {
  $schema?: string;
  schemaVersion: 1;
  maxBytes: number;
  ownerScopes: Array<"user" | "organization">;
  mediaTypes: Array<{
    mediaType: string;
    extensions: string[];
    signatures: string[];
  }>;
}

export interface UploadCandidate {
  fileName: string;
  size: number;
  declaredMediaType: string;
  headerBytes: Uint8Array;
  owner: { scope: "user" | "organization"; id: string };
}

export interface UploadActor {
  userId: string;
  organizationIds: readonly string[];
}

function issue(code: string, path: string, message: string): Diagnostic {
  return { code, path, message, severity: "error" };
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function signatureMatches(bytes: Uint8Array, signature: string): boolean {
  if (!/^(?:[a-f0-9]{2})+$/i.test(signature)) return false;
  const expected = Buffer.from(signature, "hex");
  return bytes.length >= expected.length && expected.every((value, index) => bytes[index] === value);
}

export function validateUpload(
  policy: UploadPolicy,
  candidate: UploadCandidate,
  actor: UploadActor
): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  if (!Number.isSafeInteger(policy.maxBytes) || policy.maxBytes < 1 || policy.mediaTypes.length === 0) {
    return { valid: false, diagnostics: [issue("upload.policy.invalid", "/policy", "Upload policy is invalid or empty.")] };
  }
  if (
    candidate.fileName.length < 1 ||
    candidate.fileName.length > 255 ||
    candidate.fileName !== path.basename(candidate.fileName) ||
    /[\\/\u0000-\u001f\u007f]/.test(candidate.fileName) ||
    candidate.fileName === "." ||
    candidate.fileName === ".."
  ) {
    diagnostics.push(issue("upload.fileName", "/fileName", "File name must be a plain, control-free base name of at most 255 characters."));
  }
  if (!Number.isSafeInteger(candidate.size) || candidate.size < 1 || candidate.size > policy.maxBytes) {
    diagnostics.push(issue("upload.size", "/size", `Upload size must be between 1 and ${policy.maxBytes} bytes.`));
  }
  const mediaType = policy.mediaTypes.find((entry) => entry.mediaType === candidate.declaredMediaType.toLowerCase());
  if (!mediaType) {
    diagnostics.push(issue("upload.mediaType", "/declaredMediaType", "Declared media type is not allowed."));
  } else {
    const extension = path.extname(candidate.fileName).toLowerCase();
    if (!mediaType.extensions.includes(extension)) {
      diagnostics.push(issue("upload.extension", "/fileName", "File extension does not match the declared media type."));
    }
    if (!mediaType.signatures.some((signature) => signatureMatches(candidate.headerBytes, signature))) {
      diagnostics.push(issue("upload.signature", "/headerBytes", "File signature does not match the declared media type."));
    }
  }
  if (!policy.ownerScopes.includes(candidate.owner.scope) || !uuid(candidate.owner.id) || !uuid(actor.userId)) {
    diagnostics.push(issue("upload.owner", "/owner", "Upload owner is invalid or uses a disallowed scope."));
  } else if (
    (candidate.owner.scope === "user" && candidate.owner.id !== actor.userId) ||
    (candidate.owner.scope === "organization" && !actor.organizationIds.includes(candidate.owner.id))
  ) {
    diagnostics.push(issue("upload.ownerDenied", "/owner", "The authenticated actor does not own the requested upload scope."));
  }
  diagnostics.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
  return { valid: diagnostics.length === 0, diagnostics };
}
