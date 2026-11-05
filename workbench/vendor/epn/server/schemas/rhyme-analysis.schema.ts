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

export interface RhymeAnalysisUnitDraft {
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

export interface RhymeAnalysisGroupDraft {
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

export interface RhymeAnalysisSummaryDraft {
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

export interface RhymeAnalysisDraft {
  units?: RhymeAnalysisUnitDraft[];
  groups?: RhymeAnalysisGroupDraft[];
  lineRhymeMap?: Record<string, string[]>;
  summary?: RhymeAnalysisSummaryDraft;
  warnings?: string[];
}

export const rhymeAnalysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["units", "groups", "lineRhymeMap", "summary", "warnings"],
  properties: {
    units: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "lineIndex",
          "text",
          "position",
          "syllables",
          "phoneticKey",
          "rhymeType",
          "rhymeLevel",
          "rhymeQuality",
          "rhymeGroupId",
          "confidence",
        ],
        properties: {
          id: { type: "string" },
          lineId: { type: "string" },
          lineIndex: { type: "integer", minimum: 0 },
          text: { type: "string" },
          startChar: { type: "integer", minimum: 0 },
          endChar: { type: "integer", minimum: 0 },
          position: {
            type: "string",
            enum: ["start", "middle", "end", "internal", "cross-line"],
          },
          syllables: {
            type: "array",
            items: { type: "string" },
          },
          phoneticKey: { type: "string" },
          rhymeType: { type: "string" },
          rhymeLevel: {
            type: "string",
            enum: ["single", "double", "triple", "multi"],
          },
          rhymeQuality: {
            type: "string",
            enum: [
              "perfect",
              "slant",
              "assonance",
              "consonance",
              "repetition",
              "uncertain",
            ],
          },
          rhymeGroupId: { type: "string" },
          rhymeLabel: { type: "string" },
          note: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "pattern", "lineIndexes", "confidence"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          pattern: { type: "string" },
          lineIds: {
            type: "array",
            items: { type: "string" },
          },
          lineIndexes: {
            type: "array",
            items: { type: "integer", minimum: 0 },
          },
          description: { type: "string" },
          unitIds: {
            type: "array",
            items: { type: "string" },
          },
          rhymeLevel: {
            type: "string",
            enum: ["single", "double", "triple", "multi"],
          },
          rhymeQuality: {
            type: "string",
            enum: [
              "perfect",
              "slant",
              "assonance",
              "consonance",
              "repetition",
              "uncertain",
            ],
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    lineRhymeMap: {
      type: "object",
      additionalProperties: {
        type: "array",
        items: { type: "string" },
      },
    },
    summary: {
      type: "object",
      additionalProperties: false,
      properties: {
        totalLines: { type: "integer", minimum: 0 },
        unitCount: { type: "integer", minimum: 0 },
        candidateCount: { type: "integer", minimum: 0 },
        confirmedUnitCount: { type: "integer", minimum: 0 },
        groupCount: { type: "integer", minimum: 0 },
        multiSyllableCount: { type: "integer", minimum: 0 },
        lineEndCount: { type: "integer", minimum: 0 },
        middleCount: { type: "integer", minimum: 0 },
        crossLineCount: { type: "integer", minimum: 0 },
        internalCount: { type: "integer", minimum: 0 },
        repetitionCount: { type: "integer", minimum: 0 },
        slantCount: { type: "integer", minimum: 0 },
        dominantPatterns: {
          type: "array",
          items: { type: "string" },
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

export function createRhymeAnalysisSchemaHint(): string {
  return [
    "Rhyme analysis output schema:",
    "- rhymeAnalysis.units: every rhyme unit found in the lyric, including line-end, middle, internal, and cross-line units.",
    "- rhymeAnalysis.groups: rhyme families or schemes that connect related units.",
    "- rhymeAnalysis.lineRhymeMap: map from lineId to the unit ids that belong to that line.",
    "- rhymeAnalysis.summary: totalLines, unitCount, candidateCount, confirmedUnitCount, groupCount, multiSyllableCount, lineEndCount, middleCount, crossLineCount, internalCount, repetitionCount, slantCount, dominantPatterns, confidence.",
    "- rhymeAnalysis.warnings: short notes when the analysis is uncertain or partial.",
    "Every unit should carry lineIndex, text, startChar, endChar, position, syllables, phoneticKey, rhymeType, rhymeLevel, rhymeQuality, rhymeGroupId, and confidence.",
    "Use rhymeLevel to mark single/double/triple/multi, and rhymeQuality to distinguish perfect/slant/assonance/consonance/repetition/uncertain.",
    "Use conservative confidence values and prefer warnings over guessing.",
  ].join("\n");
}

export function normalizeRhymeAnalysisDraft(
  value: unknown,
): RhymeAnalysisDraft | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const units = normalizeUnits(value.units);
  const groups = normalizeGroups(value.groups);
  const lineRhymeMap = normalizeLineRhymeMap(value.lineRhymeMap);
  const summary = normalizeSummary(value.summary);
  const warnings = normalizeStringArray(value.warnings, 12);

  if (!units && !groups && !lineRhymeMap && !summary && !warnings) {
    return undefined;
  }

  return {
    ...(units ? { units } : {}),
    ...(groups ? { groups } : {}),
    ...(lineRhymeMap ? { lineRhymeMap } : {}),
    ...(summary ? { summary } : {}),
    ...(warnings ? { warnings } : {}),
  };
}

function normalizeUnits(value: unknown): RhymeAnalysisUnitDraft[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const units = value
    .map((item): RhymeAnalysisUnitDraft | null => {
      if (!isPlainObject(item)) {
        return null;
      }

      const lineIndex = readIndex(item.lineIndex);
      const text = normalizeText(item.text);
      const startChar = readIndex(item.startChar);
      const endChar = readIndex(item.endChar);
      const position = normalizePosition(item.position);
      const syllables = normalizeStringArray(item.syllables, 8);
      const phoneticKey = normalizeText(item.phoneticKey);
      const rhymeType = normalizeText(item.rhymeType);
      const rhymeLevel = normalizeRhymeLevel(item.rhymeLevel);
      const rhymeQuality = normalizeRhymeQuality(item.rhymeQuality);
      const rhymeGroupId = normalizeText(item.rhymeGroupId);
      const rhymeLabel = normalizeText(item.rhymeLabel);
      const note = normalizeText(item.note);
      const confidence = readUnitNumber(item.confidence);

      if (
        lineIndex === undefined &&
        !text &&
        startChar === undefined &&
        endChar === undefined &&
        !position &&
        !syllables &&
        !phoneticKey &&
        !rhymeType &&
        !rhymeLevel &&
        !rhymeQuality &&
        !rhymeGroupId &&
        !rhymeLabel &&
        !note &&
        confidence === undefined
      ) {
        return null;
      }

      return {
        ...(normalizeText(item.id) ? { id: normalizeText(item.id) } : {}),
        ...(normalizeText(item.lineId)
          ? { lineId: normalizeText(item.lineId) }
          : {}),
        ...(lineIndex !== undefined ? { lineIndex } : {}),
        ...(text ? { text } : {}),
        ...(startChar !== undefined ? { startChar } : {}),
        ...(endChar !== undefined ? { endChar } : {}),
        ...(position ? { position } : {}),
        ...(syllables ? { syllables } : {}),
        ...(phoneticKey ? { phoneticKey } : {}),
        ...(rhymeType ? { rhymeType } : {}),
        ...(rhymeLevel ? { rhymeLevel } : {}),
        ...(rhymeQuality ? { rhymeQuality } : {}),
        ...(rhymeGroupId ? { rhymeGroupId } : {}),
        ...(rhymeLabel ? { rhymeLabel } : {}),
        ...(note ? { note } : {}),
        ...(confidence !== undefined ? { confidence } : {}),
      };
    })
    .filter((item): item is RhymeAnalysisUnitDraft => Boolean(item));

  return units.length ? units : undefined;
}

function normalizeGroups(
  value: unknown,
): RhymeAnalysisGroupDraft[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const groups = value
    .map((item): RhymeAnalysisGroupDraft | null => {
      if (!isPlainObject(item)) {
        return null;
      }

      const label = normalizeText(item.label);
      const pattern = normalizeText(item.pattern);
      const lineIds = normalizeStringArray(item.lineIds, 16);
      const lineIndexes = normalizeIndexArray(item.lineIndexes, 16);
      const unitIds = normalizeStringArray(item.unitIds, 32);
      const rhymeLevel = normalizeRhymeLevel(item.rhymeLevel);
      const rhymeQuality = normalizeRhymeQuality(item.rhymeQuality);
      const confidence = readUnitNumber(item.confidence);
      const description = normalizeText(item.description);

      if (
        !label &&
        !pattern &&
        !lineIds &&
        !lineIndexes &&
        !unitIds &&
        !description &&
        !rhymeLevel &&
        !rhymeQuality &&
        confidence === undefined
      ) {
        return null;
      }

      return {
        ...(normalizeText(item.id) ? { id: normalizeText(item.id) } : {}),
        ...(label ? { label } : {}),
        ...(pattern ? { pattern } : {}),
        ...(lineIds ? { lineIds } : {}),
        ...(lineIndexes ? { lineIndexes } : {}),
        ...(unitIds ? { unitIds } : {}),
        ...(description ? { description } : {}),
        ...(rhymeLevel ? { rhymeLevel } : {}),
        ...(rhymeQuality ? { rhymeQuality } : {}),
        ...(confidence !== undefined ? { confidence } : {}),
      };
    })
    .filter((item): item is RhymeAnalysisGroupDraft => Boolean(item));

  return groups.length ? groups : undefined;
}

function normalizeLineRhymeMap(
  value: unknown,
): Record<string, string[]> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const entries = Object.entries(value)
    .map(([key, entryValue]) => {
      const normalizedKey = normalizeText(key);
      const normalizedValues = normalizeStringArray(entryValue, 12);

      if (!normalizedKey || !normalizedValues) {
        return null;
      }

      return [normalizedKey, normalizedValues] as const;
    })
    .filter((item): item is readonly [string, string[]] => Boolean(item));

  if (!entries.length) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function normalizeSummary(
  value: unknown,
): RhymeAnalysisSummaryDraft | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const totalLines = readIndex(value.totalLines);
  const unitCount = readIndex(value.unitCount);
  const candidateCount = readIndex(value.candidateCount);
  const confirmedUnitCount = readIndex(value.confirmedUnitCount);
  const groupCount = readIndex(value.groupCount);
  const multiSyllableCount = readIndex(value.multiSyllableCount);
  const lineEndCount = readIndex(value.lineEndCount);
  const middleCount = readIndex(value.middleCount);
  const crossLineCount = readIndex(value.crossLineCount);
  const internalCount = readIndex(value.internalCount);
  const repetitionCount = readIndex(value.repetitionCount);
  const slantCount = readIndex(value.slantCount);
  const dominantPatterns = normalizeStringArray(value.dominantPatterns, 8);
  const confidence = readUnitNumber(value.confidence);

  if (
    totalLines === undefined &&
    unitCount === undefined &&
    candidateCount === undefined &&
    confirmedUnitCount === undefined &&
    groupCount === undefined &&
    multiSyllableCount === undefined &&
    lineEndCount === undefined &&
    middleCount === undefined &&
    crossLineCount === undefined &&
    internalCount === undefined &&
    repetitionCount === undefined &&
    slantCount === undefined &&
    !dominantPatterns &&
    confidence === undefined
  ) {
    return undefined;
  }

  return {
    ...(totalLines !== undefined ? { totalLines } : {}),
    ...(unitCount !== undefined ? { unitCount } : {}),
    ...(candidateCount !== undefined ? { candidateCount } : {}),
    ...(confirmedUnitCount !== undefined ? { confirmedUnitCount } : {}),
    ...(groupCount !== undefined ? { groupCount } : {}),
    ...(multiSyllableCount !== undefined ? { multiSyllableCount } : {}),
    ...(lineEndCount !== undefined ? { lineEndCount } : {}),
    ...(middleCount !== undefined ? { middleCount } : {}),
    ...(crossLineCount !== undefined ? { crossLineCount } : {}),
    ...(internalCount !== undefined ? { internalCount } : {}),
    ...(repetitionCount !== undefined ? { repetitionCount } : {}),
    ...(slantCount !== undefined ? { slantCount } : {}),
    ...(dominantPatterns ? { dominantPatterns } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

function normalizePosition(value: unknown): RhymeAnalysisPosition | undefined {
  const normalizedValue = normalizeText(value);

  if (
    normalizedValue === "start" ||
    normalizedValue === "end" ||
    normalizedValue === "middle" ||
    normalizedValue === "internal" ||
    normalizedValue === "cross-line"
  ) {
    return normalizedValue;
  }

  return undefined;
}

function normalizeRhymeLevel(value: unknown): RhymeAnalysisLevel | undefined {
  const normalizedValue = normalizeText(value);

  if (
    normalizedValue === "single" ||
    normalizedValue === "double" ||
    normalizedValue === "triple" ||
    normalizedValue === "multi"
  ) {
    return normalizedValue;
  }

  return undefined;
}

function normalizeRhymeQuality(
  value: unknown,
): RhymeAnalysisQuality | undefined {
  const normalizedValue = normalizeText(value);

  if (
    normalizedValue === "perfect" ||
    normalizedValue === "slant" ||
    normalizedValue === "assonance" ||
    normalizedValue === "consonance" ||
    normalizedValue === "repetition" ||
    normalizedValue === "uncertain"
  ) {
    return normalizedValue;
  }

  return undefined;
}

function normalizeStringArray(
  value: unknown,
  maxLength: number,
): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, maxLength);

  return items.length ? items : undefined;
}

function normalizeIndexArray(
  value: unknown,
  maxLength: number,
): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .map((item) => readIndex(item))
    .filter((item): item is number => item !== undefined)
    .slice(0, maxLength);

  return items.length ? items : undefined;
}

function readIndex(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  return undefined;
}

function readUnitNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return clamp(Number(value.toFixed(3)), 0, 1);
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
