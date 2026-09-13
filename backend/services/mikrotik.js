export async function createHotspotUser({ baseUrl, username, password, profile = 'default', limitUptime, routerUsername, routerPassword }) {
  if (!baseUrl || !routerUsername || !routerPassword) {
    throw new Error('MikroTik REST credentials are not configured');
  }
  if (!username || !password || !limitUptime) {
    throw new Error('HotSpot user data is incomplete');
  }

  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('MIKROTIK_BASE_URL is invalid');
  }
  if (url.protocol !== 'https:') {
    throw new Error('MikroTik REST API wajib menggunakan HTTPS');
  }

  const endpoint = `${url.toString().replace(/\/$/, '')}/rest/ip/hotspot/user/add`;
  const headers = {
    Authorization: `Basic ${Buffer.from(`${routerUsername}:${routerPassword}`).toString('base64')}`,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: username, password, profile, 'limit-uptime': limitUptime })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('MikroTik REST request failed');
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}
