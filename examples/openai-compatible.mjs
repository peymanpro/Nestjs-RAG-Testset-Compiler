import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { OpenAICompatibleSynthesizer, generateTestset, validateTestset } from "../dist/index.js";

async function collectMarkdown(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const documents = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) documents.push(...await collectMarkdown(absolute));
    else if (entry.isFile() && /\.(md|txt)$/i.test(entry.name)) {
      documents.push({ path: path.relative(process.cwd(), absolute).replaceAll(path.sep, "/"), content: await readFile(absolute, "utf8") });
    }
  }
  return documents;
}

const documents = await collectMarkdown("./examples/docs");
const synthesizer = new OpenAICompatibleSynthesizer({
  apiKey: process.env.NESTJS_RAG_TESTSET_API_KEY ?? "",
  model: process.env.NESTJS_RAG_TESTSET_MODEL ?? "",
  baseUrl: process.env.NESTJS_RAG_TESTSET_BASE_URL,
});
const testset = await generateTestset(documents, synthesizer, { strictEvidence: true });
const validation = validateTestset(documents, testset);
if (!validation.valid) throw new Error(JSON.stringify(validation.issues, null, 2));
console.log(JSON.stringify(testset, null, 2));
