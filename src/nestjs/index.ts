import { DynamicModule, Module, Provider } from "@nestjs/common";
import { analyzeCorpusDrift, generateTestset, validateTestset } from "../testset.ts";
import { analyzeChangeImpact } from "../impact.ts";
import type { ChangeImpactReport, GenerateTestsetOptions, MarkdownDocument, ScenarioSynthesizer, Testset, ValidationResult, DriftReport } from "../types.ts";

export const RAG_TESTSET_OPTIONS = Symbol.for("RAG_TESTSET_OPTIONS");

export interface RagTestsetModuleOptions {
  synthesizer: ScenarioSynthesizer;
  strictEvidence?: boolean;
}

export class RagTestsetService {
  private readonly options: RagTestsetModuleOptions;

  constructor(options: RagTestsetModuleOptions) {
    this.options = options;
  }

  generate(documents: MarkdownDocument[], options: GenerateTestsetOptions = {}): Promise<Testset> {
    return generateTestset(documents, this.options.synthesizer, {
      strictEvidence: this.options.strictEvidence ?? options.strictEvidence,
    });
  }

  validate(documents: MarkdownDocument[], testset: Testset): ValidationResult {
    return validateTestset(documents, testset);
  }

  diff(documents: MarkdownDocument[], testset: Testset): DriftReport {
    return analyzeCorpusDrift(documents, testset);
  }

  impact(previousDocuments: MarkdownDocument[], currentDocuments: MarkdownDocument[], testset: Testset): ChangeImpactReport {
    return analyzeChangeImpact(previousDocuments, currentDocuments, testset);
  }
}

@Module({})
export class RagTestsetModule {
  static register(options: RagTestsetModuleOptions): DynamicModule {
    const optionsProvider: Provider = { provide: RAG_TESTSET_OPTIONS, useValue: options };
    const serviceProvider: Provider = {
      provide: RagTestsetService,
      useFactory: (resolvedOptions: RagTestsetModuleOptions) => new RagTestsetService(resolvedOptions),
      inject: [RAG_TESTSET_OPTIONS],
    };
    return {
      module: RagTestsetModule,
      providers: [optionsProvider, serviceProvider],
      exports: [RagTestsetService],
    };
  }
}
