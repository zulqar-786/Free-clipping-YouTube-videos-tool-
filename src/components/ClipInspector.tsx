import { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import type {
  ExtractionStyle,
  OutputLanguage,
  ShortClip,
} from '../types';
import {
  buildSingleFfmpegCommand,
  buildSrtContent,
  formatMmSs,
  triggerFileDownload,
} from '../utils/exporters';

interface ClipInspectorProps {
  clip: ShortClip;
  canonicalUrl: string;
  videoTitle: string;
  maxDurationSeconds: number | null;
  style: ExtractionStyle;
  language: OutputLanguage;
  targetDuration: number;
  onUpdateClip: (updated: ShortClip) => void;
}

type InspectorTab = 'script' | 'caption' | 'export';

export function ClipInspector({
  clip,
  canonicalUrl,
  videoTitle,
  maxDurationSeconds,
  style,
  language,
  targetDuration,
  onUpdateClip,
}: ClipInspectorProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('script');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);

  const copyText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const adjustTrim = (newStart: number, newEnd: number) => {
    const safeStart = Math.max(0, Math.round(newStart));
    const upperBound =
      maxDurationSeconds && maxDurationSeconds > 15
        ? maxDurationSeconds
        : safeStart + 180;
    const safeEnd = Math.min(
      upperBound,
      Math.max(safeStart + 10, Math.round(newEnd))
    );
    const clampedEnd = Math.min(safeStart + 59, safeEnd);

    onUpdateClip({
      ...clip,
      startSeconds: safeStart,
      endSeconds: clampedEnd,
      startTime: formatMmSs(safeStart),
      endTime: formatMmSs(clampedEnd),
      durationSeconds: clampedEnd - safeStart,
    });
  };

  const handleSnapToTarget = () => {
    adjustTrim(clip.startSeconds, clip.startSeconds + targetDuration);
  };

  const handleRefineHook = async () => {
    setIsRefining(true);
    setRefineError(null);
    try {
      const res = await fetch('/api/refine-short', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clip,
          videoTitle,
          style,
          language,
        }),
      });
      const data = (await res.json()) as {
        title?: string;
        hookText?: string;
        socialCaption?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to refine Short.');
      }
      onUpdateClip({
        ...clip,
        title: data.title || clip.title,
        hookText: data.hookText || clip.hookText,
        socialCaption: data.socialCaption || clip.socialCaption,
      });
    } catch (err) {
      setRefineError(
        err instanceof Error ? err.message : 'Unable to regenerate hook.'
      );
    } finally {
      setIsRefining(false);
    }
  };

  const ffmpegCmd = buildSingleFfmpegCommand(canonicalUrl, clip);

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-6">
      {/* Header & Metadata */}
      <div className="border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="font-mono font-semibold text-rose-600 tabular-nums">
            Short {String(clip.clipNumber).padStart(2, '0')}
          </span>
          <span aria-hidden="true">·</span>
          <span>{clip.corporateAngle}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">
            {clip.startTime} – {clip.endTime} ({clip.durationSeconds}s)
          </span>
        </div>

        <input
          type="text"
          value={clip.title}
          onChange={(e) => onUpdateClip({ ...clip, title: e.target.value })}
          aria-label="Short clip title"
          className="mt-2 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 font-display text-lg font-bold text-slate-950 transition-colors hover:border-slate-200 focus:border-slate-900 focus:bg-slate-50 focus:outline-none"
        />
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
          {clip.whyItWorks}
        </p>
      </div>

      {/* Trim Controls */}
      <div className="border-b border-slate-100 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-slate-600">Start</span>
              <button
                type="button"
                onClick={() => adjustTrim(clip.startSeconds - 1, clip.endSeconds)}
                className="rounded border border-slate-200 px-2 py-1 font-mono text-slate-700 hover:bg-slate-50"
              >
                -1s
              </button>
              <span className="min-w-[48px] text-center font-mono font-semibold text-slate-950 tabular-nums">
                {clip.startTime}
              </span>
              <button
                type="button"
                onClick={() => adjustTrim(clip.startSeconds + 1, clip.endSeconds)}
                className="rounded border border-slate-200 px-2 py-1 font-mono text-slate-700 hover:bg-slate-50"
              >
                +1s
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="font-medium text-slate-600">End</span>
              <button
                type="button"
                onClick={() => adjustTrim(clip.startSeconds, clip.endSeconds - 1)}
                className="rounded border border-slate-200 px-2 py-1 font-mono text-slate-700 hover:bg-slate-50"
              >
                -1s
              </button>
              <span className="min-w-[48px] text-center font-mono font-semibold text-slate-950 tabular-nums">
                {clip.endTime}
              </span>
              <button
                type="button"
                onClick={() => adjustTrim(clip.startSeconds, clip.endSeconds + 1)}
                className="rounded border border-slate-200 px-2 py-1 font-mono text-slate-700 hover:bg-slate-50"
              >
                +1s
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSnapToTarget}
            className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-xs font-medium text-slate-800 transition-colors hover:bg-slate-100 whitespace-nowrap shrink-0 tabular-nums"
          >
            Snap to {targetDuration}s
          </button>
        </div>
      </div>

      {/* Opening Hook Editor */}
      <div className="border-b border-slate-100 py-4">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="hook-input"
            className="text-xs font-semibold text-slate-700"
          >
            On-Screen Opening Hook (First 3s)
          </label>
          <button
            type="button"
            disabled={isRefining}
            onClick={handleRefineHook}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-600 hover:text-rose-700 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {isRefining ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Regenerate Hook
          </button>
        </div>

        <input
          id="hook-input"
          type="text"
          value={clip.hookText}
          onChange={(e) => onUpdateClip({ ...clip, hookText: e.target.value })}
          className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
        />

        {refineError && (
          <p className="mt-1.5 text-xs text-rose-600">{refineError}</p>
        )}

        <p className="mt-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">B-Roll Cue:</span>{' '}
          {clip.bRollSuggestion}
        </p>
      </div>

      {/* Sub-tabs */}
      <div className="mt-4 flex items-center gap-1 rounded-lg bg-slate-100 p-1">
        {(
          [
            { id: 'script', label: 'Timed Script' },
            { id: 'caption', label: 'Post Caption' },
            { id: 'export', label: 'FFmpeg & SRT' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === tab.id
                ? 'bg-white text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-950'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Panels */}
      <div className="mt-4">
        {activeTab === 'script' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">
                {clip.captionSegments.length} timed subtitle beats
              </span>
              <button
                type="button"
                onClick={() =>
                  copyText(
                    'script',
                    clip.captionSegments
                      .map((s) => `[${formatMmSs(s.offsetSeconds)}] ${s.text}`)
                      .join('\n')
                  )
                }
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-950"
              >
                {copiedKey === 'script' ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copiedKey === 'script' ? 'Copied' : 'Copy Script'}
              </button>
            </div>
            <div className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50">
              {clip.captionSegments.map((seg, i) => (
                <div
                  key={`${seg.offsetSeconds}-${i}`}
                  className="flex items-start gap-3 px-3 py-2 text-xs"
                >
                  <span className="shrink-0 font-mono text-slate-500 tabular-nums">
                    {formatMmSs(seg.offsetSeconds)}
                  </span>
                  <span className="leading-relaxed text-slate-800">
                    {seg.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'caption' && (
          <div className="space-y-3">
            <textarea
              rows={5}
              value={clip.socialCaption}
              onChange={(e) =>
                onUpdateClip({ ...clip, socialCaption: e.target.value })
              }
              aria-label="YouTube Shorts and LinkedIn caption"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
            />
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => copyText('caption', clip.socialCaption)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                {copiedKey === 'caption' ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copiedKey === 'caption' ? 'Caption Copied' : 'Copy Post Caption'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'export' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  triggerFileDownload(
                    `short_${String(clip.clipNumber).padStart(2, '0')}_${clip.durationSeconds}s.srt`,
                    buildSrtContent(clip),
                    'application/x-subrip;charset=utf-8'
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                Download .SRT Subtitles
              </button>

              <button
                type="button"
                onClick={() => copyText('ffmpeg', ffmpegCmd)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                {copiedKey === 'ffmpeg' ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Terminal className="h-3.5 w-3.5" />
                )}
                {copiedKey === 'ffmpeg'
                  ? 'Command Copied'
                  : 'Copy 9:16 FFmpeg Command'}
              </button>
            </div>

            <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-950 p-3.5 font-mono text-[11px] leading-relaxed text-slate-200">
              <code>{ffmpegCmd}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
