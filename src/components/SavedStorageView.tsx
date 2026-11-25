import { useEffect, useState } from 'react';
import {
  Download,
  Film,
  FolderOpen,
  HardDrive,
  Play,
  Trash2,
} from 'lucide-react';
import type { ExtractionResult } from '../types';
import {
  downloadCompleteZipPack,
  formatMmSs,
} from '../utils/exporters';
import {
  getAllSavedMp4Clips,
  type SavedMp4Clip,
} from '../utils/storageDb';
import { buildZipBlob } from '../utils/zipBuilder';

interface SavedStorageViewProps {
  items: ExtractionResult[];
  onLoadItem: (item: ExtractionResult) => void;
  onDeleteItem: (videoId: string) => void;
  onClearAll: () => void;
}

export function SavedStorageView({
  items,
  onLoadItem,
  onDeleteItem,
  onClearAll,
}: SavedStorageViewProps) {
  const [mp4Clips, setMp4Clips] = useState<SavedMp4Clip[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string>('');

  useEffect(() => {
    void getAllSavedMp4Clips().then(setMp4Clips);
  }, [items]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const totalClips = items.reduce((acc, item) => acc + item.clips.length, 0);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const downloadVideoMp4Zip = async (videoId: string, clipsForVideo: SavedMp4Clip[]) => {
    const entries = await Promise.all(
      clipsForVideo.map(async (c) => ({
        name: c.filename,
        content: new Uint8Array(await c.blob.arrayBuffer()),
      }))
    );
    const zipBlob = buildZipBlob(entries);
    downloadBlob(zipBlob, `ClipCut_${videoId}_MP4_Shorts.zip`);
  };

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-950">
            My Saved Shorts Storage
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {items.length} saved video pack{items.length === 1 ? '' : 's'} ·{' '}
            <span className="font-mono tabular-nums">{totalClips}</span> Short cut sheets ·{' '}
            <span className="font-mono tabular-nums">{mp4Clips.length}</span> rendered MP4 clip{mp4Clips.length === 1 ? '' : 's'} offline
          </p>
        </div>

        {items.length > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear Storage
          </button>
        )}
      </div>

      {previewUrl && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-950">
              Saved MP4 Preview: {previewTitle}
            </span>
            <button
              type="button"
              onClick={() => setPreviewUrl(null)}
              className="text-xs font-medium text-slate-600 hover:text-slate-950"
            >
              Close Preview
            </button>
          </div>
          <video
            src={previewUrl}
            controls
            autoPlay
            className="mx-auto aspect-[9/16] max-h-[420px] rounded-xl bg-zinc-950"
          />
        </div>
      )}

      {items.length === 0 ? (
        <div className="mt-12 flex flex-col items-center rounded-xl border border-slate-200 bg-white px-6 py-14 text-center">
          <HardDrive className="h-8 w-8 text-slate-400" />
          <h2 className="mt-3 font-display text-lg font-semibold text-slate-950">
            Your Shorts storage is empty
          </h2>
          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-600">
            Every YouTube video you extract is automatically saved offline here and downloaded as a ZIP pack when Auto-Save ZIP is on. Rendered 9:16 MP4 clips are also stored right here for offline playback and download.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {items.map((item) => {
            const videoMp4s = mp4Clips.filter(
              (m) => m.videoId === item.video.videoId
            );
            return (
              <div
                key={item.video.videoId}
                className="rounded-xl border border-slate-200 bg-white p-5"
              >
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 items-start gap-3">
                    <img
                      src={item.video.thumbnailUrl}
                      alt={item.video.title}
                      referrerPolicy="no-referrer"
                      className="h-14 w-24 shrink-0 rounded-md border border-slate-200 object-cover"
                    />
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-slate-950">
                        {item.video.title}
                      </h2>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.video.channelName}
                        {item.video.durationSeconds
                          ? ` · ${formatMmSs(item.video.durationSeconds)}`
                          : ''}
                        {' · '}
                        <span className="font-mono tabular-nums">
                          {item.clips.length} Shorts (~{item.targetDuration}s)
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {videoMp4s.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          void downloadVideoMp4Zip(item.video.videoId, videoMp4s)
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 whitespace-nowrap"
                      >
                        <Film className="h-3.5 w-3.5" />
                        Download {videoMp4s.length} MP4s (.ZIP)
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => downloadCompleteZipPack(item)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download Pack ZIP
                    </button>
                    <button
                      type="button"
                      onClick={() => onLoadItem(item)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteItem(item.video.videoId)}
                      aria-label={`Delete ${item.video.title} from storage`}
                      className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {videoMp4s.length > 0 && (
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <p className="mb-2 text-xs font-semibold text-slate-700">
                      Saved 9:16 MP4 Clips ({videoMp4s.length})
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {videoMp4s.map((mp4) => (
                        <div
                          key={mp4.key}
                          className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">
                              {String(mp4.clipNumber).padStart(2, '0')}.{' '}
                              {mp4.title}
                            </p>
                            <p className="font-mono text-[11px] text-slate-500 tabular-nums">
                              {mp4.durationSeconds}s ·{' '}
                              {(mp4.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                if (previewUrl) URL.revokeObjectURL(previewUrl);
                                setPreviewUrl(URL.createObjectURL(mp4.blob));
                                setPreviewTitle(mp4.title);
                              }}
                              aria-label={`Play ${mp4.title}`}
                              className="rounded border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-100"
                            >
                              <Play className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                downloadBlob(mp4.blob, mp4.filename)
                              }
                              aria-label={`Download ${mp4.filename}`}
                              className="rounded border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-100"
                            >
                              <Download className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
