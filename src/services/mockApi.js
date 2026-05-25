const delay = (ms = 260) => new Promise((resolve) => window.setTimeout(resolve, ms));

async function getPublicIp() {
  try {
    const response = await fetch('https://api.ipify.org?format=json', {
      signal: AbortSignal.timeout(1200),
    });
    const data = await response.json();
    return data.ip;
  } catch {
    return 'server-captured-ip';
  }
}

export const mockApi = {
  async securityInit({ fingerprint }) {
    await delay(180);
    const ipAddress = await getPublicIp();

    const payload = {
      ipAddress,
      fingerprint,
      initializedAt: new Date().toISOString(),
      riskScore: 8,
    };

    console.info('[mock-api] POST /security/init', payload);
    return payload;
  },

  async watchVideo({ userId, videoId, fingerprintHash }) {
    await delay();
    const payload = {
      userId,
      videoId,
      fingerprintHash,
      reward: 2,
      status: 'rewarded',
      idempotencyKey: `watch:${userId}:${videoId}`,
    };
    console.info('[mock-api] POST /videos/:id/watch-complete', payload);
    return payload;
  },

  async likeVideo({ creatorId, videoId }) {
    await delay(140);
    console.info('[mock-api] POST /videos/:id/like', {
      creatorId,
      videoId,
      creatorReward: 0.5,
    });
    return { creatorReward: 0.5 };
  },

  async commentVideo({ creatorId, videoId, body }) {
    await delay(180);
    console.info('[mock-api] POST /videos/:id/comments', {
      creatorId,
      videoId,
      body,
      creatorReward: 0.5,
    });
    return { creatorReward: 0.5 };
  },

  async followCreator({ creatorId }) {
    await delay(180);
    console.info('[mock-api] POST /users/:id/follow', {
      creatorId,
      creatorReward: 1,
    });
    return { creatorReward: 1 };
  },
};
