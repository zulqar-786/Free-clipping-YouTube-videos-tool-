import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Captions,
  Check,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Smartphone,
  Square,
  Terminal,
  Type as TypeIcon,
  Upload,
} from 'lucide-react';
import type { ShortClip } from '../types';
import {
  buildSingleFfmpegCommand,
  buildSrtContent,
  formatMmSs,
  triggerFileDownload,
} from '../utils/exporters';

interface PreviewStageProps {
  videoId: string;
  canonicalUrl: string;
  thumbnailUrl: string;
  clip: ShortClip;
  renderedMp4Url?: string | null;
  renderedMp4DownloadUrl?: string | null;
  renderedMp4Filename?: string | null;
  isRenderingMp4?: boolean;
  hasSourceVideo: boolean;
  isUploadingSource?: boolean;
  openDownloadDrawerNonce?: number;
  onDownloadMp4: (clip: ShortClip) => void;
  onAttachSourceAndCut: (file: File, clip: ShortClip) => void;
  onCutFromDirectUrl: (sourceUrl: string, clip: ShortClip) => void;
  onStopRender?: () => void;
}

export function PreviewStage({
  videoId,
  canonicalUrl,
  thumbnailUrl,
  clip,
  renderedMp4Url,
  renderedMp4DownloadUrl,
  renderedMp4Filename,
  isRenderingMp4 = false,
  hasSourceVideo,
  isUploadingSource = false,
  openDownloadDrawerNonce = 0,
  onDownloadMp4,
  onAttachSourceAndCut,
  onCutFromDirectUrl,
  onStopRender,
}: PreviewStageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [aspectMode, setAspectMode] = useState<'9:16' | '16:9'>('9:16');
  const [playerSource, setPlayerSource] = useState<'youtube' | 'mp4'>('youtube');
  const [showHook, setShowHook] = useState(true);
  const [showCaptions, setShowCaptions] = useState(true);
  const [isPlayingOverlay, setIsPlayingOverlay] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [playNonce, setPlayNonce] = useState(0);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [showDownloadDrawer, setShowDownloadDrawer] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [directVideoUrl, setDirectVideoUrl] = useState('');

  // Reset playback clock when switching clips or editing clip start/end
  useEffect(() => {
    setElapsed(0);
    setIsPlayingOverlay(false);
    setShowDownloadDrawer(false);
    setCopiedCmd(false);
  }, [clip.id, clip.startSeconds, clip.endSeconds]);

  // Open download drawer when triggered externally (e.g. clicking MP4 in queue without source)
  useEffect(() => {
    if (openDownloadDrawerNonce > 0 && !renderedMp4Url && !hasSourceVideo) {
      setShowDownloadDrawer(true);
    }
  }, [openDownloadDrawerNonce, renderedMp4Url, hasSourceVideo]);

  // Automatically switch to local MP4 preview if rendered
  useEffect(() => {
    if (renderedMp4Url) {
      setPlayerSource('mp4');
      setShowDownloadDrawer(false);
    } else {
      setPlayerSource('youtube');
    }
  }, [renderedMp4Url, clip.id]);

  useEffect(() => {
    if (!isPlayingOverlay) return;
    const timer = window.setInterval(() => {
      setElapsed((prev) => {
        if (prev + 0.5 >= clip.durationSeconds) {
          setIsPlayingOverlay(false);
          return clip.durationSeconds;
        }
        return prev + 0.5;
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [isPlayingOverlay, clip.durationSeconds]);

  const activeCaption = useMemo(() => {
    if (!clip.captionSegments.length) return clip.hookText;
    const match = clip.captionSegments.find(
      (seg) =>
        elapsed >= seg.offsetSeconds &&
        elapsed < seg.offsetSeconds + seg.durationSeconds
    );
    if (match) return match.text;
    const lastBefore = [...clip.captionSegments]
      .reverse()
      .find((seg) => elapsed >= seg.offsetSeconds);
    return lastBefore?.text ?? clip.captionSegments[0].text;
  }, [clip.captionSegments, clip.hookText, elapsed]);

  const embedSrc = useMemo(() => {
    const params = new URLSearchParams({
      start: String(clip.startSeconds),
      end: String(clip.endSeconds),
      autoplay: playNonce > 0 ? '1' : '0',
      rel: '0',
      modestbranding: '1',
      playsinline: '1',
    });
    return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
  }, [videoId, clip.startSeconds, clip.endSeconds, playNonce]);

  const handleRestartClip = () => {
    setElapsed(0);
    setIsPlayingOverlay(true);
    setPlayNonce((n) => n + 1);
  };

  const handleDownloadClick = () => {
    if (hasSourceVideo) {
      onDownloadMp4(clip);
    } else {
      setShowDownloadDrawer((v) => !v);
    }
  };

  const handleCopySingleCommand = async () => {
    try {
      await navigator.clipboard.writeText(
        buildSingleFfmpegCommand(canonicalUrl, clip)
      );
      setCopiedCmd(true);
      window.setTimeout(() => setCopiedCmd(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  return (
    <div className="flex flex-col items-center rounded-xl border border-slate-200 bg-white p-5">
      {/* Top Stage Controls */}
      <div className="mb-4 flex w-full flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex items-center rounded-md border border-slate-200 bg-slate-50 p-0.5">
          <button
            type="button"
            onClick={() => setAspectMode('9:16')}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              aspectMode === '9:16'
                ? 'bg-white text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-950'
            }`}
          >
            <Smartphone className="h-3.5 w-3.5" />
            9:16
          </button>
          <button
            type="button"
            onClick={() => setAspectMode('16:9')}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              aspectMode === '16:9'
                ? 'bg-white text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-950'
            }`}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            16:9
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {renderedMp4Url && (
            <button
              type="button"
              onClick={() =>
                setPlayerSource((s) => (s === 'mp4' ? 'youtube' : 'mp4'))
              }
              className="rounded-md border border-emerald-700 bg-emerald-700 px-2 py-1 text-[11px] font-medium text-white whitespace-nowrap shrink-0"
            >
              {playerSource === 'mp4' ? 'MP4 Clip' : 'YouTube'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowHook((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              showHook
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:text-slate-950'
            }`}
          >
            <TypeIcon className="h-3 w-3" />
            Hook
          </button>
          <button
            type="button"
            onClick={() => setShowCaptions((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              showCaptions
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:text-slate-950'
            }`}
          >
            <Captions className="h-3 w-3" />
            Captions
          </button>
        </div>
      </div>

      {/* Video Viewport */}
      <div
        className={`relative overflow-hidden rounded-xl bg-zinc-950 shadow-sm ${
          aspectMode === '9:16'
            ? 'aspect-[9/16] w-full max-w-[300px]'
            : 'aspect-video w-full'
        }`}
      >
        {playerSource === 'mp4' && renderedMp4Url ? (
          <video
            key={renderedMp4Url}
            src={renderedMp4Url}
            controls
            playsInline
            className="h-full w-full object-cover"
          />
        ) : (
          <>
            {!thumbFailed ? (
              <img
                src={thumbnailUrl}
                alt={clip.title}
                referrerPolicy="no-referrer"
                onError={() => setThumbFailed(true)}
                className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-35"
              />
            ) : (
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-900 to-zinc-950" />
            )}

            <iframe
              key={`${videoId}-${clip.startSeconds}-${clip.endSeconds}-${playNonce}`}
              src={embedSrc}
              title={clip.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className={
                aspectMode === '9:16'
                  ? 'absolute inset-y-0 left-1/2 h-full w-[178%] max-w-none -translate-x-1/2 border-0'
                  : 'absolute inset-0 h-full w-full border-0'
              }
            />
          </>
        )}

        {/* Hook Headline Overlay (Upper Safe Zone) */}
        {showHook && (
          <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 via-black/40 to-transparent px-4 pt-4 pb-8">
            <p className="mx-auto max-w-[260px] text-center font-display text-sm font-bold leading-snug text-white drop-shadow">
              {clip.hookText}
            </p>
          </div>
        )}

        {/* Live Timed Caption Overlay (Lower Safe Zone) */}
        {showCaptions && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pt-10 pb-10">
            <p className="mx-auto max-w-[260px] rounded bg-black/75 px-3 py-1.5 text-center text-xs font-semibold leading-snug text-white">
              {activeCaption}
            </p>
          </div>
        )}
      </div>

      {/* Caption Scrubber & Direct Video Download Controls */}
      <div className="mt-4 w-full space-y-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsPlayingOverlay((p) => !p)}
            aria-label={isPlayingOverlay ? 'Pause caption sync' : 'Play caption sync'}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
          >
            {isPlayingOverlay ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </button>

          <input
            type="range"
            min={0}
            max={clip.durationSeconds}
            step={0.5}
            value={elapsed}
            aria-label="Scrub clip caption timeline"
            onChange={(e) => {
              setElapsed(Number(e.target.value));
              setIsPlayingOverlay(false);
            }}
            className="h-1.5 flex-1 cursor-pointer accent-rose-600"
          />

          <span className="font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap shrink-0">
            {formatMmSs(elapsed)} / {formatMmSs(clip.durationSeconds)}
          </span>
        </div>

        {/* Primary Video Play + Direct Video Download Row */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleRestartClip}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Play ({clip.startTime})
          </button>

          {renderedMp4Url ? (
            <a
              href={renderedMp4DownloadUrl || renderedMp4Url}
              download={
                renderedMp4Filename ||
                `short_${String(clip.clipNumber).padStart(2, '0')}_${clip.durationSeconds}s.mp4`
              }
              rel="noopener"
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              Save .MP4
            </a>
          ) : (
            <button
              type="button"
              disabled={isRenderingMp4 || isUploadingSource}
              onClick={handleDownloadClick}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              {isRenderingMp4 || isUploadingSource ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {isUploadingSource ? 'Uploading...' : 'Cutting MP4...'}
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" />
                  Download Video
                </>
              )}
            </button>
          )}

          {(isRenderingMp4 || isUploadingSource) && onStopRender && (
            <button
              type="button"
              onClick={onStopRender}
              aria-label="Stop MP4 processing"
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Square className="h-3 w-3 fill-current" />
              Stop
            </button>
          )}
        </div>

        {/* Clear Download Options Drawer when no source MP4 is attached yet */}
        {showDownloadDrawer && !hasSourceVideo && !renderedMp4Url && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs">
            <div className="flex items-start justify-between gap-2">
              <p className="leading-relaxed text-slate-700">
                YouTube blocks cloud servers from grabbing raw video streams directly. Choose how to download this{' '}
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {clip.durationSeconds}s
                </span>{' '}
                9:16 MP4 clip:
              </p>
              <button
                type="button"
                onClick={() => setShowDownloadDrawer(false)}
                className="shrink-0 font-medium text-slate-500 hover:text-slate-900"
              >
                Close
              </button>
            </div>

            {/* Option 1: 1-Click Terminal Clip Command (No upload needed) */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopySingleCommand()}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
              >
                {copiedCmd ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Terminal className="h-3.5 w-3.5" />
                )}
                {copiedCmd ? 'Clip Command Copied' : 'Copy Clip Command (yt-dlp)'}
              </button>

              <button
                type="button"
                onClick={() =>
                  triggerFileDownload(
                    `short_${String(clip.clipNumber).padStart(2, '0')}_${clip.durationSeconds}s.srt`,
                    buildSrtContent(clip),
                    'application/x-subrip;charset=utf-8'
                  )
                }
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap"
              >
                <Copy className="h-3 w-3" />
                .SRT
              </button>
            </div>

            {/* Option 2: Direct Video URL */}
            <div className="flex items-center gap-1.5">
              <input
                type="url"
                value={directVideoUrl}
                onChange={(e) => setDirectVideoUrl(e.target.value)}
                placeholder="Or paste direct .mp4 / .webm link..."
                aria-label="Direct MP4 video URL"
                className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
              />
              <button
                type="button"
                disabled={!directVideoUrl.trim() || isRenderingMp4}
                onClick={() => {
                  if (directVideoUrl.trim()) {
                    onCutFromDirectUrl(directVideoUrl.trim(), clip);
                  }
                }}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Scissors className="h-3 w-3" />
                Cut URL
              </button>
            </div>

            {/* Option 3: Upload local video file once (chunked, any size up to 1.5 GB) */}
            <div className="border-t border-slate-200 pt-2.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setShowDownloadDrawer(false);
                    onAttachSourceAndCut(file, clip);
                  }
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100"
              >
                <Upload className="h-3.5 w-3.5" />
                Have the .MP4 file? Upload Once to Cut (up to 1.5 GB)
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end">
          <a
            href={`https://youtu.be/${videoId}?t=${clip.startSeconds}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-950 whitespace-nowrap shrink-0"
          >
            Open clip on YouTube
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
