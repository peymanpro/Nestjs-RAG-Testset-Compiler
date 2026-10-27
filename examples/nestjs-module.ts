import { Module } from "@nestjs/common";
import { RagTestsetModule } from "nestjs-rag-testset-compiler/nestjs";
import { OpenAICompatibleSynthesizer } from "nestjs-rag-testset-compiler";

@Module({
  imports: [
    RagTestsetModule.register({
      synthesizer: new OpenAICompatibleSynthesizer({
        apiKey: process.env.NESTJS_RAG_TESTSET_API_KEY ?? "",
        model: process.env.NESTJS_RAG_TESTSET_MODEL ?? "",
      }),
      strictEvidence: true,
    }),
  ],
})
export class EvaluationModule {}
