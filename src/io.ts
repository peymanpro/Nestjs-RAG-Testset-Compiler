import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { MarkdownDocument } from "./types.ts";

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return walk(entryPath);
    return entry.isFile() && /\.(md|txt)$/i.test(entry.name) ? [entryPath] : [];
  }));
  return files.flat();
}

export async function loadDocuments(directory: string): Promise<MarkdownDocument[]> {
  const root = path.resolve(directory);
  const files = (await walk(root)).sort((a, b) => a.localeCompare(b));
  return Promise.all(files.map(async (file) => ({ path: path.relative(root, file).split(path.sep).join("/"), content: await readFile(file, "utf8") })));
}

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeJsonLines(file: string, values: unknown[]): Promise<void> {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, values.map((value) => JSON.stringify(value)).join("\n") + "\n", "utf8");
}
