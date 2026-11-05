import type {
  AnalysisContract,
  AnalysisData,
  AnalysisDiagnostic,
  AnalysisDimension,
  AnalysisDimensionData,
  AnalysisNodeKind,
  AnalysisNodeStatus,
  JsonObject,
  JsonValue,
  RhymeAnalysis,
  RhymeAdjudication,
  TrackMetadata,
  TrackMetadataCandidate,
} from "../../src/types/analysis";

export type RapNodeKind =
  | AnalysisNodeKind
  | "rap-analysis"
  | "rhyme-scheme-generator"
  | "vibe-vectorizer";

export type RapAnalysisDimension =
  | AnalysisDimension
  | "rhymeScheme"
  | "vibeVector";

export interface RhymeSchemeEntry extends JsonObject {
  lineId: string;
  lineIndex: number;
  text: string;
  endWord: string;
  rhymeLabel: string;
  phoneticKey: string;
  rhymeType?: string;
  position?: string;
  syllables?: string[];
  groupId?: string;
  unitId?: string;
  confidence: number;
}

export interface VibeVector extends JsonObject {
  energy: number;
  aggression: number;
  melancholy: number;
  confidence: number;
  bounce: number;
  narrativeTension: number;
}

export interface RhymeSchemePayload extends JsonObject {
  rhymeScheme: RhymeSchemeEntry[];
}

export interface VibeVectorPayload extends JsonObject {
  vibeVector: VibeVector;
}

export interface RapNodeAnalysisPayload extends JsonObject {
  rawLyrics: string;
  track?: TrackMetadata;
  rhymeScheme: RhymeSchemeEntry[];
  vibeVector: VibeVector;
}

export interface RapAnalysisData extends AnalysisData {
  dimensions: AnalysisData["dimensions"] & {
    rhymeScheme: AnalysisDimensionData<RhymeSchemePayload>;
    vibeVector: AnalysisDimensionData<VibeVectorPayload>;
  };
  extensions: AnalysisData["extensions"] & {
    rhymeScheme: RhymeSchemeEntry[];
    vibeVector: VibeVector;
    rhymeAnalysis?: RhymeAnalysis;
    rhymeAdjudication?: RhymeAdjudication;
    rhymeAnalysisCoverage?: JsonValue;
    rhymeCandidateScan?: JsonValue;
  };
}

export interface RapNode {
  id: string;
  kind: RapNodeKind;
  label: string;
  version: string;
  status: AnalysisNodeStatus;
  analysis: RapNodeAnalysisPayload;
  contract: AnalysisContract<RapAnalysisData>;
  diagnostics: AnalysisDiagnostic[];
  createdAt: string;
  updatedAt: string;
}

export interface ResolveTrackMetadataRequest {
  rawLyrics: string;
  track?: TrackMetadata;
  locale?: string;
  requestId?: string;
  traceId?: string;
  allowRemoteLookup?: boolean;
}

export interface ResolveTrackMetadataResponse {
  track: TrackMetadata;
  candidates?: TrackMetadataCandidate[];
  diagnostics: AnalysisDiagnostic[];
}
export interface AnalyzeLyricsRequest {
  rawLyrics: string;
  track?: TrackMetadata;
  locale?: string;
  requestId?: string;
  traceId?: string;
}

export interface AnalyzeLyricsResponse {
  node: RapNode;
  rhymeScheme: RhymeSchemeEntry[];
  vibeVector: VibeVector;
}







