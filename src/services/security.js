async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function createDeviceFingerprint() {
  const parts = [
    navigator.userAgent,
    navigator.language,
    navigator.platform,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.hardwareConcurrency ?? 'unknown-cpu',
    navigator.deviceMemory ?? 'unknown-memory',
    window.Telegram?.WebApp?.platform ?? 'web',
  ];

  return {
    hash: await sha256(parts.join('|')),
    browser: navigator.userAgent,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: {
      width: screen.width,
      height: screen.height,
      colorDepth: screen.colorDepth,
    },
    telegramPlatform: window.Telegram?.WebApp?.platform ?? null,
  };
}
