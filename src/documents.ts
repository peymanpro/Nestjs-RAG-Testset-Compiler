import { sha256, normalizeText, normalizeSourcePath } from "./hash.ts";
import type { EvidenceSection, MarkdownDocument } from "./types.ts";

/** Split Markdown into heading-scoped sections, ignoring headings inside fenced code blocks. */
export function parseMarkdownDocuments(documents: MarkdownDocument[]): EvidenceSection[] {
  const result: EvidenceSection[] = [];
  const seenPaths = new Set<string>();

  for (const document of [...documents].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    const sourcePath = normalizeSourcePath(document.path);
    if (seenPaths.has(sourcePath)) throw new Error(`Duplicate source path: ${sourcePath}`);
    seenPaths.add(sourcePath);

    const lines = document.content.replace(/\r\n?/g, "\n").split("\n");
    const headingOccurrences = new Map<string, number>();
    let title = "(preamble)";
    let sectionStart = 1;
    let body: string[] = [];
    let fence: { marker: string; length: number } | undefined;

    const flush = (lineEnd: number): void => {
      const content = body.map((line) => line.trim()).filter(Boolean).join("\n");
      if (normalizeText(content).length === 0) return;
      const occurrence = (headingOccurrences.get(title) ?? 0) + 1;
      headingOccurrences.set(title, occurrence);
      result.push({
        id: `${sourcePath}::${title}::${occurrence}`,
        sourcePath,
        title,
        occurrence,
        content,
        contentHash: sha256(`${title}\n${normalizeText(content)}`),
        lineStart: sectionStart,
        lineEnd,
      });
    };

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const trimmed = line.trim();
      const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
      if (fenceMatch) {
        if (!fence) fence = { marker: fenceMatch[1]![0]!, length: fenceMatch[1]!.length };
        else if (fenceMatch[1]![0] === fence.marker && fenceMatch[1]!.length >= fence.length) fence = undefined;
        body.push(line);
        continue;
      }
      if (!fence) {
        const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed);
        if (heading) {
          flush(index);
          title = heading[2]!.trim();
          sectionStart = index + 2;
          body = [];
          continue;
        }
      }
      body.push(line);
    }
    flush(lines.length);
  }
  return result;
}

export function cleanMarkdownLine(line: string): string {
  return line.trim().replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "").trim();
}
