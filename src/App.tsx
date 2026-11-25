import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CheckSquare,
  Download,
  Film,
  Loader2,
  Search,
  Square,
  Upload,
} from 'lucide-react';
import { BatchExportView } from './components/BatchExportView';
import { ClipInspector } from './components/ClipInspector';
import { CutSheetView } from './components/CutSheetView';
import { EmptyWorkspace, SAMPLE_VIDEOS } from './components/EmptyWorkspace';
import { Header, type StudioView } from './components/Header';
import {
  Mp4RenderPanel,
  type RenderedMp4Entry,
} from './components/Mp4RenderPanel';
import { PreviewStage } from './components/PreviewStage';
import { SavedStorageView } from './components/SavedStorageView';
import { VideoInputBar } from './components/VideoInputBar';
import type {
  ExtractionResult,
  ExtractionStyle,
  OutputLanguage,
  ShortClip,
} from './types';
import { formatMmSs } from './utils/exporters';
import {
  clearAllSavedExtractions,
  deleteSavedExtraction,
  getAllSavedExtractions,
  getAllSavedMp4Clips,
  saveExtractionToStorage,
  saveRenderedMp4Clip,
} from './utils/storageDb';
import { buildZipBlob } from './utils/zipBuilder';

const AUTO_DOWNLOAD_PREF_KEY = 'clipcut_auto_download_mp4_v1';

const MAX_UPLOAD_BYTES = 1536 * 1024 * 1024; // 1.5 GB

function triggerDirectDownload(href: string, filename: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export default function App() {
  const topFileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeView, setActiveView] = useState<StudioView>('extractor');
  const [url, setUrl] = useState('');
  const [manualTranscript, setManualTranscript] = useState('');
  const [showTranscriptBox, setShowTranscriptBox] = useState(false);
  const [autoDownload, setAutoDownload] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(AUTO_DOWNLOAD_PREF_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const [clipCount, setClipCount] = useState(9);
  const [targetDuration, setTargetDuration] = useState(53);
  const [style, setStyle] = useState<ExtractionStyle>('corporate');
  const [language, setLanguage] = useState<OutputLanguage>('english');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [angleFilter, setAngleFilter] = useState<string>('all');
  const [thumbError, setThumbError] = useState(false);
  const [history, setHistory] = useState<ExtractionResult[]>([]);

  // Abort & stop controllers for extraction, upload, and MP4 cutting
  const extractAbortRef = useRef<AbortController | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const renderAbortRef = useRef<AbortController | null>(null);
  const stopRenderFlagRef = useRef(false);
  const pendingSingleClipRef = useRef<ShortClip | null>(null);

  // Source video upload + per-clip MP4 rendering state
  const [sourceUploadId, setSourceUploadId] = useState<string | null>(null);
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [isUploadingSource, setIsUploadingSource] = useState(false);
  const [isBatchRendering, setIsBatchRendering] = useState(false);
  const [renderingClipIds, setRenderingClipIds] = useState<Set<string>>(
    new Set()
  );
  const [renderStatusMessage, setRenderStatusMessage] = useState<string | null>(
    null
  );
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderedMp4Map, setRenderedMp4Map] = useState<
    Record<string, RenderedMp4Entry>
  >({});
  const [openDownloadDrawerNonce, setOpenDownloadDrawerNonce] = useState(0);
  const [readyDownloadLink, setReadyDownloadLink] = useState<{
    url: string;
    filename: string;
    label: string;
  } | null>(null);

  useEffect(() => {
    void getAllSavedExtractions().then((items) => {
      setHistory(items);
    });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_DOWNLOAD_PREF_KEY, String(autoDownload));
    } catch {
      // Ignore storage errors
    }
  }, [autoDownload]);

  // Hydrate previously saved MP4 clips from IndexedDB whenever active video changes
  useEffect(() => {
    if (!result) {
      setRenderedMp4Map({});
      return;
    }
    let cancelled = false;
    void getAllSavedMp4Clips().then((savedClips) => {
      if (cancelled) return;
      const map: Record<string, RenderedMp4Entry> = {};
      for (const sc of savedClips) {
        if (sc.videoId === result.video.videoId) {
          map[sc.clipId] = {
            clipId: sc.clipId,
            clipNumber: sc.clipNumber,
            title: sc.title,
            filename: sc.filename,
            durationSeconds: sc.durationSeconds,
            sizeBytes: sc.sizeBytes,
            blobUrl: URL.createObjectURL(sc.blob),
            blob: sc.blob,
          };
        }
      }
      setRenderedMp4Map(map);
    });
    return () => {
      cancelled = true;
    };
  }, [result?.video.videoId]);

  const handleStopExtraction = () => {
    extractAbortRef.current?.abort();
    extractAbortRef.current = null;
    setIsLoading(false);
    setError(null);
    setDownloadNotice('Extraction stopped.');
  };

  const runExtraction = async (overrideUrl?: string) => {
    const targetUrl = (overrideUrl ?? url).trim();
    if (!targetUrl) return;

    if (overrideUrl) {
      setUrl(overrideUrl);
    }

    extractAbortRef.current?.abort();
    const controller = new AbortController();
    extractAbortRef.current = controller;

    setIsLoading(true);
    setError(null);
    setDownloadNotice(null);
    setReadyDownloadLink(null);
    setRenderError(null);
    setRenderStatusMessage(null);
    setActiveView('extractor');

    try {
      const res = await fetch('/api/extract-shorts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          url: targetUrl,
          clipCount,
          targetDuration,
          style,
          language,
          manualTranscript: manualTranscript.trim() || undefined,
        }),
      });

      const rawText = await res.text();
      let data: (ExtractionResult & { error?: string }) | null = null;
      try {
        data = JSON.parse(rawText) as ExtractionResult & { error?: string };
      } catch {
        data = null;
      }

      if (!res.ok || !data || data.error) {
        throw new Error(
          data?.error ||
            (res.status === 504 || res.status === 502
              ? 'Video analysis timed out on this length. Try again or paste the YouTube transcript for instant extraction.'
              : 'Failed to analyze YouTube link. Please try again.')
        );
      }

      setResult(data);
      setThumbError(false);
      setActiveClipId(data.clips[0]?.id ?? null);
      setSelectedIds(new Set(data.clips.map((c) => c.id)));
      setSearchQuery('');
      setAngleFilter('all');
      setSourceUploadId(null);
      setSourceFileName(null);

      await saveExtractionToStorage(data);
      setHistory((prev) => {
        const filtered = prev.filter(
          (item) => item.video.videoId !== data.video.videoId
        );
        return [data, ...filtered];
      });
    } catch (err) {
      if (
        controller.signal.aborted ||
        (err instanceof DOMException && err.name === 'AbortError')
      ) {
        setError(null);
        setDownloadNotice('Extraction stopped.');
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to extract Shorts from this YouTube URL.'
      );
    } finally {
      if (extractAbortRef.current === controller) {
        extractAbortRef.current = null;
      }
      setIsLoading(false);
    }
  };

  const handleLoadHistory = (item: ExtractionResult) => {
    setResult(item);
    setUrl(item.video.canonicalUrl);
    setThumbError(false);
    setActiveClipId(item.clips[0]?.id ?? null);
    setSelectedIds(new Set(item.clips.map((c) => c.id)));
    setError(null);
    setDownloadNotice(null);
    setSourceUploadId(null);
    setSourceFileName(null);
    setActiveView('extractor');
  };

  const handleUpdateClip = (updated: ShortClip) => {
    setResult((prev) => {
      if (!prev) return prev;
      const next: ExtractionResult = {
        ...prev,
        clips: prev.clips.map((c) => (c.id === updated.id ? updated : c)),
      };
      void saveExtractionToStorage(next);
      setHistory((h) =>
        h.map((item) => (item.video.videoId === next.video.videoId ? next : item))
      );
      return next;
    });
  };

  const handleStopMediaProcessing = () => {
    stopRenderFlagRef.current = true;
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    renderAbortRef.current?.abort();
    renderAbortRef.current = null;
    pendingSingleClipRef.current = null;
    setIsUploadingSource(false);
    setIsBatchRendering(false);
    setRenderingClipIds(new Set());
    setRenderError(null);
    setRenderStatusMessage('Processing stopped.');
  };

  const parseJsonSafe = async <T,>(res: Response): Promise<T | null> => {
    const raw = await res.text();
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };

  const uploadSourceVideoFile = async (file: File): Promise<string> => {
    uploadAbortRef.current?.abort();
    const controller = new AbortController();
    uploadAbortRef.current = controller;

    if (file.size > MAX_UPLOAD_BYTES) {
      const msg = 'Selected video exceeds the 1.5 GB upload limit.';
      setRenderError(msg);
      throw new Error(msg);
    }

    setIsUploadingSource(true);
    setRenderError(null);
    const totalMb = (file.size / (1024 * 1024)).toFixed(1);
    setRenderStatusMessage(`Starting upload: ${file.name} (${totalMb} MB)...`);

    try {
      const initRes = await fetch('/api/upload-init', {
        method: 'POST',
        signal: controller.signal,
      });
      const initData = await parseJsonSafe<{ uploadId?: string; error?: string }>(
        initRes
      );
      if (!initRes.ok || !initData?.uploadId) {
        throw new Error(initData?.error || 'Failed to initialize video upload.');
      }

      const uploadId = initData.uploadId;
      const CHUNK_SIZE = 8 * 1024 * 1024;
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

      for (let idx = 0; idx < totalChunks; idx++) {
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const start = idx * CHUNK_SIZE;
        const end = Math.min(file.size, start + CHUNK_SIZE);
        const chunkBlob = file.slice(start, end);
        const pct = Math.round(((idx + 1) / totalChunks) * 100);
        const uploadedMb = (end / (1024 * 1024)).toFixed(1);
        setRenderStatusMessage(
          `Uploading ${file.name}: ${pct}% (${uploadedMb} / ${totalMb} MB)...`
        );

        const chunkRes = await fetch(`/api/upload-chunk/${uploadId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          signal: controller.signal,
          body: chunkBlob,
        });
        const chunkData = await parseJsonSafe<{ error?: string }>(chunkRes);
        if (!chunkRes.ok) {
          throw new Error(
            chunkData?.error || `Failed uploading chunk ${idx + 1} of ${totalChunks}.`
          );
        }
      }

      const finishRes = await fetch(`/api/upload-finish/${uploadId}`, {
        method: 'POST',
        signal: controller.signal,
      });
      const finishData = await parseJsonSafe<{
        uploadId?: string;
        error?: string;
      }>(finishRes);
      if (!finishRes.ok || !finishData?.uploadId) {
        throw new Error(finishData?.error || 'Failed to finalize video upload.');
      }

      setSourceUploadId(uploadId);
      setSourceFileName(file.name);
      setRenderStatusMessage(
        `Video uploaded (${file.name}). Click Download Video on any clip to save its MP4.`
      );
      return uploadId;
    } catch (err) {
      if (
        controller.signal.aborted ||
        (err instanceof DOMException && err.name === 'AbortError')
      ) {
        setRenderStatusMessage('Video upload stopped.');
        throw err;
      }
      const msg =
        err instanceof Error ? err.message : 'Failed to upload source video.';
      setRenderError(msg);
      throw err;
    } finally {
      if (uploadAbortRef.current === controller) {
        uploadAbortRef.current = null;
      }
      setIsUploadingSource(false);
    }
  };

  const renderClipsOnServer = async (
    uploadId: string,
    clipsToRender: ShortClip[],
    autoSaveIndividual: boolean
  ) => {
    if (!result || clipsToRender.length === 0) return;

    stopRenderFlagRef.current = false;
    const ids = clipsToRender.map((c) => c.id);
    setRenderingClipIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    setRenderError(null);

    const newlyRendered: RenderedMp4Entry[] = [];
    let wasStopped = false;

    try {
      for (let i = 0; i < clipsToRender.length; i++) {
        if (stopRenderFlagRef.current) {
          wasStopped = true;
          break;
        }

        const clip = clipsToRender[i];
        const controller = new AbortController();
        renderAbortRef.current = controller;

        setRenderStatusMessage(
          clipsToRender.length === 1
            ? `Cutting Short ${clip.clipNumber} (${clip.durationSeconds}s 9:16 MP4)...`
            : `Cutting clip ${i + 1} of ${clipsToRender.length} — Short ${clip.clipNumber} (${clip.durationSeconds}s MP4)...`
        );

        const renderRes = await fetch('/api/render-mp4-clips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            uploadId,
            clips: [
              {
                id: clip.id,
                clipNumber: clip.clipNumber,
                title: clip.title,
                startSeconds: clip.startSeconds,
                durationSeconds: clip.durationSeconds,
              },
            ],
          }),
        });

        const renderData = await parseJsonSafe<{
          rendered?: Array<{
            clipId: string;
            clipNumber: number;
            title: string;
            filename: string;
            durationSeconds: number;
            sizeBytes: number;
            downloadUrl: string;
          }>;
          error?: string;
        }>(renderRes);

        if (!renderRes.ok || !renderData?.rendered) {
          throw new Error(renderData?.error || 'FFmpeg clip cutting failed.');
        }

        for (const item of renderData.rendered) {
          if (stopRenderFlagRef.current) {
            wasStopped = true;
            break;
          }
          const clipRes = await fetch(item.downloadUrl, {
            signal: controller.signal,
          });
          if (!clipRes.ok) continue;
          const blob = await clipRes.blob();
          const blobUrl = URL.createObjectURL(blob);

          await saveRenderedMp4Clip({
            key: `${result.video.videoId}::${item.clipId}`,
            videoId: result.video.videoId,
            clipId: item.clipId,
            clipNumber: item.clipNumber,
            title: item.title,
            filename: item.filename,
            durationSeconds: item.durationSeconds,
            sizeBytes: item.sizeBytes,
            blob,
            savedAt: new Date().toISOString(),
          });

          const entry: RenderedMp4Entry = {
            clipId: item.clipId,
            clipNumber: item.clipNumber,
            title: item.title,
            filename: item.filename,
            durationSeconds: item.durationSeconds,
            sizeBytes: item.sizeBytes,
            blobUrl,
            serverDownloadUrl: item.downloadUrl,
            blob,
          };

          newlyRendered.push(entry);

          setRenderedMp4Map((prev) => ({
            ...prev,
            [entry.clipId]: entry,
          }));
        }

        setRenderingClipIds((prev) => {
          const next = new Set(prev);
          next.delete(clip.id);
          return next;
        });
      }

      if (wasStopped || stopRenderFlagRef.current) {
        const msg =
          newlyRendered.length > 0
            ? `Stopped. Saved ${newlyRendered.length} completed MP4 clip(s) to My Storage.`
            : 'Processing stopped.';
        setRenderStatusMessage(msg);
        return;
      }

      if (newlyRendered.length === 1 && autoSaveIndividual) {
        const dlUrl =
          newlyRendered[0].serverDownloadUrl || newlyRendered[0].blobUrl;
        triggerDirectDownload(dlUrl, newlyRendered[0].filename);
        setReadyDownloadLink({
          url: dlUrl,
          filename: newlyRendered[0].filename,
          label: 'Save .MP4 Now',
        });
        const msg = `Saved ${newlyRendered[0].filename} to My Storage & ready to download.`;
        setRenderStatusMessage(msg);
        setDownloadNotice(msg);
      } else if (newlyRendered.length > 1) {
        if (autoDownload) {
          const entries = await Promise.all(
            newlyRendered.map(async (item) => ({
              name: item.filename,
              content: new Uint8Array(await item.blob.arrayBuffer()),
            }))
          );
          const zipBlob = buildZipBlob(entries);
          const zipUrl = URL.createObjectURL(zipBlob);
          const zipName = `ClipCut_${result.video.videoId}_MP4_Shorts.zip`;
          triggerDirectDownload(zipUrl, zipName);
          setReadyDownloadLink({
            url: zipUrl,
            filename: zipName,
            label: 'Download ZIP Now',
          });
          window.setTimeout(() => URL.revokeObjectURL(zipUrl), 60_000);
          const msg = `Saved ${newlyRendered.length} MP4 clips to My Storage & prepared ${zipName}.`;
          setRenderStatusMessage(msg);
          setDownloadNotice(msg);
        } else {
          const msg = `Saved ${newlyRendered.length} MP4 clips to My Storage.`;
          setRenderStatusMessage(msg);
          setDownloadNotice(msg);
        }
      }
    } catch (err) {
      if (
        stopRenderFlagRef.current ||
        (err instanceof DOMException && err.name === 'AbortError')
      ) {
        const msg =
          newlyRendered.length > 0
            ? `Stopped. Saved ${newlyRendered.length} completed MP4 clip(s) to My Storage.`
            : 'Processing stopped.';
        setRenderStatusMessage(msg);
        setRenderError(null);
        return;
      }
      setRenderError(
        err instanceof Error ? err.message : 'Unable to cut MP4 clip.'
      );
    } finally {
      renderAbortRef.current = null;
      setRenderingClipIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  const handleDownloadSingleClipMp4 = async (clip: ShortClip) => {
    const existing = renderedMp4Map[clip.id];
    if (existing) {
      setDownloadNotice(
        `Downloaded ${existing.filename} to your device storage.`
      );
      return;
    }

    if (sourceUploadId) {
      await renderClipsOnServer(sourceUploadId, [clip], true);
    } else {
      setActiveClipId(clip.id);
      setOpenDownloadDrawerNonce((n) => n + 1);
    }
  };

  const handleCutFromDirectUrl = async (sourceUrl: string, clip: ShortClip) => {
    if (!result) return;
    stopRenderFlagRef.current = false;
    const controller = new AbortController();
    renderAbortRef.current = controller;

    setRenderingClipIds((prev) => {
      const next = new Set(prev);
      next.add(clip.id);
      return next;
    });
    setRenderError(null);
    setRenderStatusMessage(
      `Cutting Short ${clip.clipNumber} (${clip.durationSeconds}s MP4) from URL...`
    );

    try {
      const renderRes = await fetch('/api/render-from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          sourceUrl,
          clip: {
            id: clip.id,
            clipNumber: clip.clipNumber,
            title: clip.title,
            startSeconds: clip.startSeconds,
            durationSeconds: clip.durationSeconds,
          },
        }),
      });

      const renderData = await parseJsonSafe<{
        rendered?: Array<{
          clipId: string;
          clipNumber: number;
          title: string;
          filename: string;
          durationSeconds: number;
          sizeBytes: number;
          downloadUrl: string;
        }>;
        error?: string;
      }>(renderRes);

      if (!renderRes.ok || !renderData?.rendered?.[0]) {
        throw new Error(
          renderData?.error || 'Could not cut MP4 from that direct URL.'
        );
      }

      const item = renderData.rendered[0];
      const clipRes = await fetch(item.downloadUrl, { signal: controller.signal });
      if (!clipRes.ok) {
        throw new Error('Failed to fetch rendered MP4 clip.');
      }
      const blob = await clipRes.blob();
      const blobUrl = URL.createObjectURL(blob);

      await saveRenderedMp4Clip({
        key: `${result.video.videoId}::${item.clipId}`,
        videoId: result.video.videoId,
        clipId: item.clipId,
        clipNumber: item.clipNumber,
        title: item.title,
        filename: item.filename,
        durationSeconds: item.durationSeconds,
        sizeBytes: item.sizeBytes,
        blob,
        savedAt: new Date().toISOString(),
      });

      const entry: RenderedMp4Entry = {
        clipId: item.clipId,
        clipNumber: item.clipNumber,
        title: item.title,
        filename: item.filename,
        durationSeconds: item.durationSeconds,
        sizeBytes: item.sizeBytes,
        blobUrl,
        serverDownloadUrl: item.downloadUrl,
        blob,
      };

      setRenderedMp4Map((prev) => ({
        ...prev,
        [entry.clipId]: entry,
      }));

      const dlUrl = item.downloadUrl || blobUrl;
      triggerDirectDownload(dlUrl, item.filename);
      setReadyDownloadLink({
        url: dlUrl,
        filename: item.filename,
        label: 'Save .MP4 Now',
      });
      const msg = `Saved ${item.filename} to My Storage & ready to download.`;
      setRenderStatusMessage(msg);
      setDownloadNotice(msg);
    } catch (err) {
      if (
        stopRenderFlagRef.current ||
        (err instanceof DOMException && err.name === 'AbortError')
      ) {
        setRenderStatusMessage('Processing stopped.');
        setRenderError(null);
        return;
      }
      setRenderError(
        err instanceof Error ? err.message : 'Unable to cut clip from URL.'
      );
    } finally {
      renderAbortRef.current = null;
      setRenderingClipIds((prev) => {
        const next = new Set(prev);
        next.delete(clip.id);
        return next;
      });
    }
  };

  const handleAttachSourceAndCutClip = async (file: File, clip: ShortClip) => {
    try {
      const uploadId = await uploadSourceVideoFile(file);
      await renderClipsOnServer(uploadId, [clip], true);
    } catch {
      // Error or stop message set in uploadSourceVideoFile
    }
  };

  const handleUploadSourceAndCutSelected = async (file: File) => {
    if (!result) return;
    const singleClip = pendingSingleClipRef.current;
    pendingSingleClipRef.current = null;

    try {
      const uploadId = await uploadSourceVideoFile(file);
      if (singleClip) {
        await renderClipsOnServer(uploadId, [singleClip], true);
        return;
      }
      if (autoDownload) {
        setIsBatchRendering(true);
        const clipsToCut =
          selectedIds.size > 0
            ? result.clips.filter((c) => selectedIds.has(c.id))
            : result.clips;
        await renderClipsOnServer(uploadId, clipsToCut, false);
        setIsBatchRendering(false);
      }
    } catch {
      setIsBatchRendering(false);
    }
  };

  const handleBatchRenderAll = async () => {
    if (!result || !sourceUploadId) return;
    setIsBatchRendering(true);
    try {
      const clipsToCut =
        selectedIds.size > 0
          ? result.clips.filter((c) => selectedIds.has(c.id))
          : result.clips;
      await renderClipsOnServer(sourceUploadId, clipsToCut, false);
    } finally {
      setIsBatchRendering(false);
    }
  };

  const handleDownloadAllRenderedZip = async () => {
    if (!result) return;
    const list = result.clips
      .map((c) => renderedMp4Map[c.id])
      .filter((item): item is RenderedMp4Entry => Boolean(item));
    if (!list.length) return;
    const entries = await Promise.all(
      list.map(async (item) => ({
        name: item.filename,
        content: new Uint8Array(await item.blob.arrayBuffer()),
      }))
    );
    const zipBlob = buildZipBlob(entries);
    const zipUrl = URL.createObjectURL(zipBlob);
    const zipName = `ClipCut_${result.video.videoId}_MP4_Shorts.zip`;
    triggerDirectDownload(zipUrl, zipName);
    setReadyDownloadLink({
      url: zipUrl,
      filename: zipName,
      label: 'Download ZIP Now',
    });
    window.setTimeout(() => URL.revokeObjectURL(zipUrl), 60_000);
    setDownloadNotice(`Prepared ${zipName} (${list.length} MP4 clips).`);
  };

  const toggleSelectClip = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const angles = useMemo(() => {
    if (!result) return [];
    return Array.from(new Set(result.clips.map((c) => c.corporateAngle)));
  }, [result]);

  const filteredClips = useMemo(() => {
    if (!result) return [];
    return result.clips.filter((clip) => {
      const matchesAngle =
        angleFilter === 'all' || clip.corporateAngle === angleFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !q ||
        clip.title.toLowerCase().includes(q) ||
        clip.hookText.toLowerCase().includes(q) ||
        clip.whyItWorks.toLowerCase().includes(q);
      return matchesAngle && matchesQuery;
    });
  }, [result, angleFilter, searchQuery]);

  const activeClip = useMemo(() => {
    if (!result) return null;
    return (
      result.clips.find((c) => c.id === activeClipId) ??
      result.clips[0] ??
      null
    );
  }, [result, activeClipId]);

  const handleHeaderAction = () => {
    extractAbortRef.current?.abort();
    uploadAbortRef.current?.abort();
    renderAbortRef.current?.abort();
    stopRenderFlagRef.current = true;
    pendingSingleClipRef.current = null;

    if (result) {
      setIsLoading(false);
      setIsUploadingSource(false);
      setIsBatchRendering(false);
      setRenderingClipIds(new Set());
      setResult(null);
      setUrl('');
      setError(null);
      setDownloadNotice(null);
      setReadyDownloadLink(null);
      setRenderError(null);
      setRenderStatusMessage(null);
      setActiveClipId(null);
      setSourceUploadId(null);
      setSourceFileName(null);
      setActiveView('extractor');
    } else {
      void runExtraction(SAMPLE_VIDEOS[0].url);
    }
  };

  return (
    <div id="top" className="min-h-screen bg-slate-50 text-slate-900">
      <Header
        activeView={activeView}
        onSelectView={setActiveView}
        hasResults={Boolean(result)}
        onPrimaryAction={handleHeaderAction}
      />

      <VideoInputBar
        url={url}
        onUrlChange={setUrl}
        manualTranscript={manualTranscript}
        onManualTranscriptChange={setManualTranscript}
        showTranscriptBox={showTranscriptBox}
        onToggleTranscriptBox={() => setShowTranscriptBox((v) => !v)}
        autoDownload={autoDownload}
        onAutoDownloadChange={setAutoDownload}
        clipCount={clipCount}
        onClipCountChange={setClipCount}
        targetDuration={targetDuration}
        onTargetDurationChange={setTargetDuration}
        style={style}
        onStyleChange={setStyle}
        language={language}
        onLanguageChange={setLanguage}
        isLoading={isLoading}
        onSubmit={() => void runExtraction()}
        onStopExtraction={handleStopExtraction}
      />

      {downloadNotice && !error && (
        <div className="mx-auto max-w-[1440px] px-6 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
              <span className="font-medium">{downloadNotice}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {readyDownloadLink && (
                <a
                  href={readyDownloadLink.url}
                  download={readyDownloadLink.filename}
                  rel="noopener"
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" />
                  {readyDownloadLink.label}
                </a>
              )}
              <button
                type="button"
                onClick={() => setActiveView('saved-storage')}
                className="font-semibold text-emerald-900 underline underline-offset-2 hover:text-emerald-700"
              >
                Open My Storage
              </button>
              <button
                type="button"
                onClick={() => {
                  setDownloadNotice(null);
                  setReadyDownloadLink(null);
                }}
                className="text-emerald-700 hover:text-emerald-950"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mx-auto max-w-[1440px] px-6 pt-5">
          <div
            role="alert"
            className="flex flex-col justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 sm:flex-row sm:items-center"
          >
            <div className="flex items-start gap-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <div>
                <p className="font-semibold">Extraction failed</p>
                <p className="mt-0.5 text-xs text-rose-800">{error}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => void runExtraction()}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => setShowTranscriptBox(true)}
                className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-900 hover:bg-rose-100"
              >
                Paste Transcript
              </button>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-xs font-medium text-rose-700 hover:text-rose-950"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      <main>
        {activeView === 'workflow' ? (
          <div className="mx-auto max-w-[1440px] px-6 py-10">
            <div className="max-w-3xl space-y-8">
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-950">
                  Corporate Shorts Workflow
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  ClipCut Studio structures long-form YouTube talks into 8–10 self-contained ~53-second vertical Shorts tailored for LinkedIn, YouTube Shorts, and corporate channels.
                </p>
              </div>

              <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                <div className="p-6">
                  <span className="font-mono text-xs font-semibold text-rose-600 tabular-nums">
                    01. Segment Selection (~53 Seconds)
                  </span>
                  <h2 className="mt-1 text-base font-semibold text-slate-950">
                    Why 53 seconds is the sweet spot
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                    Targeting 53 seconds keeps every clip safely under YouTube’s 60-second Shorts limit while leaving room for a 3-second opening hook, one complete corporate argument, and a clean closing beat.
                  </p>
                </div>
                <div className="p-6">
                  <span className="font-mono text-xs font-semibold text-rose-600 tabular-nums">
                    02. 9:16 Preview &amp; Direct MP4 Download
                  </span>
                  <h2 className="mt-1 text-base font-semibold text-slate-950">
                    Cut and auto-save real vertical MP4 clips
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                    Click Download Video right beneath the preview player (or attach your video file once) to cut 720×1280 9:16 MP4 clips, store them offline in My Storage, and save directly to your device.
                  </p>
                </div>
                <div className="p-6">
                  <span className="font-mono text-xs font-semibold text-rose-600 tabular-nums">
                    03. Local 1080×1920 Batch Rendering
                  </span>
                  <h2 className="mt-1 text-base font-semibold text-slate-950">
                    One-click yt-dlp + FFmpeg cut script
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                    Use the Batch FFmpeg tab if you prefer running a local terminal script that downloads the YouTube stream once and renders all checked Shorts into 1080×1920 MP4 files.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : isLoading ? (
          <div className="mx-auto max-w-[1440px] px-6 py-8">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-2">
                  <div className="h-4 w-72 animate-pulse rounded bg-slate-200" />
                  <div className="h-3 w-48 animate-pulse rounded bg-slate-100" />
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-slate-600">
                    Analyzing video timeline &amp; mapping {clipCount} × {targetDuration}s corporate Shorts...
                  </span>
                  <button
                    type="button"
                    onClick={handleStopExtraction}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Square className="h-3 w-3 fill-current" />
                    Stop
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-12">
              <div className="space-y-2 lg:col-span-5">
                {Array.from({ length: 8 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="h-20 animate-pulse rounded-xl border border-slate-200 bg-white p-4"
                  />
                ))}
              </div>
              <div className="grid gap-6 lg:col-span-7 md:grid-cols-12">
                <div className="h-[520px] animate-pulse rounded-xl border border-slate-200 bg-white md:col-span-5" />
                <div className="h-[520px] animate-pulse rounded-xl border border-slate-200 bg-white md:col-span-7" />
              </div>
            </div>
          </div>
        ) : activeView === 'cut-sheet' ? (
          <CutSheetView
            result={result}
            onInspectClip={(clipId) => {
              setActiveClipId(clipId);
              setActiveView('extractor');
            }}
          />
        ) : activeView === 'batch-export' ? (
          <BatchExportView result={result} selectedIds={selectedIds} />
        ) : activeView === 'saved-storage' ? (
          <SavedStorageView
            items={history}
            onLoadItem={handleLoadHistory}
            onDeleteItem={(videoId) => {
              void deleteSavedExtraction(videoId).then(() => {
                setHistory((prev) =>
                  prev.filter((item) => item.video.videoId !== videoId)
                );
              });
            }}
            onClearAll={() => {
              void clearAllSavedExtractions().then(() => {
                setHistory([]);
              });
            }}
          />
        ) : !result ? (
          <EmptyWorkspace
            onSelectSample={(sampleUrl) => void runExtraction(sampleUrl)}
            history={history}
            onLoadHistory={handleLoadHistory}
          />
        ) : (
          <div className="mx-auto max-w-[1440px] px-6 py-6">
            <input
              ref={topFileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void handleUploadSourceAndCutSelected(file);
                }
                e.target.value = '';
              }}
            />

            {/* Source Video Strip */}
            <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 items-center gap-4">
                {!thumbError ? (
                  <img
                    src={result.video.thumbnailUrl}
                    alt={result.video.title}
                    referrerPolicy="no-referrer"
                    onError={() => setThumbError(true)}
                    className="h-14 w-24 shrink-0 rounded-lg border border-slate-200 object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-xs font-medium text-slate-500">
                    YouTube
                  </div>
                )}
                <div className="min-w-0">
                  <h1 className="truncate font-display text-base font-bold text-slate-950">
                    {result.video.title}
                  </h1>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{result.video.channelName}</span>
                    {result.video.durationSeconds && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {formatMmSs(result.video.durationSeconds)} total
                        </span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-slate-700 tabular-nums">
                      {result.clips.length} Shorts extracted
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {result.video.analysisMethod === 'manual-transcript'
                        ? 'Analyzed via Pasted Transcript'
                        : result.video.analysisMethod === 'transcript'
                          ? 'Synced via Timed Transcript'
                          : 'Analyzed via Video Stream'}
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={isUploadingSource || isBatchRendering}
                  onClick={() => {
                    pendingSingleClipRef.current = null;
                    topFileInputRef.current?.click();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60 whitespace-nowrap shrink-0"
                >
                  {isUploadingSource || isBatchRendering ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  {isUploadingSource
                    ? 'Uploading Video...'
                    : isBatchRendering
                      ? 'Cutting MP4s...'
                      : sourceUploadId
                        ? 'Change Uploaded Video'
                        : 'Upload Video & Cut MP4s'}
                </button>

                {sourceUploadId && (
                  <button
                    type="button"
                    disabled={isBatchRendering}
                    onClick={() => void handleBatchRenderAll()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0"
                  >
                    <Film className="h-3.5 w-3.5" />
                    Cut All ({selectedIds.size || result.clips.length}) MP4s
                  </button>
                )}

                {(isUploadingSource ||
                  isBatchRendering ||
                  renderingClipIds.size > 0) && (
                  <button
                    type="button"
                    onClick={handleStopMediaProcessing}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Square className="h-3 w-3 fill-current" />
                    Stop
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setActiveView('saved-storage')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  My Storage
                </button>
              </div>
            </div>

            {/* Main 2-Column Studio Grid */}
            <div className="mt-6 grid items-start gap-6 lg:grid-cols-12">
              {/* Left Queue: 8-10 Extracted Shorts */}
              <aside className="rounded-xl border border-slate-200 bg-white lg:col-span-5">
                <div className="border-b border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-slate-950">
                      Extracted Shorts ({filteredClips.length})
                    </h2>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedIds.size === result.clips.length) {
                          setSelectedIds(new Set());
                        } else {
                          setSelectedIds(new Set(result.clips.map((c) => c.id)));
                        }
                      }}
                      className="text-xs font-medium text-slate-600 hover:text-slate-950"
                    >
                      {selectedIds.size === result.clips.length
                        ? 'Uncheck all'
                        : 'Select all'}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Filter hooks or topics..."
                        aria-label="Filter extracted Shorts"
                        className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
                      />
                    </div>
                    <select
                      value={angleFilter}
                      onChange={(e) => setAngleFilter(e.target.value)}
                      aria-label="Filter by corporate angle"
                      className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 focus:border-slate-900 focus:outline-none"
                    >
                      <option value="all">All angles</option>
                      {angles.map((angle) => (
                        <option key={angle} value={angle}>
                          {angle}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="max-h-[680px] divide-y divide-slate-100 overflow-y-auto">
                  {filteredClips.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500">
                      No Shorts match your current filter.
                    </div>
                  ) : (
                    filteredClips.map((clip) => {
                      const isActive = activeClip?.id === clip.id;
                      const isChecked = selectedIds.has(clip.id);
                      const isClipRendering = renderingClipIds.has(clip.id);
                      const hasRenderedMp4 = Boolean(renderedMp4Map[clip.id]);
                      return (
                        <div
                          key={clip.id}
                          className={`flex items-start gap-3 px-4 py-3.5 transition-colors ${
                            isActive ? 'bg-rose-50/50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleSelectClip(clip.id)}
                            aria-label={`Select Short ${clip.clipNumber} for batch export`}
                            className="mt-0.5 shrink-0 text-slate-400 hover:text-slate-800"
                          >
                            {isChecked ? (
                              <CheckSquare className="h-4 w-4 text-slate-900" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => setActiveClipId(clip.id)}
                            className="min-w-0 flex-1 text-left focus-visible:outline-none"
                          >
                            <div className="flex items-center gap-2 text-[11px] text-slate-500">
                              <span
                                className={`font-mono font-semibold tabular-nums ${
                                  isActive ? 'text-rose-600' : 'text-slate-400'
                                }`}
                              >
                                {String(clip.clipNumber).padStart(2, '0')}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                {clip.startTime} – {clip.endTime}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono font-semibold text-slate-800 tabular-nums">
                                {clip.durationSeconds}s
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="truncate">
                                {clip.corporateAngle}
                              </span>
                            </div>

                            <p className="mt-1 truncate text-sm font-semibold text-slate-950">
                              {clip.title}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-slate-600">
                              {clip.hookText}
                            </p>
                          </button>

                          {hasRenderedMp4 ? (
                            <a
                              href={
                                renderedMp4Map[clip.id].serverDownloadUrl ||
                                renderedMp4Map[clip.id].blobUrl
                              }
                              download={renderedMp4Map[clip.id].filename}
                              rel="noopener"
                              onClick={() =>
                                setDownloadNotice(
                                  `Downloaded ${renderedMp4Map[clip.id].filename} to your device storage.`
                                )
                              }
                              aria-label={`Save Short ${clip.clipNumber} MP4`}
                              className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 whitespace-nowrap"
                            >
                              <Download className="h-3 w-3" />
                              Save MP4
                            </a>
                          ) : (
                            <button
                              type="button"
                              disabled={isClipRendering || isUploadingSource}
                              onClick={() =>
                                void handleDownloadSingleClipMp4(clip)
                              }
                              aria-label={`Download Short ${clip.clipNumber} MP4`}
                              className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:border-rose-200 hover:text-rose-600 disabled:opacity-50 whitespace-nowrap"
                            >
                              {isClipRendering ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Download className="h-3 w-3" />
                              )}
                              MP4
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </aside>

              {/* Right Stage: 9:16 Preview + Clip Inspector */}
              {activeClip && (
                <div className="grid items-start gap-6 lg:col-span-7 md:grid-cols-12">
                  <div className="md:col-span-5">
                    <PreviewStage
                      videoId={result.video.videoId}
                      canonicalUrl={result.video.canonicalUrl}
                      thumbnailUrl={result.video.thumbnailUrl}
                      clip={activeClip}
                      renderedMp4Url={
                        renderedMp4Map[activeClip.id]?.blobUrl ?? null
                      }
                      renderedMp4DownloadUrl={
                        renderedMp4Map[activeClip.id]?.serverDownloadUrl ?? null
                      }
                      renderedMp4Filename={
                        renderedMp4Map[activeClip.id]?.filename ?? null
                      }
                      isRenderingMp4={renderingClipIds.has(activeClip.id)}
                      hasSourceVideo={Boolean(sourceUploadId)}
                      isUploadingSource={isUploadingSource}
                      openDownloadDrawerNonce={openDownloadDrawerNonce}
                      onDownloadMp4={(clip) =>
                        void handleDownloadSingleClipMp4(clip)
                      }
                      onAttachSourceAndCut={(file, clip) =>
                        void handleAttachSourceAndCutClip(file, clip)
                      }
                      onCutFromDirectUrl={(srcUrl, clip) =>
                        void handleCutFromDirectUrl(srcUrl, clip)
                      }
                      onStopRender={handleStopMediaProcessing}
                    />
                  </div>
                  <div className="md:col-span-7">
                    <ClipInspector
                      clip={activeClip}
                      canonicalUrl={result.video.canonicalUrl}
                      videoTitle={result.video.title}
                      maxDurationSeconds={result.video.durationSeconds}
                      style={result.style}
                      language={result.language}
                      targetDuration={result.targetDuration}
                      onUpdateClip={handleUpdateClip}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6">
              <Mp4RenderPanel
                result={result}
                selectedIds={selectedIds}
                sourceFileName={sourceFileName}
                hasSourceUpload={Boolean(sourceUploadId)}
                isUploadingSource={isUploadingSource}
                isBatchRendering={isBatchRendering}
                renderStatusMessage={renderStatusMessage}
                renderError={renderError}
                renderedMap={renderedMp4Map}
                onUploadSource={(file) =>
                  void handleUploadSourceAndCutSelected(file)
                }
                onBatchRenderAll={() => void handleBatchRenderAll()}
                onDownloadSingleMp4={(clip) =>
                  void handleDownloadSingleClipMp4(clip)
                }
                onDownloadAllMp4Zip={() => void handleDownloadAllRenderedZip()}
                onStopProcessing={handleStopMediaProcessing}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
