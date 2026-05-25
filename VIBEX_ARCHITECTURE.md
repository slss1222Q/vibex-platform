# VIBEX - Production Architecture Blueprint

## 0. Product Definition

VIBEX is a short-video social platform for mobile and Telegram surfaces: TikTok/Reels-style vertical feed plus a controlled reward economy. The platform must optimize for four things at the same time:

- Fast creator and viewer experience.
- Abuse-resistant coin earning and withdrawal.
- Scalable media ingestion and feed delivery.
- Admin-grade observability, moderation, and fraud control.

The system should be treated as a financial-adjacent social product. Coins create real payout risk, so fraud prevention, ledger correctness, and admin controls are first-class domain modules, not afterthoughts.

## 1. Recommended Tech Stack

### Client

- Mobile app: Flutter.
- Admin panel: Next.js or React + Vite.
- Telegram bot/web app: Node.js bot service + Telegram Mini App for feed/wallet flows.
- Video player: native Flutter video player with prefetching, caching, adaptive bitrate support.

### Backend

- API: NestJS, TypeScript, Fastify adapter.
- Database: PostgreSQL 16+.
- Cache/rate limits/feed hot data: Redis.
- Queue: BullMQ + Redis.
- Search: Meilisearch for MVP, OpenSearch/Elasticsearch for scale.
- Media storage/CDN: BunnyCDN Stream or Cloudinary for MVP; S3-compatible object storage + CDN for scale.
- AI moderation: provider abstraction over Hive, AWS Rekognition, Google Video Intelligence, or custom model workers.
- Observability: OpenTelemetry, Prometheus, Grafana, Loki, Sentry.
- Deployment: Docker Compose for MVP, Kubernetes-ready manifests for production.

### Payment/Payout

- Click, Payme, Uzum Bank integrations via isolated payout service.
- Manual admin payout as mandatory fallback.
- Crypto optional only after compliance review.

## 2. High-Level Architecture

```text
Flutter App / Telegram Mini App / Admin Panel
        |
        | HTTPS + JWT access token
        v
API Gateway / Nginx / WAF
        |
        v
NestJS API Monolith, modular by domain
        |
        +-- PostgreSQL: durable relational data
        +-- Redis: cache, feed windows, rate limit, sessions
        +-- BullMQ: video processing, fraud scoring, notifications
        +-- Object Storage/CDN: video, thumbnails, avatars
        +-- Search Index: users, hashtags, captions
        +-- AI Moderation Providers
        +-- Payout Providers
```

### MVP Architecture Choice

Start with a modular monolith. Keep module boundaries strict enough that these can later split into services:

- Auth service
- User/profile service
- Video service
- Feed service
- Interaction service
- Coin ledger service
- Fraud/risk service
- Notification service
- Payment/withdrawal service
- Admin service
- Moderation service
- Search service

Premature microservices would increase operational cost before product-market fit. A modular monolith with queues, clean domain boundaries, idempotency keys, and event outbox gives the best scaling path.

## 3. Repository Structure

```text
vibex/
  apps/
    mobile-flutter/
      lib/
        app/
        core/
        features/
          auth/
          feed/
          upload/
          profile/
          wallet/
          search/
          notifications/
    admin-web/
      src/
        app/
        features/
        components/
        lib/
    telegram-bot/
      src/
        bot/
        miniapp/
        commands/
  services/
    api/
      src/
        main.ts
        app.module.ts
        common/
          decorators/
          filters/
          guards/
          interceptors/
          pipes/
          utils/
        modules/
          auth/
          users/
          videos/
          feed/
          interactions/
          comments/
          coins/
          withdrawals/
          referrals/
          fraud/
          moderation/
          search/
          notifications/
          admin/
          reports/
        database/
          migrations/
          seeds/
        jobs/
        events/
      test/
    workers/
      video-worker/
      fraud-worker/
      moderation-worker/
      notification-worker/
  packages/
    shared-contracts/
    config/
    logger/
    security/
  infra/
    docker/
    nginx/
    k8s/
    terraform/
    monitoring/
  docs/
    api/
    runbooks/
    threat-model.md
```

## 4. Domain Model

### Core Principles

- Coins must be ledger-based. Never update balances directly without a corresponding immutable transaction row.
- Views and rewards must be idempotent.
- Fraud scoring must happen before reward finalization where possible, and after finalization with clawback/freeze support where necessary.
- Admin actions must be audited.
- Video moderation states must block distribution before public feed exposure.

### Main Entities

- User: identity, profile, security state.
- Session: refresh token family, device identity, IP history.
- Video: media metadata, moderation status, counters.
- Watch event: playback proof and reward eligibility.
- Interaction: likes, comments, follows, shares, saves.
- Coin ledger: immutable earning/spending/freeze/withdraw events.
- Withdrawal: payout request lifecycle.
- Fraud signal/log: risk scoring evidence.
- Referral: inviter/invitee lifecycle.
- Admin action log: who changed what and why.

## 5. PostgreSQL Schema

Use UUID primary keys for public-safe identifiers and BIGSERIAL only for internal event streams if needed.

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_status AS ENUM ('active', 'limited', 'frozen', 'banned', 'deleted');
CREATE TYPE video_status AS ENUM ('uploading', 'processing', 'review', 'published', 'rejected', 'deleted');
CREATE TYPE moderation_status AS ENUM ('pending', 'approved', 'flagged', 'rejected');
CREATE TYPE coin_tx_type AS ENUM (
  'view_reward',
  'like_reward',
  'comment_reward',
  'follow_reward',
  'referral_reward',
  'withdraw_hold',
  'withdraw_release',
  'withdraw_paid',
  'admin_adjustment',
  'fraud_clawback',
  'freeze',
  'unfreeze'
);
CREATE TYPE withdrawal_status AS ENUM ('pending', 'approved', 'rejected', 'processing', 'paid', 'failed', 'cancelled');
CREATE TYPE report_status AS ENUM ('open', 'reviewing', 'resolved', 'rejected');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code VARCHAR(8) NOT NULL UNIQUE,
  username VARCHAR(32) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name VARCHAR(80),
  bio VARCHAR(240),
  avatar_url TEXT,
  status user_status NOT NULL DEFAULT 'active',
  role VARCHAR(24) NOT NULL DEFAULT 'user',
  coins_available NUMERIC(18,2) NOT NULL DEFAULT 0,
  coins_pending NUMERIC(18,2) NOT NULL DEFAULT 0,
  coins_frozen NUMERIC(18,2) NOT NULL DEFAULT 0,
  fraud_score INTEGER NOT NULL DEFAULT 0,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_users_username_trgm ON users USING gin (username gin_trgm_ops);
CREATE INDEX idx_users_status_created ON users(status, created_at DESC);
CREATE INDEX idx_users_fraud_score ON users(fraud_score DESC);

CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL,
  refresh_token_family UUID NOT NULL,
  device_id VARCHAR(128),
  device_fingerprint_hash TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  country_code CHAR(2),
  is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user_active ON user_sessions(user_id, is_revoked, expires_at);
CREATE INDEX idx_sessions_device ON user_sessions(device_fingerprint_hash);

CREATE TABLE follows (
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CONSTRAINT chk_no_self_follow CHECK (follower_id <> following_id)
);

CREATE INDEX idx_follows_following ON follows(following_id, created_at DESC);
CREATE INDEX idx_follows_follower ON follows(follower_id, created_at DESC);

CREATE TABLE videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caption VARCHAR(2200),
  hashtags TEXT[] NOT NULL DEFAULT '{}',
  category VARCHAR(64),
  source_url TEXT NOT NULL,
  playback_url TEXT,
  thumbnail_url TEXT,
  music_id UUID,
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0 AND duration_ms <= 60000),
  width INTEGER,
  height INTEGER,
  size_bytes BIGINT,
  status video_status NOT NULL DEFAULT 'uploading',
  moderation_status moderation_status NOT NULL DEFAULT 'pending',
  moderation_score JSONB,
  view_count BIGINT NOT NULL DEFAULT 0,
  like_count BIGINT NOT NULL DEFAULT 0,
  comment_count BIGINT NOT NULL DEFAULT 0,
  share_count BIGINT NOT NULL DEFAULT 0,
  save_count BIGINT NOT NULL DEFAULT 0,
  completion_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  avg_watch_ms INTEGER NOT NULL DEFAULT 0,
  engagement_score NUMERIC(12,4) NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_videos_feed ON videos(status, moderation_status, published_at DESC);
CREATE INDEX idx_videos_user_created ON videos(user_id, created_at DESC);
CREATE INDEX idx_videos_hashtags ON videos USING gin(hashtags);
CREATE INDEX idx_videos_engagement ON videos(engagement_score DESC, published_at DESC);

CREATE TABLE video_likes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, video_id)
);

CREATE INDEX idx_likes_video ON video_likes(video_id, created_at DESC);

CREATE TABLE video_saves (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, video_id)
);

CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  body VARCHAR(1000) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'published',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_comments_video_created ON comments(video_id, created_at DESC);
CREATE INDEX idx_comments_parent ON comments(parent_id, created_at ASC);

CREATE TABLE watch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES user_sessions(id) ON DELETE SET NULL,
  watch_ms INTEGER NOT NULL DEFAULT 0,
  video_duration_ms INTEGER NOT NULL,
  completion_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  interaction_count INTEGER NOT NULL DEFAULT 0,
  client_event_id UUID NOT NULL,
  device_fingerprint_hash TEXT,
  ip_hash TEXT,
  risk_score INTEGER NOT NULL DEFAULT 0,
  reward_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  reward_granted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, video_id, client_event_id)
);

CREATE INDEX idx_watch_user_video_created ON watch_events(user_id, video_id, created_at DESC);
CREATE INDEX idx_watch_video_created ON watch_events(video_id, created_at DESC);
CREATE INDEX idx_watch_reward_pending ON watch_events(reward_eligible, reward_granted) WHERE reward_eligible = TRUE;

CREATE TABLE coin_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tx_type coin_tx_type NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  balance_after NUMERIC(18,2) NOT NULL,
  source_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source_video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
  source_event_id UUID,
  idempotency_key TEXT NOT NULL UNIQUE,
  risk_score INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_coin_ledger_user_created ON coin_ledger(user_id, created_at DESC);
CREATE INDEX idx_coin_ledger_type_created ON coin_ledger(tx_type, created_at DESC);

CREATE TABLE withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_coins NUMERIC(18,2) NOT NULL CHECK (amount_coins > 0),
  amount_money NUMERIC(18,2) NOT NULL CHECK (amount_money > 0),
  currency CHAR(3) NOT NULL DEFAULT 'UZS',
  method VARCHAR(32) NOT NULL,
  destination_encrypted TEXT NOT NULL,
  status withdrawal_status NOT NULL DEFAULT 'pending',
  admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  provider_tx_id TEXT,
  risk_snapshot JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_withdrawals_status_created ON withdrawals(status, created_at ASC);
CREATE INDEX idx_withdrawals_user_created ON withdrawals(user_id, created_at DESC);

CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  referral_code VARCHAR(32) NOT NULL,
  is_active_qualified BOOLEAN NOT NULL DEFAULT FALSE,
  rewarded BOOLEAN NOT NULL DEFAULT FALSE,
  qualification_reason JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  qualified_at TIMESTAMPTZ
);

CREATE INDEX idx_referrals_inviter ON referrals(inviter_id, created_at DESC);
CREATE INDEX idx_referrals_code ON referrals(referral_code);

CREATE TABLE fraud_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
  signal_type VARCHAR(64) NOT NULL,
  severity INTEGER NOT NULL CHECK (severity BETWEEN 0 AND 100),
  score_delta INTEGER NOT NULL DEFAULT 0,
  evidence JSONB NOT NULL DEFAULT '{}',
  action_taken VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fraud_user_created ON fraud_logs(user_id, created_at DESC);
CREATE INDEX idx_fraud_signal_created ON fraud_logs(signal_type, created_at DESC);

CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
  reported_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  reason VARCHAR(64) NOT NULL,
  description TEXT,
  status report_status NOT NULL DEFAULT 'open',
  admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reports_status_created ON reports(status, created_at ASC);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(64) NOT NULL,
  title VARCHAR(120) NOT NULL,
  body VARCHAR(500),
  data JSONB NOT NULL DEFAULT '{}',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE admin_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(80) NOT NULL,
  target_type VARCHAR(64) NOT NULL,
  target_id UUID,
  before JSONB,
  after JSONB,
  reason TEXT,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_logs_admin_created ON admin_logs(admin_id, created_at DESC);
CREATE INDEX idx_admin_logs_target ON admin_logs(target_type, target_id);
```

### Scaling Database Strategy

- Partition high-volume tables by month: `watch_events`, `coin_ledger`, `fraud_logs`, `notifications`.
- Keep counters on `videos` denormalized, update asynchronously with queue workers or atomic increments.
- Use read replicas for admin analytics and feed candidate queries.
- Move raw clickstream/watch telemetry to ClickHouse when volume grows.
- Keep PostgreSQL as source of truth for financial ledger and user state.

## 6. Authentication and Session System

### Requirements

- Username + password only.
- No phone number dependency.
- Unique custom public ID like `%5XZ`, `@KQ9`, `#A2P`.
- bcrypt or Argon2id.
- JWT access token + rotating refresh token.
- Multi-device detection.

### Public Code Generation

Use a short human code for display only, not authorization. Generate with collision retry.

```ts
const PREFIXES = ['%', '@', '#'];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePublicCode(): string {
  const prefix = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
  let body = '';
  for (let i = 0; i < 3; i++) {
    body += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `${prefix}${body}`;
}
```

For 1M+ users, 3 characters is too small. Use 5-6 characters in production while still displaying a compact code:

```text
%5XZ9Q
@KQ9VA
#A2P7M
```

### Token Policy

- Access token TTL: 10-15 minutes.
- Refresh token TTL: 30 days.
- Refresh token rotation on every refresh.
- Reuse detection: revoke token family and force login.
- Store only refresh token hash.
- Include `sub`, `sid`, `role`, `tokenVersion` in JWT.

## 7. API Routes

### Auth

```text
POST   /v1/auth/register
POST   /v1/auth/login
POST   /v1/auth/refresh
POST   /v1/auth/logout
GET    /v1/auth/sessions
DELETE /v1/auth/sessions/:id
POST   /v1/auth/password/change
```

### Users/Profile

```text
GET    /v1/me
PATCH  /v1/me
POST   /v1/me/avatar
GET    /v1/users/:username
GET    /v1/users/:id/videos
GET    /v1/users/:id/followers
GET    /v1/users/:id/following
POST   /v1/users/:id/follow
DELETE /v1/users/:id/follow
```

### Videos

```text
POST   /v1/videos/upload-url
POST   /v1/videos
GET    /v1/videos/:id
PATCH  /v1/videos/:id
DELETE /v1/videos/:id
POST   /v1/videos/:id/watch-events
POST   /v1/videos/:id/like
DELETE /v1/videos/:id/like
POST   /v1/videos/:id/save
DELETE /v1/videos/:id/save
POST   /v1/videos/:id/share
```

### Feed

```text
GET /v1/feed/for-you?cursor=
GET /v1/feed/trending?cursor=
GET /v1/feed/newest?cursor=
GET /v1/feed/following?cursor=
```

### Comments

```text
GET    /v1/videos/:id/comments
POST   /v1/videos/:id/comments
POST   /v1/comments/:id/replies
PATCH  /v1/comments/:id
DELETE /v1/comments/:id
```

### Search

```text
GET /v1/search?q=&type=all
GET /v1/search/users?q=
GET /v1/search/hashtags?q=
GET /v1/search/videos?q=
GET /v1/search/trending
```

### Wallet

```text
GET  /v1/wallet
GET  /v1/wallet/ledger
GET  /v1/wallet/withdrawals
POST /v1/wallet/withdrawals
```

### Referrals

```text
GET  /v1/referrals/me
POST /v1/referrals/apply
GET  /v1/referrals/stats
```

### Admin

```text
GET    /v1/admin/overview
GET    /v1/admin/users
GET    /v1/admin/users/:id
PATCH  /v1/admin/users/:id/status
POST   /v1/admin/users/:id/freeze-coins
GET    /v1/admin/videos
PATCH  /v1/admin/videos/:id/moderation
DELETE /v1/admin/videos/:id
GET    /v1/admin/withdrawals
POST   /v1/admin/withdrawals/:id/approve
POST   /v1/admin/withdrawals/:id/reject
GET    /v1/admin/fraud/events
GET    /v1/admin/fraud/users/:id
GET    /v1/admin/reports
PATCH  /v1/admin/reports/:id
GET    /v1/admin/analytics
POST   /v1/admin/trending/boost
POST   /v1/admin/ads
```

## 8. Backend Code Examples

### NestJS Auth Service

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly jwt: JwtService,
  ) {}

  async register(input: RegisterDto, ctx: RequestContext) {
    const existing = await this.users.findByUsername(input.username);
    if (existing) throw new Error('USERNAME_TAKEN');

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await this.users.create({
      username: input.username.toLowerCase(),
      passwordHash,
      publicCode: await this.users.createUniquePublicCode(),
    });

    return this.createTokenPair(user, ctx);
  }

  async login(input: LoginDto, ctx: RequestContext) {
    const user = await this.users.findByUsername(input.username.toLowerCase());
    if (!user) throw new UnauthorizedException();

    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException();
    if (user.status === 'banned') throw new UnauthorizedException('USER_BANNED');

    return this.createTokenPair(user, ctx);
  }

  private async createTokenPair(user: UserEntity, ctx: RequestContext) {
    const sessionId = randomUUID();
    const familyId = randomUUID();
    const refreshToken = randomUUID() + '.' + randomUUID();
    const refreshTokenHash = await bcrypt.hash(refreshToken, 12);

    await this.sessions.create({
      id: sessionId,
      userId: user.id,
      refreshTokenHash,
      refreshTokenFamily: familyId,
      deviceId: ctx.deviceId,
      deviceFingerprintHash: ctx.deviceFingerprintHash,
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent,
    });

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      sid: sessionId,
      role: user.role,
    });

    return { accessToken, refreshToken, user };
  }
}
```

### Coin Ledger Service

```ts
@Injectable()
export class CoinLedgerService {
  constructor(private readonly db: PrismaService) {}

  async grantReward(input: GrantRewardInput) {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.coinLedger.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) return existing;

      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { coinsAvailable: true, status: true },
      });
      if (!user || user.status !== 'active') throw new Error('USER_NOT_ELIGIBLE');

      const balanceAfter = Number(user.coinsAvailable) + input.amount;

      const ledger = await tx.coinLedger.create({
        data: {
          userId: input.userId,
          txType: input.type,
          amount: input.amount,
          balanceAfter,
          sourceUserId: input.sourceUserId,
          sourceVideoId: input.sourceVideoId,
          sourceEventId: input.sourceEventId,
          idempotencyKey: input.idempotencyKey,
          riskScore: input.riskScore,
          metadata: input.metadata ?? {},
        },
      });

      await tx.user.update({
        where: { id: input.userId },
        data: { coinsAvailable: { increment: input.amount } },
      });

      return ledger;
    });
  }
}
```

### Watch Reward Validation

```ts
const MIN_VALID_WATCH_MS = 10_000;
const MAX_DAILY_VIEW_REWARDS_PER_VIEWER = 500;
const REPEAT_WATCH_COOLDOWN_HOURS = 24;

export function isPotentiallyValidWatch(event: WatchEventInput): boolean {
  if (event.viewerId === event.creatorId) return false;
  if (event.watchMs < MIN_VALID_WATCH_MS) return false;
  if (event.interactionCount < 1) return false;
  if (event.completionPercent < 20) return false;
  if (!event.clientEventId) return false;
  return true;
}

@Processor('watch-events')
export class WatchRewardProcessor {
  async process(job: Job<WatchEventInput>) {
    const event = job.data;
    const risk = await this.fraud.scoreWatchEvent(event);

    const eligible =
      isPotentiallyValidWatch(event) &&
      risk.score < 60 &&
      !(await this.watchRepo.hasRewardedRecentWatch(
        event.viewerId,
        event.videoId,
        REPEAT_WATCH_COOLDOWN_HOURS,
      )) &&
      (await this.watchRepo.dailyRewardCount(event.viewerId)) < MAX_DAILY_VIEW_REWARDS_PER_VIEWER;

    const saved = await this.watchRepo.create({ ...event, riskScore: risk.score, rewardEligible: eligible });

    if (eligible) {
      await this.coins.grantReward({
        userId: event.viewerId,
        type: 'view_reward',
        amount: 1,
        sourceVideoId: event.videoId,
        sourceUserId: event.creatorId,
        sourceEventId: saved.id,
        idempotencyKey: `watch:${event.viewerId}:${event.videoId}:${saved.id}`,
        riskScore: risk.score,
      });
    }
  }
}
```

## 9. Coin Economy Logic

### Rewards

```text
Valid watch:              viewer gets 1 coin
Like received:            creator gets 0.5 coin
Comment received:         creator gets 0.5 coin
Follow received:          creator gets 1 coin
Active referral:          inviter gets 30 coins
```

### Critical Guardrails

- Like/comment/follow reward only once per actor-target pair.
- Self-engagement never rewards.
- Rewards from high-risk users go to pending balance or are denied.
- Withdrawals require available balance, not pending/frozen balance.
- Admin can freeze coins during investigation.
- Referral reward requires active user qualification.

### Active Referral Qualification

An invitee qualifies only if all conditions are true:

- Account age at least 48 hours.
- At least 10 valid watches.
- At least 3 organic interactions.
- At least 2 sessions on different times of day.
- Device fingerprint not linked to inviter.
- IP/network not repeatedly shared with inviter.
- Fraud score below threshold.

## 10. Fraud Detection System

### Risk Score Model

Use a hybrid system:

- Rule engine for explainable immediate blocking.
- Feature-based ML or anomaly model for adaptive scoring.
- Admin review workflows for uncertain cases.

### Signals

```text
Identity:
- Repeated device fingerprint across many accounts.
- Shared IP/subnet account bursts.
- Username creation patterns.
- Password reuse hash fingerprint, if privacy policy allows secure k-anonymized derivation.

Device:
- Emulator/debug/root signals.
- Missing sensors or unrealistic device metadata.
- Device ID reset frequency.
- Timezone/IP country mismatch.

Network:
- VPN/proxy/datacenter ASN.
- High request rate.
- Repeated failed login or token refresh patterns.

Behavior:
- Constant watch duration.
- Perfectly periodic swipes.
- No pause/replay/seek variance.
- Like/comment/follow too soon after video start.
- Engagement ratio statistically abnormal.
- Same accounts repeatedly engaging each other.

Referral:
- Invite chains from same device/IP.
- Referral clusters with low retention.
- Qualification activity completed too quickly.

Video:
- Upload spam.
- Duplicate media hash.
- Copyright match.
- AI moderation flags.
```

### Fraud Scoring Example

```ts
export class FraudScoringService {
  scoreWatchEvent(input: WatchEventFeatures): FraudScore {
    const reasons: string[] = [];
    let score = 0;

    if (input.isVpnOrDatacenterIp) {
      score += 20;
      reasons.push('vpn_or_datacenter_ip');
    }

    if (input.deviceAccountCountLast7d >= 3) {
      score += 30;
      reasons.push('multi_account_device');
    }

    if (input.swipeIntervalStdDevMs < 250 && input.eventsInSession > 20) {
      score += 25;
      reasons.push('robotic_scroll_pattern');
    }

    if (input.watchMsVarianceLast50 < 500) {
      score += 20;
      reasons.push('constant_watch_duration');
    }

    if (input.viewerCreatorGraphDensity > 0.75) {
      score += 25;
      reasons.push('engagement_farm_cluster');
    }

    if (input.accountAgeHours < 4 && input.rewardActionsLastHour > 30) {
      score += 25;
      reasons.push('new_account_reward_farming');
    }

    return {
      score: Math.min(score, 100),
      reasons,
      action: score >= 80 ? 'block' : score >= 60 ? 'hold_reward' : score >= 40 ? 'review' : 'allow',
    };
  }
}
```

### Actions by Risk

```text
0-39:  allow
40-59: allow but log; lower feed/reward trust
60-79: hold reward, require review or delayed settlement
80-100: block reward, freeze withdrawals, challenge or ban
```

## 11. Recommendation Engine

### Feed Candidate Sources

- Followed creators.
- Similar hashtags/categories.
- Trending videos.
- New videos exploration pool.
- Previously watched category expansion.
- Geo/language-relevant content.

### Ranking Formula

```text
score =
  0.30 * predicted_watch_time
+ 0.20 * completion_rate
+ 0.15 * engagement_rate
+ 0.10 * freshness_boost
+ 0.10 * creator_quality
+ 0.10 * interest_match
+ 0.05 * viral_velocity
- 0.30 * fraud_risk_penalty
- 0.20 * moderation_risk_penalty
- 0.10 * repetition_penalty
```

### Engagement Score

```ts
export function calculateVideoScore(v: VideoMetrics, now = Date.now()) {
  const ageHours = Math.max((now - v.publishedAtMs) / 36e5, 1);
  const engagement =
    v.likes * 2 +
    v.comments * 3 +
    v.shares * 4 +
    v.saves * 3 +
    v.followsFromVideo * 5;

  const retention = Math.min(v.avgWatchMs / Math.max(v.durationMs, 1), 1.5);
  const completion = v.completionRate / 100;
  const velocity = engagement / Math.pow(ageHours, 1.3);
  const quality = retention * 0.45 + completion * 0.35 + Math.log1p(velocity) * 0.2;

  return quality * 100 - v.fraudRisk * 0.8 - v.moderationRisk * 0.6;
}
```

### Feed Strategy

- First 20 videos: mix 50% personalized, 20% trending, 20% fresh exploration, 10% followed creators.
- New user cold start: ask optional interests, infer from early watch behavior.
- Avoid repeated creator/content clusters in one session.
- Cache feed pages in Redis with cursor-based pagination.
- Re-rank every session using recent behavior.

## 12. Video Pipeline

```text
1. Client requests signed upload URL.
2. Client uploads source video directly to object storage.
3. Client creates video record.
4. Video worker downloads/transcodes/compresses.
5. Thumbnail worker extracts preview.
6. Perceptual hash worker checks duplicate/reupload abuse.
7. AI moderation worker scans video.
8. If approved, status becomes published.
9. Search and feed indexes update asynchronously.
```

### Video Rules

- Max duration: 60 seconds.
- Vertical target: 9:16.
- Generate 240p/480p/720p variants for adaptive playback.
- Store source separately and protect it from public access.
- CDN URLs should be signed where needed.

## 13. AI Moderation

### Auto Detection

- Pornography/nudity.
- Violence/blood/weapons.
- Illegal content.
- Spam/scams.
- Copyright matches.
- Hate/harassment.
- Underage safety risk.

### Moderation States

```text
pending -> approved -> published
pending -> flagged -> admin review
pending -> rejected
published -> flagged -> limited distribution
published -> rejected/deleted
```

### Recommended Policy

- High-confidence severe content: auto reject.
- Medium confidence: block feed distribution, send to admin queue.
- Low confidence: publish with monitoring.
- Repeat offender: account limit, then ban.

## 14. Security System

### Application Security

- bcrypt cost 12+ or Argon2id.
- JWT access token short TTL.
- Refresh token rotation and reuse detection.
- Helmet/security headers.
- Strict CORS allowlist.
- Rate limiting by IP, user ID, device ID, and route.
- DTO validation with whitelist.
- Parameterized SQL via ORM/query builder.
- XSS protection through output escaping and sanitized rich text.
- CSRF protection for admin web if cookie-based auth is used.
- Admin MFA strongly recommended.

### Infrastructure Security

- HTTPS only.
- HSTS.
- WAF/CDN DDoS protection.
- Secrets in managed secret store.
- Database encryption at rest.
- Encrypted payout destination data.
- Private object storage buckets.
- Audit logs immutable or append-only.
- Least-privilege service accounts.

### Admin Security

- Separate admin role and permissions.
- MFA.
- IP allowlist for superadmin.
- Every action logged.
- Four-eyes approval for large withdrawals.
- Admin session timeout.

## 15. Admin Dashboard Design

### Pages

- Overview: DAU, WAU, videos uploaded, rewards issued, withdrawals pending, fraud alerts.
- Users: search, status, fraud score, balances, sessions, devices.
- Videos: moderation queue, takedown, creator history.
- Withdrawals: pending, risk score, approve/reject, payout method.
- Fraud Center: clusters, device/IP graphs, suspicious accounts, event timeline.
- Referrals: campaigns, suspicious chains, reward status.
- Reports: user reports and moderation outcomes.
- Ads: campaign management, impressions, click-through, budget.
- Trending: manual boost/suppress with audit trail.
- Admin logs: actions, filters, export.

### Admin Controls

- Ban user.
- Limit user.
- Freeze/unfreeze coins.
- Remove video.
- Force logout sessions.
- Reject withdrawal with reason.
- Mark fraud cluster.
- Suppress hashtag/video.

## 16. UI/UX Specification

### Mobile Pages

- Splash: fast brand load, token refresh.
- Login/Register: username/password, password strength, referral code optional.
- Home Feed: full-screen vertical video, swipe up/down, autoplay, prefetch next 2 videos.
- Upload: picker, trim, caption, hashtags, music, upload progress.
- Profile: avatar, bio, videos grid, follower stats, wallet summary.
- Search: users, hashtags, videos, trending.
- Notifications: interactions, reward updates, withdrawal status.
- Wallet: available/pending/frozen coins, ledger, withdrawal CTA.
- Withdraw: method, amount, destination, review state.
- Settings: sessions, security, blocked users, privacy.

### Design Direction

- Dark UI with high contrast.
- Bottom navigation: Home, Search, Upload, Wallet, Profile.
- Feed actions right side: like, comment, share, save, follow.
- Creator/caption lower left.
- Wallet states must be clear: available, pending, frozen.
- Fraud/security warnings should be calm, specific, and actionable.

## 17. DevOps and Deployment

### Docker Compose MVP

```yaml
services:
  api:
    build: ./services/api
    env_file: .env
    depends_on:
      - postgres
      - redis
  worker:
    build: ./services/workers
    env_file: .env
    depends_on:
      - postgres
      - redis
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: vibex
      POSTGRES_USER: vibex
      POSTGRES_PASSWORD: change_me
    volumes:
      - pgdata:/var/lib/postgresql/data
  redis:
    image: redis:7
  nginx:
    image: nginx:1.25
    volumes:
      - ./infra/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    ports:
      - "80:80"
      - "443:443"
volumes:
  pgdata:
```

### Production

- Kubernetes deployments for API and workers.
- HPA autoscaling by CPU, request latency, and queue depth.
- Managed PostgreSQL with read replicas.
- Managed Redis.
- CDN in front of media.
- Separate worker pools for video, moderation, fraud, notifications.
- Blue/green or canary deploys.
- Database migrations via CI/CD gated step.
- Backups tested monthly.

### Environment Variables

```text
DATABASE_URL=
REDIS_URL=
JWT_ACCESS_SECRET=
JWT_REFRESH_PEPPER=
CDN_BASE_URL=
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
PAYME_MERCHANT_ID=
PAYME_SECRET=
CLICK_SERVICE_ID=
CLICK_SECRET=
UZUM_API_KEY=
SENTRY_DSN=
```

## 18. Observability

### Metrics

- API latency p50/p95/p99.
- Feed generation latency.
- Upload processing time.
- Video moderation time.
- Queue depth by worker.
- Reward grants per hour.
- Withdrawal approval time.
- Fraud blocks/holds.
- Login failures.
- Token refresh reuse events.

### Alerts

- Withdrawal spike.
- Reward spike by user/device/IP.
- Feed error rate.
- Video processing backlog.
- Database CPU/locks.
- Redis memory.
- High 401/403/429 rates.
- AI moderation provider failure.

## 19. MVP Roadmap

### Phase 1 - Foundation

- Auth with username/password.
- Profiles.
- Video upload and processing.
- Basic feed.
- Likes/comments/follows.
- Coin ledger.
- Manual withdrawal requests.
- Basic admin panel.

### Phase 2 - Trust and Monetization

- Fraud scoring v1.
- Referral validation.
- AI moderation.
- Search.
- Notifications.
- Payment provider integrations.
- Admin fraud center.

### Phase 3 - Scale

- Personalized recommendation engine.
- CDN optimization.
- Feed cache and candidate precomputation.
- Read replicas.
- ClickHouse analytics.
- Advanced device fingerprinting.

### Phase 4 - Growth

- Ads platform.
- Creator campaigns.
- Boosted videos.
- Creator analytics.
- Regional trends.
- Telegram Mini App full wallet/feed support.

## 20. Monetization Strategy

- In-feed ads.
- Sponsored hashtag challenges.
- Brand creator campaigns.
- Paid creator boosts.
- Premium creator analytics.
- Withdrawal fee or spread, if legally permitted.
- Affiliate campaigns.
- Regional ad marketplace.

Do not depend on reward payouts alone for growth. Reward systems attract abuse; sustainable monetization must come from ads, campaigns, and creator tools.

## 21. Production Best Practices

- Treat coins as money-like assets.
- Use immutable ledgers and idempotency keys.
- Never trust client watch events without server-side validation.
- Delay or hold rewards for high-risk behavior.
- Keep AI moderation provider-agnostic.
- Separate public user IDs from internal UUIDs.
- Audit every admin action.
- Use feature flags for reward rule changes.
- Run load tests before marketing campaigns.
- Keep a fraud review runbook.
- Use staged rollouts for recommendation changes.

## 22. Scaling Plan to 1M+ Users

### 0-50K Users

- Modular NestJS API.
- Single managed PostgreSQL.
- Redis.
- CDN.
- BullMQ workers.

### 50K-250K Users

- Read replica.
- Queue separation.
- Feed precomputation.
- Search service.
- Dedicated media processing workers.
- Better fraud dashboards.

### 250K-1M Users

- Partition event tables.
- ClickHouse for analytics.
- Dedicated recommendation worker/service.
- Multi-region CDN.
- Autoscaling Kubernetes.
- Isolated payout service.

### 1M+ Users

- Split high-load modules into services.
- Event streaming with Kafka or Redpanda.
- Feature store for recommendation/fraud ML.
- Dedicated graph analysis for engagement farms.
- Regional feed caches.
- Advanced abuse operations team.

## 23. Enterprise Clean Code Rules

- Domain modules own their database access.
- Controllers only validate/authorize/delegate.
- Business rules live in services/domain policies.
- All reward grants require idempotency keys.
- All admin mutations require audit log.
- All external providers behind interfaces.
- All queue jobs retry safely and idempotently.
- All financial-like state changes inside DB transactions.
- Never use floating point for coins; use decimal.

## 24. Critical Launch Checklist

- Password hashing configured.
- JWT rotation tested.
- Refresh token reuse detection tested.
- Rate limits enabled.
- Video moderation blocks unsafe content.
- Withdrawal approval requires admin.
- Coin ledger reconciliation job exists.
- Fraud thresholds configured.
- Admin logs immutable enough for audits.
- Backups and restore tested.
- CDN and object storage private/public rules verified.
- Incident runbooks ready.

