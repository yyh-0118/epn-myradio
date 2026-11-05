import { readFile } from "node:fs/promises";
import { serverEnv } from "../config/env";
import {
  DEFAULT_RHYME_ANALYSIS_MODE,
  DEFAULT_RHYME_ANALYSIS_PROFILE,
  type RhymeAnalysisMode,
  type RhymeAnalysisProfile,
} from "../config/rhymeAnalysis";
import { createRhymeAnalysisSchemaHint } from "../schemas/rhyme-analysis.schema";

let cachedBasePrompt: string | undefined;

export async function buildRhymeAnalysisPrompt(): Promise<string> {
  const basePrompt = await loadBasePrompt();

  return [
    basePrompt,
    "",
    `当前模式: ${serverEnv.rhymeAnalysisMode}`,
    `当前档位: ${serverEnv.rhymeAnalysisProfile}`,
    `Prompt 版本: ${serverEnv.rhymePromptVersion}`,
    "",
    buildModeGuidance(serverEnv.rhymeAnalysisMode),
    buildProfileGuidance(serverEnv.rhymeAnalysisProfile),
    "",
    createRhymeAnalysisSchemaHint(),
  ].join("\n");
}

async function loadBasePrompt(): Promise<string> {
  if (cachedBasePrompt) {
    return cachedBasePrompt;
  }

  try {
    const prompt = await readFile(
      new URL("./rhyme-analysis.zh.md", import.meta.url),
      "utf8",
    );
    cachedBasePrompt = prompt.trim();
    return cachedBasePrompt;
  } catch {
    cachedBasePrompt = [
      "你是专业说唱韵脚分析师。",
      "你必须分析句尾、句中、内部韵、跳押、双押、三押和跨行韵脚。",
      "如果输入里包含 input.rhymeCandidateScan，请把它当成候选韵脚库存来确认或修正，不要完全从零开始。",
      "你必须区分真押、近似押、重复词和不确定情况。",
      "你必须只输出 JSON，不要写散文解释。",
    ].join("\n");

    return cachedBasePrompt;
  }
}

function buildModeGuidance(mode: RhymeAnalysisMode): string {
  const normalizedMode = mode || DEFAULT_RHYME_ANALYSIS_MODE;

  if (normalizedMode === "heuristic") {
    return [
      "模式说明: heuristic",
      "优先保守判断，只输出把握较高的韵脚单元。",
      "不确定的地方写进 warnings，不要为了凑结果而过度推断。",
    ].join("\n");
  }

  if (normalizedMode === "llm") {
    return [
      "模式说明: llm",
      "优先完整抽取所有可见韵脚关系，允许模型做更深层的语义和音感判断。",
      "仍然要保持 JSON 严格可解析。",
    ].join("\n");
  }

  return [
    "模式说明: hybrid",
    "规则优先，模型补全。先识别明确的韵脚单元，再补充跨行、跳押和近似韵。",
    "遇到模糊关系时保留 conservative confidence。",
  ].join("\n");
}

function buildProfileGuidance(profile: RhymeAnalysisProfile): string {
  const normalizedProfile = profile || DEFAULT_RHYME_ANALYSIS_PROFILE;

  if (normalizedProfile === "basic") {
    return [
      "档位说明: basic",
      "只保留最核心的韵脚单元和分组。",
      "适合快速预览，不追求最深层的结构展开。",
    ].join("\n");
  }

  if (normalizedProfile === "full") {
    return [
      "档位说明: full",
      "必须覆盖句尾、句中、内部韵和跳押。",
      "输出 summary 和 lineRhymeMap，并尽量给出稳定的 rhyme groups。",
    ].join("\n");
  }

  return [
    "档位说明: expert",
    "必须尽量完整拆出单押、双押、三押及以上、连环押、跨行押和中段埋韵。",
    "要显式标记 position、syllables、phoneticKey、rhymeType、rhymeGroupId。",
  ].join("\n");
}

