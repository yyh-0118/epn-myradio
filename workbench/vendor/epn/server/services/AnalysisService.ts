import { serverEnv } from "../config/env";
import { buildRhymeAnalysisPrompt } from "../prompts/rhymeAnalysisPrompt";
import {
  normalizeRhymeAnalysisDraft,
  type RhymeAnalysisDraft,
  type RhymeAnalysisUnitDraft,
} from "../schemas/rhyme-analysis.schema";
import type {
  AnalyzeLyricsRequest,
  AnalyzeLyricsResponse,
  RapAnalysisData,
  RapNode,
  RhymeSchemeEntry,
  VibeVector,
} from "../models/node";
import { DeepSeekClient, type LlmChatMessage } from "./DeepSeekClient";
import { AgentStepRunner } from "./AgentStepRunner";
import { MusicMetadataService } from "./MusicMetadataService";
import {
  mergeRhymeAnalysisDrafts,
  scanRhymeCandidates,
  type RhymeCandidateScan,
  type RhymeCandidateScanSummary,
} from "./RhymeCandidateScanner";
import type {
  AnalysisContract,
  AnalysisDiagnostic,
  AnalysisDimension,
  AnalysisNodeExecution,
  BarAnalysis,
  InsightBlock,
  JsonObject,
  JsonValue,
  LyricLine,
  RhymeTrace,
  RhymeAnalysis,
  RhymeAdjudication,
  RhymeAdjudicationDecision,
  TrackMetadata,
} from "../../src/types/analysis";

const POSITIVE_WORDS = ["win", "rise", "fly", "light", "dream", "fire"];
const AGGRESSIVE_WORDS = ["kill", "fight", "war", "rage", "burn", "boss"];
const MELANCHOLY_WORDS = ["rain", "pain", "lost", "alone", "cold", "night"];
const CHINESE_TENSION_WORDS = [
  "雨",
  "黑",
  "夜",
  "外婆",
  "惦记",
  "想起",
  "倾斜",
  "换乘",
  "零钱",
  "慢",
];
const CHINESE_NEGATION_WORDS = [
  "不",
  "没",
  "无",
  "别",
  "懒",
  "不会",
];
const CHINESE_TRANSITION_WORDS = [
  "但",
  "却",
  "如今",
  "所以",
  "再",
  "只是",
  "还",
];

interface LlmAnalysisDraft {
  track?: LlmTrackDraft;
  summary?: LlmSummaryDraft;
  lines?: LlmLineDraft[];
  vibeVector?: Partial<VibeVector>;
  insights?: LlmInsightDraft[];
  rhymeAnalysis?: RhymeAnalysisDraft;
  rhymeAdjudication?: RhymeAdjudication;
}

interface LlmTrackDraft {
  title?: string;
  artist?: string;
  bpm?: number;
  language?: string;
  confidence?: number;
}

interface LlmSummaryDraft {
  title?: string;
  description?: string;
  keywords?: string[];
  confidence?: number;
}

interface LlmLineDraft {
  index?: number;
  text?: string;
  endWord?: string;
  rhymeLabel?: string;
  phoneticKey?: string;
  rhymeType?: string;
  energy?: number;
  tension?: number;
  density?: number;
  emotion?: string;
  note?: string;
  confidence?: number;
}

interface LlmInsightDraft {
  dimension?: AnalysisDimension;
  title?: string;
  body?: string;
  evidenceLineIndexes?: number[];
}

interface RhymeAnalysisCoverage {
  totalLines: number;
  unitCount: number;
  coveredLineCount: number;
  coverageRatio: number;
  lineEndCount: number;
  middleUnitCount: number;
  internalUnitCount: number;
  crossLineUnitCount: number;
  multiSyllableCount: number;
  repetitionCount: number;
  slantCount: number;
  isLikelyLineEndOnly: boolean;
  isLikelyIncomplete: boolean;
}

interface HeuristicLineMetrics {
  energy: number;
  tension: number;
  density: number;
}

export class AnalysisService {
  private readonly deepSeekClient = new DeepSeekClient();

  constructor(
    private readonly musicMetadataService = new MusicMetadataService(),
  ) {}

  async analyzeLyrics(request: AnalyzeLyricsRequest): Promise<AnalyzeLyricsResponse> {
    const createdAt = new Date().toISOString();
    const requestId = request.requestId ?? createId("analysis");
    const traceId = request.traceId ?? createId("trace");
    const diagnostics: AnalysisDiagnostic[] = [];
    const stepRunner = new AgentStepRunner(diagnostics);
    const lines = await stepRunner.run(
      {
        nodeId: "lyric-segmenter",
        kind: "lyric-segmenter",
        inputDimensions: ["structure"],
        outputDimensions: ["structure"],
      },
      () => this.createLyricLines(request.rawLyrics),
    );
    const resolvedTrack = await stepRunner.run(
      {
        nodeId: "track-resolver",
        kind: "contract-normalizer",
        inputDimensions: ["structure"],
        outputDimensions: ["semantic", "structure"],
      },
      () =>
        this.musicMetadataService.resolveTrackMetadata({
          rawLyrics: request.rawLyrics,
          track: request.track,
          locale: request.locale,
          allowRemoteLookup: shouldLookupRemoteTrack(request.track),
          diagnostics,
        }),
    );
    const requestWithResolvedTrack = { ...request, track: resolvedTrack };
    const rhymeCandidateScan = await stepRunner.run(
      {
        nodeId: "rhyme-candidate-scanner",
        kind: "rhyme-tracker",
        inputDimensions: ["structure"],
        outputDimensions: ["rhyme"],
      },
      () => scanRhymeCandidates(lines),
    );

    diagnostics.push({
      id: createId("diagnostic"),
      level: "info",
      message: `Rhyme candidate scanner generated ${rhymeCandidateScan.summary.candidateCount} candidates and ${rhymeCandidateScan.summary.confirmedUnitCount} heuristic units.`,
      nodeId: "rhyme-candidate-scanner",
      details: createRhymeCandidateScanDiagnosticDetails(rhymeCandidateScan),
    });

    const draft = await stepRunner.run(
      {
        nodeId: "llm-analysis-service",
        kind: "insight-synthesizer",
        inputDimensions: ["structure", "rhyme", "semantic"],
        outputDimensions: ["rhyme", "emotion", "semantic"],
      },
      () =>
        this.tryCreateLlmDraft(
          requestWithResolvedTrack,
          lines,
          rhymeCandidateScan,
          diagnostics,
        ),
    );
    const llmRhymeAnalysis = await stepRunner.run(
      {
        nodeId: "rhyme-analysis-schema",
        kind: "contract-normalizer",
        inputDimensions: ["rhyme"],
        outputDimensions: ["rhyme"],
      },
      () => normalizeRhymeAnalysisDraft(draft?.rhymeAnalysis),
    );

    if (draft && !llmRhymeAnalysis) {
      diagnostics.push({
        id: createId("diagnostic"),
        level: "warning",
        message: "LLM response did not include a schema-valid rhymeAnalysis block. Falling back to candidate-scanner rhyme data.",
        nodeId: "rhyme-analysis-schema",
      });
    }

    const rhymeAnalysis = await stepRunner.run(
      {
        nodeId: "rhyme-analysis-merger",
        kind: "rhyme-tracker",
        inputDimensions: ["rhyme"],
        outputDimensions: ["rhyme"],
      },
      () => mergeRhymeAnalysisDrafts(rhymeCandidateScan.analysis, llmRhymeAnalysis),
    );
    const rhymeAdjudication = await stepRunner.run(
      {
        nodeId: "rhyme-adjudicator",
        kind: "rhyme-tracker",
        inputDimensions: ["rhyme"],
        outputDimensions: ["rhyme"],
      },
      () =>
        createRhymeAdjudication({
          candidateScan: rhymeCandidateScan,
          finalAnalysis: rhymeAnalysis,
          llmAnalysis: llmRhymeAnalysis,
          llmAdjudication: draft?.rhymeAdjudication,
          usedLlm: Boolean(draft),
        }),
    );

    diagnostics.push({
      id: createId("diagnostic"),
      level: "info",
      message: `Rhyme adjudication resolved ${rhymeAdjudication.summary?.finalUnitCount ?? 0} final units from ${rhymeAdjudication.summary?.candidateUnitCount ?? 0} scanner units.`,
      nodeId: "rhyme-adjudicator",
      details: (rhymeAdjudication.summary ?? {}) as JsonObject,
    });

    const rhymeAnalysisCoverage = await stepRunner.run(
      {
        nodeId: "rhyme-coverage-inspector",
        kind: "rhyme-tracker",
        inputDimensions: ["rhyme"],
        outputDimensions: ["rhyme"],
      },
      () => inspectRhymeAnalysisCoverage(lines, rhymeAnalysis),
    );

    diagnostics.push(
      ...createRhymeAnalysisCoverageDiagnostics(
        rhymeAnalysisCoverage,
        Boolean(draft),
      ),
    );

    const bars = await stepRunner.run(
      {
        nodeId: "flow-metric-vectorizer",
        kind: "flow-analyzer",
        inputDimensions: ["structure", "semantic"],
        outputDimensions: ["flow"],
      },
      () => this.createBars(lines, draft),
    );
    const rhymeScheme = await stepRunner.run(
      {
        nodeId: "rhyme-scheme-generator",
        kind: "rhyme-tracker",
        inputDimensions: ["rhyme"],
        outputDimensions: ["rhyme"],
      },
      () => this.createRhymeScheme(lines, draft, rhymeAnalysis),
    );
    const vibeVector = await stepRunner.run(
      {
        nodeId: "vibe-vectorizer",
        kind: "narrative-curve",
        inputDimensions: ["structure", "semantic"],
        outputDimensions: ["emotion", "narrative"],
      },
      () => this.createVibeVector(request.rawLyrics, lines, draft),
    );
    const rhymeTraces = await stepRunner.run(
      {
        nodeId: "rhyme-trace-builder",
        kind: "rhyme-tracker",
        inputDimensions: ["rhyme"],
        outputDimensions: ["rhyme"],
      },
      () => this.createRhymeTraces(rhymeScheme),
    );
    const insights = await stepRunner.run(
      {
        nodeId: "insight-synthesizer",
        kind: "insight-synthesizer",
        inputDimensions: ["rhyme", "emotion", "semantic"],
        outputDimensions: ["semantic"],
      },
      () => this.createInsights(draft, rhymeScheme),
    );
    const track = mergeTrackMetadata(resolvedTrack, draft?.track);
    const contract = await stepRunner.run(
      {
        nodeId: "contract-assembler",
        kind: "contract-normalizer",
        inputDimensions: ["structure", "rhyme", "flow", "emotion", "semantic"],
        outputDimensions: ["structure", "rhyme", "flow", "emotion", "semantic"],
      },
      () =>
        this.createContract({
          request,
          requestId,
          traceId,
          createdAt,
          track,
          lines,
          bars,
          rhymeScheme,
          rhymeAnalysis,
          rhymeAdjudication,
          rhymeAnalysisCoverage,
          rhymeCandidateScan,
          rhymeTraces,
          vibeVector,
          insights,
          diagnostics,
          draft,
          usedLlm: Boolean(draft),
          nodeExecutions: stepRunner.executions,
        }),
    );
    const node: RapNode = {
      id: createId("rap-node"),
      kind: "rap-analysis",
      label: draft ? "LLM Rap Analysis Node" : "Rap Analysis Node",
      version: serverEnv.agentVersion,
      status: "completed",
      analysis: {
        rawLyrics: request.rawLyrics,
        track,
        rhymeScheme,
        vibeVector,
      },
      contract,
      diagnostics: contract.diagnostics,
      createdAt,
      updatedAt: createdAt,
    };

    return {
      node,
      rhymeScheme,
      vibeVector,
    };
  }
  private async tryCreateLlmDraft(
    request: AnalyzeLyricsRequest,
    lines: LyricLine[],
    rhymeCandidateScan: RhymeCandidateScan,
    diagnostics: AnalysisDiagnostic[],
  ): Promise<LlmAnalysisDraft | undefined> {
    if (!serverEnv.useRealLlm) {
      diagnostics.push({
        id: createId("diagnostic"),
        level: "info",
        message: "USE_REAL_LLM is disabled. Using heuristic analysis baseline.",
        nodeId: "llm-analysis-service",
      });
      return undefined;
    }

    if (!this.deepSeekClient.isConfigured) {
      diagnostics.push({
        id: createId("diagnostic"),
        level: "warning",
        message: "USE_REAL_LLM is true, but the LLM proxy config is incomplete. Falling back to heuristic analysis.",
        nodeId: "llm-analysis-service",
      });
      return undefined;
    }

    try {
      const draft = await this.deepSeekClient.completeJson<LlmAnalysisDraft>({
        messages: await createAnalysisMessages(
          request,
          lines,
          rhymeCandidateScan,
        ),
        temperature: serverEnv.llmTemperature,
        maxTokens: serverEnv.llmMaxTokens,
        disableThinking: true,
      });

      diagnostics.push({
        id: createId("diagnostic"),
        level: "info",
        message: "LLM JSON analysis draft generated successfully.",
        nodeId: "llm-analysis-service",
      });

      return draft;
    } catch (error) {
      diagnostics.push({
        id: createId("diagnostic"),
        level: "warning",
        message: `LLM analysis failed. Falling back to heuristic analysis. ${readErrorMessage(error)}`,
        nodeId: "llm-analysis-service",
      });
      return undefined;
    }
  }

  private createLyricLines(rawLyrics: string): LyricLine[] {
    return rawLyrics
      .split(/\r?\n/)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text, index) => ({
        id: `line-${index + 1}`,
        index,
        text,
        bar: index + 1,
      }));
  }

  private createBars(lines: LyricLine[], draft?: LlmAnalysisDraft): BarAnalysis[] {
    const draftLines = createDraftLineMap(draft?.lines);

    return lines.map((line) => {
      const draftLine = draftLines.get(line.index);
      const fallbackMetrics = this.createHeuristicLineMetrics(line, lines);
      const energy = readUnitNumber(draftLine?.energy, fallbackMetrics.energy);
      const tension = readUnitNumber(
        draftLine?.tension,
        fallbackMetrics.tension,
      );
      const density = readUnitNumber(
        draftLine?.density,
        fallbackMetrics.density,
      );
      const note = normalizeString(draftLine?.note);

      return {
        id: `bar-${line.index + 1}`,
        index: line.index,
        text: line.text,
        startLineId: line.id,
        endLineId: line.id,
        density,
        energy,
        tension,
        emotion: normalizeString(draftLine?.emotion),
        annotations: note ? [note] : undefined,
      };
    });
  }

  private createHeuristicLineMetrics(
    line: LyricLine,
    lines: LyricLine[],
  ): HeuristicLineMetrics {
    const text = line.text;
    const averageLength = Math.max(
      lines.reduce((sum, item) => sum + item.text.length, 0) /
        Math.max(lines.length, 1),
      1,
    );
    const previousLine = lines[line.index - 1];
    const nextLine = lines[line.index + 1];
    const lineLengthRatio = clamp(text.length / (averageLength * 1.45), 0, 1);
    const punctuationCount = countMatches(text, /[!?\uFF01\uFF1F]/g);
    const pauseCount = countMatches(text, /[,\uFF0C\u3001]/g);
    const englishRatio = clamp(countMatches(text, /[a-z]/gi) / 12, 0, 1);
    const digitRatio = clamp(countMatches(text, /\d/g) / 4, 0, 1);
    const tensionHits = countTextHits(text, CHINESE_TENSION_WORDS);
    const negationHits = countTextHits(text, CHINESE_NEGATION_WORDS);
    const transitionHits = countTextHits(text, CHINESE_TRANSITION_WORDS);
    const previousDelta = previousLine
      ? Math.abs(text.length - previousLine.text.length) / averageLength
      : 0;
    const nextDelta = nextLine
      ? Math.abs(text.length - nextLine.text.length) / averageLength
      : 0;
    const localShift = clamp((previousDelta + nextDelta) * 0.5, 0, 1);
    const progress = lines.length > 1 ? line.index / (lines.length - 1) : 0;
    const narrativeArc = Math.sin(progress * Math.PI);
    const density = clamp(
      round(0.18 + lineLengthRatio * 0.62 + pauseCount * 0.035),
      0,
      1,
    );
    const energy = clamp(
      round(
        0.24 +
          lineLengthRatio * 0.34 +
          punctuationCount * 0.12 +
          pauseCount * 0.035 +
          englishRatio * 0.12 +
          digitRatio * 0.1 +
          localShift * 0.1,
      ),
      0,
      1,
    );
    const tension = clamp(
      round(
        0.18 +
          energy * 0.3 +
          tensionHits * 0.07 +
          negationHits * 0.055 +
          transitionHits * 0.055 +
          localShift * 0.14 +
          narrativeArc * 0.11,
      ),
      0,
      1,
    );

    return {
      energy,
      tension,
      density,
    };
  }

  private createRhymeScheme(
    lines: LyricLine[],
    draft?: LlmAnalysisDraft,
    rhymeAnalysis?: RhymeAnalysisDraft,
  ): RhymeSchemeEntry[] {
    const draftLines = createDraftLineMap(draft?.lines);
    const unitsByLine = createRhymeUnitsByLine(rhymeAnalysis);
    const groupLabelById = createRhymeGroupLabelMap(rhymeAnalysis);
    const labelByKey = new Map<string, string>();

    return lines.map((line) => {
      const draftLine = draftLines.get(line.index);
      const primaryUnit = selectPrimaryRhymeUnit(unitsByLine.get(line.index));
      const unitGroupId = normalizeString(primaryUnit?.rhymeGroupId);
      const unitId = normalizeString(primaryUnit?.id);
      const endWord =
        normalizeString(primaryUnit?.text) ||
        normalizeString(draftLine?.endWord) ||
        extractEndWord(line.text);
      const phoneticKey =
        normalizeString(primaryUnit?.phoneticKey) ||
        normalizeString(draftLine?.phoneticKey) ||
        createPhoneticKey(endWord);
      const rhymeLabel =
        readRhymeGroupLabel(primaryUnit, groupLabelById) ||
        normalizeString(primaryUnit?.rhymeLabel) ||
        normalizeString(draftLine?.rhymeLabel) ||
        this.resolveRhymeLabel(phoneticKey, labelByKey);
      const rhymeType =
        normalizeString(primaryUnit?.rhymeType) ||
        normalizeString(draftLine?.rhymeType);

      return {
        lineId: line.id,
        lineIndex: line.index,
        text: line.text,
        endWord,
        rhymeLabel,
        rhymeType,
        phoneticKey,
        confidence: readUnitNumber(
          primaryUnit?.confidence ?? draftLine?.confidence,
          phoneticKey ? 0.72 : 0.35,
        ),
        ...(unitGroupId ? { groupId: unitGroupId } : {}),
        ...(unitId ? { unitId } : {}),
        ...(primaryUnit?.position ? { position: primaryUnit.position } : {}),
        ...(primaryUnit?.syllables?.length
          ? { syllables: primaryUnit.syllables }
          : {}),
      };
    });
  }

  private createVibeVector(
    rawLyrics: string,
    lines: LyricLine[],
    draft?: LlmAnalysisDraft,
  ): VibeVector {
    const fallback = this.createHeuristicVibeVector(rawLyrics, lines);
    const draftVector = draft?.vibeVector;

    return {
      energy: readUnitNumber(draftVector?.energy, fallback.energy),
      aggression: readUnitNumber(draftVector?.aggression, fallback.aggression),
      melancholy: readUnitNumber(draftVector?.melancholy, fallback.melancholy),
      confidence: readUnitNumber(draftVector?.confidence, fallback.confidence),
      bounce: readUnitNumber(draftVector?.bounce, fallback.bounce),
      narrativeTension: readUnitNumber(
        draftVector?.narrativeTension,
        fallback.narrativeTension,
      ),
    };
  }

  private createHeuristicVibeVector(
    rawLyrics: string,
    lines: LyricLine[],
  ): VibeVector {
    const normalizedText = rawLyrics.toLowerCase();
    const wordCount = normalizedText.split(/\s+/).filter(Boolean).length;
    const averageLineLength =
      lines.length > 0
        ? lines.reduce((sum, line) => sum + line.text.length, 0) / lines.length
        : 0;
    const exclamationCount = countMatches(rawLyrics, /!/g);
    const positiveHits = countWordHits(normalizedText, POSITIVE_WORDS);
    const aggressiveHits = countWordHits(normalizedText, AGGRESSIVE_WORDS);
    const melancholyHits = countWordHits(normalizedText, MELANCHOLY_WORDS);

    return {
      energy: clamp(
        round(0.35 + exclamationCount * 0.08 + averageLineLength / 180),
        0,
        1,
      ),
      aggression: clamp(round(0.2 + aggressiveHits * 0.14), 0, 1),
      melancholy: clamp(round(0.18 + melancholyHits * 0.16), 0, 1),
      confidence: clamp(round(0.52 + Math.min(lines.length, 16) * 0.02), 0, 1),
      bounce: clamp(
        round(0.3 + Math.min(wordCount / Math.max(lines.length, 1), 18) / 28),
        0,
        1,
      ),
      narrativeTension: clamp(
        round(
          0.25 +
            positiveHits * 0.05 +
            melancholyHits * 0.08 +
            aggressiveHits * 0.07,
        ),
        0,
        1,
      ),
    };
  }

  private createRhymeTraces(rhymeScheme: RhymeSchemeEntry[]): RhymeTrace[] {
    const entriesByLabel = new Map<string, RhymeSchemeEntry[]>();

    for (const entry of rhymeScheme) {
      const entries = entriesByLabel.get(entry.rhymeLabel) ?? [];
      entries.push(entry);
      entriesByLabel.set(entry.rhymeLabel, entries);
    }

    return Array.from(entriesByLabel.entries()).map(([label, entries]) => ({
      id: `rhyme-${label.toLowerCase()}`,
      label,
      phoneticKey: entries[0]?.phoneticKey ?? "",
      pattern: entries[0]?.rhymeType,
      occurrences: entries.map((entry) => ({
        id: `${entry.lineId}-rhyme`,
        lineId: entry.lineId,
        barIndex: entry.lineIndex,
        text: entry.endWord,
        syllable: entry.phoneticKey,
        position: "end",
      })),
      complexity: clamp(
        round(entries.length / Math.max(rhymeScheme.length, 1)),
        0,
        1,
      ),
      confidence: clamp(
        round(
          entries.reduce((sum, entry) => sum + entry.confidence, 0) /
            entries.length,
        ),
        0,
        1,
      ),
    }));
  }

  private createInsights(
    draft: LlmAnalysisDraft | undefined,
    rhymeScheme: RhymeSchemeEntry[],
  ): InsightBlock[] {
    const draftInsights = draft?.insights
      ?.map((insight, index): InsightBlock | null => {
        const title = normalizeString(insight.title);
        const body = normalizeString(insight.body);

        if (!title || !body) {
          return null;
        }

        return {
          id: `insight-${index + 1}`,
          dimension: insight.dimension ?? "semantic",
          title,
          body,
          evidenceIds: (insight.evidenceLineIndexes ?? [])
            .filter((lineIndex) => Number.isInteger(lineIndex) && lineIndex >= 0)
            .map((lineIndex) => `line-${lineIndex + 1}`),
        };
      })
      .filter((insight): insight is InsightBlock => Boolean(insight));

    if (draftInsights?.length) {
      return draftInsights;
    }

    return [
      {
        id: "insight-rhyme-density",
        dimension: "rhyme",
        title: "Rhyme scheme detected",
        body: `Detected ${rhymeScheme.length} lyric lines and grouped end rhymes into scheme labels.`,
        evidenceIds: rhymeScheme.map((entry) => entry.lineId),
      },
    ];
  }

  private createContract(input: {
    request: AnalyzeLyricsRequest;
    requestId: string;
    traceId: string;
    createdAt: string;
    track: TrackMetadata;
    lines: LyricLine[];
    bars: BarAnalysis[];
    rhymeScheme: RhymeSchemeEntry[];
    rhymeAnalysis?: RhymeAnalysisDraft;
    rhymeAdjudication: RhymeAdjudication;
    rhymeAnalysisCoverage: RhymeAnalysisCoverage;
    rhymeCandidateScan: RhymeCandidateScan;
    rhymeTraces: RhymeTrace[];
    vibeVector: VibeVector;
    insights: InsightBlock[];
    diagnostics: AnalysisDiagnostic[];
    usedLlm: boolean;
    nodeExecutions: AnalysisNodeExecution[];
    draft?: LlmAnalysisDraft;
  }): AnalysisContract<RapAnalysisData> {
    const data: RapAnalysisData = {
      summary: createSummary(input, input.draft),
      bars: input.bars,
      rhymeTraces: input.rhymeTraces,
      flowSegments: [],
      insights: input.insights,
      dimensions: {
        rhymeScheme: {
          dimension: "rhyme",
          version: serverEnv.analysisContractVersion,
          nodeId: "rap-analysis-service",
          confidence: input.vibeVector.confidence,
          payload: {
            rhymeScheme: input.rhymeScheme,
          },
        },
        vibeVector: {
          dimension: "emotion",
          version: serverEnv.analysisContractVersion,
          nodeId: "rap-analysis-service",
          confidence: input.vibeVector.confidence,
          payload: {
            vibeVector: input.vibeVector,
          },
        },
      },
      extensions: {
        rhymeScheme: input.rhymeScheme,
        vibeVector: input.vibeVector,
        rhymeAdjudication: input.rhymeAdjudication,
        rhymeAnalysisCoverage:
          input.rhymeAnalysisCoverage as unknown as JsonValue,
        rhymeCandidateScan: createRhymeCandidateScanExtension(
          input.rhymeCandidateScan,
        ),
        ...(input.rhymeAnalysis
          ? { rhymeAnalysis: input.rhymeAnalysis as unknown as RhymeAnalysis }
          : {}),
      },
    };

    return {
      contractType: "echopulsenode.analysis",
      version: serverEnv.analysisContractVersion,
      requestId: input.requestId,
      createdAt: input.createdAt,
      source: {
        track: input.track,
        lyrics: {
          rawText: input.request.rawLyrics,
          lines: input.lines,
        },
        locale: input.request.locale,
      },
      data,
      pipeline: {
        version: serverEnv.analysisContractVersion,
        executions: input.nodeExecutions.map((execution) => ({
          ...execution,
          diagnostics: input.diagnostics.filter(
            (diagnostic) => diagnostic.nodeId === execution.nodeId,
          ),
        })),
      },
      diagnostics: input.diagnostics,
      extensions: {
        traceId: input.traceId,
        agentName: serverEnv.agentName,
        agentVersion: serverEnv.agentVersion,
        rhymeAnalysisMode: serverEnv.rhymeAnalysisMode,
        rhymeAnalysisProfile: serverEnv.rhymeAnalysisProfile,
        rhymePromptVersion: serverEnv.rhymePromptVersion,
        rhymeAdjudication: input.rhymeAdjudication,
        rhymeAnalysisCoverage:
          input.rhymeAnalysisCoverage as unknown as JsonValue,
        rhymeCandidateScan: createRhymeCandidateScanExtension(
          input.rhymeCandidateScan,
        ),
        llmProvider: input.usedLlm ? "proxy" : "heuristic",
        ...(input.usedLlm ? { llmModel: serverEnv.llmModel } : {}),
      },
    };
  }

  private resolveRhymeLabel(
    phoneticKey: string,
    labelByKey: Map<string, string>,
  ): string {
    if (!phoneticKey) {
      return "?";
    }

    const existingLabel = labelByKey.get(phoneticKey);

    if (existingLabel) {
      return existingLabel;
    }

    const label = createSchemeLabel(labelByKey.size);
    labelByKey.set(phoneticKey, label);

    return label;
  }


}

function createRhymeAdjudication(input: {
  candidateScan: RhymeCandidateScan;
  finalAnalysis: RhymeAnalysisDraft;
  llmAnalysis?: RhymeAnalysisDraft;
  llmAdjudication?: RhymeAdjudication;
  usedLlm: boolean;
}): RhymeAdjudication {
  const candidateUnits = input.candidateScan.analysis.units ?? [];
  const finalUnits = input.finalAnalysis.units ?? [];
  const llmUnits = input.llmAnalysis?.units ?? [];
  const usedLlmUnits = input.usedLlm && llmUnits.length > 0;
  const source = usedLlmUnits ? "hybrid" : "candidate-scanner";
  const decisions: RhymeAdjudicationDecision[] = [];
  const matchedFinalIndexes = new Set<number>();
  let confirmedCount = 0;
  let rejectedCount = 0;
  let correctedCount = 0;
  let addedCount = 0;

  candidateUnits.forEach((candidate, index) => {
    const exactIndex = findExactRhymeUnitIndex(finalUnits, candidate, matchedFinalIndexes);

    if (exactIndex >= 0) {
      const finalUnit = finalUnits[exactIndex];
      matchedFinalIndexes.add(exactIndex);
      confirmedCount += 1;
      decisions.push(
        createRhymeAdjudicationDecision({
          index: decisions.length,
          status: usedLlmUnits ? "confirmed" : "heuristic-confirmed",
          candidate,
          finalUnit,
          source,
          reason: usedLlmUnits
            ? "AI 裁决保留了这个规则候选。"
            : "未启用有效 AI 裁决，使用规则扫描器确认结果。",
        }),
      );
      return;
    }

    const correctedIndex = usedLlmUnits
      ? findCorrectedRhymeUnitIndex(finalUnits, candidate, matchedFinalIndexes)
      : -1;

    if (correctedIndex >= 0) {
      const finalUnit = finalUnits[correctedIndex];
      matchedFinalIndexes.add(correctedIndex);
      correctedCount += 1;
      decisions.push(
        createRhymeAdjudicationDecision({
          index: decisions.length,
          status: "corrected",
          candidate,
          finalUnit,
          source,
          reason: "AI 裁决认为这个候选需要修正片段、位置或分组。",
        }),
      );
      return;
    }

    if (usedLlmUnits) {
      rejectedCount += 1;
      decisions.push(
        createRhymeAdjudicationDecision({
          index: decisions.length,
          status: "rejected",
          candidate,
          source,
          reason: "AI 裁决未采纳这个规则候选，可能是弱押、功能词噪音或音乐意义不足。",
        }),
      );
      return;
    }

    decisions.push(
      createRhymeAdjudicationDecision({
        index,
        status: "heuristic-confirmed",
        candidate,
        source,
        reason: "规则扫描器候选进入最终结果。",
      }),
    );
  });

  finalUnits.forEach((finalUnit, index) => {
    if (matchedFinalIndexes.has(index)) {
      return;
    }

    addedCount += 1;
    decisions.push(
      createRhymeAdjudicationDecision({
        index: decisions.length,
        status: "added",
        finalUnit,
        source: usedLlmUnits ? "llm" : source,
        reason: usedLlmUnits
          ? "AI 裁决补充了规则扫描器没有确认的韵脚。"
          : "最终结果包含一个没有对应候选的规则韵脚。",
      }),
    );
  });

  const agreementRatio = candidateUnits.length
    ? round((confirmedCount + correctedCount) / candidateUnits.length)
    : 0;
  const modelDecisionCount = Array.isArray(input.llmAdjudication?.decisions)
    ? input.llmAdjudication.decisions.length
    : 0;
  const warnings = createRhymeAdjudicationWarnings({
    source,
    usedLlm: input.usedLlm,
    llmUnitCount: llmUnits.length,
    modelDecisionCount,
    llmWarnings: input.llmAdjudication?.warnings,
  });

  return {
    source,
    mode: serverEnv.rhymeAnalysisMode,
    summary: {
      candidateUnitCount: candidateUnits.length,
      llmUnitCount: llmUnits.length,
      finalUnitCount: finalUnits.length,
      confirmedCount,
      rejectedCount,
      correctedCount,
      addedCount,
      agreementRatio,
      modelDecisionCount,
    },
    decisions: decisions.slice(0, 160),
    warnings,
  };
}

function createRhymeAdjudicationDecision(input: {
  index: number;
  status: RhymeAdjudicationDecision["status"];
  candidate?: RhymeAnalysisUnitDraft;
  finalUnit?: RhymeAnalysisUnitDraft;
  source: RhymeAdjudicationDecision["source"];
  reason: string;
}): RhymeAdjudicationDecision {
  const unit = input.finalUnit ?? input.candidate;

  return {
    id: `rhyme-adjudication-${input.index + 1}`,
    status: input.status,
    candidateId: input.candidate?.id,
    unitId: input.finalUnit?.id,
    lineId: unit?.lineId,
    lineIndex: unit ? readRhymeUnitLineIndex(unit) : undefined,
    text: input.finalUnit?.text ?? input.candidate?.text,
    candidateText: input.candidate?.text,
    finalText: input.finalUnit?.text,
    candidateRange: readRhymeUnitRange(input.candidate),
    finalRange: readRhymeUnitRange(input.finalUnit),
    rhymeGroupId: input.finalUnit?.rhymeGroupId ?? input.candidate?.rhymeGroupId,
    rhymeLabel: readAdjudicationUnitLabel(input.finalUnit ?? input.candidate),
    reason: input.reason,
    confidence: readUnitNumber(input.finalUnit?.confidence ?? input.candidate?.confidence, 0.5),
    source: input.source,
  };
}

function findExactRhymeUnitIndex(
  units: RhymeAnalysisUnitDraft[],
  candidate: RhymeAnalysisUnitDraft,
  usedIndexes: Set<number>,
): number {
  return units.findIndex(
    (unit, index) => !usedIndexes.has(index) && isExactRhymeUnitMatch(unit, candidate),
  );
}

function findCorrectedRhymeUnitIndex(
  units: RhymeAnalysisUnitDraft[],
  candidate: RhymeAnalysisUnitDraft,
  usedIndexes: Set<number>,
): number {
  const candidateLineIndex = readRhymeUnitLineIndex(candidate);
  const candidateLabel = readAdjudicationUnitLabel(candidate);
  const candidateText = normalizeString(candidate.text);
  const candidateRange = readRhymeUnitRange(candidate);

  return units.findIndex((unit, index) => {
    if (usedIndexes.has(index)) return false;
    if (readRhymeUnitLineIndex(unit) !== candidateLineIndex) return false;

    const unitLabel = readAdjudicationUnitLabel(unit);
    const unitText = normalizeString(unit.text);
    const unitRange = readRhymeUnitRange(unit);
    const sameLabel = Boolean(candidateLabel && candidateLabel === unitLabel);
    const textContains = Boolean(
      candidateText &&
        unitText &&
        (candidateText.includes(unitText) || unitText.includes(candidateText)),
    );
    const rangeOverlaps = Boolean(
      candidateRange && unitRange && isRangeOverlap(candidateRange, unitRange),
    );

    return rangeOverlaps || textContains || sameLabel;
  });
}

function isExactRhymeUnitMatch(
  unit: RhymeAnalysisUnitDraft,
  candidate: RhymeAnalysisUnitDraft,
): boolean {
  if (readRhymeUnitLineIndex(unit) !== readRhymeUnitLineIndex(candidate)) {
    return false;
  }

  if (normalizeString(unit.text) !== normalizeString(candidate.text)) {
    return false;
  }

  if (unit.position && candidate.position && unit.position !== candidate.position) {
    return false;
  }

  const unitRange = readRhymeUnitRange(unit);
  const candidateRange = readRhymeUnitRange(candidate);

  if (unitRange && candidateRange) {
    return unitRange[0] === candidateRange[0] && unitRange[1] === candidateRange[1];
  }

  return true;
}

function readRhymeUnitRange(
  unit: RhymeAnalysisUnitDraft | undefined,
): number[] | undefined {
  const start = unit?.startChar;
  const end = unit?.endChar;

  return typeof start === "number" && typeof end === "number" && end >= start
    ? [start, end]
    : undefined;
}

function isRangeOverlap(left: number[], right: number[]): boolean {
  return left[0] < right[1] && right[0] < left[1];
}

function readAdjudicationUnitLabel(unit: RhymeAnalysisUnitDraft | undefined): string {
  return normalizeString(unit?.rhymeLabel) || normalizeString(unit?.phoneticKey);
}

function createRhymeAdjudicationWarnings(input: {
  source: RhymeAdjudication["source"];
  usedLlm: boolean;
  llmUnitCount: number;
  modelDecisionCount: number;
  llmWarnings?: string[];
}): string[] {
  const warnings = [...(input.llmWarnings ?? [])];

  if (input.usedLlm && input.llmUnitCount === 0) {
    warnings.push("LLM 没有返回有效韵脚 units，本次使用规则扫描结果兜底。");
  }

  if (input.source === "hybrid" && input.modelDecisionCount === 0) {
    warnings.push("LLM 没有返回 rhymeAdjudication.decisions，后端根据候选和最终结果自动推导裁决摘要。");
  }

  return warnings.slice(0, 12);
}
async function createAnalysisMessages(
  request: AnalyzeLyricsRequest,
  lines: LyricLine[],
  rhymeCandidateScan: RhymeCandidateScan,
): Promise<LlmChatMessage[]> {
  const rhymeAnalysisPrompt = await buildRhymeAnalysisPrompt();
  const inputPayload = {
    trackHint: request.track ?? {},
    locale: request.locale ?? "zh-CN",
    lyrics: lines.map((line) => ({
      id: line.id,
      index: line.index,
      text: line.text,
    })),
    rhymeCandidateScan: createRhymeCandidateScanPromptPayload(rhymeCandidateScan),
    rhymeAdjudicationPolicy: createRhymeAdjudicationPolicyPayload(),
  };

  return [
    {
      role: "system",
      content: [
        "You are EchoPulseNode's professional rap analysis engine.",
        "Reply with valid JSON only. Do not output markdown, commentary, or code fences.",
        "Use concise Chinese labels and descriptions where they appear in the JSON.",
        "All normalized scores must be numbers between 0 and 1.",
        "",
        rhymeAnalysisPrompt,
      ].join("\n"),
    },
    {
      role: "user",
      content: `Analyze the lyric input below and return a JSON object that matches this schema:
- track: title, artist, bpm, language, confidence
- summary: title, description, keywords, confidence
- lines: one entry per lyric line with index, text, endWord, rhymeLabel, phoneticKey, rhymeType, energy, tension, density, emotion, note, confidence
- rhymeAnalysis.units: confirmed rhyme units. Each unit must include lineIndex, text, startChar, endChar, position, syllables, phoneticKey, rhymeType, rhymeLevel, rhymeQuality, rhymeGroupId, confidence, and optional note
- rhymeAnalysis.groups: color-level rhyme families, with label, pattern, lineIndexes, unitIds, description, rhymeLevel, rhymeQuality, confidence
- rhymeAnalysis.lineRhymeMap: map lineId to unit ids
- rhymeAnalysis.summary: totalLines, unitCount, candidateCount, confirmedUnitCount, groupCount, multiSyllableCount, lineEndCount, middleCount, crossLineCount, internalCount, repetitionCount, slantCount, dominantPatterns, confidence
- rhymeAnalysis.warnings: notes when analysis is partial or uncertain
- rhymeAdjudication: top-level candidate adjudication with decisions, summary, and warnings. Use status confirmed, rejected, corrected, or added.
- vibeVector: energy, aggression, melancholy, bounce, narrativeTension, confidence
- insights: dimension, title, body, evidenceLineIndexes

Rules:
1. Keep line ids and line indexes aligned with the input order.
2. Preserve the original line text exactly.
3. A single lyric line may contain multiple rhymeAnalysis.units.
4. Do not only analyze the final character of each line. Scan start, middle, internal, line-end, and cross-line rhymes.
5. For each line, inspect final 1-character, 2-character, 3-character, and 4-character windows before deciding the final units.
6. Multi-syllable rhymes must keep the full phrase as one unit; do not collapse double/triple rhymes to the final character.
7. Use the supplied input.rhymeCandidateScan as a candidate inventory. Confirm, reject, extend, or correct candidates instead of discovering everything from scratch.
8. Prefer candidate startChar/endChar ranges when they are correct. If you correct a range, keep it aligned to the exact source line text.
9. Use shared rhymeGroupId values for the same sound family, so the frontend can assign one color to each group.
10. Use conservative estimates if artist, title, BPM, or rhyme relation is uncertain.
11. Do not invent lines that are not present in the source lyrics.
12. If the final rhymeAnalysis only contains end-position units, add a warning explaining that middle/internal rhymes were not confidently found.
13. If you reject or correct a supplied candidate, keep the final rhymeAnalysis clean and record the reason in rhymeAdjudication.decisions.
14. For each entry in lines, "emotion" is a short Chinese mood word (at most 6 characters). "note" is a one-sentence Chinese reading of what the line says or implies (at most 30 characters), based only on the lyric text; it is NOT a rhyme note. Write a note only for lines with clear imagery, a turn, or a key idea, at most 12 lines in total, and leave note empty for all other lines. Do not invent the singer's biography or the story behind the song.
15. insights.evidenceLineIndexes must be zero-based indexes of lines that actually support the insight, at most 4 per insight.
16. Return JSON only.

Input JSON:
${JSON.stringify(inputPayload, null, 2)}`,
    },
  ];
}

function createRhymeAdjudicationPolicyPayload(): JsonObject {
  return {
    mode: serverEnv.rhymeAnalysisMode,
    candidateRole: "rhymeCandidateScan is a candidate inventory, not the final answer.",
    finalAuthority: "Final rhymeAnalysis.units must contain only adjudicated rhyme units.",
    allowedDecisionStatus: ["confirmed", "rejected", "corrected", "added"],
    rules: [
      "confirmed: keep a candidate when it has clear sound correspondence.",
      "rejected: omit weak, noisy, or musically meaningless candidates from final rhymeAnalysis.units.",
      "corrected: adjust candidate text/range/group when the relation is real but the span is wrong.",
      "added: add obvious rhyme units missed by deterministic scanning.",
    ],
  };
}
function createRhymeCandidateScanPromptPayload(
  scan: RhymeCandidateScan,
): JsonObject {
  const summary = createRhymeCandidateScanSummaryPayload(scan.summary);

  return {
    summary,
    warnings: scan.analysis.warnings ?? [],
    candidatePreviewByLine: createRhymeCandidatePreviewByLine(scan.candidates, 6),
    confirmedAnalysis: scan.analysis as unknown as JsonValue,
  };
}

function createRhymeCandidateScanDiagnosticDetails(
  scan: RhymeCandidateScan,
): JsonObject {
  const summary = createRhymeCandidateScanSummaryPayload(scan.summary);

  return {
    summary,
    warnings: scan.analysis.warnings ?? [],
    candidatePreviewByLine: createRhymeCandidatePreviewByLine(scan.candidates, 4),
    confirmedAnalysis: scan.analysis as unknown as JsonValue,
  };
}

function createRhymeCandidateScanExtension(
  scan: RhymeCandidateScan,
): JsonValue {
  return {
    summary: createRhymeCandidateScanSummaryPayload(scan.summary),
    analysis: scan.analysis as unknown as JsonValue,
  };
}

function createRhymeCandidateScanSummaryPayload(
  summary: RhymeCandidateScanSummary,
): JsonObject {
  return {
    totalLines: summary.totalLines,
    candidateCount: summary.candidateCount,
    confirmedUnitCount: summary.confirmedUnitCount,
    groupCount: summary.groupCount,
    lineEndCount: summary.lineEndCount,
    middleCount: summary.middleCount,
    crossLineCount: summary.crossLineCount,
    internalCount: summary.internalCount,
    multiSyllableCount: summary.multiSyllableCount,
    repetitionCount: summary.repetitionCount,
    slantCount: summary.slantCount,
    dominantPatterns: summary.dominantPatterns,
    confidence: summary.confidence,
  };
}

function createRhymeCandidatePreviewByLine(
  candidates: RhymeAnalysisUnitDraft[],
  limit: number,
): JsonObject[] {
  const lineMap = new Map<
    number,
    {
      lineId: string;
      lineIndex: number;
      candidateCount: number;
      candidates: JsonObject[];
    }
  >();

  for (const candidate of candidates) {
    const lineIndex = readRhymeUnitLineIndex(candidate);
    if (lineIndex === undefined) continue;

    const existing = lineMap.get(lineIndex) ?? {
      lineId: normalizeString(candidate.lineId) || `line-${lineIndex + 1}`,
      lineIndex,
      candidateCount: 0,
      candidates: [],
    };

    existing.candidateCount += 1;

    if (existing.candidates.length < limit) {
      existing.candidates.push(createRhymeCandidatePreview(candidate));
    }

    lineMap.set(lineIndex, existing);
  }

  return Array.from(lineMap.values())
    .sort((left, right) => left.lineIndex - right.lineIndex)
    .map((entry) => ({
      lineId: entry.lineId,
      lineIndex: entry.lineIndex,
      candidateCount: entry.candidateCount,
      candidates: entry.candidates,
    }));
}

function createRhymeCandidatePreview(
  candidate: RhymeAnalysisUnitDraft,
): JsonObject {
  return {
    id: candidate.id,
    lineId: candidate.lineId,
    lineIndex: candidate.lineIndex,
    text: candidate.text,
    startChar: candidate.startChar,
    endChar: candidate.endChar,
    position: candidate.position,
    syllables: candidate.syllables,
    phoneticKey: candidate.phoneticKey,
    rhymeType: candidate.rhymeType,
    rhymeLevel: candidate.rhymeLevel,
    rhymeQuality: candidate.rhymeQuality,
    rhymeGroupId: candidate.rhymeGroupId,
    rhymeLabel: candidate.rhymeLabel,
    confidence: candidate.confidence,
    note: candidate.note,
  };
}

function inspectRhymeAnalysisCoverage(
  lines: LyricLine[],
  rhymeAnalysis: RhymeAnalysisDraft | undefined,
): RhymeAnalysisCoverage {
  const units = rhymeAnalysis?.units ?? [];
  const coveredLineIndexes = new Set<number>();
  let lineEndCount = 0;
  let middleUnitCount = 0;
  let internalUnitCount = 0;
  let crossLineUnitCount = 0;
  let multiSyllableCount = 0;
  let repetitionCount = 0;
  let slantCount = 0;

  for (const unit of units) {
    const lineIndex = readRhymeUnitLineIndex(unit);

    if (lineIndex !== undefined) {
      coveredLineIndexes.add(lineIndex);
    }

    if (unit.position === "end") {
      lineEndCount += 1;
    }

    if (unit.position === "middle" || unit.position === "start") {
      middleUnitCount += 1;
    }

    if (unit.position === "internal") {
      internalUnitCount += 1;
    }

    if (unit.position === "cross-line") {
      crossLineUnitCount += 1;
    }

    if (isMultiSyllableRhymeUnit(unit)) {
      multiSyllableCount += 1;
    }

    if (unit.rhymeQuality === "repetition") {
      repetitionCount += 1;
    }

    if (
      unit.rhymeQuality === "slant" ||
      unit.rhymeQuality === "assonance" ||
      unit.rhymeQuality === "consonance"
    ) {
      slantCount += 1;
    }
  }

  const coverageRatio = lines.length
    ? round(coveredLineIndexes.size / lines.length)
    : 0;
  const isLikelyLineEndOnly =
    units.length > 0 &&
    lineEndCount === units.length &&
    middleUnitCount === 0 &&
    internalUnitCount === 0;
  const isLikelyIncomplete =
    units.length === 0 ||
    coverageRatio < 0.6 ||
    (lines.length >= 4 && isLikelyLineEndOnly);

  return {
    totalLines: lines.length,
    unitCount: units.length,
    coveredLineCount: coveredLineIndexes.size,
    coverageRatio,
    lineEndCount,
    middleUnitCount,
    internalUnitCount,
    crossLineUnitCount,
    multiSyllableCount,
    repetitionCount,
    slantCount,
    isLikelyLineEndOnly,
    isLikelyIncomplete,
  };
}

function createRhymeAnalysisCoverageDiagnostics(
  coverage: RhymeAnalysisCoverage,
  usedLlm: boolean,
): AnalysisDiagnostic[] {
  const diagnostics: AnalysisDiagnostic[] = [];

  if (coverage.unitCount === 0) {
    diagnostics.push({
      id: createId("diagnostic"),
      level: usedLlm ? "warning" : "info",
      message: usedLlm
        ? "LLM did not return confirmed rhymeAnalysis units. Frontend will use line-end fallback only."
        : "No LLM rhymeAnalysis units are available. Frontend will use line-end fallback only.",
      nodeId: "rhyme-analysis-coverage",
    });
    return diagnostics;
  }

  if (coverage.isLikelyLineEndOnly) {
    diagnostics.push({
      id: createId("diagnostic"),
      level: "warning",
      message: "rhymeAnalysis appears to contain only line-end units. Middle, internal, and jump rhymes may be under-detected.",
      nodeId: "rhyme-analysis-coverage",
      details: coverage as unknown as JsonObject,
    });
  }

  if (coverage.multiSyllableCount === 0 && coverage.totalLines >= 4) {
    diagnostics.push({
      id: createId("diagnostic"),
      level: "info",
      message: "No double/triple/multi rhyme units were returned. This may indicate a shallow rhyme pass or genuinely sparse lyrics.",
      nodeId: "rhyme-analysis-coverage",
      details: coverage as unknown as JsonObject,
    });
  }

  if (coverage.coverageRatio < 0.6 && coverage.totalLines >= 4) {
    diagnostics.push({
      id: createId("diagnostic"),
      level: "warning",
      message: "rhymeAnalysis covers fewer than 60% of lyric lines. Treat the color map as partial.",
      nodeId: "rhyme-analysis-coverage",
      details: coverage as unknown as JsonObject,
    });
  }

  return diagnostics;
}

function isMultiSyllableRhymeUnit(unit: RhymeAnalysisUnitDraft): boolean {
  if (
    unit.rhymeLevel === "double" ||
    unit.rhymeLevel === "triple" ||
    unit.rhymeLevel === "multi"
  ) {
    return true;
  }

  if (Array.isArray(unit.syllables) && unit.syllables.length >= 2) {
    return true;
  }

  const text = normalizeString(unit.text);

  return /[一-鿿]/.test(text)
    ? text.length >= 2
    : text.split(/\s+/).filter(Boolean).length >= 2;
}

function createDraftLineMap(lines: LlmLineDraft[] | undefined): Map<number, LlmLineDraft> {
  const lineMap = new Map<number, LlmLineDraft>();

  if (!Array.isArray(lines)) {
    return lineMap;
  }

  for (const line of lines) {
    const index = line.index;

    if (typeof index === "number" && Number.isInteger(index) && index >= 0) {
      lineMap.set(index, line);
    }
  }

  return lineMap;
}

function createRhymeUnitsByLine(
  rhymeAnalysis: RhymeAnalysisDraft | undefined,
): Map<number, RhymeAnalysisUnitDraft[]> {
  const unitsByLine = new Map<number, RhymeAnalysisUnitDraft[]>();

  for (const unit of rhymeAnalysis?.units ?? []) {
    const lineIndex = readRhymeUnitLineIndex(unit);

    if (lineIndex === undefined) {
      continue;
    }

    const units = unitsByLine.get(lineIndex) ?? [];
    units.push(unit);
    unitsByLine.set(lineIndex, units);
  }

  return unitsByLine;
}

function createRhymeGroupLabelMap(
  rhymeAnalysis: RhymeAnalysisDraft | undefined,
): Map<string, string> {
  const labelById = new Map<string, string>();

  for (const group of rhymeAnalysis?.groups ?? []) {
    const id = normalizeString(group.id);
    const label = normalizeString(group.label) || normalizeString(group.pattern) || id;

    if (id && label) {
      labelById.set(id, label);
    }
  }

  return labelById;
}

function selectPrimaryRhymeUnit(
  units: RhymeAnalysisUnitDraft[] | undefined,
): RhymeAnalysisUnitDraft | undefined {
  return units
    ?.slice()
    .sort((left, right) => readRhymeUnitPriority(right) - readRhymeUnitPriority(left))[0];
}

function readRhymeGroupLabel(
  unit: RhymeAnalysisUnitDraft | undefined,
  groupLabelById: Map<string, string>,
): string | undefined {
  const groupId = normalizeString(unit?.rhymeGroupId);

  return groupId ? groupLabelById.get(groupId) : undefined;
}

function readRhymeUnitLineIndex(unit: RhymeAnalysisUnitDraft): number | undefined {
  if (typeof unit.lineIndex === "number" && Number.isInteger(unit.lineIndex)) {
    return unit.lineIndex >= 0 ? unit.lineIndex : undefined;
  }

  const match = normalizeString(unit.lineId).match(/^line-(\d+)$/);
  const lineNumber = match ? Number(match[1]) : 0;

  return Number.isInteger(lineNumber) && lineNumber > 0
    ? lineNumber - 1
    : undefined;
}

function readRhymeUnitPriority(unit: RhymeAnalysisUnitDraft): number {
  return readRhymePositionPriority(unit.position) * 10 + (unit.confidence ?? 0);
}

function readRhymePositionPriority(position: RhymeAnalysisUnitDraft["position"]): number {
  if (position === "end") {
    return 4;
  }

  if (position === "middle") {
    return 3;
  }

  if (position === "internal") {
    return 2;
  }

  if (position === "cross-line") {
    return 1;
  }

  return 0;
}
function createSummary(input: {
  track: TrackMetadata;
  vibeVector: VibeVector;
  insights: InsightBlock[];
  usedLlm: boolean;
}, draft?: LlmAnalysisDraft): RapAnalysisData["summary"] {
  return {
    title:
      normalizeString(draft?.summary?.title) ||
      (input.track.title ? `${input.track.title} analysis` : "Rap structure analysis"),
    description:
      normalizeString(draft?.summary?.description) ||
      (input.usedLlm
        ? "LLM proxy generated a structured rap analysis draft and EchoPulseNode normalized it into AnalysisContract."
        : input.track.sourceProvider === "alapi"
          ? "ALAPI metadata lookup combined with local heuristics generated this structured rap analysis."
          : "Local heuristic analysis generated from raw lyrics for EchoPulseNode pipeline development."),
    confidence: readUnitNumber(draft?.summary?.confidence, input.vibeVector.confidence),
    keywords:
      draft?.summary?.keywords?.filter((keyword) => typeof keyword === "string" && keyword.trim()).map((keyword) => keyword.trim()).slice(0, 8) ??
      input.insights.map((insight) => insight.dimension).slice(0, 5),
  };
}

function shouldLookupRemoteTrack(track: TrackMetadata | undefined): boolean {
  const hasTitle = Boolean(normalizeString(track?.title));
  const hasArtist = Boolean(normalizeString(track?.artist));
  const sourceProvider = normalizeString(track?.sourceProvider);

  if (sourceProvider === "alapi") {
    return false;
  }

  return !(hasTitle && hasArtist);
}

function mergeTrackMetadata(
  baseTrack: TrackMetadata | undefined,
  draftTrack: LlmTrackDraft | undefined,
): TrackMetadata {
  const bpm = readPositiveNumber(baseTrack?.bpm, draftTrack?.bpm, 0);

  return {
    title: readFirstText(baseTrack?.title, draftTrack?.title, "Untitled Track"),
    artist: readFirstText(baseTrack?.artist, draftTrack?.artist, "Unknown Artist"),
    bpm,
    language: readFirstText(baseTrack?.language, draftTrack?.language),
    album: readFirstText(baseTrack?.album),
    releaseYear: baseTrack?.releaseYear,
    tags: baseTrack?.tags,
    confidence: readUnitNumber(baseTrack?.confidence ?? draftTrack?.confidence, 0),
    sourceProvider: readFirstText(baseTrack?.sourceProvider),
    sourceId: readFirstText(baseTrack?.sourceId),
    sourceUrl: readFirstText(baseTrack?.sourceUrl),
    coverUrl: readFirstText(baseTrack?.coverUrl),
    durationMs: baseTrack?.durationMs,
  };
}

function extractEndWord(text: string): string {
  const cleanedText = text
    .trim()
    .replace(/[.,!?;:'"`~()[\]{}<>，。！？；：“”‘’、]+$/g, "");
  const tokens = cleanedText.split(/\s+/).filter(Boolean);
  const lastToken = tokens.at(-1) ?? cleanedText;

  return /[\u4e00-\u9fff]/.test(lastToken)
    ? lastToken.slice(-2)
    : lastToken.toLowerCase();
}

function createPhoneticKey(word: string): string {
  if (!word) {
    return "";
  }

  if (/[\u4e00-\u9fff]/.test(word)) {
    return word.slice(-1);
  }

  const normalizedWord = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  const vowelTail = normalizedWord.match(/[aeiouy]+[^aeiouy]*$/)?.[0];

  return vowelTail ?? normalizedWord.slice(-3);
}

function createSchemeLabel(index: number): string {
  const alphabetSize = 26;
  const firstChar = String.fromCharCode(65 + (index % alphabetSize));
  const cycle = Math.floor(index / alphabetSize);

  return cycle === 0 ? firstChar : `${firstChar}${cycle + 1}`;
}

function countTextHits(text: string, words: string[]): number {
  return words.reduce((count, word) => {
    if (!word) {
      return count;
    }

    return count + countMatches(text, new RegExp(escapeRegExp(word), "g"));
  }, 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countWordHits(text: string, words: string[]): number {
  return words.reduce((count, word) => {
    const pattern = new RegExp(`\\b${word}\\b`, "gi");

    return count + countMatches(text, pattern);
  }, 0);
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readUnitNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp(round(value), 0, 1);
  }

  return clamp(round(fallback), 0, 1);
}

function readPositiveNumber(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.round(value);
    }
  }

  return 0;
}

function readFirstText(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalizedValue = normalizeString(value);

    if (normalizedValue) {
      return normalizedValue;
    }
  }

  return undefined;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}


























