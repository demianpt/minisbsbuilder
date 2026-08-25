import { BriefBrainError, CancelledError } from '../shared/errors.mjs';

/**
 * Stock media adapter.
 *
 * Search only. This module never calls a licensing endpoint, so every URL it
 * returns is a **watermarked preview** and no download is spent against the
 * account. That is the whole point: a client sees the concept with real,
 * on-brief imagery and buys only the assets they keep.
 *
 * The browser never sees the token — it asks the server for a media plan and
 * receives preview URLs plus the asset ids needed to license them later.
 */

const MAX_PER_PAGE = 100;

function timeoutSignal(signal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function firstUrl(...candidates) {
  for (const candidate of candidates) {
    const url = typeof candidate === 'string' ? candidate : candidate?.url;
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url;
  }
  return '';
}

function text(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Accept the way strategists actually copy Shutterstock assets: either the
 * numeric id or the complete public asset URL (including tracking query
 * strings). The asset id is always taken from an explicit id field or the
 * final numeric path segment/suffix before any unrelated tracking values.
 */
export function extractShutterstockAssetId(value) {
  const raw = String(value ?? '').trim();
  if (/^[1-9]\d{5,14}$/.test(raw)) return raw;
  if (!raw || raw.length > 4096) return '';

  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'shutterstock.com' || host.endsWith('.shutterstock.com')) {
      for (const key of ['id', 'image_id', 'video_id', 'asset_id', 'imageId', 'videoId']) {
        const candidate = String(url.searchParams.get(key) || '').trim();
        if (/^[1-9]\d{5,14}$/.test(candidate)) return candidate;
      }
      const pathname = decodeURIComponent(url.pathname).replace(/\/+$/, '');
      // Public image pages end in "-<assetId>" and video pages in
      // "clip-<assetId>". Read the path before looking at tracking params.
      const pathMatch = pathname.match(/(?:-|\/)([1-9]\d{5,14})$/);
      if (pathMatch) return pathMatch[1];
    }
  } catch {
    // It may be a pasted label such as "Shutterstock ID: 123456789".
  }

  const labelled = raw.match(/\b(?:shutterstock\s*)?(?:asset\s*)?(?:image\s*|video\s*)?id\s*[:=#-]?\s*([1-9]\d{5,14})\b/i);
  if (labelled) return labelled[1];

  const candidates = [...raw.matchAll(/\b([1-9]\d{5,14})\b/g)].map((match) => match[1]);
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : '';
}

/** Purchase deep link. Only ever built from an id the API returned. */
function assetPage(kind, id) {
  return kind === 'video'
    ? `https://www.shutterstock.com/video/clip-${id}`
    : `https://www.shutterstock.com/image-photo/-${id}`;
}

/**
 * One normalised shape for images and videos alike, so every consumer — the
 * assignment prompt, the editor's picker, the preview renderer and the export —
 * reads the same fields regardless of asset kind.
 */
function normalizeImage(entry) {
  const assets = entry?.assets || {};
  const src = firstUrl(assets.preview_1500, assets.preview_1000, assets.preview, assets.huge_thumb);
  if (!src || !entry?.id) return null;
  return {
    id: `ss-image-${entry.id}`,
    assetId: String(entry.id),
    kind: 'image',
    provider: 'shutterstock',
    licensed: false,
    src,
    poster: '',
    thumb: firstUrl(assets.large_thumb, assets.small_thumb, assets.preview, src),
    alt: text(entry.description, 240) || 'Shutterstock preview image',
    width: Number(assets.preview_1500?.width || assets.preview?.width) || null,
    height: Number(assets.preview_1500?.height || assets.preview?.height) || null,
    aspect: Number(entry.aspect) || null,
    duration: null,
    keywords: Array.isArray(entry.keywords) ? entry.keywords.slice(0, 12).map((word) => text(word, 40)).filter(Boolean) : [],
    url: firstUrl(entry.url) || assetPage('image', entry.id),
  };
}

function normalizeVideo(entry) {
  const assets = entry?.assets || {};
  const src = firstUrl(assets.preview_mp4, assets.preview_webm, assets.thumb_mp4);
  if (!src || !entry?.id) return null;
  const posters = Array.isArray(assets.thumb_jpgs?.urls) ? assets.thumb_jpgs.urls : [];
  const poster = firstUrl(...posters, assets.thumb_jpg, assets.preview_jpg);
  return {
    id: `ss-video-${entry.id}`,
    assetId: String(entry.id),
    kind: 'video',
    provider: 'shutterstock',
    licensed: false,
    src,
    // A background or hero video with no poster flashes empty while it buffers.
    poster,
    thumb: poster,
    alt: text(entry.description, 240) || 'Shutterstock preview video',
    width: Number(assets.preview_mp4?.width) || null,
    height: Number(assets.preview_mp4?.height) || null,
    aspect: Number(entry.aspect) || null,
    duration: Number(entry.duration) || null,
    keywords: Array.isArray(entry.keywords) ? entry.keywords.slice(0, 12).map((word) => text(word, 40)).filter(Boolean) : [],
    url: firstUrl(entry.url) || assetPage('video', entry.id),
  };
}

export function createShutterstockProvider({ config, fetchImpl = globalThis.fetch, logger } = {}) {
  if (!config) throw new Error('The Shutterstock provider requires server configuration.');
  const base = String(config.shutterstockBaseUrl || '').replace(/\/$/, '');
  const token = config.shutterstockApiToken || '';
  const clientId = config.shutterstockClientId || '';
  const clientSecret = config.shutterstockClientSecret || '';
  const configured = Boolean(token || (clientId && clientSecret));

  function authorization() {
    if (token) return `Bearer ${token}`;
    return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  }

  function assertConfigured() {
    if (!configured) {
      throw new BriefBrainError('STOCK_NOT_CONFIGURED', 'Stock media search is not configured on this server.', { status: 503 });
    }
  }

  /** The quota numbers Shutterstock returns with a 429, if it returned any. */
  async function readQuota(response) {
    try {
      const body = await response.json();
      return {
        limit: Number.isFinite(Number(body?.limit)) ? Number(body.limit) : null,
        remaining: Number.isFinite(Number(body?.remaining)) ? Number(body.remaining) : null,
        reset: Number.isFinite(Number(body?.reset)) ? Number(body.reset) : null,
      };
    } catch (error) {
      return { limit: null, remaining: null, reset: null };
    }
  }

  async function get(path, params, { signal, allowMissing = false } = {}) {
    assertConfigured();
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    const deadline = timeoutSignal(signal, config.shutterstockTimeoutMs);
    try {
      const response = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: authorization(),
          // Shutterstock rejects requests without one.
          'user-agent': 'sbs-page-builder/1.0 (+brief-brain media)',
        },
        signal: deadline.signal,
      });
      // A lookup by id has a real "no such asset" answer; a search does not.
      // 403 in this context means the token lacks images.view scope, not that
      // the credentials are invalid (search still works).
      if (allowMissing && (response.status === 404 || response.status === 400 || response.status === 403)) return null;
      if (!response.ok) {
        if (response.status === 429) {
          // The body carries the account's own numbers. `reset` is epoch ms.
          const quota = await readQuota(response);
          const at = quota.reset ? new Date(quota.reset) : null;
          const when = at && !Number.isNaN(at.getTime())
            ? ` It resets at ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
            : ' Try again shortly.';
          throw new BriefBrainError(
            'STOCK_RATE_LIMITED',
            `Shutterstock's request limit for this account is used up${quota.limit ? ` (${quota.limit} per hour)` : ''}.${when}`,
            { status: 429, details: { status: 429, ...quota } },
          );
        }
        if (response.status === 401 || response.status === 403) {
          throw new BriefBrainError('STOCK_DENIED', 'Shutterstock refused these credentials. Check the API token, or the client id and secret.', { status: 502, details: { status: response.status } });
        }
        throw new BriefBrainError('STOCK_UNAVAILABLE', 'Shutterstock could not complete the search.', { status: 503, details: { status: response.status } });
      }
      return await response.json();
    } catch (error) {
      if (deadline.timedOut()) throw new BriefBrainError('STOCK_TIMEOUT', 'Shutterstock took too long to respond.', { status: 504, cause: error });
      if (signal?.aborted || error?.name === 'AbortError') throw new CancelledError();
      if (error instanceof BriefBrainError) throw error;
      throw new BriefBrainError('STOCK_UNAVAILABLE', 'Shutterstock could not be reached.', { status: 503, cause: error });
    } finally {
      deadline.dispose();
    }
  }

  /**
   * Construct a watermarked preview from Shutterstock's predictable CDN URLs.
   * This is the fallback when the API token lacks images.view scope (403) but
   * the image still exists on the CDN. Returns null if the CDN rejects the URL.
   */
  async function assetFromCdn(assetId, { signal } = {}) {
    const src = `https://image.shutterstock.com/shutterstock/photos/${assetId}/display_1500/stock-photo-${assetId}.jpg`;
    const thumb = `https://image.shutterstock.com/image-photo/-260nw-${assetId}.jpg`;
    // Verify the CDN actually has this asset before returning a constructed object.
    const deadline = timeoutSignal(signal, config.shutterstockTimeoutMs);
    try {
      const probe = await fetchImpl(src, { method: 'HEAD', signal: deadline.signal });
      if (!probe.ok) return null;
    } catch {
      return null;
    } finally {
      deadline.dispose();
    }
    return {
      id: `ss-image-${assetId}`,
      assetId: String(assetId),
      kind: 'image',
      provider: 'shutterstock',
      licensed: false,
      src,
      poster: '',
      thumb,
      alt: 'Shutterstock preview image',
      width: null,
      height: null,
      aspect: null,
      duration: null,
      keywords: [],
      url: assetPage('image', assetId),
    };
  }

  /**
   * One asset, by the id printed on its Shutterstock page.
   *
   * The kind is not part of that id, so the image catalogue is checked first and
   * the video catalogue is used only when the image lookup has no match. Still a watermarked preview: this is the "I already found the
   * shot I want" path, not a licensing call.
   */
  async function assetById({ id, signal } = {}) {
    const assetId = extractShutterstockAssetId(id);
    if (!assetId) {
      throw new BriefBrainError('STOCK_ID_INVALID', 'Paste a Shutterstock asset URL or a numeric Shutterstock id (6–15 digits).', { status: 422 });
    }

    // Most hand-picked assets are images. Resolve that catalogue first and
    // return immediately when it succeeds. The old Promise.all also queried the
    // video catalogue, so a video permission error could incorrectly fail a
    // perfectly valid image lookup.
    const image = await get(`/images/${assetId}`, { view: 'full' }, { signal, allowMissing: true });
    const normalizedImage = image && normalizeImage(image);
    if (normalizedImage) return normalizedImage;

    const video = await get(`/videos/${assetId}`, { view: 'full' }, { signal, allowMissing: true });
    const normalizedVideo = video && normalizeVideo(video);
    if (normalizedVideo) return normalizedVideo;

    // API lookup failed (token may lack images.view scope). Fall back to the
    // predictable CDN URL which serves watermarked previews without auth.
    const cdnAsset = await assetFromCdn(assetId, { signal });
    if (cdnAsset) return cdnAsset;

    throw new BriefBrainError('STOCK_ID_NOT_FOUND', `Shutterstock has no image or clip with the id ${assetId}.`, { status: 404 });
  }

  async function searchImages({ query, count = 10, orientation = '', signal } = {}) {
    const payload = await get('/images/search', {
      query: text(query, 200),
      per_page: Math.max(1, Math.min(MAX_PER_PAGE, count)),
      sort: 'popular',
      image_type: 'photo',
      orientation,
      safe: config.shutterstockSafeSearch ? 'true' : 'false',
      view: 'full',
    }, { signal });
    const data = Array.isArray(payload?.data) ? payload.data : [];
    return data.map(normalizeImage).filter(Boolean);
  }

  async function searchVideos({ query, count = 2, signal } = {}) {
    if (count <= 0) return [];
    const payload = await get('/videos/search', {
      query: text(query, 200),
      per_page: Math.max(1, Math.min(MAX_PER_PAGE, count)),
      sort: 'popular',
      safe: config.shutterstockSafeSearch ? 'true' : 'false',
      view: 'full',
    }, { signal });
    const data = Array.isArray(payload?.data) ? payload.data : [];
    return data.map(normalizeVideo).filter(Boolean);
  }

  /*
   * The probe is cached, because it is a real search and the account is metered.
   *
   * The status endpoint is polled by every page load, and each poll used to
   * spend one of the account's hundred hourly requests to draw a green dot — so
   * a morning of reloads could exhaust the quota before anybody asked for a
   * single photograph, and the failure then looked like broken credentials.
   * Whether a credential works does not change minute to minute; five is a
   * generous freshness for it.
   */
  const PROBE_TTL_MS = 5 * 60 * 1000;
  let probe = { at: 0, value: null };

  async function status() {
    if (!configured) return { provider: 'shutterstock', configured: false, available: false, auth: 'none' };
    const auth = token ? 'token' : 'basic';
    const now = Date.now();
    if (probe.value) {
      const fresh = now - probe.at < PROBE_TTL_MS;
      // A quota that is spent stays spent until it resets. Asking again before
      // then cannot tell us anything new and costs a request we do not have.
      const stillThrottled = probe.value.throttled && probe.value.resetsAt && now < probe.value.resetsAt;
      if (fresh || stillThrottled) return { ...probe.value, cached: true };
    }
    const remember = (value) => { probe = { at: Date.now(), value }; return value; };
    try {
      // One cheap real search is the only honest probe: credentials that parse
      // can still be unauthorised for the API.
      await get('/images/search', { query: 'office', per_page: 1, view: 'minimal' }, {});
      return remember({ provider: 'shutterstock', configured: true, available: true, auth });
    } catch (error) {
      logger?.warn('shutterstock_status_unavailable', { code: error.code });
      if (error.code === 'STOCK_RATE_LIMITED') {
        // Throttled is not broken: configured, authorised, and out of allowance.
        return remember({ provider: 'shutterstock', configured: true, available: true, throttled: true, auth, resetsAt: error.details?.reset ?? null });
      }
      return remember({ provider: 'shutterstock', configured: true, available: false, auth });
    }
  }

  return Object.freeze({
    kind: 'shutterstock',
    configured,
    imageCount: config.mediaImageCount,
    videoCount: config.mediaVideoCount,
    searchImages,
    searchVideos,
    assetById,
    status,
  });
}
