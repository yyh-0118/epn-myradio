import type { LyricLine } from "../../src/types/analysis";
import type {
  RhymeAnalysisDraft,
  RhymeAnalysisGroupDraft,
  RhymeAnalysisLevel,
  RhymeAnalysisPosition,
  RhymeAnalysisQuality,
  RhymeAnalysisUnitDraft,
} from "../schemas/rhyme-analysis.schema";

export interface RhymeCandidateScanSummary {
  totalLines: number;
  candidateCount: number;
  confirmedUnitCount: number;
  groupCount: number;
  lineEndCount: number;
  middleCount: number;
  crossLineCount: number;
  internalCount: number;
  multiSyllableCount: number;
  repetitionCount: number;
  slantCount: number;
  dominantPatterns: string[];
  confidence: number;
}

export interface RhymeCandidateScan {
  candidates: RhymeAnalysisUnitDraft[];
  analysis: RhymeAnalysisDraft;
  summary: RhymeCandidateScanSummary;
}

interface TextSegment {
  text: string;
  start: number;
  end: number;
  isLineEnd: boolean;
}

interface RhymeCandidate extends RhymeAnalysisUnitDraft {
  groupKey: string;
  exactGroupKey: string;
  looseGroupKey: string;
  score: number;
}

const MAX_CANDIDATES_PER_LINE = 36;
const MAX_CJK_WINDOW_LENGTH = 4;
const MIN_CJK_MIDDLE_WINDOW_LENGTH = 2;
const LOOSE_GROUP_SCORE_PENALTY = 0.075;
const SEGMENT_PATTERN = /[\u4e00-\u9fffA-Za-z0-9]+/g;
const CJK_PATTERN = /[\u4e00-\u9fff]/;
const CJK_RUN_PATTERN = /[\u4e00-\u9fff]+/g;
const TRAILING_NOISE_PATTERN = /[\s.,!?;:'"`~()[\]{}<>\uFF0C\u3002\uFF01\uFF1F\uFF1B\uFF1A\u201C\u201D\u2018\u2019\u3001]+$/g;

const CJK_TAIL_HINTS: Array<[string, string]> = [
  ["\u5929\u9ed1\u9ed1", "ei"],
  ["\u94a2\u7434\u7ec3\u4e60\u66f2", "u"],
  ["\u7ec3\u4e60\u66f2", "u"],
  ["\u968f\u8eab\u542c", "ing"],
  ["\u6362\u4e58", "eng"],
  ["\u5916\u5a46", "o"],
  ["\u60f3\u8d77", "i"],
  ["\u81ea\u7531", "ou"],
];

const CJK_FINAL_HINTS: Record<string, string> = {
  "\u4f24": "ang", "\u60f3": "iang", "\u846c": "ang", "\u957f": "ang", "\u8ba9": "ang", "\u4e0a": "ang", "\u5fd8": "ang", "\u5fd9": "ang", "\u5c1d": "ang", "\u5531": "ang", "\u671b": "ang", "\u653e": "ang", "\u6d6a": "ang", "\u65b9": "ang", "\u5f53": "ang",
  "\u6c5f": "iang", "\u9999": "iang", "\u5411": "iang", "\u8bb2": "iang", "\u5899": "iang", "\u5f3a": "iang", "\u826f": "iang", "\u6881": "iang", "\u573a": "iang", "\u54cd": "iang", "\u6837": "iang", "\u9633": "iang", "\u4eae": "iang", "\u4e61": "iang", "\u6e58": "iang", "\u5a18": "iang", "\u6768": "iang",
  "\u7ebf": "ian", "\u94b1": "ian", "\u5929": "ian", "\u524d": "ian", "\u89c1": "ian", "\u8fde": "ian", "\u7ec3": "ian", "\u5e74": "ian", "\u7720": "ian", "\u8fb9": "ian", "\u53d8": "ian", "\u5148": "ian", "\u95f4": "ian", "\u6e10": "ian", "\u60e6": "ian", "\u5ff5": "ian", "\u9762": "ian", "\u70b9": "ian", "\u95ea": "ian", "\u73b0": "ian", "\u6b20": "ian",
  "\u5357": "an", "\u4e09": "an", "\u5b89": "an", "\u770b": "an", "\u6ee1": "an", "\u61d2": "an", "\u6162": "an", "\u6562": "an", "\u96be": "an", "\u4f1e": "an",
  "\u6362": "uan", "\u665a": "uan", "\u4e71": "uan", "\u5173": "uan", "\u65ad": "uan", "\u5706": "uan", "\u56e2": "uan", "\u7ba1": "uan", "\u613f": "uan", "\u8f6c": "uan", "\u8fdc": "uan", "\u9009": "uan", "\u7b97": "uan",
  "\u659c": "ie", "\u591c": "ie", "\u522b": "ie", "\u89e3": "ie", "\u5199": "ie", "\u501f": "ie", "\u63a5": "ie", "\u53f6": "ie", "\u5217": "ie", "\u7ed3": "ie", "\u8d34": "ie",
  "\u5305": "ao", "\u5c11": "ao", "\u5230": "ao", "\u9ad8": "ao", "\u597d": "ao", "\u6389": "ao", "\u7b11": "ao", "\u627e": "ao", "\u8001": "ao", "\u544a": "ao", "\u65e9": "ao", "\u5c0f": "iao", "\u79d2": "iao", "\u8981": "iao", "\u6653": "iao",
  "\u5feb": "ai", "\u7231": "ai", "\u5916": "ai", "\u602a": "ai", "\u6765": "ai", "\u5728": "ai", "\u5f00": "ai", "\u767d": "ai", "\u4e70": "ai", "\u6539": "ai", "\u5e26": "ai", "\u5757": "uai",
  "\u7531": "ou", "\u8d70": "ou", "\u624b": "ou", "\u53e3": "ou", "\u540e": "ou", "\u7559": "ou", "\u6536": "ou", "\u5934": "ou", "\u5468": "ou", "\u591f": "ou", "\u53cb": "ou", "\u9996": "ou", "\u6d41": "iu", "\u6c42": "iu", "\u725b": "iu", "\u5c31": "iu",
  "\u9ed1": "ei", "\u98de": "ei", "\u8c01": "ei", "\u6cea": "ei", "\u8ffd": "ei", "\u7f8e": "ei", "\u5317": "ei", "\u7ed9": "ei", "\u676f": "ei",
  "\u66f2": "u", "\u533a": "u", "\u53bb": "u", "\u53e5": "u", "\u4e3e": "u", "\u8bb8": "u", "\u53d6": "u", "\u8bed": "u", "\u96e8": "u", "\u4f4f": "u", "\u51fa": "u", "\u4e66": "u", "\u5904": "u", "\u8f66": "u", "\u9010": "u", "\u8def": "u", "\u82e6": "u", "\u6570": "u", "\u5267": "u",
  "\u4f60": "i", "\u91cc": "i", "\u8d77": "i", "\u8bb0": "i", "\u673a": "i", "\u7b14": "i", "\u9898": "i", "\u5176": "i", "\u671f": "i", "\u8ff7": "i", "\u59cb": "i", "\u662f": "i", "\u4e8b": "i", "\u5931": "i", "\u8bcd": "i", "\u6b21": "i", "\u81f3": "i", "\u59ff": "i", "\u5242": "i", "\u620f": "i",
  "\u5fc3": "in", "\u65b0": "in", "\u4eb2": "in", "\u91d1": "in", "\u6797": "in", "\u4eca": "in", "\u97f3": "in", "\u4fe1": "in", "\u77ac": "un", "\u987a": "un", "\u51c6": "un",
  "\u542c": "ing", "\u60c5": "ing", "\u6e05": "ing", "\u9752": "ing", "\u8f7b": "ing", "\u660e": "ing", "\u5f71": "ing", "\u6674": "ing", "\u661f": "ing", "\u503e": "ing", "\u6210": "eng", "\u58f0": "eng", "\u98ce": "eng", "\u7b49": "eng", "\u706f": "eng", "\u51b7": "eng",
  "\u4e2d": "ong", "\u7ec8": "ong", "\u949f": "ong", "\u63a7": "ong", "\u75db": "ong", "\u7a7a": "ong", "\u61c2": "ong", "\u52a8": "ong", "\u68a6": "ong", "\u5145": "ong",
  "\u5a46": "o", "\u591a": "o", "\u6211": "o", "\u505a": "o", "\u9519": "o", "\u8bf4": "o", "\u706b": "o", "\u8fc7": "uo", "\u843d": "uo", "\u6269": "uo", "\u82e5": "uo", "\u5f31": "uo",
  "\u54e5": "e", "\u6cb3": "e", "\u53ef": "e", "\u70ed": "e", "\u4e48": "e", "\u5962": "e", "\u5ba2": "e", "\u7740": "e", "\u4e86": "e", "\u7684": "e", "\u5f97": "e", "\u600e": "en", "\u4ec0": "en", "\u771f": "en", "\u95e8": "en", "\u4eba": "en", "\u8ddf": "en", "\u800c": "er", "\u8033": "er", "\u5427": "a", "\u5417": "a", "\u5bb6": "ia", "\u52a0": "ia",
};

Object.assign(CJK_FINAL_HINTS, {
  "太": "ai",
  "再": "ai",
  "零": "ing",
  "行": "ing",
  "两": "iang",
  "琴": "in",
  "随": "ui",
  "身": "en",
  "暴": "ao",
  "调": "iao",
  "烟": "ian",
  "燃": "an",
  "光": "uang",
  "穿": "uan",
  "船": "uan",
  "川": "uan",
  "院": "uan",
  "卷": "uan",
  "潮": "ao",
  "燥": "ao",
  "绕": "ao",
  "饶": "ao",
  "傲": "ao",
  "骄": "iao",
  "摇": "iao",
  "飘": "iao",
  "漂": "iao",
  "烧": "ao",
  "招": "ao",
  "桥": "iao",
});

const CJK_WEAK_FINAL_CHARS = new Set(["的", "了", "着", "么", "吗", "吧", "啊", "呀", "啦", "嘛", "呢"]);
const CJK_WEAK_MIDDLE_CHARS = new Set(["的", "了", "着", "是", "我", "你", "他", "她", "它", "这", "那", "个", "一", "不", "在"]);
const CJK_WEAK_CONNECTOR_CHARS = new Set(["的", "了", "着", "是", "在", "个"]);

const CJK_FINAL_FAMILY_ALIASES: Record<string, string> = {
  ia: "a",
  ua: "a",
  ian: "an",
  uan: "an",
  iang: "ang",
  uang: "ang",
  iao: "ao",
  uai: "ai",
  in: "en",
  un: "en",
  ing: "eng",
  ong: "eng",
  iong: "eng",
  iu: "ou",
  ui: "ei",
  ue: "ie",
  uo: "o",
};

export function scanRhymeCandidates(lines: LyricLine[]): RhymeCandidateScan {
  const candidates = lines.flatMap((line) => scanLineCandidates(line));
  const confirmedCandidates = selectConfirmedCandidates(candidates, lines);
  const units = confirmedCandidates.map(stripCandidateMeta);
  const groups = createGroups(confirmedCandidates);
  const summary = createSummary(lines, candidates, confirmedCandidates, groups);
  const analysis: RhymeAnalysisDraft = {
    units,
    groups,
    lineRhymeMap: createLineRhymeMap(units),
    summary: {
      totalLines: summary.totalLines,
      candidateCount: summary.candidateCount,
      confirmedUnitCount: summary.confirmedUnitCount,
      unitCount: summary.confirmedUnitCount,
      groupCount: summary.groupCount,
      multiSyllableCount: summary.multiSyllableCount,
      lineEndCount: summary.lineEndCount,
      middleCount: summary.middleCount,
      crossLineCount: summary.crossLineCount,
      internalCount: summary.internalCount,
      repetitionCount: summary.repetitionCount,
      slantCount: summary.slantCount,
      dominantPatterns: summary.dominantPatterns,
      confidence: summary.confidence,
    },
    warnings: createWarnings(summary),
  };

  return { candidates: candidates.map(stripCandidateMeta), analysis, summary };
}

export function mergeRhymeAnalysisDrafts(
  candidateAnalysis: RhymeAnalysisDraft,
  llmAnalysis: RhymeAnalysisDraft | undefined,
): RhymeAnalysisDraft {
  if (!llmAnalysis) return candidateAnalysis;

  const llmUnits = sortUnits(llmAnalysis.units ?? []);

  if (!llmUnits.length) {
    return {
      ...candidateAnalysis,
      warnings: [
        ...(llmAnalysis.warnings ?? []),
        ...(candidateAnalysis.warnings ?? []),
        "LLM did not adjudicate any rhyme units; candidate scanner result is used as fallback.",
      ].slice(0, 12),
    };
  }

  const groups = llmAnalysis.groups?.length
    ? llmAnalysis.groups
    : createGroupsFromDraftUnits(llmUnits);

  return {
    ...candidateAnalysis,
    ...llmAnalysis,
    units: llmUnits,
    groups,
    lineRhymeMap: createLineRhymeMap(llmUnits),
    summary: {
      ...(candidateAnalysis.summary ?? {}),
      ...(llmAnalysis.summary ?? {}),
      candidateCount: candidateAnalysis.summary?.candidateCount,
      unitCount: llmUnits.length,
      confirmedUnitCount: llmUnits.length,
      groupCount: groups.length,
      lineEndCount: llmUnits.filter((unit) => unit.position === "end").length,
      middleCount: llmUnits.filter((unit) => unit.position === "middle" || unit.position === "start").length,
      crossLineCount: llmUnits.filter((unit) => unit.position === "cross-line").length,
      internalCount: llmUnits.filter((unit) => unit.position === "internal").length,
      multiSyllableCount: llmUnits.filter(isMultiSyllableUnit).length,
      repetitionCount: llmUnits.filter((unit) => unit.rhymeQuality === "repetition").length,
      slantCount: llmUnits.filter((unit) => isSlantQuality(unit.rhymeQuality)).length,
      dominantPatterns: createDominantPatterns(groups),
    },
    warnings: [
      ...(llmAnalysis.warnings ?? []),
      ...(candidateAnalysis.warnings ?? []).map((warning) => `candidate-scan: ${warning}`),
    ].slice(0, 12),
  };
}

function scanLineCandidates(line: LyricLine): RhymeCandidate[] {
  const segments = findTextSegments(line.text);
  const candidates = segments.flatMap((segment) =>
    hasCjk(segment.text)
      ? createCjkCandidates(line, segment)
      : createLatinCandidates(line, segment),
  );

  return dedupeCandidates(candidates)
    .sort(
      (left, right) =>
        right.score - left.score ||
        readTextLength(right.text ?? "") - readTextLength(left.text ?? ""),
    )
    .slice(0, MAX_CANDIDATES_PER_LINE)
    .map((candidate, index) => ({
      ...candidate,
      id: `${line.id}-candidate-${index + 1}`,
    }));
}

function findTextSegments(text: string): TextSegment[] {
  const contentEnd = text.replace(TRAILING_NOISE_PATTERN, "").length;
  const segments: TextSegment[] = [];
  let match: RegExpExecArray | null;

  SEGMENT_PATTERN.lastIndex = 0;
  while ((match = SEGMENT_PATTERN.exec(text)) !== null) {
    const segmentText = match[0];
    const start = match.index;
    const end = start + segmentText.length;

    segments.push({ text: segmentText, start, end, isLineEnd: end >= contentEnd });
  }

  return segments;
}

function createCjkCandidates(line: LyricLine, segment: TextSegment): RhymeCandidate[] {
  return findCjkRuns(segment).flatMap((run) => createCjkRunCandidates(line, run));
}

function findCjkRuns(segment: TextSegment): TextSegment[] {
  const runs: TextSegment[] = [];
  let match: RegExpExecArray | null;

  CJK_RUN_PATTERN.lastIndex = 0;
  while ((match = CJK_RUN_PATTERN.exec(segment.text)) !== null) {
    const start = segment.start + match.index;
    const end = start + match[0].length;

    runs.push({
      text: match[0],
      start,
      end,
      isLineEnd: segment.isLineEnd && end === segment.end,
    });
  }

  return runs;
}

function createCjkRunCandidates(line: LyricLine, segment: TextSegment): RhymeCandidate[] {
  const candidates: RhymeCandidate[] = [];
  const maxLength = Math.min(segment.text.length, MAX_CJK_WINDOW_LENGTH);

  for (let length = 1; length <= maxLength; length += 1) {
    pushCjkCandidate(candidates, {
      line,
      text: line.text.slice(segment.end - length, segment.end),
      startChar: segment.end - length,
      endChar: segment.end,
      position: segment.isLineEnd ? "end" : "middle",
    });
  }

  for (let length = MIN_CJK_MIDDLE_WINDOW_LENGTH; length <= maxLength; length += 1) {
    for (let startChar = segment.start; startChar + length <= segment.end; startChar += 1) {
      const endChar = startChar + length;

      if (endChar === segment.end) {
        continue;
      }

      pushCjkCandidate(candidates, {
        line,
        text: line.text.slice(startChar, endChar),
        startChar,
        endChar,
        position: startChar === segment.start ? "start" : "middle",
      });
    }
  }

  return candidates;
}

function pushCjkCandidate(
  candidates: RhymeCandidate[],
  input: {
    line: LyricLine;
    text: string;
    startChar: number;
    endChar: number;
    position: RhymeAnalysisPosition;
  },
): void {
  if (shouldCreateCjkCandidate(input.text, input.position)) {
    candidates.push(createCandidate(input));
  }
}

function shouldCreateCjkCandidate(text: string, position: RhymeAnalysisPosition): boolean {
  const chars = Array.from(text).filter((char) => CJK_PATTERN.test(char));
  const finalChar = chars.at(-1);

  if (!finalChar || CJK_WEAK_FINAL_CHARS.has(finalChar)) {
    return false;
  }

  if (!CJK_FINAL_HINTS[finalChar]) {
    return false;
  }

  if (position === "start") {
    return false;
  }

  if (
    chars.length > 1 &&
    chars.slice(0, -1).some((char) => CJK_WEAK_CONNECTOR_CHARS.has(char))
  ) {
    return false;
  }

  if (position !== "end" && chars.some((char) => CJK_WEAK_MIDDLE_CHARS.has(char))) {
    return false;
  }

  if (position !== "end" && chars.length >= 3 && chars.some((char) => !CJK_FINAL_HINTS[char])) {
    return false;
  }

  return true;
}

function createLatinCandidates(line: LyricLine, segment: TextSegment): RhymeCandidate[] {
  if (segment.text.length < 3) return [];

  return [
    createCandidate({
      line,
      text: segment.text,
      startChar: segment.start,
      endChar: segment.end,
      position: segment.isLineEnd ? "end" : "middle",
    }),
  ];
}

function createCandidate(input: {
  line: LyricLine;
  text: string;
  startChar: number;
  endChar: number;
  position: RhymeAnalysisPosition;
}): RhymeCandidate {
  const rhymeLevel = readRhymeLevel(input.text);
  const phoneticKey = createPhoneticKey(input.text);
  const exactGroupKey = createRhymeFamilyKey(phoneticKey);
  const looseGroupKey = readTailFamilyKey(phoneticKey);
  const score = scoreCandidate(input.position, rhymeLevel, input.text);

  return {
    id: `${input.line.id}-candidate`,
    lineId: input.line.id,
    lineIndex: input.line.index,
    text: input.text,
    startChar: input.startChar,
    endChar: input.endChar,
    position: input.position,
    syllables: splitSyllables(input.text),
    phoneticKey,
    rhymeType: `${input.position === "end" ? "line-end" : input.position} ${rhymeLevel} rhyme`,
    rhymeLevel,
    rhymeQuality: "uncertain",
    rhymeGroupId: `rhyme-${slugKey(exactGroupKey)}`,
    rhymeLabel: exactGroupKey,
    note: "Generated by rule-based phonetic window scanner.",
    confidence: clamp(score, 0.28, 0.74),
    groupKey: exactGroupKey,
    exactGroupKey,
    looseGroupKey,
    score,
  };
}

function selectConfirmedCandidates(candidates: RhymeCandidate[], lines: LyricLine[]): RhymeCandidate[] {
  const relationAwareCandidates = createRelationAwareCandidates(candidates);
  const groupedCandidates = groupCandidates(relationAwareCandidates);
  const selected: RhymeCandidate[] = [];
  const occupiedRangesByLine = new Map<string, Array<{ start: number; end: number }>>();

  const relationalGroups = Array.from(groupedCandidates.values())
    .filter(isRelationalCandidateGroup)
    .sort((left, right) => readGroupSelectionScore(right) - readGroupSelectionScore(left));

  for (const group of relationalGroups) {
    const distinctLineCount = new Set(group.map((candidate) => candidate.lineIndex)).size;
    const sortedGroup = group
      .map((candidate) => ({
        ...candidate,
        score: candidate.score + Math.min(distinctLineCount, 4) * 0.055,
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          readTextLength(right.text ?? "") - readTextLength(left.text ?? ""),
      );

    for (const candidate of sortedGroup) {
      pushCandidateIfFree(selected, occupiedRangesByLine, candidate);
    }
  }

  for (const line of lines) {
    if (selected.some((candidate) => candidate.lineId === line.id)) continue;

    const fallbackCandidate = relationAwareCandidates
      .filter((candidate) => candidate.lineId === line.id && candidate.position === "end")
      .sort(
        (left, right) =>
          readTextLength(left.text ?? "") - readTextLength(right.text ?? "") ||
          right.score - left.score,
      )[0];

    if (fallbackCandidate) {
      pushCandidateIfFree(selected, occupiedRangesByLine, {
        ...fallbackCandidate,
        confidence: 0.42,
        rhymeQuality: "uncertain",
        note: "Line-end fallback from candidate scanner; needs LLM confirmation.",
      });
    }
  }

  return selected
    .sort(
      (left, right) =>
        (left.lineIndex ?? 0) - (right.lineIndex ?? 0) ||
        (left.startChar ?? 0) - (right.startChar ?? 0),
    )
    .map((candidate, index) => ({
      ...candidate,
      id: `${candidate.lineId}-rhyme-${index + 1}`,
      confidence: clamp(candidate.confidence ?? candidate.score, 0.32, 0.86),
      rhymeQuality: candidate.rhymeQuality ?? (candidate.position === "end" ? "slant" : "uncertain"),
    }));
}

function createRelationAwareCandidates(candidates: RhymeCandidate[]): RhymeCandidate[] {
  const exactGroups = groupCandidatesBy(candidates, (candidate) => candidate.exactGroupKey);
  const looseGroups = groupCandidatesBy(candidates, (candidate) => candidate.looseGroupKey);

  return candidates.map((candidate) => {
    const exactGroup = exactGroups.get(candidate.exactGroupKey) ?? [];
    const looseGroup = looseGroups.get(candidate.looseGroupKey) ?? [];
    const hasExactRelation = isRelationalCandidateGroup(exactGroup);
    const hasLooseRelation = isRelationalCandidateGroup(looseGroup);
    const useLooseGroup =
      !hasExactRelation &&
      hasLooseRelation &&
      candidate.looseGroupKey !== candidate.exactGroupKey &&
      candidate.position === "end" &&
      readTextLength(candidate.text ?? "") === 1;
    const groupKey = useLooseGroup ? candidate.looseGroupKey : candidate.exactGroupKey;
    const length = readTextLength(candidate.text ?? "");
    const loosePenalty = useLooseGroup
      ? Math.max(length - 1, 0) * LOOSE_GROUP_SCORE_PENALTY
      : 0;
    const relationBonus = hasExactRelation ? 0.09 : useLooseGroup ? 0.025 : 0;
    const rhymeQuality = readCandidateQuality(candidate, hasExactRelation, useLooseGroup);

    return {
      ...candidate,
      groupKey,
      rhymeGroupId: `rhyme-${slugKey(groupKey)}`,
      rhymeLabel: groupKey,
      rhymeQuality,
      confidence: clamp(
        (candidate.confidence ?? 0.4) + relationBonus * 0.55 - loosePenalty * 0.35,
        0.28,
        0.82,
      ),
      score: clamp(candidate.score + relationBonus - loosePenalty, 0.18, 0.92),
      note: useLooseGroup
        ? `${candidate.note} Grouped by tail-family ${groupKey}; full sequence is ${candidate.phoneticKey}.`
        : candidate.note,
    };
  });
}

function readCandidateQuality(
  candidate: RhymeCandidate,
  hasExactRelation: boolean,
  useLooseGroup: boolean,
): RhymeAnalysisQuality {
  if (useLooseGroup) {
    return readTextLength(candidate.text ?? "") >= 2 ? "assonance" : "slant";
  }

  if (hasExactRelation) {
    return readTextLength(candidate.text ?? "") >= 2 ? "perfect" : "slant";
  }

  return candidate.rhymeQuality ?? "uncertain";
}

function groupCandidatesBy(
  candidates: RhymeCandidate[],
  readKey: (candidate: RhymeCandidate) => string,
): Map<string, RhymeCandidate[]> {
  const groups = new Map<string, RhymeCandidate[]>();

  for (const candidate of candidates) {
    const key = readKey(candidate);
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  return groups;
}

function isRelationalCandidateGroup(group: RhymeCandidate[] | undefined): boolean {
  if (!group?.length) {
    return false;
  }

  const distinctLineCount = new Set(group.map((candidate) => candidate.lineIndex)).size;

  if (distinctLineCount >= 2) {
    return true;
  }

  return hasMultipleNonOverlappingCandidates(group);
}

function readGroupSelectionScore(group: RhymeCandidate[]): number {
  const distinctLineCount = new Set(group.map((candidate) => candidate.lineIndex)).size;
  const maxLevelScore = Math.max(...group.map((candidate) => readRhymeLevelScore(candidate.rhymeLevel)));
  const averageScore = group.reduce((sum, candidate) => sum + candidate.score, 0) / Math.max(group.length, 1);

  return maxLevelScore * 2 + Math.min(distinctLineCount, 4) * 0.12 + averageScore;
}

function readRhymeLevelScore(level: RhymeAnalysisLevel | undefined): number {
  if (level === "multi") return 4;
  if (level === "triple") return 3;
  if (level === "double") return 2;
  return 1;
}

function hasMultipleNonOverlappingCandidates(group: RhymeCandidate[]): boolean {
  const candidatesByLine = new Map<string, RhymeCandidate[]>();

  for (const candidate of group) {
    const lineId = candidate.lineId ?? `line-${candidate.lineIndex ?? 0}`;
    const lineCandidates = candidatesByLine.get(lineId) ?? [];
    lineCandidates.push(candidate);
    candidatesByLine.set(lineId, lineCandidates);
  }

  for (const lineCandidates of candidatesByLine.values()) {
    const sortedCandidates = lineCandidates
      .slice()
      .sort((left, right) => (left.startChar ?? 0) - (right.startChar ?? 0));
    let previousEnd = -1;
    let count = 0;

    for (const candidate of sortedCandidates) {
      const start = candidate.startChar ?? 0;
      const end = candidate.endChar ?? start + readTextLength(candidate.text ?? "");

      if (start >= previousEnd) {
        count += 1;
        previousEnd = end;
      }

      if (count >= 2) {
        return true;
      }
    }
  }

  return false;
}

function pushCandidateIfFree(
  selected: RhymeCandidate[],
  occupiedRangesByLine: Map<string, Array<{ start: number; end: number }>>,
  candidate: RhymeCandidate,
): void {
  const lineId = candidate.lineId ?? `line-${candidate.lineIndex}`;
  const start = candidate.startChar ?? 0;
  const end = candidate.endChar ?? start + readTextLength(candidate.text ?? "");
  const occupiedRanges = occupiedRangesByLine.get(lineId) ?? [];
  const overlaps = occupiedRanges.some((range) => start < range.end && end > range.start);

  if (overlaps) return;

  selected.push(candidate);
  occupiedRanges.push({ start, end });
  occupiedRangesByLine.set(lineId, occupiedRanges);
}

function createGroups(candidates: RhymeCandidate[]): RhymeAnalysisGroupDraft[] {
  const groupedCandidates = groupCandidates(candidates);

  return Array.from(groupedCandidates.entries()).map(([groupKey, group], index) => {
    const lineIndexes = uniqueNumbers(group.map((candidate) => candidate.lineIndex ?? 0));
    const lineIds = uniqueStrings(group.map((candidate) => candidate.lineId ?? ""));
    const unitIds = uniqueStrings(group.map((candidate) => candidate.id ?? ""));
    const levels = group.map((candidate) => candidate.rhymeLevel).filter(Boolean) as string[];
    const qualities = group.map((candidate) => candidate.rhymeQuality).filter(Boolean) as string[];
    const examples = uniqueStrings(group.map((candidate) => candidate.text ?? "")).slice(0, 5);

    return {
      id: `group-${slugKey(groupKey) || index + 1}`,
      label: groupKey || createSchemeLabel(index),
      pattern: readGroupPattern(lineIndexes),
      lineIds,
      lineIndexes,
      unitIds,
      description: `Rule scan grouped ${group.length} units by rhyme family ${groupKey}. Examples: ${examples.join(" / ")}.`,
      rhymeLevel: readDominantValue(levels) as RhymeAnalysisLevel | undefined,
      rhymeQuality: readDominantValue(qualities) as RhymeAnalysisQuality | undefined,
      confidence: clamp(
        round(group.reduce((sum, candidate) => sum + (candidate.confidence ?? 0.4), 0) / group.length),
        0,
        1,
      ),
    };
  });
}

function createLineRhymeMap(units: RhymeAnalysisUnitDraft[]): Record<string, string[]> {
  const lineRhymeMap: Record<string, string[]> = {};

  for (const unit of units) {
    const lineId = unit.lineId ?? `line-${(unit.lineIndex ?? 0) + 1}`;
    lineRhymeMap[lineId] = [...(lineRhymeMap[lineId] ?? []), unit.id ?? `${lineId}-rhyme`];
  }

  return lineRhymeMap;
}

function createSummary(
  lines: LyricLine[],
  candidates: RhymeCandidate[],
  confirmedCandidates: RhymeCandidate[],
  groups: RhymeAnalysisGroupDraft[],
): RhymeCandidateScanSummary {
  const confidence = confirmedCandidates.length
    ? confirmedCandidates.reduce((sum, candidate) => sum + (candidate.confidence ?? 0.4), 0) /
      confirmedCandidates.length
    : 0;

  return {
    totalLines: lines.length,
    candidateCount: candidates.length,
    confirmedUnitCount: confirmedCandidates.length,
    groupCount: groups.length,
    lineEndCount: confirmedCandidates.filter((candidate) => candidate.position === "end").length,
    middleCount: confirmedCandidates.filter((candidate) => candidate.position === "middle" || candidate.position === "start").length,
    crossLineCount: confirmedCandidates.filter((candidate) => candidate.position === "cross-line").length,
    internalCount: confirmedCandidates.filter((candidate) => candidate.position === "internal").length,
    multiSyllableCount: confirmedCandidates.filter(isMultiSyllableUnit).length,
    repetitionCount: confirmedCandidates.filter((candidate) => candidate.rhymeQuality === "repetition").length,
    slantCount: confirmedCandidates.filter((candidate) => isSlantQuality(candidate.rhymeQuality)).length,
    dominantPatterns: createDominantPatterns(groups),
    confidence: clamp(round(confidence), 0, 1),
  };
}

function createWarnings(summary: RhymeCandidateScanSummary): string[] {
  const warnings: string[] = [];

  if (summary.confirmedUnitCount === 0) {
    warnings.push("Candidate scanner found no confirmed rhyme units.");
  }

  if (summary.middleCount === 0 && summary.internalCount === 0 && summary.totalLines >= 4) {
    warnings.push("Candidate scanner currently found line-end units only; LLM should review middle/internal rhymes.");
  }

  if (summary.multiSyllableCount === 0 && summary.totalLines >= 4) {
    warnings.push("Candidate scanner found no double/triple/multi units; LLM should review multi-rhyme windows.");
  }

  if (summary.slantCount > summary.confirmedUnitCount * 0.6 && summary.confirmedUnitCount >= 6) {
    warnings.push("Candidate scanner relied heavily on slant or tail-family grouping; LLM should verify weak rhyme families.");
  }

  return warnings;
}

function createDominantPatterns(groups: RhymeAnalysisGroupDraft[]): string[] {
  const patternCounts = new Map<string, number>();

  for (const pattern of groups.map((group) => group.pattern).filter((pattern): pattern is string => Boolean(pattern))) {
    patternCounts.set(pattern, (patternCounts.get(pattern) ?? 0) + 1);
  }

  return Array.from(patternCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([pattern]) => pattern)
    .slice(0, 5);
}

function groupCandidates(candidates: RhymeCandidate[]): Map<string, RhymeCandidate[]> {
  const groupedCandidates = new Map<string, RhymeCandidate[]>();

  for (const candidate of candidates) {
    const group = groupedCandidates.get(candidate.groupKey) ?? [];
    group.push(candidate);
    groupedCandidates.set(candidate.groupKey, group);
  }

  return groupedCandidates;
}

function dedupeCandidates(candidates: RhymeCandidate[]): RhymeCandidate[] {
  const candidateMap = new Map<string, RhymeCandidate>();

  for (const candidate of candidates) {
    const key = createUnitKey(candidate);
    const existingCandidate = candidateMap.get(key);

    if (!existingCandidate || candidate.score > existingCandidate.score) {
      candidateMap.set(key, candidate);
    }
  }

  return Array.from(candidateMap.values());
}

function sortUnits(units: RhymeAnalysisUnitDraft[]): RhymeAnalysisUnitDraft[] {
  return units.slice().sort(
    (left, right) =>
      (left.lineIndex ?? 0) - (right.lineIndex ?? 0) ||
      (left.startChar ?? 0) - (right.startChar ?? 0),
  );
}

function createGroupsFromDraftUnits(
  units: RhymeAnalysisUnitDraft[],
): RhymeAnalysisGroupDraft[] {
  const groupedUnits = new Map<string, RhymeAnalysisUnitDraft[]>();

  for (const unit of units) {
    const groupKey =
      unit.rhymeGroupId || unit.rhymeLabel || unit.phoneticKey || "unknown";
    const group = groupedUnits.get(groupKey) ?? [];
    group.push(unit);
    groupedUnits.set(groupKey, group);
  }

  return Array.from(groupedUnits.entries()).map(([groupKey, group], index) => {
    const lineIndexes = uniqueNumbers(group.map((unit) => unit.lineIndex ?? 0));
    const lineIds = uniqueStrings(group.map((unit) => unit.lineId ?? ""));
    const unitIds = uniqueStrings(group.map((unit) => unit.id ?? ""));
    const levels = group.map((unit) => unit.rhymeLevel).filter(Boolean) as string[];
    const qualities = group.map((unit) => unit.rhymeQuality).filter(Boolean) as string[];
    const examples = uniqueStrings(group.map((unit) => unit.text ?? "")).slice(0, 5);

    return {
      id: groupKey.startsWith("group-") ? groupKey : `group-${slugKey(groupKey) || index + 1}`,
      label: group[0]?.rhymeLabel || group[0]?.phoneticKey || groupKey,
      pattern: readGroupPattern(lineIndexes),
      lineIds,
      lineIndexes,
      unitIds,
      description: `LLM adjudication grouped ${group.length} units by rhyme family ${groupKey}. Examples: ${examples.join(" / ")}.`,
      rhymeLevel: readDominantValue(levels) as RhymeAnalysisLevel | undefined,
      rhymeQuality: readDominantValue(qualities) as RhymeAnalysisQuality | undefined,
      confidence: clamp(
        round(group.reduce((sum, unit) => sum + (unit.confidence ?? 0.4), 0) / group.length),
        0,
        1,
      ),
    };
  });
}

function stripCandidateMeta(candidate: RhymeCandidate): RhymeAnalysisUnitDraft {
  const {
    groupKey: _groupKey,
    exactGroupKey: _exactGroupKey,
    looseGroupKey: _looseGroupKey,
    score: _score,
    ...unit
  } = candidate;
  void _groupKey;
  void _exactGroupKey;
  void _looseGroupKey;
  void _score;
  return unit;
}

function createUnitKey(unit: RhymeAnalysisUnitDraft): string {
  return [
    unit.lineId ?? `line-${unit.lineIndex ?? 0}`,
    unit.startChar ?? "?",
    unit.endChar ?? "?",
    unit.text ?? "",
    unit.position ?? "",
  ].join("|");
}

function createPhoneticKey(text: string): string {
  const normalizedText = text.trim();
  if (!normalizedText) return "unknown";

  if (hasCjk(normalizedText)) {
    const cjkText = extractCjkText(normalizedText);
    const tailHint = readCjkTailHint(cjkText);

    if (tailHint) {
      return tailHint;
    }

    const finals = readCjkFinals(cjkText);
    return finals.length ? finals.join("-") : "unknown";
  }

  return createLatinPhoneticKey(normalizedText);
}

function readCjkTailHint(text: string): string | undefined {
  if (!text) {
    return undefined;
  }

  for (const [tail, key] of CJK_TAIL_HINTS) {
    if (text === tail) {
      return key;
    }
  }

  return undefined;
}

function readCjkFinals(text: string): string[] {
  return Array.from(text)
    .filter((char) => CJK_PATTERN.test(char))
    .map((char) => CJK_FINAL_HINTS[char] ?? char);
}

function extractCjkText(text: string): string {
  return Array.from(text)
    .filter((char) => CJK_PATTERN.test(char))
    .join("");
}

function createLatinPhoneticKey(text: string): string {
  const normalizedWord = text.toLowerCase().replace(/[^a-z]/g, "");
  if (!normalizedWord) {
    return "unknown";
  }

  const hint = readLatinRhymeHint(normalizedWord);
  if (hint) {
    return hint;
  }

  const vowelTail = normalizedWord.match(/[aeiouy]+[^aeiouy]*$/)?.[0];
  return vowelTail ?? normalizedWord.slice(-3) ?? "unknown";
}

function createRhymeFamilyKey(phoneticKey: string): string {
  return phoneticKey
    .split("-")
    .map((part) => normalizeFinalFamily(part))
    .filter(Boolean)
    .join("-") || "unknown";
}

function readTailFamilyKey(phoneticKey: string): string {
  const parts = phoneticKey.split("-").filter(Boolean);
  return normalizeFinalFamily(parts.at(-1) ?? phoneticKey) || "unknown";
}

function normalizeFinalFamily(finalKey: string): string {
  const normalizedKey = finalKey.trim().toLowerCase();
  return CJK_FINAL_FAMILY_ALIASES[normalizedKey] ?? normalizedKey;
}

function readLatinRhymeHint(word: string): string | undefined {
  const soundHints: Array<[RegExp, string]> = [
    [/(?:eigh|igh|yme|ime|ine|ite|ide|ike|ife|ive|yne|yte|ight)$/u, "ai"],
    [/(?:ee|ea|ie|ei|ey)$/u, "i"],
    [/(?:oo|ew|ue)$/u, "u"],
    [/(?:ow|ou)$/u, "ou"],
    [/(?:air|are|ear)$/u, "air"],
    [/(?:tion|sion)$/u, "shun"],
  ];

  for (const [pattern, key] of soundHints) {
    if (pattern.test(word)) {
      return key;
    }
  }

  const tailMatch = word.match(/([aeiouy])([^aeiouy]*)$/u);
  if (!tailMatch) {
    return undefined;
  }

  const vowel = tailMatch[1];
  const tail = tailMatch[2];

  if (tail === "y") {
    return "ai";
  }

  if (["me", "mb", "ne", "nd", "nt", "ng", "ge", "ke", "pe", "te", "ve", "ce", "se", "de"].includes(tail)) {
    if (vowel === "a" || vowel === "i" || vowel === "y") return "ai";
    if (vowel === "e") return "i";
    if (vowel === "o") return "o";
    if (vowel === "u") return "u";
  }

  return undefined;
}

function readRhymeLevel(text: string): RhymeAnalysisLevel {
  const length = readTextLength(text);

  if (length <= 1) return "single";
  if (length === 2) return "double";
  if (length === 3) return "triple";
  return "multi";
}

function readGroupPattern(lineIndexes: number[]): string {
  if (lineIndexes.length <= 1) return "single-occurrence";

  const sortedIndexes = [...lineIndexes].sort((left, right) => left - right);
  const isConsecutive = sortedIndexes.every(
    (lineIndex, index) => index === 0 || lineIndex === sortedIndexes[index - 1] + 1,
  );

  if (isConsecutive && sortedIndexes.length >= 3) return "chain";

  const gaps = sortedIndexes.slice(1).map((lineIndex, index) => lineIndex - sortedIndexes[index]);
  return gaps.some((gap) => gap > 1) ? "jump" : "couplet";
}

function scoreCandidate(
  position: RhymeAnalysisPosition,
  rhymeLevel: RhymeAnalysisLevel,
  text: string,
): number {
  const positionScore =
    position === "end"
      ? 0.22
      : position === "middle"
        ? 0.14
        : position === "start"
          ? 0.1
          : 0.08;
  const levelScore =
    rhymeLevel === "multi"
      ? 0.18
      : rhymeLevel === "triple"
        ? 0.14
        : rhymeLevel === "double"
          ? 0.1
          : 0.03;
  const lengthScore = Math.min(readTextLength(text), 4) * 0.025;

  return round(0.31 + positionScore + levelScore + lengthScore);
}

function splitSyllables(text: string): string[] {
  if (hasCjk(text)) {
    return Array.from(text).filter((char) => CJK_PATTERN.test(char));
  }

  return text.split(/\s+/).filter(Boolean);
}

function readTextLength(text: string): number {
  if (hasCjk(text)) {
    return Array.from(text).filter((char) => CJK_PATTERN.test(char)).length;
  }

  return text.split(/\s+/).filter(Boolean).length || text.length;
}

function isMultiSyllableUnit(unit: RhymeAnalysisUnitDraft): boolean {
  return (
    unit.rhymeLevel === "double" ||
    unit.rhymeLevel === "triple" ||
    unit.rhymeLevel === "multi" ||
    (unit.syllables?.length ?? 0) >= 2 ||
    readTextLength(unit.text ?? "") >= 2
  );
}

function isSlantQuality(value: RhymeAnalysisQuality | undefined): boolean {
  return value === "slant" || value === "assonance" || value === "consonance";
}

function hasCjk(text: string): boolean {
  return CJK_PATTERN.test(text);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values.filter((value) => Number.isInteger(value)))).sort(
    (left, right) => left - right,
  );
}

function readDominantValue(values: Array<string | undefined>): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0];
}

function slugKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "");
}

function createSchemeLabel(index: number): string {
  const alphabetSize = 26;
  const firstChar = String.fromCharCode(65 + (index % alphabetSize));
  const cycle = Math.floor(index / alphabetSize);
  return cycle === 0 ? firstChar : `${firstChar}${cycle + 1}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number): number {
  return Number(value.toFixed(3));
}










