import { motion } from 'framer-motion';
import {
  Heart,
  MessageCircle,
  MoreHorizontal,
  Send,
  UserPlus,
  Volume2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar } from '../components/Avatar.jsx';
import { CoinToast } from '../components/CoinToast.jsx';
import { VerifiedBadge } from '../components/VerifiedBadge.jsx';
import { mockApi } from '../services/mockApi.js';
import { videos as seedVideos } from '../data/mockData.js';

export function FeedScreen({ appState }) {
  const [feedVideos] = useState([...seedVideos, ...seedVideos.map((v) => ({ ...v, id: `${v.id}-loop` }))]);
  const [activeVideo, setActiveVideo] = useState(feedVideos[0]?.id);
  const [rewardedVideos, setRewardedVideos] = useState(new Set());
  const [likedVideos, setLikedVideos] = useState(new Set());
  const [followedCreators, setFollowedCreators] = useState(new Set());
  const [coinToast, setCoinToast] = useState(false);
  const videoRefs = useRef(new Map());

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const videoId = entry.target.dataset.videoId;
          const video = videoRefs.current.get(videoId);

          if (entry.isIntersecting && entry.intersectionRatio >= 0.72) {
            setActiveVideo(videoId);
            video?.play?.().catch(() => undefined);
          } else {
            video?.pause?.();
          }
        });
      },
      { threshold: [0.2, 0.72, 0.92] },
    );

    videoRefs.current.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [feedVideos]);

  const grantWatchReward = useCallback(
    async (video) => {
      if (rewardedVideos.has(video.id)) return;

      const result = await mockApi.watchVideo({
        userId: appState.user.id,
        videoId: video.id,
        fingerprintHash: appState.securityState?.fingerprint?.hash,
      });

      setRewardedVideos((current) => new Set(current).add(video.id));
      appState.setUser((user) => ({ ...user, coins: user.coins + result.reward }));
      setCoinToast(true);
      window.setTimeout(() => setCoinToast(false), 1200);
    },
    [appState, rewardedVideos],
  );

  async function handleLike(video) {
    if (likedVideos.has(video.id)) return;
    setLikedVideos((current) => new Set(current).add(video.id));
    await mockApi.likeVideo({ creatorId: video.creator.id, videoId: video.id });
  }

  async function handleComment(video) {
    await mockApi.commentVideo({
      creatorId: video.creator.id,
      videoId: video.id,
      body: 'Amazing drop',
    });
  }

  async function handleFollow(video) {
    if (followedCreators.has(video.creator.id)) return;
    setFollowedCreators((current) => new Set(current).add(video.creator.id));
    await mockApi.followCreator({ creatorId: video.creator.id });
  }

  return (
    <section className="relative h-dvh bg-black">
      <CoinToast visible={coinToast} amount={2} />

      <div className="absolute left-4 top-[calc(env(safe-area-inset-top)+16px)] z-20 flex items-center gap-2 rounded-full bg-black/34 px-3 py-1.5 text-xs font-bold backdrop-blur-md">
        <span className="h-2 w-2 rounded-full bg-coin" />
        {appState.user.coins.toLocaleString()} Coins
      </div>

      <div className="h-full snap-y snap-mandatory overflow-y-auto hide-scrollbar">
        {feedVideos.map((video) => {
          const isActive = activeVideo === video.id;
          const isLiked = likedVideos.has(video.id);
          const isFollowed = followedCreators.has(video.creator.id);

          return (
            <article key={video.id} className="relative h-dvh snap-start overflow-hidden bg-ink-950">
              <video
                ref={(node) => {
                  if (node) videoRefs.current.set(video.id, node);
                }}
                data-video-id={video.id}
                className="absolute inset-0 h-full w-full object-cover"
                src={video.videoUrl}
                poster={video.poster}
                muted
                playsInline
                loop
                preload="metadata"
                onEnded={() => grantWatchReward(video)}
                onTimeUpdate={(event) => {
                  const node = event.currentTarget;
                  if (node.duration && node.currentTime / node.duration > 0.92) {
                    grantWatchReward(video);
                  }
                }}
              />

              <div className="pointer-events-none absolute inset-0 reel-gradient" />

              <div className="absolute right-3 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-5">
                <button type="button" onClick={() => handleFollow(video)} className="relative">
                  <Avatar user={video.creator} size="h-12 w-12" />
                  {!isFollowed && (
                    <span className="absolute -bottom-2 left-1/2 grid h-6 w-6 -translate-x-1/2 place-items-center rounded-full bg-telegram">
                      <UserPlus className="h-3.5 w-3.5 text-white" />
                    </span>
                  )}
                </button>

                <ActionButton
                  icon={Heart}
                  label={formatCount(video.likes + (isLiked ? 1 : 0))}
                  active={isLiked}
                  onClick={() => handleLike(video)}
                />
                <ActionButton
                  icon={MessageCircle}
                  label={formatCount(video.comments)}
                  onClick={() => handleComment(video)}
                />
                <ActionButton icon={Send} label={formatCount(video.shares)} />
                <ActionButton icon={MoreHorizontal} label="" />
              </div>

              <div className="absolute inset-x-0 bottom-0 z-10 safe-bottom px-4">
                <motion.div
                  animate={{ opacity: isActive ? 1 : 0.62, y: isActive ? 0 : 8 }}
                  className="max-w-[78%]"
                >
                  <div className="mb-2 inline-flex items-center gap-2">
                    <span className="text-[15px] font-extrabold">{video.creator.fullUsername}</span>
                    {video.creator.verified && <VerifiedBadge />}
                  </div>
                  <p className="line-clamp-2 text-sm font-medium leading-5 text-white/88">{video.caption}</p>
                  <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-white/72">
                    <Volume2 className="h-4 w-4" />
                    Original audio - FlixCoin
                  </div>
                </motion.div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ActionButton({ icon: Icon, label, active = false, onClick }) {
  return (
    <button type="button" onClick={onClick} className="flex w-14 flex-col items-center gap-1 text-white">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-black/26 backdrop-blur-sm">
        <Icon
          className={`h-7 w-7 ${active ? 'fill-red-500 text-red-500' : ''}`}
          strokeWidth={2.4}
        />
      </span>
      {label && <span className="text-[11px] font-bold drop-shadow">{label}</span>}
    </button>
  );
}

function formatCount(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}
