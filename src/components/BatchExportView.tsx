import { useState } from 'react';
import { Check, Copy, Download, Terminal } from 'lucide-react';
import type { ExtractionResult } from '../types';
import { buildBatchShellScript, triggerFileDownload } from '../utils/exporters';

interface BatchExportViewProps {
  result: ExtractionResult | null;
  selectedIds: Set<string>;
}

export function BatchExportView({ result, selectedIds }: BatchExportViewProps) {
  const [copied, setCopied] = useState(false);

  if (!result) {
    return (
      <div className="mx-auto max-w-[1440px] px-6 py-16 text-center">
        <h2 className="font-display text-xl font-semibold text-slate-950">
          No Batch Script Ready Yet
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Extract 8–10 corporate Shorts from a YouTube video first to generate a one-click 9:16 FFmpeg render script.
        </p>
      </div>
    );
  }

  const targetClips =
    selectedIds.size > 0
      ? result.clips.filter((c) => selectedIds.has(c.id))
      : result.clips;

  const scriptText = buildBatchShellScript(result, targetClips);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(scriptText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-950">
            Batch 9:16 Vertical Render Script
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {targetClips.length} selected clip{targetClips.length === 1 ? '' : 's'} · Downloads source once via yt-dlp and cuts 1080×1920 MP4s with FFmpeg
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? 'Script Copied' : 'Copy Shell Script'}
          </button>
          <button
            type="button"
            onClick={() =>
              triggerFileDownload(
                `render_${result.video.videoId}_shorts.sh`,
                scriptText,
                'text/x-shellscript;charset=utf-8'
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Download .SH Script
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <Terminal className="h-4 w-4 text-slate-600" />
              Included Shorts ({targetClips.length})
            </div>
            <ul className="mt-3 divide-y divide-slate-100">
              {targetClips.map((clip) => (
                <li
                  key={clip.id}
                  className="flex items-center justify-between gap-3 py-2.5 text-xs"
                >
                  <span className="truncate font-medium text-slate-800">
                    {String(clip.clipNumber).padStart(2, '0')}. {clip.title}
                  </span>
                  <span className="font-mono text-slate-500 tabular-nums shrink-0">
                    {clip.durationSeconds}s
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="lg:col-span-8">
          <pre className="max-h-[540px] overflow-auto rounded-xl border border-slate-200 bg-slate-950 p-5 font-mono text-xs leading-relaxed text-slate-200">
            <code>{scriptText}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
