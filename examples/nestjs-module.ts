import { Module } from "@nestjs/common";
import { RagTestsetModule } from "rag-testset-compiler/nestjs";
import { OpenAICompatibleSynthesizer } from "rag-testset-compiler";

@Module({
  imports: [
    RagTestsetModule.register({
      synthesizer: new OpenAICompatibleSynthesizer({
        apiKey: process.env.RAG_TESTSET_API_KEY ?? "",
        model: process.env.RAG_TESTSET_MODEL ?? "",
      }),
      strictEvidence: true,
    }),
  ],
})
export class EvaluationModule {}
