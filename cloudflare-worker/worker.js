// Subroto Das Photos — upload & publishing Worker. Secrets: GH_TOKEN, UPLOAD_PIN. Vars: wrangler.toml.

const SITE = 'https://photos.subromart.com';
const INDEXNOW_KEY = '985a261135b1a6047a235e2acbd3a3bd';
const HUB = 'https://pubsubhubbub.appspot.com/';
const UPLOAD_RE = /^photos\/[A-Za-z0-9._\/-]+\.jpg$/;
const IMAGE_RE = /^photos\/[A-Za-z0-9._\/-]+\.(jpe?g|png)$/i;
const SRC_RE = /^https:\/\/photos\.subromart\.com\/photos\/[A-Za-z0-9._\/-]+\.(jpe?g|png)$/i;
const PERSON = {
  '@type': 'Person',
  '@id': `${SITE}/#person`,
  name: 'Subroto Das',
  alternateName: ['Subroto', 'সুব্রত দাস'],
  jobTitle: 'Software Engineer',
  url: 'https://me.subromart.com',
  worksFor: { '@type': 'Organization', name: "Apar's Classroom" },
  sameAs: ['https://me.subromart.com', 'https://subromart.com', 'https://systems.subromart.com', 'https://github.com/subroto23'],
};

// ---------- HTTP / auth ----------

function isAllowedOrigin(env, origin) {
  if (!origin) return true;
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

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  e.expose = true;
  return e;
}

// ---------- GitHub ----------

async function gh(env, path, opts = {}) {
  return fetch(`https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'subro-gallery-worker',
      ...(opts.headers || {}),
    },
  });
}

async function ghJson(env, path, opts = {}) {
  const r = await gh(env, path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.message || `GitHub ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return j;
}

const postJson = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function exists(env, path, ref) {
  const r = await gh(env, `contents/${path}?ref=${ref}`, { method: 'HEAD' });
  return r.ok;
}

async function readText(env, path, ref) {
  const r = await gh(env, `contents/${path}?ref=${ref}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
  return r.ok ? r.text() : null;
}

async function readGallery(env, ref) {
  const r = await gh(env, `contents/gallery-data.json?ref=${ref}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
  if (r.status === 404) return { photos: [] };
  if (!r.ok) throw new Error(`Could not read gallery data (${r.status})`);
  const gd = JSON.parse(await r.text());
  if (!Array.isArray(gd.photos)) gd.photos = [];
  return gd;
}

// Read-modify-write the repo as ONE atomic commit; retries if main moved meanwhile.
async function mutate(env, message, change) {
  for (let attempt = 1; ; attempt++) {
    const head = (await ghJson(env, `git/ref/heads/${env.GH_BRANCH}`)).object.sha;
    const base = await ghJson(env, `git/commits/${head}`);
    const gd = await readGallery(env, head);
    const { files, result } = await change(gd, head);
    if (!files.length) return result;
    const tree = await ghJson(env, 'git/trees', postJson({
      base_tree: base.tree.sha,
      tree: files.map(f => ({
        path: f.path,
        mode: '100644',
        type: 'blob',
        ...(f.delete ? { sha: null } : f.sha ? { sha: f.sha } : { content: f.content }),
      })),
    }));
    const commit = await ghJson(env, 'git/commits', postJson({ message, tree: tree.sha, parents: [head] }));
    try {
      await ghJson(env, `git/refs/heads/${env.GH_BRANCH}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha: commit.sha }),
      });
      return result;
    } catch (e) {
      if (attempt >= 3 || e.status !== 422) throw e;
    }
  }
}

// Legacy single-file commit (kept so an old cached page can still upload).
async function putFile(env, path, contentB64, message) {
  const r0 = await gh(env, `contents/${path}?ref=${env.GH_BRANCH}`);
  const sha = r0.ok ? (await r0.json()).sha : null;
  const body = { message, content: contentB64, branch: env.GH_BRANCH };
  if (sha) body.sha = sha;
  await ghJson(env, `contents/${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

// ---------- Photo data helpers ----------

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const ldJson = o => JSON.stringify(o).replace(/</g, '\\u003c');
const DATE_FMT = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const photoDate = p => new Date(p.dateTaken || p.date);
const fmtDate = d => (isNaN(d) ? '' : DATE_FMT.format(d));
const isoDay = d => (isNaN(d) ? new Date() : d).toISOString().slice(0, 10);
const isoTime = (v, fallback) => { const d = new Date(v); return isNaN(d) ? fallback : d.toISOString(); };
const sortByTime = (list, time) => list.map(p => [time(p) || 0, p]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
const sortByDate = list => sortByTime(list, p => +photoDate(p));
const hasName = s => /subroto\s*das/i.test(s || '');
const withName = (s, suffix) => (hasName(s) ? s : s ? s + suffix : 'Photo by Subroto Das');
const catName = c => (c === 'BlackWhite' ? 'Black & White' : c || '');
const pageUrl = p => `${SITE}/photo/${p.slug}/`;

function truncate(s, n) {
  s = String(s || '').trim();
  return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
}

// A caption that is really just a camera filename carries no meaning for search.
const JUNK_CAPTION = /^(?:[0-9_\-\s().]+|(?:img|dsc|dscn|image|photo|pic|screenshot|pxl|vid|whatsapp)[\s_\-0-9().]*)$/i;

function baseTitle(p) {
  const cap = (p.caption || '').trim();
  if (cap && !JUNK_CAPTION.test(cap)) return cap;
  const cat = catName(p.category), d = fmtDate(photoDate(p));
  return `${cat && cat !== 'General' ? `${cat} photo` : 'Photo'} by Subroto Das${d ? ` — ${d}` : ''}`;
}

// Many photos share one caption after a bulk upload. Identical titles make Google
// treat the pages as duplicates and drop all but one, so number them: "… — 7 of 39".
const TITLES = new WeakMap();
function prepareTitles(photos) {
  const groups = new Map();
  for (const p of photos) {
    const base = baseTitle(p);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(p);
  }
  for (const [base, list] of groups) {
    const short = truncate(base, 70);
    if (list.length === 1) { TITLES.set(list[0], { base: short, suffix: '' }); continue; }
    sortByDate(list).forEach((p, i) => TITLES.set(p, { base: short, suffix: ` — ${i + 1} of ${list.length}` }));
  }
}
const titleParts = p => TITLES.get(p) || { base: truncate(baseTitle(p), 70), suffix: '' };
function titleOf(p) { const t = titleParts(p); return t.base + t.suffix; }
// Keep the distinguishing suffix even when the <title> must stay short.
function headTitle(p) { const t = titleParts(p); return `${truncate(t.base, 52)}${t.suffix} | Subroto Das Photos`; }

function cameraOf(p) {
  const make = (p.cameraMake || '').trim(), model = (p.cameraModel || '').trim();
  if (!model) return make;
  return make && !model.toLowerCase().startsWith(make.toLowerCase().split(/\s+/)[0]) ? `${make} ${model}` : model;
}

function descOf(p) {
  const { base, suffix } = titleParts(p);
  const own = (p.description || '').trim();
  if (own) return withName(`${own}${suffix}`, ' — Photo by Subroto Das.');
  const d = fmtDate(photoDate(p)), cam = cameraOf(p), cat = catName(p.category);
  const kind = cat && cat !== 'General' ? `${cat} photo` : 'Photo';
  const cap = (p.caption || '').trim();
  const lead = cap && !JUNK_CAPTION.test(cap)
    ? `${base}${suffix} — ${kind.toLowerCase()} by Subroto Das (সুব্রত দাস)`
    : `${kind}${suffix} by Subroto Das (সুব্রত দাস)`;
  return `${lead}${d ? `, taken on ${d}` : ''}${cam ? ` with ${cam}` : ''}. From the official Subroto Das Photos gallery.`;
}

const altOf = p => withName((p.alt || '').trim() || titleOf(p), ' — photo by Subroto Das');

// <meta description> is capped at ~158 chars; keep the "— 7 of 39" part so sibling
// pages from one bulk upload never share the same snippet.
function metaOf(p) {
  const { suffix } = titleParts(p), full = descOf(p), short = truncate(full, 158);
  return !suffix || short.includes(suffix) ? short : `${truncate(full, 158 - suffix.length)}${suffix}`;
}

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Stable, unique, keyword-rich URL slug per photo (assigned once, never changed).
function assignSlugs(list, taken) {
  for (const p of list) {
    if (p.slug) continue;
    const ts = (String(p.id || '').match(/\d{10,}/) || [])[0];
    const tail = ts ? Number(ts).toString(36) : Math.random().toString(36).slice(2, 9);
    const cap = slugify(p.caption).replace(/^subroto-das-?/, '');
    const base = ['subroto-das', slugify(p.category), cap].filter(Boolean).join('-').slice(0, 64).replace(/-+$/, '');
    let slug = `${base}-${tail}`;
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${tail}-${i}`;
    taken.add(slug);
    p.slug = slug;
  }
}

const FIELDS = ['id', 'src', 'caption', 'category', 'date', 'alt', 'description', 'dateTaken', 'cameraMake', 'cameraModel', 'exposure', 'aperture', 'iso', 'focalLength', 'lens'];

function cleanEntry(e) {
  if (!e || typeof e !== 'object') throw httpError(400, 'Invalid entry');
  const out = {};
  for (const k of FIELDS) {
    if (typeof e[k] === 'string' && e[k].trim()) out[k] = e[k].trim().slice(0, k === 'description' ? 2000 : 300);
  }
  if (Number.isInteger(e.w) && Number.isInteger(e.h) && e.w > 0 && e.h > 0) { out.w = e.w; out.h = e.h; }
  if (!out.id || !SRC_RE.test(out.src || '') || out.src.includes('..')) throw httpError(400, 'Invalid entry');
  if (!out.date) out.date = new Date().toISOString();
  return out;
}

// Interleaved prev/next photos around index i (for "More photos" links).
function neighbors(order, i, n = 8) {
  const out = [];
  for (let a = i - 1, b = i + 1; out.length < n && (a >= 0 || b < order.length);) {
    if (b < order.length) out.push(order[b++]);
    if (out.length < n && a >= 0) out.push(order[a--]);
  }
  return out;
}

function pagesFor(photos, slugs) {
  prepareTitles(photos);
  const order = sortByDate(photos.filter(p => p.slug));
  const files = [];
  order.forEach((p, i) => {
    if (slugs.has(p.slug)) files.push({ path: `photo/${p.slug}/index.html`, content: photoPage(p, neighbors(order, i)) });
  });
  return files;
}

// ---------- Generated files ----------

const PAGE_CSS = `:root{--bg:#0a0806;--bg2:#12100d;--ink:#ede8df;--ink2:#b5ad9e;--ink3:#857b6c;--gold:#c9a227;--line:rgba(255,255,255,.08)}
*{box-sizing:border-box;margin:0;padding:0}
body{overflow-x:clip}
img{max-width:100%}
body{background:var(--bg);color:var(--ink);font-family:Inter,system-ui,-apple-system,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.top{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;background:rgba(10,8,6,.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--line)}
.brand{font-family:'Cormorant Garamond',Georgia,serif;font-size:1.3rem;letter-spacing:.04em}
.brand em{color:var(--gold)}
.all{font-size:.74rem;color:var(--gold);border:1px solid rgba(201,162,39,.35);padding:7px 14px;border-radius:100px;white-space:nowrap}
main{max-width:1100px;margin:0 auto;padding:22px 16px 48px}
.hero{text-align:center}
.hero img{display:inline-block;vertical-align:top;max-width:100%;max-height:78vh;width:auto;height:auto;border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.55)}
.info{max-width:720px;margin:26px auto 0;text-align:center}
.crumb{font-size:.7rem;color:var(--ink3);letter-spacing:.08em;text-transform:uppercase}
.crumb a{color:var(--gold)}
h1{font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:clamp(1.6rem,4.2vw,2.4rem);line-height:1.2;margin:10px 0 6px}
.by{font-size:.85rem;color:var(--ink2)}
.by strong{color:var(--ink);font-weight:600}
.desc{font-size:.9rem;color:var(--ink2);margin:14px 0}
.facts{list-style:none;display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:14px 0 22px}
.facts li{font-size:.7rem;color:var(--ink2);border:1px solid var(--line);border-radius:100px;padding:5px 12px}
.btn{display:inline-block;background:linear-gradient(135deg,#c9a227,#e0be4c);color:#0a0806;font-weight:600;font-size:.82rem;padding:11px 24px;border-radius:100px}
.more{margin-top:48px}
.more h2{font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:1.45rem;text-align:center;margin-bottom:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.desc,h1{overflow-wrap:anywhere}
.card{display:block;border-radius:12px;overflow:hidden;background:var(--bg2);border:1px solid var(--line);transition:border-color .2s}
.card:hover{border-color:rgba(201,162,39,.45)}
.card img{display:block;width:100%;height:auto;aspect-ratio:1;object-fit:cover}
.card span{display:block;font-size:.7rem;color:var(--ink2);padding:8px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
footer{text-align:center;font-size:.72rem;color:var(--ink3);padding:28px 16px;border-top:1px solid var(--line)}
footer a{color:var(--ink2)}
@media(max-width:600px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.hero img{max-height:70vh;border-radius:10px}.brand{font-size:1.1rem}main{padding:16px 12px 40px}}`;

function photoPage(p, related) {
  const url = pageUrl(p), title = titleOf(p), desc = descOf(p), meta = metaOf(p), alt = altOf(p);
  const head = headTitle(p);
  const cat = catName(p.category);
  const dateStr = fmtDate(photoDate(p)), cam = cameraOf(p);
  const year = new Date(p.date).getFullYear() || new Date().getFullYear();
  const dims = p.w && p.h ? ` width="${p.w}" height="${p.h}"` : '';
  const facts = [dateStr && `Taken ${dateStr}`, cam, p.lens, p.focalLength, p.aperture, p.exposure, p.iso].filter(Boolean);
  const keywords = ['Subroto Das', 'Subroto', 'সুব্রত দাস', 'Subroto Das Photos', cat].filter(Boolean).join(', ');
  const exifData = [['camera', cam], ['lens', p.lens], ['focalLength', p.focalLength], ['fNumber', p.aperture], ['exposureTime', p.exposure], ['isoSpeed', p.iso]]
    .filter(([, v]) => v).map(([name, value]) => ({ '@type': 'PropertyValue', name, value }));
  const person = { '@id': PERSON['@id'] };
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ImageObject', '@id': `${url}#image`, contentUrl: p.src, url, name: title, caption: title, description: desc,
        ...(p.w && p.h ? { width: p.w, height: p.h } : {}),
        encodingFormat: /\.png$/i.test(p.src) ? 'image/png' : 'image/jpeg',
        uploadDate: p.date, datePublished: p.date, ...(p.dateTaken ? { dateCreated: p.dateTaken } : {}),
        creator: person, author: person, copyrightHolder: person,
        creditText: 'Subroto Das', copyrightNotice: `© ${year} Subroto Das`, copyrightYear: year,
        keywords, ...(exifData.length ? { exifData } : {}), mainEntityOfPage: url,
      },
      {
        '@type': 'WebPage', '@id': url, url, name: head, description: meta, inLanguage: 'en', datePublished: p.date,
        primaryImageOfPage: { '@id': `${url}#image` }, isPartOf: { '@id': `${SITE}/#website` },
        breadcrumb: { '@id': `${url}#breadcrumb` }, author: person,
      },
      {
        '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`, itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Subroto Das Photos', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: title },
        ],
      },
      { '@type': 'WebSite', '@id': `${SITE}/#website`, url: `${SITE}/`, name: 'Subroto Das Photos', publisher: person },
      PERSON,
    ],
  };
  const more = related.map(r => `<a class="card" href="${esc(pageUrl(r))}"><img src="${esc(r.src)}" alt="${esc(altOf(r))}" loading="lazy" decoding="async"${r.w && r.h ? ` width="${r.w}" height="${r.h}"` : ''} onerror="this.parentNode.remove()"><span>${esc(truncate(titleOf(r), 46))}</span></a>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(head)}</title>
<meta name="description" content="${esc(meta)}">
<meta name="author" content="Subroto Das">
<meta name="keywords" content="${esc(keywords)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${esc(url)}">
<link rel="icon" type="image/png" href="https://me.subromart.com/favicon.png">
<link rel="alternate" type="application/atom+xml" title="Subroto Das Photos" href="${SITE}/feed.xml">
<meta name="theme-color" content="#0a0806">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Subroto Das Photos">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)} — Subroto Das">
<meta property="og:description" content="${esc(meta)}">
<meta property="og:image" content="${esc(p.src)}">
<meta property="og:image:alt" content="${esc(alt)}">${p.w && p.h ? `
<meta property="og:image:width" content="${p.w}">
<meta property="og:image:height" content="${p.h}">` : ''}
<meta property="article:author" content="Subroto Das">
<meta property="article:published_time" content="${esc(p.date)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)} — Subroto Das">
<meta name="twitter:description" content="${esc(meta)}">
<meta name="twitter:image" content="${esc(p.src)}">
<meta name="twitter:image:alt" content="${esc(alt)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;1,400&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<script type="application/ld+json">${ldJson(ld)}</script>
<style>${PAGE_CSS}</style>
</head>
<body>
<header class="top"><a class="brand" href="/">Subroto Das <em>Photos</em></a><a class="all" href="/all/">All photos</a></header>
<main>
<figure class="hero"><img src="${esc(p.src)}" alt="${esc(alt)}"${dims} fetchpriority="high" decoding="async"></figure>
<article class="info">
<nav class="crumb" aria-label="Breadcrumb"><a href="/">Subroto Das Photos</a> <span aria-hidden="true">›</span> ${esc(cat || 'Photo')}</nav>
<h1>${esc(title)}</h1>
<p class="by">Photo by <strong>Subroto Das</strong> · <span lang="bn">ছবি: সুব্রত দাস</span></p>
<p class="desc">${esc(desc)}</p>
${facts.length ? `<ul class="facts">${facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>\n` : ''}<a class="btn" href="/">View all photos by Subroto Das</a>
</article>
${more ? `<section class="more"><h2>More photos by Subroto Das</h2><div class="grid">${more}</div></section>\n` : ''}</main>
<footer>© ${year} Subroto Das · <a href="https://me.subromart.com">Portfolio</a> · <a href="https://subromart.com">SubroMart</a> · <a href="/">Subroto Das Photos</a></footer>
</body>
</html>
`;
}

// Static preview injected into the homepage between the AUTO:LATEST markers.
// Crawlers (and AI agents, which don't run JavaScript) otherwise see an empty
// gallery; the script replaces this with the interactive grid for real visitors.
const HOME_START = '<!--AUTO:LATEST-->', HOME_END = '<!--/AUTO:LATEST-->';
const HOME_COUNT = 24;

function buildHomeBlock(photos) {
  const list = sortByDate(photos.filter(p => p.slug)).slice(0, HOME_COUNT);
  if (!list.length) return '';
  const cats = [...new Set(photos.map(p => catName(p.category)).filter(Boolean))].sort();
  const items = list.map(p =>
    `<li><a href="${esc(pageUrl(p))}"><img src="${esc(p.src)}" alt="${esc(altOf(p))}"${p.w && p.h ? ` width="${p.w}" height="${p.h}"` : ''} loading="lazy" decoding="async"><span>${esc(truncate(titleOf(p), 70))}</span></a></li>`
  ).join('');
  return `${HOME_START}<section class="static-latest"><h2>Latest photos by Subroto Das</h2>`
    + `<p>${photos.length} photos by Subroto Das (সুব্রত দাস) — ${esc(cats.slice(0, 8).join(', '))}. `
    + `<a href="/all/">Browse all ${photos.length} photos</a>.</p><ul>${items}</ul></section>${HOME_END}`;
}

function injectHome(html, photos) {
  const a = html.indexOf(HOME_START), b = html.indexOf(HOME_END);
  if (a < 0 || b < 0 || b < a) return null; // markers missing — leave index.html alone
  return html.slice(0, a) + buildHomeBlock(photos) + html.slice(b + HOME_END.length);
}

// A plain-HTML index of every photo page, so crawlers reach all photos without JS.
function buildArchive(photos) {
  const list = sortByDate(photos.filter(p => p.slug));
  const groups = new Map();
  for (const p of list) {
    const c = catName(p.category) || 'Other';
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(p);
  }
  const sections = [...groups.entries()].map(([cat, items]) =>
    `<section><h2>${esc(cat)} <span>${items.length}</span></h2><ul>`
    + items.map(p => `<li><a href="${esc(pageUrl(p))}">${esc(truncate(titleOf(p), 90))}</a></li>`).join('')
    + `</ul></section>`).join('\n');
  const desc = `Complete index of all ${list.length} photos by Subroto Das (সুব্রত দাস) — travel, food, fashion, portrait, nature and street photography.`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${SITE}/all/`,
    url: `${SITE}/all/`,
    name: `All photos by Subroto Das (${list.length})`,
    description: desc,
    isPartOf: { '@id': `${SITE}/#website` },
    about: { '@id': PERSON['@id'] },
    author: PERSON,
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>All Photos by Subroto Das — Complete Index (${list.length})</title>
<meta name="description" content="${esc(truncate(desc, 158))}">
<meta name="author" content="Subroto Das">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${SITE}/all/">
<link rel="icon" type="image/png" href="https://me.subromart.com/favicon.png">
<meta name="theme-color" content="#0a0806">
<script type="application/ld+json">${ldJson(ld)}</script>
<style>:root{--bg:#0a0806;--ink:#ede8df;--ink2:#b5ad9e;--ink3:#857b6c;--gold:#c9a227;--line:rgba(255,255,255,.08)}
*{box-sizing:border-box;margin:0;padding:0}body{background:var(--bg);color:var(--ink);font-family:Inter,system-ui,sans-serif;line-height:1.6}
a{color:inherit;text-decoration:none}a:hover{color:var(--gold)}
header{padding:14px 18px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.brand{font-family:'Cormorant Garamond',Georgia,serif;font-size:1.3rem}.brand em{color:var(--gold);font-style:italic}
main{max-width:900px;margin:0 auto;padding:26px 18px 56px}
h1{font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:clamp(1.5rem,4vw,2.1rem);margin-bottom:8px}
.lede{color:var(--ink2);font-size:.9rem;margin-bottom:28px}
section{margin-bottom:30px}
h2{font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:1.25rem;color:var(--gold);border-bottom:1px solid var(--line);padding-bottom:6px;margin-bottom:10px}
h2 span{font-family:Inter,sans-serif;font-size:.65rem;color:var(--ink3);vertical-align:middle;margin-left:4px}
ul{list-style:none;columns:2;column-gap:26px}
li{break-inside:avoid;font-size:.82rem;color:var(--ink2);padding:3px 0;overflow-wrap:anywhere}
footer{text-align:center;font-size:.72rem;color:var(--ink3);padding:26px 18px;border-top:1px solid var(--line)}
@media(max-width:620px){ul{columns:1}}</style>
</head>
<body>
<header><a class="brand" href="/">Subroto Das <em>Photos</em></a><a href="/">← Gallery</a></header>
<main>
<h1>All photos by Subroto Das</h1>
<p class="lede">${esc(desc)}</p>
${sections}
</main>
<footer>© ${new Date().getFullYear()} Subroto Das · <a href="/">Subroto Das Photos</a> · <a href="https://me.subromart.com">Portfolio</a></footer>
</body>
</html>
`;
}

function buildSitemap(photos) {
  const legacy = photos.filter(p => !p.slug).slice(0, 1000)
    .map(p => `<image:image><image:loc>${esc(p.src)}</image:loc></image:image>`).join('');
  const rows = [
    `<url><loc>${SITE}/</loc><lastmod>${isoDay(new Date())}</lastmod><changefreq>daily</changefreq><priority>1.0</priority>${legacy}</url>`,
    `<url><loc>${SITE}/all/</loc><lastmod>${isoDay(new Date())}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>`,
  ];
  for (const p of sortByDate(photos.filter(p => p.slug))) {
    rows.push(`<url><loc>${pageUrl(p)}</loc><lastmod>${isoDay(new Date(p.date))}</lastmod><image:image><image:loc>${esc(p.src)}</image:loc></image:image></url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${rows.join('\n')}\n</urlset>\n`;
}

function buildFeed(photos) {
  const now = new Date().toISOString();
  const latest = sortByTime(photos.filter(p => p.slug), p => +new Date(p.date)).slice(0, 50);
  const entries = latest.map(p => {
    const url = pageUrl(p), desc = descOf(p), when = isoTime(p.date, now);
    const html = `<p><a href="${esc(url)}"><img src="${esc(p.src)}" alt="${esc(altOf(p))}"></a></p><p>${esc(desc)}</p>`;
    return `<entry><title>${esc(titleOf(p))} — Subroto Das</title><link rel="alternate" type="text/html" href="${esc(url)}"/>`
      + `<link rel="enclosure" type="${/\.png$/i.test(p.src) ? 'image/png' : 'image/jpeg'}" href="${esc(p.src)}"/>`
      + `<id>${esc(url)}</id><published>${when}</published><updated>${when}</updated>`
      + `<author><name>Subroto Das</name><uri>https://me.subromart.com</uri></author>`
      + `<category term="${esc(catName(p.category) || 'Photo')}"/><summary>${esc(desc)}</summary><content type="html">${esc(html)}</content></entry>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Subroto Das Photos</title>
<subtitle>Latest photos by Subroto Das (সুব্রত দাস) — travel, food, fashion, portraits and more.</subtitle>
<link rel="self" type="application/atom+xml" href="${SITE}/feed.xml"/>
<link rel="alternate" type="text/html" href="${SITE}/"/>
<link rel="hub" href="${HUB}"/>
<id>${SITE}/</id>
<updated>${now}</updated>
<author><name>Subroto Das</name><uri>https://me.subromart.com</uri></author>
<icon>https://me.subromart.com/favicon.png</icon>
<logo>${SITE}/og-card.jpg</logo>
<rights>© ${new Date().getFullYear()} Subroto Das</rights>
${entries}
</feed>
`;
}

// Refreshes the homepage's static preview; skipped if index.html lacks the markers.
async function homeFile(env, gd, ref) {
  const html = await readText(env, 'index.html', ref);
  if (!html) return [];
  const next = injectHome(html, gd.photos);
  return next && next !== html ? [{ path: 'index.html', content: next }] : [];
}

function siteFiles(gd) {
  prepareTitles(gd.photos);
  return [
    { path: 'gallery-data.json', content: JSON.stringify(gd) },
    { path: 'all/index.html', content: buildArchive(gd.photos) },
    { path: 'sitemap.xml', content: buildSitemap(gd.photos) },
    { path: 'feed.xml', content: buildFeed(gd.photos) },
  ];
}

// ---------- Search engine notification ----------

async function pingIndexNow(urls) {
  try {
    await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'photos.subromart.com',
        key: INDEXNOW_KEY,
        keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`,
        urlList: [...new Set([`${SITE}/`, ...urls])].slice(0, 1000),
      }),
    });
  } catch {}
}

// Runs on a cron after GitHub Pages has deployed, so every pinged URL is already live.
async function notifySearchEngines() {
  const r = await fetch(`${SITE}/feed.xml?t=${Date.now()}`);
  if (!r.ok) return;
  const xml = await r.text(), now = Date.now(), WINDOW = 20 * 60 * 1000;
  const updated = Date.parse((xml.match(/<updated>([^<]+)<\/updated>/) || [])[1]);
  if (!(now - updated <= WINDOW)) return;
  const fresh = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .filter(m => now - Date.parse((m[1].match(/<published>([^<]+)<\/published>/) || [])[1]) <= WINDOW)
    .map(m => (m[1].match(/<id>([^<]+)<\/id>/) || [])[1])
    .filter(Boolean);
  await Promise.allSettled([
    fetch(HUB, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `hub.mode=publish&hub.url=${encodeURIComponent(`${SITE}/feed.xml`)}`,
    }),
    fresh.length ? pingIndexNow(fresh) : Promise.resolve(),
  ]);
}

// ---------- Routes ----------

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env, origin) });
    if (request.method !== 'POST') return json(env, { error: 'Method not allowed' }, 405, origin);
    if (!isAllowedOrigin(env, origin)) return json(env, { error: 'Forbidden origin' }, 403, origin);

    const url = new URL(request.url);
    let body;
    try { body = await request.json(); } catch { return json(env, { error: 'Bad JSON' }, 400, origin); }
    if (!checkPin(env, body.pin)) return json(env, { error: 'Wrong PIN' }, 401, origin);

    try {
      switch (url.pathname) {
        case '/api/auth':
          return json(env, { ok: true }, 200, origin);

        // Store one compressed image as a git blob (no commit yet).
        case '/api/blob': {
          const { path, content } = body;
          if (!UPLOAD_RE.test(path || '') || path.includes('..') || typeof content !== 'string' || !content) throw httpError(400, 'Invalid upload');
          const blob = await ghJson(env, 'git/blobs', postJson({ content, encoding: 'base64' }));
          return json(env, { ok: true, path, sha: blob.sha }, 200, origin);
        }

        case '/api/upload': {
          const { path, content } = body;
          if (!UPLOAD_RE.test(path || '') || path.includes('..') || !content) throw httpError(400, 'Invalid upload');
          await putFile(env, path, content, `Add: ${path.split('/').pop()}`);
          return json(env, { ok: true }, 200, origin);
        }

        // One commit: images + their photo pages + gallery data + sitemap + feed.
        case '/api/finalize': {
          const entries = (Array.isArray(body.entries) ? body.entries : []).map(cleanEntry);
          if (!entries.length) throw httpError(400, 'No entries');
          const files = Array.isArray(body.files) ? body.files : [];
          for (const f of files) {
            if (!f || !UPLOAD_RE.test(f.path || '') || f.path.includes('..') || !/^[0-9a-f]{40}$/.test(f.sha || '')) throw httpError(400, 'Invalid file');
          }
          const saved = await mutate(env, `Add ${entries.length} photo${entries.length > 1 ? 's' : ''}`, async (gd, head) => {
            const known = new Set(gd.photos.map(p => p.id));
            const fresh = entries.filter(e => !known.has(e.id)).map(e => ({ ...e }));
            if (!fresh.length && !files.length) return { files: [], result: gd.photos.filter(p => entries.some(e => e.id === p.id)) };
            assignSlugs(fresh, new Set(gd.photos.map(p => p.slug).filter(Boolean)));
            gd.photos.push(...fresh);
            return {
              files: [
                ...files.map(f => ({ path: f.path, sha: f.sha })),
                ...pagesFor(gd.photos, new Set(fresh.map(p => p.slug))),
                ...siteFiles(gd),
                ...await homeFile(env, gd, head),
              ],
              result: fresh,
            };
          });
          return json(env, { ok: true, entries: saved }, 200, origin);
        }

        // One commit: remove image + its page, refresh neighbours, data, sitemap, feed.
        case '/api/delete': {
          const { id, path } = body;
          if (!id && !path) throw httpError(400, 'Missing id/path');
          if (path && (!IMAGE_RE.test(path) || path.includes('..'))) throw httpError(400, 'Invalid path');
          const removed = await mutate(env, 'Delete photo', async (gd, head) => {
            const target = gd.photos.find(p => (id && p.id === id) || (path && typeof p.src === 'string' && p.src.endsWith('/' + path)));
            if (!target) return { files: [], result: null };
            const k = sortByDate(gd.photos.filter(p => p.slug)).indexOf(target);
            gd.photos = gd.photos.filter(p => p !== target);
            const order = sortByDate(gd.photos.filter(p => p.slug));
            const near = new Set(k < 0 ? [] : order.slice(Math.max(0, k - 8), k + 8).map(p => p.slug));
            const imgPath = target.src.startsWith(SITE + '/') ? target.src.slice(SITE.length + 1) : null;
            const pagePath = target.slug ? `photo/${target.slug}/index.html` : null;
            const dels = [];
            if (imgPath && IMAGE_RE.test(imgPath) && await exists(env, imgPath, head)) dels.push({ path: imgPath, delete: true });
            if (pagePath && await exists(env, pagePath, head)) dels.push({ path: pagePath, delete: true });
            return { files: [...dels, ...pagesFor(gd.photos, near), ...siteFiles(gd), ...await homeFile(env, gd, head)], result: target };
          });
          if (removed && removed.slug) ctx.waitUntil(pingIndexNow([pageUrl(removed)]));
          return json(env, { ok: true, removed: removed ? 1 : 0 }, 200, origin);
        }

        default:
          return json(env, { error: 'Not found' }, 404, origin);
      }
    } catch (e) {
      return json(env, { error: e.message || 'Server error' }, e.expose ? e.status : 500, origin);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(notifySearchEngines());
  },
};
