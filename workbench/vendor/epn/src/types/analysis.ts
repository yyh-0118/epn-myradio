export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export type ExtensibleString<TBase extends string> = TBase | (string & {});

export type AnalysisContractType = "echopulsenode.analysis";

export type AnalysisNodeKind = ExtensibleString<
  | "contract-normalizer"
  | "lyric-segmenter"
  | "narrative-curve"
  | "rhyme-tracker"
  | "flow-analyzer"
  | "insight-synthesizer"
>;

export type AnalysisDimension = ExtensibleString<
  "narrative" | "rhyme" | "flow" | "semantic" | "emotion" | "structure"
>;

export type AnalysisNodeStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type AnalysisDiagnosticLevel = "info" | "warning" | "error";

export interface TrackMetadata extends JsonObject {
  title?: string;
  artist?: string;
  album?: string;
  bpm?: number;
  language?: string;
  releaseYear?: number;
  tags?: string[];
  confidence?: number;
  sourceProvider?: string;
  sourceId?: string;
  sourceUrl?: string;
  coverUrl?: string;
  durationMs?: number;
}

export type TrackMetadataCandidateSource =
  | "manual"
  | "alapi"
  | "ai"
  | "heuristic"
  | "unknown";

export interface TrackMetadataCandidate extends TrackMetadata {
  candidateId: string;
  source: TrackMetadataCandidateSource;
  query?: string;
  matchScore?: number;
  reason?: string;
  selected?: boolean;
}

export interface LyricLine {
  id: string;
  index: number;
  text: string;
  bar?: number;
  startTimeMs?: number;
  endTimeMs?: number;
  speaker?: string;
}

export interface LyricInput {
  rawText: string;
  lines: LyricLine[];
}

export interface AnalysisSource {
  track?: TrackMetadata;
  lyrics: LyricInput;
  locale?: string;
  sourceUri?: string;
}

export interface AnalysisSummary {
  title: string;
  description: string;
  confidence: number;
  keywords: string[];
}

export interface BarAnalysis {
  id: string;
  index: number;
  text: string;
  startLineId?: string;
  endLineId?: string;
  energy?: number;
  tension?: number;
  density?: number;
  emotion?: string;
  rhymeGroupIds?: string[];
  annotations?: string[];
}

export interface NarrativeCurvePoint {
  id: string;
  barIndex: number;
  tension: number;
  sentiment: number;
  theme?: string;
  note?: string;
}

export interface NarrativeCurve {
  dimension: "narrative";
  summary: string;
  points: NarrativeCurvePoint[];
}

export interface RhymeOccurrence {
  id: string;
  lineId?: string;
  barIndex?: number;
  text: string;
  syllable?: string;
  position?: "start" | "middle" | "end" | "internal" | "cross-line";
}

export interface RhymeTrace {
  id: string;
  label: string;
  phoneticKey: string;
  pattern?: string;
  occurrences: RhymeOccurrence[];
  complexity: number;
  confidence: number;
}


export type RhymeAnalysisPosition =
  | "start"
  | "middle"
  | "end"
  | "internal"
  | "cross-line";

export type RhymeAnalysisLevel = "single" | "double" | "triple" | "multi";

export type RhymeAnalysisQuality =
  | "perfect"
  | "slant"
  | "assonance"
  | "consonance"
  | "repetition"
  | "uncertain";

export interface RhymeAnalysisUnit extends JsonObject {
  id?: string;
  lineId?: string;
  lineIndex?: number;
  text?: string;
  startChar?: number;
  endChar?: number;
  position?: RhymeAnalysisPosition;
  syllables?: string[];
  phoneticKey?: string;
  rhymeType?: string;
  rhymeLevel?: RhymeAnalysisLevel;
  rhymeQuality?: RhymeAnalysisQuality;
  rhymeGroupId?: string;
  rhymeLabel?: string;
  note?: string;
  confidence?: number;
}

export interface RhymeAnalysisGroup extends JsonObject {
  id?: string;
  label?: string;
  pattern?: string;
  lineIds?: string[];
  lineIndexes?: number[];
  description?: string;
  unitIds?: string[];
  rhymeLevel?: RhymeAnalysisLevel;
  rhymeQuality?: RhymeAnalysisQuality;
  confidence?: number;
}

export interface RhymeAnalysisSummary extends JsonObject {
  totalLines?: number;
  unitCount?: number;
  candidateCount?: number;
  confirmedUnitCount?: number;
  groupCount?: number;
  multiSyllableCount?: number;
  lineEndCount?: number;
  middleCount?: number;
  crossLineCount?: number;
  internalCount?: number;
  repetitionCount?: number;
  slantCount?: number;
  dominantPatterns?: string[];
  confidence?: number;
}

export interface RhymeAnalysis extends JsonObject {
  units?: RhymeAnalysisUnit[];
  groups?: RhymeAnalysisGroup[];
  lineRhymeMap?: Record<string, string[]>;
  summary?: RhymeAnalysisSummary;
  warnings?: string[];
}

export type RhymeAdjudicationDecisionStatus =
  | "confirmed"
  | "rejected"
  | "corrected"
  | "added"
  | "heuristic-confirmed";

export type RhymeAdjudicationSource = "candidate-scanner" | "llm" | "hybrid";

export interface RhymeAdjudicationDecision extends JsonObject {
  id?: string;
  status?: RhymeAdjudicationDecisionStatus;
  candidateId?: string;
  unitId?: string;
  lineId?: string;
  lineIndex?: number;
  text?: string;
  candidateText?: string;
  finalText?: string;
  candidateRange?: number[];
  finalRange?: number[];
  rhymeGroupId?: string;
  rhymeLabel?: string;
  reason?: string;
  confidence?: number;
  source?: RhymeAdjudicationSource;
}

export interface RhymeAdjudicationSummary extends JsonObject {
  candidateUnitCount?: number;
  llmUnitCount?: number;
  finalUnitCount?: number;
  confirmedCount?: number;
  rejectedCount?: number;
  correctedCount?: number;
  addedCount?: number;
  agreementRatio?: number;
  modelDecisionCount?: number;
}

export interface RhymeAdjudication extends JsonObject {
  source?: RhymeAdjudicationSource;
  mode?: string;
  summary?: RhymeAdjudicationSummary;
  decisions?: RhymeAdjudicationDecision[];
  warnings?: string[];
}

export interface FlowSegment {
  id: string;
  startBarIndex: number;
  endBarIndex: number;
  cadence?: string;
  pace?: number;
  pauseDensity?: number;
  deliveryNotes?: string[];
}

export interface InsightBlock {
  id: string;
  dimension: AnalysisDimension;
  title: string;
  body: string;
  severity?: AnalysisDiagnosticLevel;
  evidenceIds?: string[];
}

export interface AnalysisDimensionData<
  TPayload extends JsonObject = JsonObject,
> {
  dimension: AnalysisDimension;
  version: string;
  nodeId?: string;
  confidence?: number;
  payload: TPayload;
  diagnostics?: AnalysisDiagnostic[];
}

export interface AnalysisData {
  summary?: AnalysisSummary;
  bars: BarAnalysis[];
  narrativeCurve?: NarrativeCurve;
  rhymeTraces: RhymeTrace[];
  flowSegments: FlowSegment[];
  insights: InsightBlock[];
  dimensions: Record<string, AnalysisDimensionData>;
  extensions: Record<string, JsonValue>;
}

export interface AnalysisDiagnostic {
  id: string;
  level: AnalysisDiagnosticLevel;
  message: string;
  nodeId?: string;
  path?: string;
  details?: JsonObject;
}

export interface JsonSchema extends JsonObject {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type?: string | string[];
}

export interface AnalysisNodeDefinition<
  TConfig extends JsonObject = JsonObject,
> {
  id: string;
  kind: AnalysisNodeKind;
  label: string;
  version: string;
  description?: string;
  inputDimensions: AnalysisDimension[];
  outputDimensions: AnalysisDimension[];
  configSchema?: JsonSchema;
  defaultConfig?: Partial<TConfig>;
}

export interface AnalysisNodeContext {
  requestId: string;
  traceId: string;
  now: () => Date;
  metadata?: Record<string, JsonValue>;
}

export interface AnalysisNodeExecution {
  nodeId: string;
  kind: AnalysisNodeKind;
  status: AnalysisNodeStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  inputDimensions: AnalysisDimension[];
  outputDimensions: AnalysisDimension[];
  diagnostics: AnalysisDiagnostic[];
}

export interface AnalysisPipelineSnapshot {
  version: string;
  executions: AnalysisNodeExecution[];
}

export interface AnalysisContract<TData extends AnalysisData = AnalysisData> {
  contractType: AnalysisContractType;
  version: string;
  requestId: string;
  createdAt: string;
  source: AnalysisSource;
  data: TData;
  pipeline: AnalysisPipelineSnapshot;
  diagnostics: AnalysisDiagnostic[];
  extensions: Record<string, JsonValue>;
}

export interface AnalysisNodeResult<TData extends AnalysisData = AnalysisData> {
  node: AnalysisNodeDefinition;
  status: AnalysisNodeStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  contract?: AnalysisContract<TData>;
  data?: TData;
  diagnostics: AnalysisDiagnostic[];
  error?: string;
}




