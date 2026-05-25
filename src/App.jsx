import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  CircleDollarSign,
  Clapperboard,
  Coins,
  Crown,
  Heart,
  Home,
  KeyRound,
  Lock,
  LogIn,
  MessageCircle,
  PlusSquare,
  Search,
  Send,
  Shield,
  ShieldAlert,
  Sparkles,
  UploadCloud,
  UserRound,
  UserSearch,
  WalletCards,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000';
const WS_BASE = API_BASE.replace(/^http/, 'ws');
const TOKEN_KEY = 'flixcoin_token';

const tabs = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'create', label: 'Create', icon: PlusSquare },
  { id: 'wallet', label: 'Wallet', icon: WalletCards },
  { id: 'profile', label: 'Profile', icon: UserRound },
];

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function createFingerprint() {
  const raw = [
    navigator.userAgent,
    navigator.language,
    navigator.platform,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.hardwareConcurrency ?? 'cpu-unknown',
    navigator.deviceMemory ?? 'memory-unknown',
    window.Telegram?.WebApp?.platform ?? 'web',
  ].join('|');
  return sha256(raw);
}

function useApi(token, setBanned) {
  return useMemo(() => {
    async function request(path, options = {}) {
      const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers ?? {}),
        },
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 423) {
        setBanned(true);
        throw new Error(data.detail ?? 'Account locked');
      }
      if (!response.ok) throw new Error(data.detail ?? 'Request failed');
      return data;
    }
    return { request };
  }, [token, setBanned]);
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [fingerprint, setFingerprint] = useState('');
  const [user, setUser] = useState(null);
  const [videos, setVideos] = useState([]);
  const [activeTab, setActiveTab] = useState('home');
  const [authMode, setAuthMode] = useState('register');
  const [authForm, setAuthForm] = useState({ username: '', full_username: '', password: '' });
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [banned, setBanned] = useState(false);
  const [loading, setLoading] = useState(true);
  const api = useApi(token, setBanned);

  const showToast = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 1800);
  }, []);

  useEffect(() => {
    window.Telegram?.WebApp?.ready?.();
    window.Telegram?.WebApp?.expand?.();
    window.Telegram?.WebApp?.setHeaderColor?.('#000000');
    window.Telegram?.WebApp?.setBackgroundColor?.('#000000');
  }, []);

  useEffect(() => {
    createFingerprint().then(setFingerprint);
  }, []);

  useEffect(() => {
    async function bootstrap() {
      if (!fingerprint) return;
      try {
        const feed = await api.request('/videos');
        setVideos(feed.videos);
        if (token) {
          const me = await api.request('/me');
          setUser(me.user);
        }
      } catch (err) {
        if (token) {
          localStorage.removeItem(TOKEN_KEY);
          setToken('');
        }
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    bootstrap();
  }, [api, fingerprint, token]);

  useEffect(() => {
    const socket = new WebSocket(`${WS_BASE}/ws/feed`);
    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'video_published') {
        setVideos((current) => [payload.video, ...current.filter((item) => item.id !== payload.video.id)]);
        showToast('New reel published');
      }
    };
    return () => socket.close();
  }, [showToast]);

  async function submitAuth(event) {
    event.preventDefault();
    setError('');
    try {
      const path = authMode === 'register' ? '/auth/register' : '/auth/login';
      const body =
        authMode === 'register'
          ? {
              username: authForm.username,
              password: authForm.password,
              fingerprint_hash: fingerprint,
            }
          : {
              full_username: authForm.full_username,
              password: authForm.password,
              fingerprint_hash: fingerprint,
            };
      const result = await api.request(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      localStorage.setItem(TOKEN_KEY, result.token);
      setToken(result.token);
      setUser(result.user);
      showToast(authMode === 'register' ? `Created ${result.user.full_username}` : 'Welcome back');
    } catch (err) {
      setError(err.message);
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setUser(null);
    setActiveTab('home');
  }

  if (loading) return <Splash />;
  if (banned) return <BanRequestPage fingerprint={fingerprint} api={api} />;
  if (!user) {
    return (
      <AuthScreen
        mode={authMode}
        setMode={setAuthMode}
        form={authForm}
        setForm={setAuthForm}
        submit={submitAuth}
        error={error}
        fingerprint={fingerprint}
      />
    );
  }

  return (
    <main className="h-dvh w-full overflow-hidden bg-black text-white">
      <AnimatePresence>{toast && <CoinToast message={toast} />}</AnimatePresence>
      <AnimatePresence mode="wait">
        <motion.section
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
          className="h-full"
        >
          {activeTab === 'home' && (
            <HomeFeed
              videos={videos}
              user={user}
              setUser={setUser}
              fingerprint={fingerprint}
              api={api}
              showToast={showToast}
            />
          )}
          {activeTab === 'search' && <SearchScreen api={api} />}
          {activeTab === 'create' && (
            <CreateScreen
              user={user}
              api={api}
              setVideos={setVideos}
              showToast={showToast}
            />
          )}
          {activeTab === 'wallet' && <WalletScreen user={user} />}
          {activeTab === 'profile' && (
            <ProfileScreen user={user} logout={logout} api={api} setUser={setUser} showToast={showToast} />
          )}
        </motion.section>
      </AnimatePresence>
      <BottomNav active={activeTab} setActive={setActiveTab} />
    </main>
  );
}

function Splash() {
  return (
    <main className="grid h-dvh place-items-center bg-black text-white">
      <motion.div initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-coin text-black shadow-glow">
          <Clapperboard className="h-8 w-8" />
        </div>
        <h1 className="mt-4 text-3xl font-black">FlixCoin</h1>
        <p className="mt-1 text-sm text-white/45">Secure Watch-to-Earn reels</p>
      </motion.div>
    </main>
  );
}

function AuthScreen({ mode, setMode, form, setForm, submit, error, fingerprint }) {
  return (
    <main className="min-h-dvh bg-black px-5 py-[calc(env(safe-area-inset-top)+28px)] text-white">
      <div className="mx-auto max-w-md">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-white text-black">
            <KeyRound className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-black">FlixCoin</h1>
            <p className="text-sm text-white/45">Anonymous. No phone number required.</p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 rounded-[8px] border border-white/10 bg-ink-800 p-1">
          {['register', 'login'].map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              className={`h-10 rounded-[6px] text-sm font-black capitalize ${
                mode === item ? 'bg-white text-black' : 'text-white/48'
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-6 space-y-3">
          {mode === 'register' ? (
            <Input
              label="Custom username"
              value={form.username}
              onChange={(value) => setForm((current) => ({ ...current, username: value }))}
              placeholder="mentalego"
            />
          ) : (
            <Input
              label="Full username"
              value={form.full_username}
              onChange={(value) => setForm((current) => ({ ...current, full_username: value }))}
              placeholder="admin#0"
            />
          )}
          <Input
            label="Password"
            type="password"
            value={form.password}
            onChange={(value) => setForm((current) => ({ ...current, password: value }))}
            placeholder="Minimum 8 characters"
          />
          {error && <p className="rounded-[8px] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
          <button className="flex h-13 w-full items-center justify-center gap-2 rounded-[8px] bg-white text-sm font-black text-black">
            <LogIn className="h-5 w-5" />
            {mode === 'register' ? 'Create Secure Account' : 'Enter App'}
          </button>
        </form>

        <div className="mt-5 rounded-[8px] border border-white/10 bg-ink-800 p-4">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Shield className="h-4 w-4 text-telegram" />
            Security fingerprint
          </div>
          <p className="mt-2 break-all text-xs leading-5 text-white/42">{fingerprint || 'Generating...'}</p>
        </div>

        <p className="mt-4 text-xs leading-5 text-white/42">
          Bootstrap SuperAdmin: <span className="font-bold text-white">admin#0</span> /{' '}
          <span className="font-bold text-white">Admin12345!</span>
        </p>
      </div>
    </main>
  );
}

function HomeFeed({ videos, user, setUser, fingerprint, api, showToast }) {
  const rewarded = useRef(new Set());
  const videoRefs = useRef(new Map());

  async function completeWatch(video) {
    if (rewarded.current.has(video.id)) return;
    try {
      const result = await api.request(`/videos/${video.id}/watch`, {
        method: 'POST',
        body: JSON.stringify({
          video_id: video.id,
          seconds_watched: 10,
          completed: true,
          fingerprint_hash: fingerprint,
        }),
      });
      rewarded.current.add(video.id);
      if (result.rewarded) {
        setUser((current) => ({ ...current, coins: result.coins }));
        showToast('+2 Coins');
      }
    } catch (err) {
      showToast(err.message);
    }
  }

  async function likeVideo(video) {
    try {
      await api.request(`/videos/${video.id}/like`, {
        method: 'POST',
        body: JSON.stringify({ target_user_id: video.creator_id, fingerprint_hash: fingerprint }),
      });
      showToast('Creator earned +0.5');
    } catch (err) {
      showToast(err.message);
    }
  }

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const id = Number(entry.target.dataset.id);
          const node = videoRefs.current.get(id);
          if (entry.isIntersecting && entry.intersectionRatio > 0.72) node?.play?.().catch(() => undefined);
          else node?.pause?.();
        });
      },
      { threshold: [0.2, 0.72] },
    );
    videoRefs.current.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [videos]);

  if (!videos.length) {
    return (
      <section className="flex h-dvh flex-col bg-black safe-bottom">
        <TopCoinBar coins={user.coins} />
        <div className="grid flex-1 place-items-center px-7 text-center">
          <div>
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-white/10">
              <Clapperboard className="h-8 w-8 text-white/58" />
            </div>
            <h2 className="mt-5 text-2xl font-black">No reels uploaded yet</h2>
            <p className="mt-2 text-sm leading-6 text-white/48">
              Your profile and wallet are active. Reels appear globally after an approved uploader publishes a direct video link.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="relative h-dvh bg-black">
      <TopCoinBar coins={user.coins} />
      <div className="h-full snap-y snap-mandatory overflow-y-auto hide-scrollbar">
        {videos.map((video) => (
          <article key={video.id} className="relative h-dvh snap-start overflow-hidden bg-ink-950">
            <video
              ref={(node) => node && videoRefs.current.set(video.id, node)}
              data-id={video.id}
              src={video.video_url}
              className="absolute inset-0 h-full w-full object-cover"
              muted
              playsInline
              loop
              preload="metadata"
              onTimeUpdate={(event) => {
                const node = event.currentTarget;
                if (node.duration && node.currentTime / node.duration > 0.92) completeWatch(video);
              }}
            />
            <div className="pointer-events-none absolute inset-0 reel-gradient" />
            <div className="absolute right-3 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-5">
              <button onClick={() => likeVideo(video)} className="flex flex-col items-center gap-1">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-black/32 backdrop-blur">
                  <Heart className="h-7 w-7" />
                </span>
                <span className="text-xs font-bold">{video.like_count}</span>
              </button>
              <button className="flex flex-col items-center gap-1">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-black/32 backdrop-blur">
                  <MessageCircle className="h-7 w-7" />
                </span>
                <span className="text-xs font-bold">{video.comment_count}</span>
              </button>
              <button className="grid h-12 w-12 place-items-center rounded-full bg-black/32 backdrop-blur">
                <Send className="h-7 w-7" />
              </button>
            </div>
            <div className="absolute inset-x-0 bottom-0 z-10 safe-bottom px-4">
              <div className="max-w-[78%]">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-black">{video.creator_full_username}</p>
                  <BadgeCheck className="h-4 w-4 fill-telegram text-white" />
                </div>
                <h2 className="mt-2 text-lg font-black">{video.title}</h2>
                <p className="mt-1 text-sm text-white/65">#{video.category}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CreateScreen({ user, api, setVideos, showToast }) {
  const [form, setForm] = useState({ title: '', category: '', video_url: '' });
  const [busy, setBusy] = useState(false);
  const allowed = user.is_uploader || user.is_superadmin;

  async function publish(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.request('/videos', { method: 'POST', body: JSON.stringify(form) });
      setVideos((current) => [result.video, ...current]);
      setForm({ title: '', category: '', video_url: '' });
      showToast('Video published globally');
    } catch (err) {
      showToast(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="h-dvh overflow-y-auto bg-black px-5 safe-bottom hide-scrollbar">
      <Header title="Create" subtitle="Secret Video Link Publisher" />
      {!allowed ? (
        <LockedCard />
      ) : (
        <form onSubmit={publish} className="space-y-3">
          <div className="rounded-[8px] border border-coin/25 bg-coin/10 p-4">
            <div className="flex items-center gap-2 text-sm font-black text-coin">
              <Crown className="h-4 w-4" />
              Authorized publisher
            </div>
            <p className="mt-2 text-sm leading-6 text-white/58">
              Paste a direct HTTPS MP4/WebM URL. Backend validates RBAC again and rejects unauthorized requests with 403.
            </p>
          </div>
          <Input label="Title" value={form.title} onChange={(value) => setForm((c) => ({ ...c, title: value }))} />
          <Input label="Target category" value={form.category} onChange={(value) => setForm((c) => ({ ...c, category: value }))} />
          <Input label="Raw video URL" value={form.video_url} onChange={(value) => setForm((c) => ({ ...c, video_url: value }))} />
          <button disabled={busy} className="flex h-14 w-full items-center justify-center gap-2 rounded-[8px] bg-white font-black text-black disabled:opacity-40">
            <UploadCloud className="h-5 w-5" />
            Publish to Global Feed
          </button>
        </form>
      )}
    </section>
  );
}

function LockedCard() {
  return (
    <div className="rounded-[8px] border border-white/10 bg-ink-800 p-5 text-center">
      <Lock className="mx-auto h-9 w-9 text-white/42" />
      <h2 className="mt-4 text-xl font-black">Publisher access required</h2>
      <p className="mt-2 text-sm leading-6 text-white/48">
        This secret section is visible only to accounts with is_uploader or is_superadmin enabled.
      </p>
    </div>
  );
}

function WalletScreen({ user }) {
  const canWithdraw = user.coins >= 200;
  return (
    <section className="h-dvh overflow-y-auto bg-black px-5 safe-bottom hide-scrollbar">
      <Header title="Wallet" subtitle="Coin balance and payout rules" />
      <div className="rounded-[8px] border border-coin/25 bg-[radial-gradient(circle_at_top_right,rgba(245,196,81,0.22),transparent_34%),#121212] p-5 shadow-glow">
        <p className="text-sm text-white/52">Available Coins</p>
        <div className="mt-2 flex items-center justify-between">
          <h2 className="text-5xl font-black">{Number(user.coins).toLocaleString()}</h2>
          <Coins className="h-12 w-12 text-coin" />
        </div>
      </div>
      <div className="mt-4 rounded-[8px] border border-white/10 bg-ink-800 p-4 text-sm leading-7 text-white/70">
        <p>1 Video = 2 Coins.</p>
        <p>200 Coins = 20,000 UZS.</p>
        <p>Automatic Payouts every 10 days.</p>
      </div>
      <button disabled={!canWithdraw} className="mt-5 h-14 w-full rounded-[8px] bg-white font-black text-black disabled:bg-white/10 disabled:text-white/35">
        {canWithdraw ? 'Request Cashout' : `${Math.ceil(200 - user.coins)} coins left to cashout`}
      </button>
    </section>
  );
}

function SearchScreen({ api }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [message, setMessage] = useState('SuperAdmin search only.');

  async function search(event) {
    event.preventDefault();
    try {
      const data = await api.request(`/admin/users/search?q=${encodeURIComponent(q)}`);
      setResults(data.users);
      setMessage('');
    } catch (err) {
      setResults([]);
      setMessage(err.message);
    }
  }

  return (
    <section className="h-dvh overflow-y-auto bg-black px-5 safe-bottom hide-scrollbar">
      <Header title="Search" subtitle="Search users by full_username" />
      <form onSubmit={search} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="mentalego%5" className="h-12 min-w-0 flex-1 rounded-[8px] border border-white/10 bg-ink-800 px-4 text-sm font-bold outline-none" />
        <button className="grid h-12 w-12 place-items-center rounded-[8px] bg-white text-black">
          <UserSearch className="h-5 w-5" />
        </button>
      </form>
      {message && <p className="mt-4 text-sm text-white/45">{message}</p>}
      <div className="mt-4 space-y-2">
        {results.map((item) => (
          <div key={item.id} className="rounded-[8px] border border-white/10 bg-ink-800 p-4">
            <p className="font-black">{item.full_username}</p>
            <p className="mt-1 text-xs text-white/45">Coins {item.coins} | Likes {item.like_count} | Followers {item.follower_count}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProfileScreen({ user, logout, api, setUser, showToast }) {
  return (
    <section className="h-dvh overflow-y-auto bg-black px-5 safe-bottom hide-scrollbar">
      <Header title="Profile" subtitle={user.full_username} />
      <div className="rounded-[8px] border border-white/10 bg-ink-800 p-5">
        <div className="flex items-center gap-4">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-white text-2xl font-black text-black">
            {user.username.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-xl font-black">{user.full_username}</h2>
              {user.is_superadmin && <Crown className="h-5 w-5 text-coin" />}
            </div>
            <p className="mt-1 text-sm text-white/45">
              {user.is_uploader || user.is_superadmin ? 'Publisher enabled' : 'Viewer account'}
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 text-center">
          <Stat label="Coins" value={user.coins} />
          <Stat label="Likes" value={user.like_count} />
          <Stat label="Followers" value={user.follower_count} />
        </div>
      </div>
      {user.is_superadmin && <WalletAdminka api={api} setUser={setUser} showToast={showToast} />}
      <button onClick={logout} className="mt-5 h-12 w-full rounded-[8px] border border-white/10 text-sm font-black text-white/70">
        Logout
      </button>
    </section>
  );
}

function WalletAdminka({ api, showToast }) {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState(null);
  const [patch, setPatch] = useState({ coins: '', follower_count: '', like_count: '', is_uploader: false });

  async function find() {
    try {
      const data = await api.request(`/admin/users/search?q=${encodeURIComponent(query)}`);
      const user = data.users[0];
      setTarget(user ?? null);
      if (user) {
        setPatch({
          coins: user.coins,
          follower_count: user.follower_count,
          like_count: user.like_count,
          is_uploader: user.is_uploader,
        });
      }
    } catch (err) {
      showToast(err.message);
    }
  }

  async function save() {
    if (!target) return;
    try {
      const body = {
        coins: Number(patch.coins),
        follower_count: Number(patch.follower_count),
        like_count: Number(patch.like_count),
        is_uploader: Boolean(patch.is_uploader),
      };
      const data = await api.request(`/admin/users/${target.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setTarget(data.user);
      showToast('WalletAdminka updated user');
    } catch (err) {
      showToast(err.message);
    }
  }

  return (
    <div className="mt-5 rounded-[8px] border border-coin/25 bg-coin/10 p-4">
      <div className="flex items-center gap-2 font-black text-coin">
        <Crown className="h-5 w-5" />
        WalletAdminka
      </div>
      <div className="mt-4 flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="full_username" className="h-11 min-w-0 flex-1 rounded-[8px] border border-white/10 bg-black px-3 text-sm outline-none" />
        <button onClick={find} className="rounded-[8px] bg-white px-4 text-sm font-black text-black">Find</button>
      </div>
      {target && (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-black">{target.full_username}</p>
          <Input label="Coins" value={patch.coins} onChange={(value) => setPatch((c) => ({ ...c, coins: value }))} />
          <Input label="Followers" value={patch.follower_count} onChange={(value) => setPatch((c) => ({ ...c, follower_count: value }))} />
          <Input label="Likes" value={patch.like_count} onChange={(value) => setPatch((c) => ({ ...c, like_count: value }))} />
          <label className="flex items-center justify-between rounded-[8px] border border-white/10 bg-black p-3 text-sm font-bold">
            Toggle is_uploader
            <input type="checkbox" checked={patch.is_uploader} onChange={(e) => setPatch((c) => ({ ...c, is_uploader: e.target.checked }))} />
          </label>
          <button onClick={save} className="h-12 w-full rounded-[8px] bg-white font-black text-black">Save User</button>
        </div>
      )}
    </div>
  );
}

function BanRequestPage({ fingerprint, api }) {
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    try {
      await api.request('/ban-appeals', {
        method: 'POST',
        body: JSON.stringify({ message, fingerprint_hash: fingerprint }),
      });
      setSent(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-black px-5 text-white">
      <form onSubmit={submit} className="w-full max-w-md rounded-[8px] border border-red-500/30 bg-red-500/10 p-5">
        <Ban className="h-10 w-10 text-red-300" />
        <h1 className="mt-4 text-2xl font-black">WalletAdminka Ban Request</h1>
        <p className="mt-2 text-sm leading-6 text-white/58">Your account or hardware fingerprint is locked. Submit a review request to SuperAdmin.</p>
        {sent ? (
          <p className="mt-4 rounded-[8px] bg-white/10 p-3 text-sm">Appeal submitted.</p>
        ) : (
          <>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} className="mt-4 min-h-32 w-full rounded-[8px] border border-white/10 bg-black p-3 text-sm outline-none" placeholder="Explain why the ban should be reviewed..." />
            {error && <p className="mt-2 text-sm text-red-200">{error}</p>}
            <button className="mt-3 h-12 w-full rounded-[8px] bg-white font-black text-black">Submit Appeal</button>
          </>
        )}
      </form>
    </main>
  );
}

function BottomNav({ active, setActive }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-black/92 px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2 backdrop-blur-xl">
      <div className="mx-auto grid max-w-md grid-cols-5">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.id;
          return (
            <button key={tab.id} onClick={() => setActive(tab.id)} className="relative flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-bold text-white/45 data-[active=true]:text-white" data-active={isActive}>
              {isActive && <motion.span layoutId="nav-pill" className="absolute inset-x-3 top-1 h-9 rounded-full bg-white/10" />}
              <Icon className="relative h-5 w-5" />
              <span className="relative">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function Header({ title, subtitle }) {
  return (
    <header className="pb-4 pt-[calc(env(safe-area-inset-top)+18px)]">
      <h1 className="text-2xl font-black">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-white/45">{subtitle}</p>}
    </header>
  );
}

function TopCoinBar({ coins }) {
  return (
    <div className="absolute left-4 top-[calc(env(safe-area-inset-top)+16px)] z-30 flex items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 text-xs font-black backdrop-blur">
      <CircleDollarSign className="h-4 w-4 text-coin" />
      {Number(coins).toLocaleString()} Coins
    </div>
  );
}

function CoinToast({ message }) {
  return (
    <motion.div initial={{ opacity: 0, y: -18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+18px)] z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-coin/40 bg-black/85 px-4 py-2 text-sm font-black text-coin shadow-glow backdrop-blur">
      <Sparkles className="h-4 w-4" />
      {message}
    </motion.div>
  );
}

function Input({ label, value, onChange, placeholder = '', type = 'text' }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-white/45">{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-12 w-full rounded-[8px] border border-white/10 bg-ink-800 px-4 text-sm font-bold text-white outline-none placeholder:text-white/24 focus:border-white/25" />
    </label>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-lg font-black">{Number(value).toLocaleString()}</p>
      <p className="mt-1 text-xs text-white/42">{label}</p>
    </div>
  );
}
