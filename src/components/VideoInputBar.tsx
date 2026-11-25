import {
  ClipboardPaste,
  Download,
  FileText,
  Link2,
  Loader2,
  Scissors,
  Square,
  X,
} from 'lucide-react';
import type { ExtractionStyle, OutputLanguage } from '../types';

interface VideoInputBarProps {
  url: string;
  onUrlChange: (value: string) => void;
  manualTranscript: string;
  onManualTranscriptChange: (value: string) => void;
  showTranscriptBox: boolean;
  onToggleTranscriptBox: () => void;
  autoDownload: boolean;
  onAutoDownloadChange: (enabled: boolean) => void;
  clipCount: number;
  onClipCountChange: (count: number) => void;
  targetDuration: number;
  onTargetDurationChange: (seconds: number) => void;
  style: ExtractionStyle;
  onStyleChange: (style: ExtractionStyle) => void;
  language: OutputLanguage;
  onLanguageChange: (lang: OutputLanguage) => void;
  isLoading: boolean;
  onSubmit: () => void;
  onStopExtraction: () => void;
}

export function VideoInputBar({
  url,
  onUrlChange,
  manualTranscript,
  onManualTranscriptChange,
  showTranscriptBox,
  onToggleTranscriptBox,
  autoDownload,
  onAutoDownloadChange,
  clipCount,
  onClipCountChange,
  targetDuration,
  onTargetDurationChange,
  style,
  onStyleChange,
  language,
  onLanguageChange,
  isLoading,
  onSubmit,
  onStopExtraction,
}: VideoInputBarProps) {
  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        onUrlChange(text.trim());
      }
    } catch {
      // Clipboard read permission denied; user can paste directly with Ctrl/Cmd+V
    }
  };

  return (
    <section
      aria-label="YouTube link extractor controls"
      className="border-b border-slate-200 bg-white"
    >
      <div className="mx-auto max-w-[1440px] px-6 py-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Link2
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
              <input
                type="url"
                value={url}
                onChange={(e) => onUrlChange(e.target.value)}
                placeholder="Paste any YouTube link (youtube.com/watch?v=... or youtu.be/...)"
                aria-label="YouTube video URL"
                disabled={isLoading}
                className="h-11 w-full rounded-lg border border-slate-300 bg-slate-50/60 pl-10 pr-24 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-slate-900 focus:bg-white focus:outline-none disabled:opacity-60"
              />
              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                {url && !isLoading && (
                  <button
                    type="button"
                    onClick={() => onUrlChange('')}
                    aria-label="Clear YouTube link"
                    className="rounded p-1.5 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handlePasteClipboard}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <ClipboardPaste className="h-3.5 w-3.5 text-slate-500" />
                  Paste
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="submit"
                disabled={isLoading || !url.trim()}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-rose-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-300 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Extracting Shorts...
                  </>
                ) : (
                  <>
                    <Scissors className="h-4 w-4" />
                    Extract {clipCount} Shorts
                  </>
                )}
              </button>

              {isLoading && (
                <button
                  type="button"
                  onClick={onStopExtraction}
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-slate-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  Stop
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-slate-600">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-700">Clips</span>
                <div className="flex items-center rounded-md border border-slate-200 bg-slate-50 p-0.5">
                  {[8, 9, 10].map((num) => (
                    <button
                      key={num}
                      type="button"
                      disabled={isLoading}
                      onClick={() => onClipCountChange(num)}
                      className={`rounded px-2.5 py-1 font-mono text-xs tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                        clipCount === num
                          ? 'bg-white font-semibold text-slate-950 shadow-xs'
                          : 'text-slate-600 hover:text-slate-950'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-700">Target Length</span>
                <div className="flex items-center rounded-md border border-slate-200 bg-slate-50 p-0.5">
                  {[45, 53, 58].map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      disabled={isLoading}
                      onClick={() => onTargetDurationChange(sec)}
                      className={`rounded px-2.5 py-1 font-mono text-xs tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                        targetDuration === sec
                          ? 'bg-white font-semibold text-slate-950 shadow-xs'
                          : 'text-slate-600 hover:text-slate-950'
                      }`}
                    >
                      {sec}s
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <label
                  htmlFor="style-select"
                  className="font-medium text-slate-700"
                >
                  Tone
                </label>
                <select
                  id="style-select"
                  value={style}
                  disabled={isLoading}
                  onChange={(e) =>
                    onStyleChange(e.target.value as ExtractionStyle)
                  }
                  className="h-7 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-900 focus:border-slate-900 focus:outline-none"
                >
                  <option value="corporate">Corporate Short</option>
                  <option value="executive">Executive Brief</option>
                  <option value="educational">Educational Breakdown</option>
                  <option value="podcast">Podcast Highlight</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label
                  htmlFor="lang-select"
                  className="font-medium text-slate-700"
                >
                  Hooks &amp; Captions
                </label>
                <select
                  id="lang-select"
                  value={language}
                  disabled={isLoading}
                  onChange={(e) =>
                    onLanguageChange(e.target.value as OutputLanguage)
                  }
                  className="h-7 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-900 focus:border-slate-900 focus:outline-none"
                >
                  <option value="english">English</option>
                  <option value="hinglish">Hinglish</option>
                  <option value="hindi">Hindi</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={autoDownload}
                onClick={() => onAutoDownloadChange(!autoDownload)}
                disabled={isLoading}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  autoDownload
                    ? 'border-emerald-700 bg-emerald-700 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:text-slate-950'
                }`}
              >
                <Download className="h-3.5 w-3.5" />
                {autoDownload ? 'Auto-Save MP4s: On' : 'Auto-Save MP4s: Off'}
              </button>

              <button
                type="button"
                onClick={onToggleTranscriptBox}
                disabled={isLoading}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  showTranscriptBox || manualTranscript.trim()
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:text-slate-950'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                {manualTranscript.trim()
                  ? 'Transcript Attached'
                  : 'Paste Transcript (Optional)'}
              </button>
            </div>
          </div>

          {showTranscriptBox && (
            <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-slate-700">
                  Optional: Paste YouTube transcript (for 1–2 hour podcasts or instant extraction)
                </span>
                {manualTranscript && (
                  <button
                    type="button"
                    onClick={() => onManualTranscriptChange('')}
                    className="text-slate-500 hover:text-slate-900"
                  >
                    Clear transcript
                  </button>
                )}
              </div>
              <textarea
                rows={4}
                value={manualTranscript}
                onChange={(e) => onManualTranscriptChange(e.target.value)}
                placeholder="Paste YouTube timestamps + transcript here (e.g. from YouTube → Show transcript)..."
                disabled={isLoading}
                className="w-full rounded-md border border-slate-200 bg-white p-2.5 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
              />
            </div>
          )}
        </form>
      </div>
    </section>
  );
}
