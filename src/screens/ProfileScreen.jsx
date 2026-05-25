import { Edit3, Grid3X3, ShieldCheck } from 'lucide-react';
import { Avatar } from '../components/Avatar.jsx';
import { ScreenHeader } from '../components/ScreenHeader.jsx';
import { VerifiedBadge } from '../components/VerifiedBadge.jsx';
import { profileVideos } from '../data/mockData.js';

export function ProfileScreen({ appState }) {
  const user = appState.user;

  return (
    <section className="h-dvh overflow-y-auto bg-black safe-bottom hide-scrollbar">
      <ScreenHeader
        title="Profile"
        subtitle={user.fullUsername}
        right={
          <button type="button" className="grid h-10 w-10 place-items-center rounded-full bg-white/10">
            <Edit3 className="h-4 w-4" />
          </button>
        }
      />

      <div className="px-5">
        <div className="flex items-center gap-4">
          <Avatar user={user} size="h-20 w-20" showBadge />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-xl font-black">{user.name}</h2>
              {user.verified && <VerifiedBadge className="h-5 w-5" />}
            </div>
            <p className="mt-1 text-sm text-white/54">{user.bio}</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 rounded-[8px] border border-white/10 bg-ink-800 p-4 text-center">
          <Stat label="Videos" value={user.videos} />
          <Stat label="Followers" value={formatNumber(user.followers)} />
          <Stat label="Following" value={user.following} />
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-[8px] border border-telegram/25 bg-telegram/10 p-4">
          <ShieldCheck className="h-5 w-5 text-telegram" />
          <div>
            <p className="text-sm font-black">{user.verificationStatus}</p>
            <p className="text-xs text-white/50">Blue badge is visible across feed and search.</p>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-2 border-b border-white/10 pb-3 text-sm font-black">
          <Grid3X3 className="h-4 w-4" />
          Videos
        </div>

        <div className="mt-3 grid grid-cols-3 gap-1">
          {profileVideos.map((src) => (
            <button key={src} type="button" className="aspect-[9/14] overflow-hidden bg-ink-800">
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-lg font-black">{value}</p>
      <p className="mt-0.5 text-xs text-white/42">{label}</p>
    </div>
  );
}

function formatNumber(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value;
}
