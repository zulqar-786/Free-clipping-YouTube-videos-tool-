export type StudioView =
  | 'extractor'
  | 'cut-sheet'
  | 'batch-export'
  | 'saved-storage'
  | 'workflow';

interface HeaderProps {
  activeView: StudioView;
  onSelectView: (view: StudioView) => void;
  hasResults: boolean;
  onPrimaryAction: () => void;
}

const NAV_ITEMS: Array<{ id: StudioView; label: string }> = [
  { id: 'extractor', label: 'Extractor' },
  { id: 'cut-sheet', label: 'Cut Sheet' },
  { id: 'batch-export', label: 'Batch FFmpeg' },
  { id: 'saved-storage', label: 'My Storage' },
  { id: 'workflow', label: 'Workflow' },
];

export function Header({
  activeView,
  onSelectView,
  hasResults,
  onPrimaryAction,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-8 px-6">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onSelectView('extractor');
          }}
          className="font-display text-lg font-bold tracking-tight text-slate-950 whitespace-nowrap shrink-0"
        >
          ClipCut Studio
        </a>

        <nav
          aria-label="Primary studio navigation"
          className="hidden md:flex items-center gap-6"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectView(item.id)}
                className={`relative py-4 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2 ${
                  isActive
                    ? 'text-slate-950'
                    : 'text-slate-600 hover:text-slate-950'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-rose-600"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onPrimaryAction}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
          >
            {hasResults ? 'New Video' : 'Try Sample'}
          </button>
        </div>
      </div>

      {/* Mobile compact nav row */}
      <nav
        aria-label="Mobile studio navigation"
        className="flex md:hidden items-center gap-4 overflow-x-auto border-t border-slate-100 px-4 py-2"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              className={`text-xs font-medium whitespace-nowrap shrink-0 px-2 py-1 rounded ${
                isActive
                  ? 'bg-slate-100 text-slate-950'
                  : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
