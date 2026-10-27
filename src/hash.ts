import { createHash } from "node:crypto";
import type { MarkdownDocument } from "./types.ts";

export function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function normalizeQuestion(value: string): string {
  return normalizeText(value)
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSourcePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error(`Source path must be relative: ${value}`);
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === ".." || segment === "")) {
    throw new Error(`Source path must not contain empty or parent segments: ${value}`);
  }
  const safeSegments = segments.filter((segment) => segment !== ".");
  if (safeSegments.length === 0) throw new Error(`Source path must identify a file: ${value}`);
  return safeSegments.join("/");
}

export function corpusFingerprint(documents: MarkdownDocument[]): string {
  const ordered = documents
    .map((doc) => ({ path: normalizeSourcePath(doc.path), content: normalizeText(doc.content) }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const paths = new Set<string>();
  for (const document of ordered) {
    if (paths.has(document.path)) throw new Error(`Duplicate source path: ${document.path}`);
    paths.add(document.path);
  }
  return sha256(ordered.map((doc) => `${doc.path}\0${doc.content}`).join("\n\u001e\n"));
}
