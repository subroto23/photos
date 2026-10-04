/**
 * Subroto Das Gallery — Upload Worker
 *
 * Holds the GitHub token + upload PIN as Cloudflare SECRETS.
 * The browser never sees them. The frontend only sends the PIN the
 * user typed + compressed image data; this Worker verifies the PIN
 * server-side and commits to GitHub with its own hidden token.
 *
 * Secrets to set (NOT in wrangler.toml):
 *   wrangler secret put GH_TOKEN      → your fine-grained GitHub PAT (contents: write)
 *   wrangler secret put UPLOAD_PIN    → 145980
 *
 * Plain vars live in wrangler.toml: GH_OWNER, GH_REPO, GH_BRANCH, ALLOWED_ORIGIN
 */

// Production origin + any localhost/127.0.0.1 (for local dev)
function isAllowedOrigin(env, origin) {
  if (!origin) return true; // same-origin or non-browser (curl)
  if (origin === env.ALLOWED_ORIGIN) return true;
  try {
    const h = new URL(origin).hostname;
    if (h === 'localhost' || h === '127.0.0.1') return true;
  } catch {}
  return false;
}

function corsHeaders(env, origin) {
  const allow = isAllowedOrigin(env, origin) && origin ? origin : (env.ALLOWED_ORIGIN || '*');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(env, obj, status = 200, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env, origin) },
  });
}

// UTF-8 safe base64 (for JSON / XML text we commit)
function b64encode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64decode(b64) {
  return decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));
}

function xmlEscape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Constant-time-ish string compare
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function checkPin(env, pin) {
  const expected = String(env.UPLOAD_PIN || '').trim();
  return typeof pin === 'string' && expected.length > 0 && safeEqual(pin.trim(), expected);
}

async function gh(env, path, opts = {}) {
  return fetch(`https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'subro-gallery-worker',
      ...(opts.headers || {}),
    },
  });
}

async function getContents(env, path) {
  const r = await gh(env, `contents/${path}?ref=${env.GH_BRANCH}&t=${Date.now()}`);
  if (!r.ok) return { text: null, sha: null };
  const j = await r.json();
  return { text: j.content ? b64decode(j.content) : '', sha: j.sha };
}

async function putFile(env, path, contentB64, message, knownSha) {
  let sha = knownSha;
  if (sha === undefined) {
    const r = await gh(env, `contents/${path}?ref=${env.GH_BRANCH}`);
    sha = r.ok ? (await r.json()).sha : null;
  }
  const body = { message, content: contentB64, branch: env.GH_BRANCH };
  if (sha) body.sha = sha;
  const r = await gh(env, `contents/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.message || `GitHub ${r.status}`);
  }
}

function seoTitle(p) {
  if (p.caption && p.caption.trim()) return p.caption.trim();
  const d = new Date(p.dateTaken || p.date);
  const dateStr = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const cam = p.cameraModel ? ` — ${p.cameraModel}` : '';
  const cat = p.category && p.category !== 'General' ? `${p.category} ` : '';
  return `${cat}Photo by Subroto Das — ${dateStr}${cam}`;
}
function withName(s, suffix) {
  const has = /subroto\s*das/i.test(s || '');
  return has ? s : (s ? `${s}${suffix}` : 'Photo by Subroto Das');
}
function seoDesc(p) {
  if (p.description && p.description.trim()) return withName(p.description.trim(), ' — Photo by Subroto Das');
  const parts = [seoTitle(p)];
  if (p.cameraModel) parts.push(`Shot on ${p.cameraMake ? p.cameraMake + ' ' : ''}${p.cameraModel}`);
  if (p.aperture) parts.push(p.aperture);
  if (p.iso) parts.push(p.iso);
  if (p.focalLength) parts.push(p.focalLength);
  return withName(parts.join(' · '), ' · Photo by Subroto Das');
}

// IndexNow — instantly notify search engines (Bing, Yandex, Seznam, Naver…) on change.
// The key is public and served as /<key>.txt on the site.
const INDEXNOW_KEY = '985a261135b1a6047a235e2acbd3a3bd';
async function pingIndexNow(urls) {
  try {
    const list = [...new Set(['https://photos.subromart.com/', ...urls])].filter(Boolean).slice(0, 100);
    await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'photos.subromart.com',
        key: INDEXNOW_KEY,
        keyLocation: `https://photos.subromart.com/${INDEXNOW_KEY}.txt`,
        urlList: list,
      }),
    });
  } catch {}
}

function buildSitemap(photos) {
  const SITE = 'https://photos.subromart.com/';
  const today = new Date().toISOString().slice(0, 10);
  const imgs = photos.slice(0, 1000).map(p =>
    `    <image:image>\n      <image:loc>${xmlEscape(p.src)}</image:loc>\n      <image:title>${xmlEscape(seoTitle(p))}</image:title>\n      <image:caption>${xmlEscape(seoDesc(p))}</image:caption>\n    </image:image>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n  <url>\n    <loc>${SITE}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n${imgs}\n  </url>\n</urlset>\n`;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, origin) });
    }
    if (request.method !== 'POST') {
      return json(env, { error: 'Method not allowed' }, 405, origin);
    }

    // Soft origin check (defense in depth; PIN is the real gate)
    if (!isAllowedOrigin(env, origin)) {
      return json(env, { error: 'Forbidden origin' }, 403, origin);
    }

    const url = new URL(request.url);
    let body;
    try { body = await request.json(); } catch { return json(env, { error: 'Bad JSON' }, 400, origin); }

    if (!checkPin(env, body.pin)) {
      return json(env, { error: 'Wrong PIN' }, 401, origin);
    }

    try {
      // Just verify PIN
      if (url.pathname === '/api/auth') {
        return json(env, { ok: true }, 200, origin);
      }

      // Commit one image file
      if (url.pathname === '/api/upload') {
        const { path, content } = body;
        if (!path || !content) return json(env, { error: 'Missing path/content' }, 400, origin);
        if (!/^photos\/[A-Za-z0-9._\/-]+\.jpg$/.test(path)) {
          return json(env, { error: 'Invalid path' }, 400, origin);
        }
        await putFile(env, path, content, `Add: ${path.split('/').pop()}`);
        return json(env, { ok: true }, 200, origin);
      }

      // Append entries to gallery-data.json + rebuild sitemap.xml
      if (url.pathname === '/api/finalize') {
        const entries = Array.isArray(body.entries) ? body.entries : [];
        if (!entries.length) return json(env, { error: 'No entries' }, 400, origin);

        const { text, sha } = await getContents(env, 'gallery-data.json');
        let gd = { photos: [] };
        if (text) { try { gd = JSON.parse(text); } catch {} }
        if (!Array.isArray(gd.photos)) gd.photos = [];
        gd.photos.push(...entries);

        await putFile(env, 'gallery-data.json',
          b64encode(JSON.stringify(gd, null, 2)),
          `Gallery +${entries.length}`, sha);

        await putFile(env, 'sitemap.xml',
          b64encode(buildSitemap(gd.photos)),
          `Sitemap: ${gd.photos.length} images`);

        await pingIndexNow(entries.map(e => e.src));
        return json(env, { ok: true, total: gd.photos.length }, 200, origin);
      }

      // Delete one photo (file + data entry + sitemap)
      if (url.pathname === '/api/delete') {
        const { id, path } = body;
        if (!id && !path) return json(env, { error: 'Missing id/path' }, 400, origin);

        // Delete the image file (best effort)
        if (path) {
          if (!/^photos\/[A-Za-z0-9._\/-]+\.jpg$/.test(path)) return json(env, { error: 'Invalid path' }, 400, origin);
          const r = await gh(env, `contents/${path}?ref=${env.GH_BRANCH}`);
          if (r.ok) {
            const fsha = (await r.json()).sha;
            await gh(env, `contents/${path}`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: `Delete: ${path.split('/').pop()}`, sha: fsha, branch: env.GH_BRANCH }),
            });
          }
        }

        // Remove the entry from gallery-data.json
        const { text, sha } = await getContents(env, 'gallery-data.json');
        let gd = { photos: [] };
        if (text) { try { gd = JSON.parse(text); } catch {} }
        if (!Array.isArray(gd.photos)) gd.photos = [];
        const before = gd.photos.length;
        gd.photos = gd.photos.filter(p => {
          const byId = id && p.id === id;
          const byPath = path && typeof p.src === 'string' && p.src.endsWith(path);
          return !(byId || byPath);
        });
        if (gd.photos.length !== before) {
          await putFile(env, 'gallery-data.json', b64encode(JSON.stringify(gd, null, 2)), 'Gallery -1', sha);
          await putFile(env, 'sitemap.xml', b64encode(buildSitemap(gd.photos)), `Sitemap: ${gd.photos.length} images`);
          await pingIndexNow([]);
        }
        return json(env, { ok: true, total: gd.photos.length, removed: before - gd.photos.length }, 200, origin);
      }

      return json(env, { error: 'Not found' }, 404, origin);
    } catch (e) {
      return json(env, { error: e.message || 'Server error' }, 500, origin);
    }
  },
};
