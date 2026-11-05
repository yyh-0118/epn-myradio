import { serverEnv } from "../config/env";
import type { AnalysisDiagnostic, TrackMetadata, TrackMetadataCandidate } from "../../src/types/analysis";

export interface ResolveTrackMetadataInput {
  rawLyrics: string;
  allowRemoteLookup?: boolean;
  track?: TrackMetadata;
  locale?: string;
  diagnostics?: AnalysisDiagnostic[];
}

export interface ResolveTrackMetadataResult {
  track: TrackMetadata;
  candidates: TrackMetadataCandidate[];
}

interface AlapiResponse<TData> {
  success?: boolean;
  code?: number;
  message?: string;
  data?: TData;
  request_id?: string;
  time?: number;
}

interface AlapiMusicData {
  songs?: AlapiSong[];
  song?: AlapiSong;
  result?: {
    songs?: AlapiSong[];
  };
}

interface AlapiArtist {
  id?: number | string;
  name?: string;
}

interface AlapiAlbum {
  id?: number | string;
  name?: string;
  pic?: string;
  picUrl?: string;
}

interface AlapiOriginSongSimpleData {
  id?: number | string;
  name?: string;
  artists?: Array<AlapiArtist | string> | string;
  album?: string;
  duration?: number;
}

interface AlapiSong {
  id?: number | string;
  name?: string;
  mainTitle?: string;
  ar?: AlapiArtist[];
  artists?: Array<AlapiArtist | string>;
  al?: AlapiAlbum;
  album?: AlapiAlbum | string;
  alia?: string[];
  alias?: string[];
  dt?: number;
  duration?: number;
  publishTime?: number;
  originSongSimpleData?: AlapiOriginSongSimpleData;
}

type QueryParams = Record<string, string | number | undefined>;

export class MusicMetadataService {
  get isConfigured(): boolean {
    return Boolean(serverEnv.alapiToken?.trim());
  }

  async resolveTrackMetadata(
    input: ResolveTrackMetadataInput,
  ): Promise<TrackMetadata> {
    return (await this.resolveTrackMetadataWithCandidates(input)).track;
  }

  async resolveTrackMetadataWithCandidates(
    input: ResolveTrackMetadataInput,
  ): Promise<ResolveTrackMetadataResult> {
    const heuristicTrack = createHeuristicTrack(input.rawLyrics, input.locale);
    const queries = createSearchQueries(input.rawLyrics, input.track);
    const allowRemoteLookup = input.allowRemoteLookup !== false;
    const remoteResult = allowRemoteLookup && this.isConfigured
      ? await this.tryResolveCandidatesFromAlapi(queries, input.rawLyrics, input.diagnostics)
      : { track: undefined, candidates: [] };

    if (!allowRemoteLookup) {
      pushDiagnostic(
        input.diagnostics,
        "info",
        "Track metadata already looks complete. ALAPI lookup skipped.",
      );
    } else if (!this.isConfigured) {
      pushDiagnostic(
        input.diagnostics,
        "info",
        "ALAPI_TOKEN is not configured. Track metadata lookup skipped.",
      );
    }

    const track = mergeTrackMetadata(input.track, remoteResult.track, heuristicTrack);
    const candidates = createTrackCandidates({
      track,
      manualTrack: input.track,
      remoteCandidates: remoteResult.candidates,
      heuristicTrack,
    });

    return { track, candidates };
  }

  private async tryResolveCandidatesFromAlapi(
    queries: string[],
    rawLyrics: string,
    diagnostics: AnalysisDiagnostic[] | undefined,
  ): Promise<{ track?: TrackMetadata; candidates: TrackMetadataCandidate[] }> {
    if (!queries.length) {
      pushDiagnostic(
        diagnostics,
        "info",
        "No searchable lyric or track hint was found for ALAPI lookup.",
      );
      return { candidates: [] };
    }

    const collectedCandidates: TrackMetadataCandidate[] = [];
    let selectedTrack: TrackMetadata | undefined;

    for (const query of queries) {
      try {
        const songs = await this.searchSongs(query);
        const bestSong = selectBestSongCandidate(songs, query, rawLyrics);
        const queryCandidates = songs
          .map((song) => createTrackCandidateFromSong(song, rawLyrics, query))
          .sort((left, right) => (right.matchScore ?? 0) - (left.matchScore ?? 0))
          .slice(0, 4);

        collectedCandidates.push(...queryCandidates);

        if (!selectedTrack && bestSong) {
          const detail = await this.tryReadSongDetail(bestSong);
          selectedTrack = createTrackMetadataFromSong(
            detail ?? bestSong,
            rawLyrics,
            query,
          );

          if (selectedTrack.title || selectedTrack.artist) {
            pushDiagnostic(
              diagnostics,
              "info",
              `ALAPI resolved track metadata with query: ${query}`,
            );
          }
        }

        if (selectedTrack && collectedCandidates.length >= 6) {
          break;
        }
      } catch (error) {
        pushDiagnostic(
          diagnostics,
          "warning",
          `ALAPI track metadata lookup failed. ${readErrorMessage(error)}`,
        );
        break;
      }
    }

    const candidates = dedupeTrackCandidates(collectedCandidates)
      .sort((left, right) => (right.matchScore ?? 0) - (left.matchScore ?? 0))
      .slice(0, 6);

    if (!selectedTrack && !candidates.length) {
      pushDiagnostic(
        diagnostics,
        "info",
        "ALAPI music search returned no confident match. Using heuristic metadata.",
      );
    }

    return {
      track: selectedTrack,
      candidates,
    };
  }

  private async searchSongs(query: string): Promise<AlapiSong[]> {
    const data = await this.requestAlapi<AlapiMusicData>("/api/music/search", {
      keyword: query,
    });

    return readSongs(data);
  }

  private async tryReadSongDetail(song: AlapiSong): Promise<AlapiSong | undefined> {
    const id = readSongId(song);

    if (!id) {
      return undefined;
    }

    try {
      const data = await this.requestAlapi<AlapiMusicData>("/api/music/detail", {
        id,
      });

      return readSongs(data)[0];
    } catch {
      return undefined;
    }
  }

  private async requestAlapi<TData>(
    path: string,
    query: QueryParams,
  ): Promise<TData | undefined> {
    const response = await fetch(buildAlapiUrl(path, query), {
      method: "GET",
      headers: {
        Accept: "application/json",
        token: serverEnv.alapiToken ?? "",
      },
    });
    const body = await response.text();

    if (!response.ok) {
      throw new Error(
        `ALAPI request failed: ${response.status} ${readAlapiMessage(body)}`,
      );
    }

    const payload = parseAlapiResponse<TData>(body);

    if (payload.success === false || (payload.code && payload.code !== 200)) {
      throw new Error(
        `ALAPI response failed: ${payload.code ?? "unknown"} ${
          payload.message ?? "unknown error"
        }`,
      );
    }

    return payload.data;
  }
}

function createSearchQueries(rawLyrics: string, track?: TrackMetadata): string[] {
  const lines = rawLyrics
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  const title = normalizeText(track?.title);
  const artist = normalizeText(track?.artist);
  const queries = [
    [title, artist].filter(Boolean).join(" "),
    title,
    ...extractQuotedTitles(rawLyrics),
    ...lines.slice(0, 4),
    lines.slice(0, 2).join(" "),
  ];

  return dedupe(
    queries
      .map((query) => normalizeSearchQuery(query))
      .filter((query) => query.length >= 2),
  ).slice(0, 8);
}

function extractQuotedTitles(rawLyrics: string): string[] {
  return Array.from(rawLyrics.matchAll(/《([^》]+)》/g))
    .map((match) => normalizeText(match[1]))
    .filter(Boolean);
}

function normalizeSearchQuery(query: string): string {
  return normalizeText(query)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function selectBestSongCandidate(
  songs: AlapiSong[],
  query: string,
  rawLyrics: string,
): AlapiSong | undefined {
  if (!songs.length) {
    return undefined;
  }

  return songs
    .map((song) => ({
      song,
      score: scoreSongCandidate(song, query, rawLyrics),
    }))
    .sort((left, right) => right.score - left.score)[0]?.song;
}

function scoreSongCandidate(
  song: AlapiSong,
  query: string,
  rawLyrics: string,
): number {
  const normalizedQuery = normalizeSearchText(query);
  const title = normalizeSearchText(readSongTitle(song));
  const artist = normalizeSearchText(readSongArtists(song));
  const aliases = normalizeSearchText([
    ...(song.alia ?? []),
    ...(song.alias ?? []),
  ].join(" "));
  const lyricTokens = createLyricSearchTokens(rawLyrics);
  let score = 0.5;

  if (title && (normalizedQuery.includes(title) || title.includes(normalizedQuery))) {
    score += 0.25;
  }

  if (artist && normalizedQuery.includes(artist)) {
    score += 0.12;
  }

  if (aliases && (aliases.includes(normalizedQuery) || normalizedQuery.includes(aliases))) {
    score += 0.08;
  }

  for (const token of lyricTokens) {
    if (title.includes(token) || aliases.includes(token)) {
      score += 0.04;
    }
  }

  return score;
}

function createTrackMetadataFromSong(
  song: AlapiSong,
  rawLyrics: string,
  query: string,
): TrackMetadata {
  const id = readSongId(song);
  const title = readSongTitle(song);
  const artist = readSongArtists(song);
  const album = readSongAlbum(song);
  const durationMs = readPositiveNumber(
    song.dt,
    song.duration,
    song.originSongSimpleData?.duration,
  );
  const releaseYear = readReleaseYear(song.publishTime);
  const coverUrl = readFirstText(
    song.al?.picUrl,
    song.al?.pic,
    typeof song.album === "object" ? song.album.picUrl : undefined,
    typeof song.album === "object" ? song.album.pic : undefined,
  );

  return {
    title,
    artist,
    album,
    bpm: estimateBpm(rawLyrics),
    language: detectLanguage(rawLyrics),
    releaseYear,
    durationMs,
    confidence: clamp(round(scoreSongCandidate(song, query, rawLyrics)), 0.55, 0.92),
    sourceProvider: "alapi",
    sourceId: id,
    sourceUrl: id ? `https://music.163.com/#/song?id=${id}` : undefined,
    coverUrl,
  };
}

function createTrackCandidateFromSong(
  song: AlapiSong,
  rawLyrics: string,
  query: string,
): TrackMetadataCandidate {
  const track = createTrackMetadataFromSong(song, rawLyrics, query);

  return createTrackCandidateFromMetadata(track, {
    candidateId: `alapi:${track.sourceId ?? createTrackIdentityKey(track)}`,
    source: "alapi",
    query,
    matchScore: track.confidence,
    reason: `ALAPI 搜索候选：${query}`,
  });
}

function createTrackCandidates({
  track,
  manualTrack,
  remoteCandidates,
  heuristicTrack,
}: {
  track: TrackMetadata;
  manualTrack?: TrackMetadata;
  remoteCandidates: TrackMetadataCandidate[];
  heuristicTrack: TrackMetadata;
}): TrackMetadataCandidate[] {
  const candidates: TrackMetadataCandidate[] = [];

  if (hasTrackCandidateIdentity(manualTrack)) {
    candidates.push(
      createTrackCandidateFromMetadata(manualTrack, {
        candidateId: `manual:${createTrackIdentityKey(manualTrack)}`,
        source: "manual",
        matchScore: 1,
        reason: "用户手动填写或修改的曲目信息。",
      }),
    );
  }

  candidates.push(...remoteCandidates);
  candidates.push(
    createTrackCandidateFromMetadata(heuristicTrack, {
      candidateId: `heuristic:${createTrackIdentityKey(heuristicTrack) || "baseline"}`,
      source: "heuristic",
      matchScore: heuristicTrack.confidence,
      reason: "根据歌词长度、语言和标点估算的基础信息。",
    }),
  );

  const selectedKey = createTrackIdentityKey(track);
  const dedupedCandidates = dedupeTrackCandidates(candidates)
    .map((candidate) => ({
      ...candidate,
      selected: Boolean(selectedKey && createTrackIdentityKey(candidate) === selectedKey),
    }))
    .sort((left, right) => {
      if (left.selected !== right.selected) {
        return left.selected ? -1 : 1;
      }

      return (right.matchScore ?? right.confidence ?? 0) - (left.matchScore ?? left.confidence ?? 0);
    })
    .slice(0, 7);

  if (!dedupedCandidates.some((candidate) => candidate.selected) && dedupedCandidates[0]) {
    dedupedCandidates[0] = {
      ...dedupedCandidates[0],
      selected: true,
    };
  }

  return dedupedCandidates;
}

function createTrackCandidateFromMetadata(
  track: TrackMetadata | undefined,
  options: Pick<TrackMetadataCandidate, "candidateId" | "source"> &
    Partial<TrackMetadataCandidate>,
): TrackMetadataCandidate {
  return {
    ...(track ?? {}),
    candidateId: options.candidateId,
    source: options.source,
    query: options.query,
    matchScore: readUnitNumber(options.matchScore, track?.confidence),
    reason: options.reason,
    selected: options.selected,
  };
}

function dedupeTrackCandidates(candidates: TrackMetadataCandidate[]): TrackMetadataCandidate[] {
  const seen = new Set<string>();
  const dedupedCandidates: TrackMetadataCandidate[] = [];

  for (const candidate of candidates) {
    if (!hasTrackCandidateIdentity(candidate)) {
      continue;
    }

    const key = createTrackIdentityKey(candidate) || candidate.candidateId;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    dedupedCandidates.push(candidate);
  }

  return dedupedCandidates;
}

function hasTrackCandidateIdentity(track: TrackMetadata | undefined): boolean {
  return Boolean(
    readFirstText(track?.title, track?.artist, track?.sourceId) ||
      readPositiveNumber(track?.bpm),
  );
}

function createTrackIdentityKey(track: TrackMetadata | undefined): string {
  const sourceProvider = normalizeSearchText(track?.sourceProvider);
  const sourceId = normalizeSearchText(track?.sourceId);

  if (sourceProvider && sourceId) {
    return `${sourceProvider}:${sourceId}`;
  }

  return [track?.title, track?.artist]
    .map((value) => normalizeSearchText(value))
    .filter(Boolean)
    .join(":");
}

function createHeuristicTrack(rawLyrics: string, locale?: string): TrackMetadata {
  return {
    bpm: estimateBpm(rawLyrics),
    language: detectLanguage(rawLyrics, locale),
    confidence: 0.4,
    sourceProvider: "heuristic",
  };
}

function mergeTrackMetadata(
  manualTrack: TrackMetadata | undefined,
  resolvedTrack: TrackMetadata | undefined,
  fallbackTrack: TrackMetadata,
): TrackMetadata {
  return {
    title: readFirstText(manualTrack?.title, resolvedTrack?.title),
    artist: readFirstText(manualTrack?.artist, resolvedTrack?.artist),
    album: readFirstText(manualTrack?.album, resolvedTrack?.album),
    bpm: readPositiveNumber(manualTrack?.bpm, resolvedTrack?.bpm, fallbackTrack.bpm),
    language: readFirstText(
      manualTrack?.language,
      resolvedTrack?.language,
      fallbackTrack.language,
    ),
    releaseYear: readPositiveNumber(
      manualTrack?.releaseYear,
      resolvedTrack?.releaseYear,
    ),
    tags: readFirstTags(manualTrack?.tags, resolvedTrack?.tags),
    confidence: readUnitNumber(
      manualTrack?.confidence,
      resolvedTrack?.confidence,
      fallbackTrack.confidence,
    ),
    sourceProvider: readFirstText(
      manualTrack?.sourceProvider,
      resolvedTrack?.sourceProvider,
      fallbackTrack.sourceProvider,
    ),
    sourceId: readFirstText(manualTrack?.sourceId, resolvedTrack?.sourceId),
    sourceUrl: readFirstText(manualTrack?.sourceUrl, resolvedTrack?.sourceUrl),
    coverUrl: readFirstText(manualTrack?.coverUrl, resolvedTrack?.coverUrl),
    durationMs: readPositiveNumber(
      manualTrack?.durationMs,
      resolvedTrack?.durationMs,
    ),
  };
}

function readSongs(data: AlapiMusicData | undefined): AlapiSong[] {
  if (!data) {
    return [];
  }

  if (Array.isArray(data.songs)) {
    return data.songs;
  }

  if (data.song) {
    return [data.song];
  }

  if (Array.isArray(data.result?.songs)) {
    return data.result.songs;
  }

  return [];
}

function readSongId(song: AlapiSong): string | undefined {
  const id = song.id ?? song.originSongSimpleData?.id;

  return id === undefined ? undefined : String(id);
}

function readSongTitle(song: AlapiSong): string | undefined {
  return readFirstText(song.name, song.mainTitle, song.originSongSimpleData?.name);
}

function readSongArtists(song: AlapiSong): string | undefined {
  const directArtists = readArtistList(song.ar) || readArtistList(song.artists);
  const originArtists = song.originSongSimpleData?.artists;

  if (directArtists) {
    return directArtists;
  }

  if (typeof originArtists === "string") {
    return normalizeText(originArtists);
  }

  return readArtistList(originArtists);
}

function readArtistList(
  artists: Array<AlapiArtist | string> | undefined,
): string | undefined {
  const names = artists
    ?.map((artist) => (typeof artist === "string" ? artist : artist.name))
    .map((name) => normalizeText(name))
    .filter(Boolean);

  return names?.length ? names.join(" / ") : undefined;
}

function readSongAlbum(song: AlapiSong): string | undefined {
  if (typeof song.album === "string") {
    return normalizeText(song.album);
  }

  return readFirstText(
    song.al?.name,
    song.album?.name,
    song.originSongSimpleData?.album,
  );
}

function readReleaseYear(value: number | undefined): number | undefined {
  if (!value || !Number.isFinite(value)) {
    return undefined;
  }

  if (value >= 1900 && value <= 3000) {
    return Math.round(value);
  }

  const date = new Date(value);
  const year = date.getFullYear();

  return Number.isInteger(year) && year >= 1900 ? year : undefined;
}

function estimateBpm(rawLyrics: string): number {
  const lines = rawLyrics.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const compactText = rawLyrics.replace(/\s+/g, "");
  const averageLineLength = compactText.length / Math.max(lines.length, 1);
  const exclamationCount = countMatches(rawLyrics, /[!！]/g);
  const englishTokenCount = rawLyrics.match(/[a-zA-Z]+/g)?.length ?? 0;
  let bpm = 82;

  if (averageLineLength <= 10) {
    bpm += 8;
  } else if (averageLineLength >= 24) {
    bpm -= 4;
  }

  bpm += Math.min(exclamationCount, 4) * 3;
  bpm += Math.min(englishTokenCount, 4);
  bpm += Math.min(Math.max(lines.length - 8, 0), 8);

  return clamp(Math.round(bpm), 72, 132);
}

function detectLanguage(rawLyrics: string, locale?: string): string | undefined {
  if (/[\u4e00-\u9fff]/.test(rawLyrics)) {
    return "zh-CN";
  }

  if (/[a-zA-Z]/.test(rawLyrics)) {
    return "en";
  }

  return locale;
}

function createLyricSearchTokens(rawLyrics: string): string[] {
  return rawLyrics
    .split(/\r?\n/)
    .map((line) => normalizeSearchText(line).slice(0, 12))
    .filter((line) => line.length >= 2)
    .slice(0, 4);
}

function buildAlapiUrl(path: string, query: QueryParams): string {
  const baseUrl = trimTrailingSlash(serverEnv.alapiBaseUrl || "https://v3.alapi.cn");
  let normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (baseUrl.endsWith("/api") && normalizedPath.startsWith("/api/")) {
    normalizedPath = normalizedPath.slice(4);
  }

  const url = new URL(`${baseUrl}${normalizedPath}`);

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function parseAlapiResponse<TData>(body: string): AlapiResponse<TData> {
  try {
    return JSON.parse(body) as AlapiResponse<TData>;
  } catch {
    throw new Error("ALAPI response is not valid JSON.");
  }
}

function readAlapiMessage(body: string): string {
  if (!body.trim()) {
    return "unknown error";
  }

  try {
    const parsed = JSON.parse(body) as AlapiResponse<unknown>;
    return parsed.message || body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

function pushDiagnostic(
  diagnostics: AnalysisDiagnostic[] | undefined,
  level: AnalysisDiagnostic["level"],
  message: string,
): void {
  diagnostics?.push({
    id: createId("diagnostic"),
    level,
    message,
    nodeId: "music-metadata-service",
  });
}

function readFirstText(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalizedValue = normalizeText(value);

    if (normalizedValue) {
      return normalizedValue;
    }
  }

  return undefined;
}

function readFirstTags(
  ...values: Array<string[] | undefined>
): string[] | undefined {
  for (const value of values) {
    const tags = value
      ?.map((tag) => normalizeText(tag))
      .filter(Boolean)
      .slice(0, 12);

    if (tags?.length) {
      return tags;
    }
  }

  return undefined;
}

function readPositiveNumber(
  ...values: Array<number | undefined>
): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.round(value);
    }
  }

  return undefined;
}

function readUnitNumber(
  ...values: Array<number | undefined>
): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return clamp(round(value), 0, 1);
    }
  }

  return undefined;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSearchText(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/\s+/g, "");
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
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