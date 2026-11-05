import type {
  AnalysisDiagnostic,
  AnalysisDimension,
  AnalysisNodeExecution,
  AnalysisNodeKind,
} from "../../src/types/analysis";
import { createId } from "../lib/requestContext";

export interface AgentStepConfig {
  nodeId: string;
  kind: AnalysisNodeKind;
  inputDimensions: AnalysisDimension[];
  outputDimensions: AnalysisDimension[];
}

export class AgentStepRunner {
  readonly executions: AnalysisNodeExecution[] = [];

  constructor(private readonly diagnostics: AnalysisDiagnostic[]) {}

  async run<T>(config: AgentStepConfig, task: () => T | Promise<T>): Promise<T> {
    const startedAt = new Date();
    const diagnosticStartIndex = this.diagnostics.length;
    const execution: AnalysisNodeExecution = {
      nodeId: config.nodeId,
      kind: config.kind,
      status: "running",
      startedAt: startedAt.toISOString(),
      inputDimensions: config.inputDimensions,
      outputDimensions: config.outputDimensions,
      diagnostics: [],
    };

    this.executions.push(execution);

    try {
      const result = await task();
      completeExecution(execution, startedAt, "completed");
      execution.diagnostics = this.readStepDiagnostics(
        config.nodeId,
        diagnosticStartIndex,
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const diagnostic: AnalysisDiagnostic = {
        id: createId("diagnostic"),
        level: "error",
        message,
        nodeId: config.nodeId,
      };

      this.diagnostics.push(diagnostic);
      completeExecution(execution, startedAt, "failed");
      execution.diagnostics = this.readStepDiagnostics(
        config.nodeId,
        diagnosticStartIndex,
      );
      throw error;
    }
  }

  private readStepDiagnostics(
    nodeId: string,
    startIndex: number,
  ): AnalysisDiagnostic[] {
    return this.diagnostics
      .slice(startIndex)
      .filter((diagnostic) => diagnostic.nodeId === nodeId);
  }
}

function completeExecution(
  execution: AnalysisNodeExecution,
  startedAt: Date,
  status: "completed" | "failed",
): void {
  const completedAt = new Date();
  execution.status = status;
  execution.completedAt = completedAt.toISOString();
  execution.durationMs = Math.max(completedAt.getTime() - startedAt.getTime(), 0);
}
