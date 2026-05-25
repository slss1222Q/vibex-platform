import { Search, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Avatar } from '../components/Avatar.jsx';
import { ScreenHeader } from '../components/ScreenHeader.jsx';
import { VerifiedBadge } from '../components/VerifiedBadge.jsx';
import { creators } from '../data/mockData.js';

export function SearchScreen() {
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return creators;
    return creators.filter((creator) => creator.fullUsername.toLowerCase().includes(normalized));
  }, [query]);

  return (
    <section className="h-dvh overflow-y-auto bg-black safe-bottom hide-scrollbar">
      <ScreenHeader title="Search" subtitle="Find creators by full_username" />

      <div className="px-5">
        <label className="flex h-12 items-center gap-3 rounded-[8px] border border-white/10 bg-ink-800 px-4">
          <Search className="h-5 w-5 text-white/42" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search mentalego%5"
            className="h-full flex-1 bg-transparent text-sm font-semibold text-white outline-none placeholder:text-white/30"
          />
        </label>

        <div className="mt-5 flex items-center gap-2 text-sm font-bold text-white/76">
          <TrendingUp className="h-4 w-4 text-coin" />
          Trending creators
        </div>

        <div className="mt-3 space-y-2">
          {results.map((creator) => (
            <button
              key={creator.id}
              type="button"
              className="flex w-full items-center gap-3 rounded-[8px] border border-white/8 bg-ink-800 p-3 text-left"
            >
              <Avatar user={creator} size="h-12 w-12" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-extrabold">{creator.fullUsername}</p>
                  {creator.verified && <VerifiedBadge />}
                </div>
                <p className="mt-0.5 text-xs text-white/42">{creator.name}</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-black">View</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
