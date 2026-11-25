import { useRef } from 'react';
import {
  Archive,
  CheckCircle2,
  Download,
  Film,
  Loader2,
  Square,
  Upload,
} from 'lucide-react';
import type { ExtractionResult, ShortClip } from '../types';

export interface RenderedMp4Entry {
  clipId: string;
  clipNumber: number;
  title: string;
  filename: string;
  durationSeconds: number;
  sizeBytes: number;
  blobUrl: string;
  serverDownloadUrl?: string;
  blob: Blob;
}

interface Mp4RenderPanelProps {
  result: ExtractionResult;
  selectedIds: Set<string>;
  sourceFileName: string | null;
  hasSourceUpload: boolean;
  isUploadingSource: boolean;
  isBatchRendering: boolean;
  renderStatusMessage: string | null;
  renderError: string | null;
  renderedMap: Record<string, RenderedMp4Entry>;
  onUploadSource: (file: File) => void;
  onBatchRenderAll: () => void;
  onDownloadSingleMp4: (clip: ShortClip) => void;
  onDownloadAllMp4Zip: () => void;
  onStopProcessing: () => void;
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Mp4RenderPanel({
  result,
  selectedIds,
  sourceFileName,
  hasSourceUpload,
  isUploadingSource,
  isBatchRendering,
  renderStatusMessage,
  renderError,
  renderedMap,
  onUploadSource,
  onBatchRenderAll,
  onDownloadSingleMp4,
  onDownloadAllMp4Zip,
  onStopProcessing,
}: Mp4RenderPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const targetClips: ShortClip[] =
    selectedIds.size > 0
      ? result.clips.filter((c) => selectedIds.has(c.id))
      : result.clips;

  const renderedList = result.clips
    .map((clip) => renderedMap[clip.id])
    .filter((item): item is RenderedMp4Entry => Boolean(item));

  const isBusy = isUploadingSource || isBatchRendering;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Film className="h-4 w-4 text-rose-600" />
            Batch Video Cutter &amp; Auto-Downloader (9:16 MP4)
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            {hasSourceUpload && sourceFileName ? (
              <>
                Uploaded video ready:{' '}
                <span className="font-semibold text-slate-900">
                  {sourceFileName}
                </span>
                . Click Download Video on any clip or cut all{' '}
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {targetClips.length}
                </span>{' '}
                MP4 clips at once.
              </>
            ) : (
              <>
                Upload your video file (.mp4 / .mov / .webm, up to 1.5 GB chunked upload) once to cut and auto-download all{' '}
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {targetClips.length}
                </span>{' '}
                vertical ~{result.targetDuration}s MP4 clips straight to your storage.
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onUploadSource(file);
              }
              e.target.value = '';
            }}
          />

          <button
            type="button"
            disabled={isBusy}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {isUploadingSource ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {hasSourceUpload ? 'Change Uploaded Video' : 'Upload Video (.MP4)'}
          </button>

          {hasSourceUpload && (
            <button
              type="button"
              disabled={isBusy}
              onClick={onBatchRenderAll}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {isBatchRendering ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Film className="h-3.5 w-3.5" />
              )}
              {isBatchRendering
                ? 'Cutting All MP4s...'
                : `Cut & Download All ${targetClips.length} MP4s`}
            </button>
          )}

          {isBusy && (
            <button
              type="button"
              onClick={onStopProcessing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Square className="h-3 w-3 fill-current" />
              Stop Processing
            </button>
          )}

          {renderedList.length > 0 && (
            <button
              type="button"
              onClick={onDownloadAllMp4Zip}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700 whitespace-nowrap shrink-0"
            >
              <Archive className="h-3.5 w-3.5" />
              Download {renderedList.length} MP4s (.ZIP)
            </button>
          )}
        </div>
      </div>

      {(renderStatusMessage || renderError) && (
        <div
          className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
            renderError
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : isBusy
                ? 'border-slate-200 bg-slate-50 text-slate-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {isBusy ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-600" />
            ) : !renderError ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
            ) : null}
            <span>{renderError || renderStatusMessage}</span>
          </div>
          {isBusy && (
            <button
              type="button"
              onClick={onStopProcessing}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-900 hover:bg-slate-100 whitespace-nowrap shrink-0"
            >
              <Square className="h-2.5 w-2.5 fill-current" />
              Stop
            </button>
          )}
        </div>
      )}

      {renderedList.length > 0 && (
        <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {renderedList.map((entry) => {
            const clipObj = result.clips.find((c) => c.id === entry.clipId);
            return (
              <div
                key={entry.clipId}
                className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">
                    {String(entry.clipNumber).padStart(2, '0')}. {entry.title}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                    {entry.durationSeconds}s · {formatMb(entry.sizeBytes)} · 720×1280 MP4
                  </p>
                </div>
                <a
                  href={entry.serverDownloadUrl || entry.blobUrl}
                  download={entry.filename}
                  rel="noopener"
                  onClick={() => {
                    if (clipObj) onDownloadSingleMp4(clipObj);
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3 w-3" />
                  Save .MP4
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
