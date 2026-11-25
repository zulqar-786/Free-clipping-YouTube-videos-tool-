import { ArrowUpRight, Clock, Film, History, Play } from 'lucide-react';
import type { ExtractionResult } from '../types';

export interface SampleVideoPreset {
  title: string;
  channel: string;
  durationLabel: string;
  url: string;
  angle: string;
}

export const SAMPLE_VIDEOS: SampleVideoPreset[] = [
  {
    title: 'Grit: The Power of Passion and Perseverance',
    channel: 'Angela Lee Duckworth · TED',
    durationLabel: '06:12',
    url: 'https://www.youtube.com/watch?v=H14bBuluwB8',
    angle: 'Leadership Mindset',
  },
  {
    title: 'How to Speak So That People Want to Listen',
    channel: 'Julian Treasure · TED',
    durationLabel: '09:58',
    url: 'https://www.youtube.com/watch?v=eIho2S0ZahI',
    angle: 'Executive Presence',
  },
  {
    title: 'Inside the Mind of a Master Procrastinator',
    channel: 'Tim Urban · TED',
    durationLabel: '14:03',
    url: 'https://www.youtube.com/watch?v=arj7oStGLkU',
    angle: 'Productivity & Focus',
  },
];

interface EmptyWorkspaceProps {
  onSelectSample: (url: string) => void;
  history: ExtractionResult[];
  onLoadHistory: (item: ExtractionResult) => void;
}

export function EmptyWorkspace({
  onSelectSample,
  history,
  onLoadHistory,
}: EmptyWorkspaceProps) {
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-10">
      <div className="grid gap-10 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <p className="text-xs font-medium text-rose-600">
            YouTube to 53-Second Corporate Shorts
          </p>
          <h1 className="mt-2 max-w-2xl font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl [text-wrap:balance]">
            Turn one long-form YouTube link into 8 to 10 corporate-ready Shorts
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600">
            Paste any podcast, keynote, interview, or webinar link above. ClipCut Studio scans the timeline, extracts 8–10 self-contained ~53-second segments with executive hooks, timed captions, and ready-to-run 9:16 FFmpeg cut scripts.
          </p>

          <div className="mt-8 grid gap-6 border-t border-slate-200 pt-8 sm:grid-cols-3">
            <div>
              <span className="font-mono text-xs font-semibold text-slate-400 tabular-nums">
                01
              </span>
              <h2 className="mt-1.5 text-sm font-semibold text-slate-950">
                Paste YouTube Link
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Works with standard watch URLs, live streams, and shortened youtu.be links.
              </p>
            </div>
            <div>
              <span className="font-mono text-xs font-semibold text-slate-400 tabular-nums">
                02
              </span>
              <h2 className="mt-1.5 text-sm font-semibold text-slate-950">
                8–10 × 53s Corporate Cuts
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Finds complete problem-to-insight arcs sized cleanly under the 60s Shorts ceiling.
              </p>
            </div>
            <div>
              <span className="font-mono text-xs font-semibold text-slate-400 tabular-nums">
                03
              </span>
              <h2 className="mt-1.5 text-sm font-semibold text-slate-950">
                Preview &amp; Export
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Inspect each cut in a 9:16 frame, fine-tune trim bounds, and export .SRT or batch FFmpeg scripts.
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-sm font-semibold text-slate-950">
                Test with a Public Business Talk
              </h2>
              <span className="text-xs text-slate-500">1-click extract</span>
            </div>

            <div className="divide-y divide-slate-100">
              {SAMPLE_VIDEOS.map((sample) => (
                <button
                  key={sample.url}
                  type="button"
                  onClick={() => onSelectSample(sample.url)}
                  className="group flex w-full items-start justify-between gap-4 py-3.5 text-left transition-colors hover:bg-slate-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 group-hover:text-rose-600">
                      {sample.title}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                      <span>{sample.channel}</span>
                      <span aria-hidden="true">·</span>
                      <span>{sample.angle}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {sample.durationLabel}
                      </span>
                    </p>
                  </div>
                  <span className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors group-hover:border-rose-200 group-hover:text-rose-600">
                    <Play className="h-3.5 w-3.5" />
                  </span>
                </button>
              ))}
            </div>

            {history.length > 0 && (
              <div className="mt-6 border-t border-slate-200 pt-5">
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <History className="h-3.5 w-3.5 text-slate-500" />
                  Recent Extractions
                </div>
                <div className="divide-y divide-slate-100">
                  {history.slice(0, 3).map((item) => (
                    <button
                      key={`${item.video.videoId}-${item.extractedAt}`}
                      type="button"
                      onClick={() => onLoadHistory(item)}
                      className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-slate-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-900">
                          {item.video.title}
                        </p>
                        <p className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                          <span className="inline-flex items-center gap-1">
                            <Film className="h-3 w-3" />
                            {item.clips.length} clips
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                            <Clock className="h-3 w-3" />~{item.targetDuration}s
                          </span>
                        </p>
                      </div>
                      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
