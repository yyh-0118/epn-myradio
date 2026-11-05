import dotenv from "dotenv";
import {
  readRhymeAnalysisMode,
  readRhymeAnalysisProfile,
  readRhymePromptVersion,
  type RhymeAnalysisMode,
  type RhymeAnalysisProfile,
} from "./rhymeAnalysis";

if (process.env.AFTERGLOW_LOAD_DOTENV === "1") {
  dotenv.config({
    path: new URL("../../../../.env", import.meta.url),
    quiet: true,
  });
}

export type RuntimeMode = "development" | "test" | "production";
export type AnalysisSessionStorage = "file" | "sqlite";

export interface ServerEnv {
  nodeEnv: RuntimeMode;
  host: string;
  port: number;
  apiPrefix: string;
  apiBodyLimitBytes: number;
  apiRateLimitPerMinute: number;
  agentName: string;
  agentVersion: string;
  analysisContractVersion: string;
  llmApiKey?: string;
  llmApiUrl: string;
  llmModel: string;
  llmTemperature: number;
  llmMaxTokens: number;
  useRealLlm: boolean;
  alapiToken?: string;
  alapiBaseUrl: string;
  trainingDataDir: string;
  analysisSessionStorage: AnalysisSessionStorage;
  analysisSessionDataFile: string;
  analysisSessionSqliteFile: string;
  rhymeAnalysisMode: RhymeAnalysisMode;
  rhymeAnalysisProfile: RhymeAnalysisProfile;
  rhymePromptVersion: string;
}

export const serverEnv: ServerEnv = {
  nodeEnv: readRuntimeMode(process.env.NODE_ENV),
  host: process.env.SERVER_HOST ?? "0.0.0.0",
  port: readPort(process.env.PORT, 3001),
  apiPrefix: normalizePrefix(process.env.API_PREFIX ?? "/api"),
  apiBodyLimitBytes: readInteger(
    process.env.API_BODY_LIMIT_BYTES,
    1_048_576,
  ),
  apiRateLimitPerMinute: readInteger(
    process.env.API_RATE_LIMIT_PER_MINUTE,
    120,
  ),
  agentName: process.env.AGENT_NAME ?? "EchoPulseNode",
  agentVersion: process.env.AGENT_VERSION ?? "0.1.0",
  analysisContractVersion: process.env.ANALYSIS_CONTRACT_VERSION ?? "0.1.0",
  llmApiKey: process.env.LLM_API_KEY,
  llmApiUrl: process.env.LLM_PROXY_URL ?? process.env.LLM_API_URL ?? "",
  llmModel: process.env.LLM_MODEL ?? "deepseek-chat",
  llmTemperature: readNumber(process.env.LLM_TEMPERATURE, 0.2),
  llmMaxTokens: readInteger(process.env.LLM_MAX_TOKENS, 2400),
  useRealLlm: process.env.USE_REAL_LLM === "true",
  alapiToken: process.env.ALAPI_TOKEN,
  alapiBaseUrl: process.env.ALAPI_BASE_URL ?? "https://v3.alapi.cn",
  trainingDataDir: process.env.TRAINING_DATA_DIR ?? "server/training-data",
  analysisSessionStorage: readAnalysisSessionStorage(
    process.env.ANALYSIS_SESSION_STORAGE,
  ),
  analysisSessionDataFile:
    process.env.ANALYSIS_SESSION_DATA_FILE ??
    "server/data/analysis-sessions.json",
  analysisSessionSqliteFile:
    process.env.ANALYSIS_SESSION_SQLITE_FILE ??
    "server/data/analysis-sessions.sqlite",
  rhymeAnalysisMode: readRhymeAnalysisMode(process.env.RHYME_ANALYSIS_MODE),
  rhymeAnalysisProfile: readRhymeAnalysisProfile(
    process.env.RHYME_ANALYSIS_PROFILE,
  ),
  rhymePromptVersion: readRhymePromptVersion(process.env.RHYME_PROMPT_VERSION),
};

function readAnalysisSessionStorage(
  value: string | undefined,
): AnalysisSessionStorage {
  return value === "sqlite" ? "sqlite" : "file";
}

function readRuntimeMode(value: string | undefined): RuntimeMode {
  if (value === "production" || value === "test") {
    return value;
  }

  return "development";
}

function readPort(value: string | undefined, fallback: number): number {
  const parsedValue = Number(value);

  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback;
}

function readInteger(value: string | undefined, fallback: number): number {
  const parsedValue = Number(value);

  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback;
}

function readNumber(value: string | undefined, fallback: number): number {
  const parsedValue = Number(value);

  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function normalizePrefix(value: string): string {
  const prefix = value.trim();

  if (!prefix) {
    return "/api";
  }

  return prefix.startsWith("/") ? prefix : `/${prefix}`;
}

