import { Download, ExternalLink, FileText, Play } from 'lucide-react';
import type { ExtractionResult } from '../types';
import {
  buildCsvCutSheet,
  buildMarkdownBrief,
  buildSrtContent,
  triggerFileDownload,
} from '../utils/exporters';

interface CutSheetViewProps {
  result: ExtractionResult | null;
  onInspectClip: (clipId: string) => void;
}

export function CutSheetView({ result, onInspectClip }: CutSheetViewProps) {
  if (!result) {
    return (
      <div className="mx-auto max-w-[1440px] px-6 py-16 text-center">
        <h2 className="font-display text-xl font-semibold text-slate-950">
          No Cut Sheet Generated Yet
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Paste a YouTube link in the Extractor bar above to generate an 8–10 clip production cut sheet.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-950">
            Production Cut Sheet
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {result.video.title} · {result.clips.length} corporate Shorts
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              triggerFileDownload(
                `${result.video.videoId}_cut_sheet.csv`,
                buildCsvCutSheet(result),
                'text/csv;charset=utf-8'
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Download CSV
          </button>
          <button
            type="button"
            onClick={() =>
              triggerFileDownload(
                `${result.video.videoId}_shorts_brief.md`,
                buildMarkdownBrief(result),
                'text/markdown;charset=utf-8'
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <FileText className="h-3.5 w-3.5" />
            Download Markdown Brief
          </button>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
              <th className="px-4 py-3 font-semibold">#</th>
              <th className="px-4 py-3 font-semibold">Clip Title &amp; Hook</th>
              <th className="px-4 py-3 font-semibold">Angle</th>
              <th className="px-4 py-3 text-right font-semibold">Start</th>
              <th className="px-4 py-3 text-right font-semibold">End</th>
              <th className="px-4 py-3 text-right font-semibold">Length</th>
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {result.clips.map((clip) => (
              <tr
                key={clip.id}
                className="transition-colors hover:bg-slate-50/80"
              >
                <td className="px-4 py-3.5 font-mono font-semibold text-slate-500 tabular-nums">
                  {String(clip.clipNumber).padStart(2, '0')}
                </td>
                <td className="max-w-md px-4 py-3.5">
                  <p className="font-semibold text-slate-950">{clip.title}</p>
                  <p className="mt-0.5 truncate text-slate-500">
                    {clip.hookText}
                  </p>
                </td>
                <td className="px-4 py-3.5 text-slate-700 whitespace-nowrap">
                  {clip.corporateAngle}
                </td>
                <td className="px-4 py-3.5 text-right font-mono text-slate-800 tabular-nums">
                  {clip.startTime}
                </td>
                <td className="px-4 py-3.5 text-right font-mono text-slate-800 tabular-nums">
                  {clip.endTime}
                </td>
                <td className="px-4 py-3.5 text-right font-mono font-semibold text-rose-600 tabular-nums">
                  {clip.durationSeconds}s
                </td>
                <td className="px-4 py-3.5 text-right">
                  <div className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onInspectClip(clip.id)}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-100"
                    >
                      <Play className="h-3 w-3" />
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        triggerFileDownload(
                          `short_${String(clip.clipNumber).padStart(2, '0')}.srt`,
                          buildSrtContent(clip),
                          'application/x-subrip;charset=utf-8'
                        )
                      }
                      className="rounded border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-100"
                    >
                      .SRT
                    </button>
                    <a
                      href={`https://youtu.be/${result.video.videoId}?t=${clip.startSeconds}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${clip.title} on YouTube`}
                      className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
