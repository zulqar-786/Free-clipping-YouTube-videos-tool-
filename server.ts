import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  GoogleGenAI,
  MediaResolution,
  ThinkingLevel,
  Type,
} from '@google/genai';
import type {
  CaptionSegment,
  ExtractionResult,
  ExtractionStyle,
  OutputLanguage,
  ShortClip,
} from './src/types.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const GEMINI_MODEL = 'gemini-4-hydrogen';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please verify your key in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatGeminiError(error: unknown): { status: number; message: string } {
  const rawMsg =
    error instanceof Error ? error.message : String(error ?? 'Unknown error');

  let parsedCode: number | undefined;
  let parsedMessage: string | undefined;

  try {
    const outer = JSON.parse(rawMsg) as {
      error?: { code?: number; message?: string };
    };
    if (outer?.error?.message) {
      parsedCode = outer.error.code;
      parsedMessage = outer.error.message;
    }
  } catch {
    const jsonMatch = rawMsg.match(/\{[\s\S]*"error"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const inner = JSON.parse(jsonMatch[0]) as {
          error?: { code?: number; message?: string };
        };
        parsedCode = inner?.error?.code;
        parsedMessage = inner?.error?.message;
      } catch {
        // Use rawMsg
      }
    }
  }

  const finalMessage = parsedMessage || rawMsg;
  if (
    parsedCode === 503 ||
    finalMessage.includes('503') ||
    finalMessage.includes('high demand') ||
    finalMessage.includes('UNAVAILABLE')
  ) {
    return {
      status: 503,
      message:
        'The AI model is temporarily experiencing high demand. Please wait a few seconds and click Extract Shorts again.',
    };
  }
  if (parsedCode === 429 || finalMessage.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message:
        'Rate limit reached on the Gemini API key. Please wait a moment before retrying.',
    };
  }
  if (
    parsedCode === 403 ||
    parsedCode === 400 ||
    finalMessage.includes('API_KEY_INVALID') ||
    finalMessage.includes('PERMISSION_DENIED')
  ) {
    return {
      status: parsedCode || 400,
      message:
        'Gemini API key error or insufficient permissions. Please verify your key in Settings > Secrets.',
    };
  }

  return { status: 500, message: finalMessage };
}

const FALLBACK_MODEL = 'gemini-3.1-flash-lite';

function isTransientOrQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('high demand') ||
    msg.includes('quota') ||
    msg.includes('timeout')
  );
}

async function generateWithFallback(
  ai: GoogleGenAI,
  buildRequest: (
    model: string,
    thinkingLevel: ThinkingLevel
  ) => Parameters<GoogleGenAI['models']['generateContent']>[0],
  abortSignal?: AbortSignal
) {
  const withSignal = (
    model: string,
    thinkingLevel: ThinkingLevel
  ): Parameters<GoogleGenAI['models']['generateContent']>[0] => {
    const req = buildRequest(model, thinkingLevel);
    return abortSignal
      ? { ...req, config: { ...(req.config ?? {}), abortSignal } }
      : req;
  };

  try {
    return await ai.models.generateContent(
      withSignal(GEMINI_MODEL, ThinkingLevel.LOW)
    );
  } catch (primaryErr) {
    if (abortSignal?.aborted || !isTransientOrQuotaError(primaryErr)) {
      throw primaryErr;
    }
    try {
      return await ai.models.generateContent(
        withSignal(FALLBACK_MODEL, ThinkingLevel.MINIMAL)
      );
    } catch (fallbackErr) {
      if (abortSignal?.aborted || !isTransientOrQuotaError(fallbackErr)) {
        throw fallbackErr;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (abortSignal?.aborted) {
        throw fallbackErr;
      }
      return await ai.models.generateContent(
        withSignal(FALLBACK_MODEL, ThinkingLevel.MINIMAL)
      );
    }
  }
}

function extractYouTubeVideoId(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  let parsed: URL;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    parsed = new URL(withProtocol);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  if (host === 'youtu.be') {
    const candidate = parsed.pathname.split('/').filter(Boolean)[0];
    return candidate && /^[a-zA-Z0-9_-]{11}$/.test(candidate)
      ? candidate
      : null;
  }

  if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com'
  ) {
    const vParam = parsed.searchParams.get('v');
    if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
      return vParam;
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (
      segments.length >= 2 &&
      ['shorts', 'live', 'embed', 'v'].includes(segments[0]) &&
      /^[a-zA-Z0-9_-]{11}$/.test(segments[1])
    ) {
      return segments[1];
    }
  }

  return null;
}

function formatTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

function extractBalancedJsonObject(
  html: string,
  marker: string
): Record<string, unknown> | null {
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const startBrace = html.indexOf('{', idx + marker.length);
  if (startBrace === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startBrace; i < html.length; i++) {
    const ch = html[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = html.slice(startBrace, i + 1);
        try {
          return JSON.parse(candidate) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

interface YouTubeFetchedData {
  title: string;
  channelName: string;
  thumbnailUrl: string;
  durationSeconds: number | null;
  description: string;
  transcriptText: string | null;
}

interface CaptionTrackItem {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Array<{ utf8?: string }>;
}

async function fetchYouTubeContext(
  videoId: string
): Promise<YouTubeFetchedData> {
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  let title = '';
  let channelName = '';
  let thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  let durationSeconds: number | null = null;
  let description = '';
  let transcriptText: string | null = null;

  // 1. Fetch oEmbed metadata (fast, reliable public endpoint)
  try {
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (oembedRes.ok) {
      const oembed = (await oembedRes.json()) as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
      };
      if (oembed.title) title = oembed.title;
      if (oembed.author_name) channelName = oembed.author_name;
      if (oembed.thumbnail_url) thumbnailUrl = oembed.thumbnail_url;
    }
  } catch {
    // Continue to watch page / Gemini video analysis
  }

  // 2. Fetch watch page HTML for exact duration, description, and timed caption tracks
  try {
    const watchRes = await fetch(canonicalUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(4000),
    });

    if (watchRes.ok) {
      const html = await watchRes.text();
      const playerResponse =
        extractBalancedJsonObject(html, 'var ytInitialPlayerResponse =') ??
        extractBalancedJsonObject(html, 'ytInitialPlayerResponse =');

      if (playerResponse) {
        const videoDetails = playerResponse.videoDetails as
          | {
              title?: string;
              author?: string;
              lengthSeconds?: string;
              shortDescription?: string;
            }
          | undefined;

        if (videoDetails) {
          if (!title && videoDetails.title) title = videoDetails.title;
          if (!channelName && videoDetails.author) {
            channelName = videoDetails.author;
          }
          if (videoDetails.lengthSeconds) {
            const parsedLen = Number(videoDetails.lengthSeconds);
            if (Number.isFinite(parsedLen) && parsedLen > 0) {
              durationSeconds = Math.round(parsedLen);
            }
          }
          if (videoDetails.shortDescription) {
            description = videoDetails.shortDescription.slice(0, 2500);
          }
        }

        const captions = playerResponse.captions as
          | {
              playerCaptionsTracklistRenderer?: {
                captionTracks?: CaptionTrackItem[];
              };
            }
          | undefined;

        const tracks =
          captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

        if (tracks.length > 0) {
          const preferredTrack =
            tracks.find(
              (t) => t.languageCode?.startsWith('en') && t.kind !== 'asr'
            ) ??
            tracks.find((t) => t.languageCode?.startsWith('en')) ??
            tracks.find((t) => t.languageCode?.startsWith('hi')) ??
            tracks[0];

          if (preferredTrack?.baseUrl) {
            const captionUrl = preferredTrack.baseUrl.includes('fmt=')
              ? preferredTrack.baseUrl
              : `${preferredTrack.baseUrl}&fmt=json3`;

            const capRes = await fetch(captionUrl, {
              signal: AbortSignal.timeout(8000),
            });
            if (capRes.ok) {
              const rawCap = await capRes.text();
              if (rawCap.trim().startsWith('{')) {
                const json3 = JSON.parse(rawCap) as { events?: Json3Event[] };
                const buckets = new Map<number, string[]>();
                for (const ev of json3.events ?? []) {
                  if (typeof ev.tStartMs !== 'number' || !ev.segs) continue;
                  const chunkText = ev.segs
                    .map((s) => s.utf8 ?? '')
                    .join('')
                    .replace(/\s+/g, ' ')
                    .trim();
                  if (!chunkText) continue;
                  const bucketSec = Math.floor(ev.tStartMs / 1000 / 10) * 10;
                  const existing = buckets.get(bucketSec) ?? [];
                  existing.push(chunkText);
                  buckets.set(bucketSec, existing);
                }

                const lines: string[] = [];
                for (const [sec, parts] of [...buckets.entries()].sort(
                  (a, b) => a[0] - b[0]
                )) {
                  lines.push(`[${formatTimestamp(sec)}] ${parts.join(' ')}`);
                }

                if (lines.length >= 6) {
                  let joined = lines.join('\n');
                  if (joined.length > 42000) {
                    const step = Math.ceil(lines.length / 450);
                    joined = lines
                      .filter((_, i) => i % step === 0)
                      .join('\n');
                  }
                  transcriptText = joined;
                }
              }
            }
          }
        }
      }
    }
  } catch {
    // Watch page scraping failed; Gemini video URI fallback handles this
  }

  return {
    title,
    channelName,
    thumbnailUrl,
    durationSeconds,
    description,
    transcriptText,
  };
}

function getStyleGuidance(style: ExtractionStyle): string {
  switch (style) {
    case 'executive':
      return 'Executive Brief: sharp boardroom clarity, strategic takeaways, zero fluff, authoritative hooks suited for C-suite and founders.';
    case 'educational':
      return 'Educational Breakdown: structured frameworks, clear mental models, step-by-step takeaways with crisp corporate storytelling.';
    case 'podcast':
      return 'Podcast Highlight: high-retention conversational insight, contrarian business wisdom, and punchy emotional or intellectual pivots.';
    case 'corporate':
    default:
      return 'Corporate Short: polished, credible LinkedIn & YouTube Shorts format — clear problem-to-insight arc, strong opening hook, clean professional tone.';
  }
}

function getLanguageGuidance(language: OutputLanguage): string {
  switch (language) {
    case 'hinglish':
      return 'Write titles, hookText, whyItWorks, and socialCaption in natural modern Hinglish (Roman script, crisp corporate/creator Hinglish like Indian business creators on LinkedIn/YouTube Shorts). Keep captionSegments aligned to the spoken video language or clean Hinglish.';
    case 'hindi':
      return 'Write titles, hookText, whyItWorks, and socialCaption in clear, polished Hindi (Devanagari script) suitable for professional Indian business audiences.';
    case 'english':
    default:
      return 'Write all titles, hookText, whyItWorks, socialCaption, and captionSegments in crisp, professional English.';
  }
}

const extractionResponseSchema = {
  type: Type.OBJECT,
  properties: {
    videoTitle: {
      type: Type.STRING,
      description: 'Title of the YouTube video.',
    },
    channelName: {
      type: Type.STRING,
      description: 'Creator or channel name of the YouTube video.',
    },
    estimatedTotalDurationSeconds: {
      type: Type.INTEGER,
      description: 'Total duration of the source video in seconds.',
    },
    clips: {
      type: Type.ARRAY,
      description: 'Array of extracted corporate Short clip segments.',
      items: {
        type: Type.OBJECT,
        properties: {
          title: {
            type: Type.STRING,
            description:
              'Crisp corporate Short title (max 65 characters, no hashtags).',
          },
          hookText: {
            type: Type.STRING,
            description:
              'Scroll-stopping 3-second opening on-screen text headline (6 to 12 words).',
          },
          corporateAngle: {
            type: Type.STRING,
            description:
              'Short 2-3 word editorial category such as Strategy Framework, Leadership Lesson, Market Reality, Execution Playbook, or Contrarian Take.',
          },
          startSeconds: {
            type: Type.INTEGER,
            description: 'Exact start timestamp in seconds from 0.',
          },
          endSeconds: {
            type: Type.INTEGER,
            description:
              'Exact end timestamp in seconds. Should match target clip duration (~53 seconds).',
          },
          whyItWorks: {
            type: Type.STRING,
            description:
              'One concise sentence explaining why this segment performs well as a corporate Short.',
          },
          bRollSuggestion: {
            type: Type.STRING,
            description:
              'Concise visual/graphic overlay or B-roll suggestion for corporate editing polish.',
          },
          socialCaption: {
            type: Type.STRING,
            description:
              'Ready-to-publish LinkedIn / YouTube Shorts post caption including 4 relevant hashtags.',
          },
          captionSegments: {
            type: Type.ARRAY,
            description:
              '6 to 10 timed spoken subtitle cues spanning from offsetSeconds 0 up to the clip duration.',
            items: {
              type: Type.OBJECT,
              properties: {
                offsetSeconds: {
                  type: Type.INTEGER,
                  description:
                    'Offset in seconds relative to clip start (starting at 0).',
                },
                durationSeconds: {
                  type: Type.INTEGER,
                  description: 'Duration of this subtitle cue in seconds (3 to 8).',
                },
                text: {
                  type: Type.STRING,
                  description: 'Short, punchy subtitle line (max 14 words).',
                },
              },
              required: ['offsetSeconds', 'durationSeconds', 'text'],
            },
          },
        },
        required: [
          'title',
          'hookText',
          'corporateAngle',
          'startSeconds',
          'endSeconds',
          'whyItWorks',
          'bRollSuggestion',
          'socialCaption',
          'captionSegments',
        ],
      },
    },
  },
  required: [
    'videoTitle',
    'channelName',
    'estimatedTotalDurationSeconds',
    'clips',
  ],
};

function normalizeClips(
  rawClips: Array<{
    title?: string;
    hookText?: string;
    corporateAngle?: string;
    startSeconds?: number;
    endSeconds?: number;
    whyItWorks?: string;
    bRollSuggestion?: string;
    socialCaption?: string;
    captionSegments?: Array<{
      offsetSeconds?: number;
      durationSeconds?: number;
      text?: string;
    }>;
  }>,
  targetDuration: number,
  maxVideoDuration: number | null
): ShortClip[] {
  return rawClips.map((raw, idx) => {
    let start = Math.max(0, Math.round(Number(raw.startSeconds ?? 0)));
    let end = Math.round(Number(raw.endSeconds ?? start + targetDuration));

    if (end <= start) {
      end = start + targetDuration;
    }

    if (maxVideoDuration && maxVideoDuration > 15) {
      if (start >= maxVideoDuration - 10) {
        start = Math.max(0, maxVideoDuration - targetDuration);
      }
      if (end > maxVideoDuration) {
        end = maxVideoDuration;
      }
      if (end - start < 20 && maxVideoDuration >= targetDuration) {
        start = Math.max(0, end - targetDuration);
      }
    }

    const duration = Math.max(1, end - start);

    const rawSegments = Array.isArray(raw.captionSegments)
      ? raw.captionSegments
      : [];
    const normalizedSegments: CaptionSegment[] = rawSegments
      .filter((s) => s && typeof s.text === 'string' && s.text.trim().length > 0)
      .map((s) => {
        const offset = Math.max(
          0,
          Math.min(duration - 2, Math.round(Number(s.offsetSeconds ?? 0)))
        );
        const segDur = Math.max(
          2,
          Math.min(duration - offset, Math.round(Number(s.durationSeconds ?? 5)))
        );
        return {
          offsetSeconds: offset,
          durationSeconds: segDur,
          text: String(s.text).trim(),
        };
      })
      .sort((a, b) => a.offsetSeconds - b.offsetSeconds);

    return {
      id: `short-${idx + 1}`,
      clipNumber: idx + 1,
      title: String(raw.title || `Corporate Highlight ${idx + 1}`).trim(),
      hookText: String(raw.hookText || 'Watch this key insight').trim(),
      corporateAngle: String(raw.corporateAngle || 'Executive Insight').trim(),
      startSeconds: start,
      endSeconds: end,
      startTime: formatTimestamp(start),
      endTime: formatTimestamp(end),
      durationSeconds: duration,
      whyItWorks: String(
        raw.whyItWorks ||
          'Delivers a focused, high-authority takeaway within a single vertical Short.'
      ).trim(),
      captionSegments: normalizedSegments,
      socialCaption: String(
        raw.socialCaption || `${raw.title ?? 'Key takeaway'} #Leadership #Business`
      ).trim(),
      bRollSuggestion: String(
        raw.bRollSuggestion ||
          'Add clean kinetic typography and subtle data callouts on key metrics.'
      ).trim(),
    };
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/extract-shorts', async (req, res) => {
    try {
      const body = req.body as {
        url?: string;
        clipCount?: number;
        targetDuration?: number;
        style?: ExtractionStyle;
        language?: OutputLanguage;
        manualTranscript?: string;
      };

      const rawUrl = typeof body.url === 'string' ? body.url : '';
      const videoId = extractYouTubeVideoId(rawUrl);
      if (!videoId) {
        res.status(400).json({
          error:
            'Please paste a valid YouTube link (e.g. youtube.com/watch?v=... or youtu.be/...).',
        });
        return;
      }

      const clipCount = Math.min(10, Math.max(8, Number(body.clipCount) || 9));
      const targetDuration = Math.min(
        59,
        Math.max(30, Number(body.targetDuration) || 53)
      );
      const style: ExtractionStyle = body.style ?? 'corporate';
      const language: OutputLanguage = body.language ?? 'english';
      const manualTranscript =
        typeof body.manualTranscript === 'string'
          ? body.manualTranscript.trim()
          : '';
      const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

      const ai = getAiClient();
      const ytContext = await fetchYouTubeContext(videoId);

      const promptInstructions = `
You are an elite corporate video producer and YouTube Shorts editor.
Analyze this YouTube video and extract EXACTLY ${clipCount} distinct, self-contained vertical Shorts segments.

CRITICAL TIMING RULES:
- Target clip duration: EXACTLY ${targetDuration} seconds per clip (acceptable range: ${Math.max(25, targetDuration - 4)} to ${Math.min(59, targetDuration + 3)} seconds, strictly under 60 seconds).
${
  ytContext.durationSeconds
    ? `- Known total video duration: ${ytContext.durationSeconds} seconds (${formatTimestamp(ytContext.durationSeconds)}). Every startSeconds and endSeconds MUST be strictly within 0 and ${ytContext.durationSeconds}.`
    : `- Ensure all timestamps are strictly accurate to the video timeline.`
}
- Spread the ${clipCount} clips across the full arc of the video so every clip covers a distinct idea, framework, or compelling story without repeating the same point.
- Start each clip cleanly at the beginning of a strong hook sentence and end on a decisive conclusion or punchline.

EDITORIAL STYLE:
- ${getStyleGuidance(style)}
- ${getLanguageGuidance(language)}
- Every Short needs a sharp 6–12 word opening hookText, a crisp corporateAngle label, timed spoken captionSegments spanning the clip (offsetSeconds starting at 0 up to ~${targetDuration}s), a B-roll suggestion, and a LinkedIn/Shorts-ready socialCaption.
`.trim();

      let parsedPayload: {
        videoTitle?: string;
        channelName?: string;
        estimatedTotalDurationSeconds?: number;
        clips?: Array<Record<string, unknown>>;
      } | null = null;
      let analysisMethod: 'transcript' | 'video-stream' | 'manual-transcript' =
        'transcript';

      const extractAbortController = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) {
          extractAbortController.abort();
        }
      });

      const transcriptSource = manualTranscript || ytContext.transcriptText;

      if (transcriptSource) {
        const cappedTranscript =
          transcriptSource.length > 42000
            ? transcriptSource.slice(0, 42000)
            : transcriptSource;

        const transcriptPrompt = `
${promptInstructions}

VIDEO METADATA:
- URL: ${canonicalUrl}
- Title: ${ytContext.title || 'Unknown'}
- Channel: ${ytContext.channelName || 'Unknown'}
- Duration: ${ytContext.durationSeconds ? `${ytContext.durationSeconds}s (${formatTimestamp(ytContext.durationSeconds)})` : 'Unknown'}
${ytContext.description ? `- Description & Chapters:\n${ytContext.description}\n` : ''}

TIMED TRANSCRIPT:
${cappedTranscript}
`.trim();

        const response = await generateWithFallback(
          ai,
          (model, thinkingLevel) => ({
            model,
            contents: transcriptPrompt,
            config: {
              thinkingConfig: { thinkingLevel },
              responseMimeType: 'application/json',
              responseSchema: extractionResponseSchema,
            },
          }),
          extractAbortController.signal
        );

        parsedPayload = JSON.parse((response.text ?? '{}').trim());
        analysisMethod = manualTranscript ? 'manual-transcript' : 'transcript';
      } else {
        // Direct YouTube URL understanding via Gemini fileData with low media resolution for speed & token efficiency
        const videoPrompt = `
${promptInstructions}

YouTube URL: ${canonicalUrl}
${ytContext.title ? `Known Title: ${ytContext.title}` : ''}
${ytContext.channelName ? `Known Channel: ${ytContext.channelName}` : ''}
${ytContext.durationSeconds ? `Known Duration: ${ytContext.durationSeconds}s` : ''}
`.trim();

        const response = await generateWithFallback(
          ai,
          (model, thinkingLevel) => ({
            model,
            contents: [
              {
                role: 'user',
                parts: [
                  { fileData: { fileUri: canonicalUrl } },
                  { text: videoPrompt },
                ],
              },
            ],
            config: {
              thinkingConfig: { thinkingLevel },
              mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
              responseMimeType: 'application/json',
              responseSchema: extractionResponseSchema,
            },
          }),
          extractAbortController.signal
        );

        parsedPayload = JSON.parse((response.text ?? '{}').trim());
        analysisMethod = 'video-stream';
      }

      const rawClips = Array.isArray(parsedPayload?.clips)
        ? parsedPayload.clips
        : [];

      if (rawClips.length === 0) {
        res.status(502).json({
          error:
            'Could not extract clips from this video. Make sure the YouTube video is public and has spoken content.',
        });
        return;
      }

      const resolvedDuration =
        ytContext.durationSeconds ??
        (typeof parsedPayload?.estimatedTotalDurationSeconds === 'number' &&
        parsedPayload.estimatedTotalDurationSeconds > 0
          ? parsedPayload.estimatedTotalDurationSeconds
          : null);

      const clips = normalizeClips(
        rawClips as Parameters<typeof normalizeClips>[0],
        targetDuration,
        resolvedDuration
      );

      const result: ExtractionResult = {
        video: {
          videoId,
          canonicalUrl,
          title:
            ytContext.title ||
            parsedPayload?.videoTitle ||
            `YouTube Video (${videoId})`,
          channelName:
            ytContext.channelName ||
            parsedPayload?.channelName ||
            'YouTube Creator',
          thumbnailUrl: ytContext.thumbnailUrl,
          durationSeconds: resolvedDuration,
          analysisMethod,
        },
        style,
        language,
        targetDuration,
        clips,
        extractedAt: new Date().toISOString(),
      };

      res.json(result);
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/refine-short', async (req, res) => {
    try {
      const body = req.body as {
        clip?: ShortClip;
        videoTitle?: string;
        style?: ExtractionStyle;
        language?: OutputLanguage;
      };

      if (!body.clip) {
        res.status(400).json({ error: 'Clip payload is required.' });
        return;
      }

      const ai = getAiClient();
      const style: ExtractionStyle = body.style ?? 'corporate';
      const language: OutputLanguage = body.language ?? 'english';

      const transcriptSnippet = body.clip.captionSegments
        .map((c) => c.text)
        .join(' ');

      const prompt = `
Rewrite and sharpen this ${body.clip.durationSeconds}-second corporate Short for maximum retention.
Source Video: ${body.videoTitle ?? 'YouTube Video'}
Current Title: ${body.clip.title}
Current Hook: ${body.clip.hookText}
Spoken Content: ${transcriptSnippet || body.clip.whyItWorks}

Style: ${getStyleGuidance(style)}
Language: ${getLanguageGuidance(language)}

Return a fresh, stronger title, a punchier 6-12 word hookText, and an updated socialCaption with 4 corporate hashtags.
`.trim();

      const response = await generateWithFallback(
        ai,
        (model, thinkingLevel) => ({
          model,
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                hookText: { type: Type.STRING },
                socialCaption: { type: Type.STRING },
              },
              required: ['title', 'hookText', 'socialCaption'],
            },
          },
        })
      );

      const refined = JSON.parse((response.text ?? '{}').trim()) as {
        title?: string;
        hookText?: string;
        socialCaption?: string;
      };

      res.json({
        title: refined.title || body.clip.title,
        hookText: refined.hookText || body.clip.hookText,
        socialCaption: refined.socialCaption || body.clip.socialCaption,
      });
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  const WORK_ROOT = path.join(os.tmpdir(), 'clipcut_work');

  function cleanupOldWorkDirs() {
    try {
      if (!fs.existsSync(WORK_ROOT)) return;
      const now = Date.now();
      const TTL_MS = 60 * 60 * 1000;
      for (const entry of fs.readdirSync(WORK_ROOT)) {
        const dirPath = path.join(WORK_ROOT, entry);
        const dirStat = fs.statSync(dirPath);
        let latestMtime = dirStat.mtimeMs;
        const sourcePath = path.join(dirPath, 'source.mp4');
        if (fs.existsSync(sourcePath)) {
          latestMtime = Math.max(latestMtime, fs.statSync(sourcePath).mtimeMs);
        }
        if (now - latestMtime > TTL_MS) {
          fs.rmSync(dirPath, { recursive: true, force: true });
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  function runFfmpegCut(
    inputPath: string,
    outputPath: string,
    startSeconds: number,
    durationSeconds: number,
    signal?: AbortSignal
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Processing stopped by user.'));
        return;
      }

      const args = [
        '-y',
        '-ss',
        String(Math.max(0, startSeconds)),
        '-i',
        inputPath,
        '-t',
        String(Math.max(1, durationSeconds)),
        '-map',
        '0:v:0',
        '-map',
        '0:a?',
        '-vf',
        "crop='if(gt(iw/ih,9/16),ih*9/16,iw)':'if(gt(iw/ih,9/16),ih,iw*16/9)',scale=720:1280:flags=lanczos",
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '23',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outputPath,
      ];
      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      let abortedBySignal = false;

      const onAbort = () => {
        abortedBySignal = true;
        try {
          proc.kill('SIGTERM');
          setTimeout(() => {
            if (!proc.killed) {
              try {
                proc.kill('SIGKILL');
              } catch {
                // ignore
              }
            }
          }, 800);
        } catch {
          // ignore
        }
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.on('error', (err) => {
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      });
      proc.on('close', (code) => {
        signal?.removeEventListener('abort', onAbort);
        if (abortedBySignal) {
          try {
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          } catch {
            // ignore
          }
          reject(new Error('Processing stopped by user.'));
          return;
        }
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-300)}`));
      });
    });
  }

  app.post('/api/upload-init', (_req, res) => {
    cleanupOldWorkDirs();
    const uploadId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const dir = path.join(WORK_ROOT, uploadId);
    fs.mkdirSync(dir, { recursive: true });
    res.json({ uploadId });
  });

  app.post(
    '/api/upload-chunk/:uploadId',
    express.raw({ type: '*/*', limit: '12mb' }),
    (req, res) => {
      const { uploadId } = req.params;
      if (!/^[a-zA-Z0-9_-]{8,32}$/.test(uploadId)) {
        res.status(400).json({ error: 'Invalid uploadId.' });
        return;
      }
      const dir = path.join(WORK_ROOT, uploadId);
      if (!fs.existsSync(dir)) {
        res.status(404).json({ error: 'Upload session not found or expired.' });
        return;
      }

      const chunk = req.body as Buffer;
      if (!Buffer.isBuffer(chunk) || chunk.length === 0) {
        res.status(400).json({ error: 'Empty upload chunk.' });
        return;
      }

      const targetPath = path.join(dir, 'source.mp4');
      const currentSize = fs.existsSync(targetPath)
        ? fs.statSync(targetPath).size
        : 0;
      const MAX_BYTES = 1536 * 1024 * 1024; // 1.5 GB
      if (currentSize + chunk.length > MAX_BYTES) {
        fs.rmSync(dir, { recursive: true, force: true });
        res.status(413).json({
          error: 'Source video exceeds the 1.5 GB server limit.',
        });
        return;
      }

      fs.appendFileSync(targetPath, chunk);
      res.json({ uploadId, sizeBytes: currentSize + chunk.length });
    }
  );

  app.post('/api/upload-finish/:uploadId', (req, res) => {
    const { uploadId } = req.params;
    if (!/^[a-zA-Z0-9_-]{8,32}$/.test(uploadId)) {
      res.status(400).json({ error: 'Invalid uploadId.' });
      return;
    }
    const targetPath = path.join(WORK_ROOT, uploadId, 'source.mp4');
    if (!fs.existsSync(targetPath)) {
      res.status(400).json({ error: 'No video data received.' });
      return;
    }
    const stat = fs.statSync(targetPath);
    if (stat.size === 0) {
      res.status(400).json({ error: 'Uploaded video file is empty.' });
      return;
    }
    res.json({ uploadId, sizeBytes: stat.size });
  });

  function isBlockedIpAddress(ip: string): boolean {
    if (net.isIPv4(ip)) {
      const parts = ip.split('.').map(Number);
      if (parts.length !== 4) return true;
      const [a, b] = parts;
      if (a === 0 || a === 10 || a === 127) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 100 && b >= 64 && b <= 127) return true;
      if (a >= 224) return true;
      return false;
    }
    if (net.isIPv6(ip)) {
      const lower = ip.toLowerCase();
      if (
        lower === '::1' ||
        lower === '::' ||
        lower.startsWith('fc') ||
        lower.startsWith('fd') ||
        lower.startsWith('fe80') ||
        lower.startsWith('::ffff:127.') ||
        lower.startsWith('::ffff:10.') ||
        lower.startsWith('::ffff:192.168.') ||
        lower.startsWith('::ffff:169.254.')
      ) {
        return true;
      }
      return false;
    }
    return true;
  }

  app.post('/api/render-from-url', async (req, res) => {
    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    try {
      const body = req.body as {
        sourceUrl?: string;
        clip?: {
          id: string;
          clipNumber: number;
          title: string;
          startSeconds: number;
          durationSeconds: number;
        };
      };

      const rawUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl.trim() : '';
      if (!rawUrl || !body.clip) {
        res.status(400).json({ error: 'Direct video URL and clip are required.' });
        return;
      }

      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        res.status(400).json({ error: 'Please enter a valid https:// video file URL.' });
        return;
      }

      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        res.status(400).json({ error: 'Only http/https video URLs are supported.' });
        return;
      }

      const hostLower = parsed.hostname.toLowerCase();
      if (
        hostLower === 'youtube.com' ||
        hostLower.endsWith('.youtube.com') ||
        hostLower === 'youtu.be'
      ) {
        res.status(400).json({
          error:
            'YouTube watch links cannot be streamed directly by cloud FFmpeg because YouTube blocks datacenter IPs. Use the 1-line yt-dlp command or upload your .MP4 file once.',
        });
        return;
      }

      if (hostLower === 'localhost' || hostLower.endsWith('.local')) {
        res.status(400).json({ error: 'Private or local hostnames are not allowed.' });
        return;
      }

      if (net.isIP(hostLower)) {
        if (isBlockedIpAddress(hostLower)) {
          res.status(400).json({ error: 'Private IP addresses are not allowed.' });
          return;
        }
      } else {
        const records = await dns.lookup(hostLower, { all: true });
        if (!records.length || records.some((r) => isBlockedIpAddress(r.address))) {
          res.status(400).json({ error: 'URL resolves to a restricted network address.' });
          return;
        }
      }

      cleanupOldWorkDirs();
      const uploadId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const outDir = path.join(WORK_ROOT, uploadId, 'clips');
      fs.mkdirSync(outDir, { recursive: true });

      const clip = body.clip;
      const slug = String(clip.title || `short-${clip.clipNumber}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 36);
      const filename = `${String(clip.clipNumber).padStart(2, '0')}_${slug || 'short'}_${clip.durationSeconds}s.mp4`;
      const outPath = path.join(outDir, filename);

      await runFfmpegCut(
        parsed.toString(),
        outPath,
        Number(clip.startSeconds) || 0,
        Number(clip.durationSeconds) || 53,
        abortController.signal
      );

      const stat = fs.statSync(outPath);
      if (!abortController.signal.aborted && !res.writableEnded) {
        res.json({
          uploadId,
          rendered: [
            {
              clipId: clip.id,
              clipNumber: clip.clipNumber,
              title: clip.title,
              filename,
              durationSeconds: clip.durationSeconds,
              sizeBytes: stat.size,
              downloadUrl: `/api/rendered-clip/${uploadId}/${encodeURIComponent(filename)}`,
            },
          ],
        });
      }
    } catch (error) {
      if (abortController.signal.aborted || res.writableEnded) return;
      const msg =
        error instanceof Error
          ? error.message
          : 'Could not cut clip from that video URL.';
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/upload-source-video', (req, res) => {
    cleanupOldWorkDirs();
    const uploadId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const dir = path.join(WORK_ROOT, uploadId);
    fs.mkdirSync(dir, { recursive: true });
    const targetPath = path.join(dir, 'source.mp4');
    const writeStream = fs.createWriteStream(targetPath);

    let totalBytes = 0;
    const MAX_BYTES = 1536 * 1024 * 1024; // 1.5 GB
    let aborted = false;

    const cleanupOnAbort = () => {
      if (aborted || res.writableEnded) return;
      aborted = true;
      req.unpipe(writeStream);
      writeStream.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    };

    req.on('aborted', cleanupOnAbort);
    res.on('close', cleanupOnAbort);

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BYTES && !aborted) {
        aborted = true;
        req.unpipe(writeStream);
        writeStream.destroy();
        fs.rmSync(dir, { recursive: true, force: true });
        res.status(413).json({
          error: 'Source video exceeds the 1.5 GB server limit.',
        });
      }
    });

    req.pipe(writeStream);

    writeStream.on('finish', () => {
      if (aborted) return;
      if (totalBytes === 0) {
        fs.rmSync(dir, { recursive: true, force: true });
        res.status(400).json({ error: 'Uploaded video file is empty.' });
        return;
      }
      res.json({ uploadId, sizeBytes: totalBytes });
    });

    writeStream.on('error', (err) => {
      if (aborted) return;
      fs.rmSync(dir, { recursive: true, force: true });
      res.status(500).json({ error: err.message || 'Failed to save video.' });
    });
  });

  app.post('/api/render-mp4-clips', async (req, res) => {
    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    try {
      const body = req.body as {
        uploadId?: string;
        clips?: Array<{
          id: string;
          clipNumber: number;
          title: string;
          startSeconds: number;
          durationSeconds: number;
        }>;
      };

      const uploadId =
        typeof body.uploadId === 'string' &&
        /^[a-zA-Z0-9_-]{8,32}$/.test(body.uploadId)
          ? body.uploadId
          : null;

      if (!uploadId) {
        res.status(400).json({ error: 'Invalid uploadId.' });
        return;
      }

      const workDir = path.join(WORK_ROOT, uploadId);
      const sourcePath = path.join(workDir, 'source.mp4');
      if (!fs.existsSync(sourcePath)) {
        res.status(404).json({
          error: 'Uploaded source video expired or not found. Please re-select the file.',
        });
        return;
      }

      const clips = Array.isArray(body.clips) ? body.clips.slice(0, 10) : [];
      if (clips.length === 0) {
        res.status(400).json({ error: 'No clips specified to render.' });
        return;
      }

      const outDir = path.join(workDir, 'clips');
      fs.mkdirSync(outDir, { recursive: true });

      const rendered: Array<{
        clipId: string;
        clipNumber: number;
        title: string;
        filename: string;
        durationSeconds: number;
        sizeBytes: number;
        downloadUrl: string;
      }> = [];

      for (const clip of clips) {
        if (abortController.signal.aborted) break;

        const slug = String(clip.title || `short-${clip.clipNumber}`)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 36);
        const filename = `${String(clip.clipNumber).padStart(2, '0')}_${slug || 'short'}_${clip.durationSeconds}s.mp4`;
        const outPath = path.join(outDir, filename);

        await runFfmpegCut(
          sourcePath,
          outPath,
          Number(clip.startSeconds) || 0,
          Number(clip.durationSeconds) || 53,
          abortController.signal
        );

        const stat = fs.statSync(outPath);
        rendered.push({
          clipId: clip.id,
          clipNumber: clip.clipNumber,
          title: clip.title,
          filename,
          durationSeconds: clip.durationSeconds,
          sizeBytes: stat.size,
          downloadUrl: `/api/rendered-clip/${uploadId}/${encodeURIComponent(filename)}`,
        });
      }

      if (!abortController.signal.aborted && !res.writableEnded) {
        res.json({ uploadId, rendered });
      }
    } catch (error) {
      if (abortController.signal.aborted || res.writableEnded) return;
      const msg =
        error instanceof Error ? error.message : 'FFmpeg clip rendering failed.';
      res.status(500).json({ error: msg });
    }
  });

  app.get('/api/rendered-clip/:uploadId/:filename', (req, res) => {
    const { uploadId, filename } = req.params;
    if (
      !/^[a-zA-Z0-9_-]{8,32}$/.test(uploadId) ||
      !/^[a-zA-Z0-9._-]{4,100}\.mp4$/i.test(filename)
    ) {
      res.status(400).json({ error: 'Invalid clip path.' });
      return;
    }

    const safeName = path.basename(filename);
    const filePath = path.join(WORK_ROOT, uploadId, 'clips', safeName);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Rendered clip not found.' });
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const isInline = req.query.inline === '1';

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Disposition',
      `${isInline ? 'inline' : 'attachment'}; filename="${safeName}"`
    );

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = Math.max(0, Number.parseInt(parts[0], 10) || 0);
      const end = parts[1]
        ? Math.min(fileSize - 1, Number.parseInt(parts[1], 10))
        : fileSize - 1;
      if (start >= fileSize || end < start) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', String(end - start + 1));
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.setHeader('Content-Length', String(fileSize));
    fs.createReadStream(filePath).pipe(res);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ClipCut Studio running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
