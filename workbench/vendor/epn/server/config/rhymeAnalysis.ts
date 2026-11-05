export type RhymeAnalysisMode = "heuristic" | "hybrid" | "llm";
export type RhymeAnalysisProfile = "basic" | "full" | "expert";

export const DEFAULT_RHYME_ANALYSIS_MODE: RhymeAnalysisMode = "hybrid";
export const DEFAULT_RHYME_ANALYSIS_PROFILE: RhymeAnalysisProfile = "expert";
export const DEFAULT_RHYME_PROMPT_VERSION = "2026-07-24";

export function readRhymeAnalysisMode(
  value: string | undefined,
): RhymeAnalysisMode {
  const normalizedValue = normalizeKeyword(value);

  if (normalizedValue === "heuristic" || normalizedValue === "llm") {
    return normalizedValue;
  }

  return DEFAULT_RHYME_ANALYSIS_MODE;
}

export function readRhymeAnalysisProfile(
  value: string | undefined,
): RhymeAnalysisProfile {
  const normalizedValue = normalizeKeyword(value);

  if (
    normalizedValue === "basic" ||
    normalizedValue === "full" ||
    normalizedValue === "expert"
  ) {
    return normalizedValue;
  }

  return DEFAULT_RHYME_ANALYSIS_PROFILE;
}

export function readRhymePromptVersion(value: string | undefined): string {
  const normalizedValue = normalizeKeyword(value);

  return normalizedValue || DEFAULT_RHYME_PROMPT_VERSION;
}

function normalizeKeyword(value: string | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

