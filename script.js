(() => {
    'use strict';

    const GH_OWNER = 'subroto23';
    const GH_REPO = 'photos';
    const GH_BRANCH = 'main';
    const PIN_HASH = '150602';
    const PP = 16;
    const DATA = 'gallery-data.json';
    const DIR = 'photos';
    const ENC_KEY_FILE = 'config.enc';
    const RAW_BASE = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}`;

    const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const MONTHS_SHORT = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

    let ghToken = null;
    let photos = [], filtered = [], shown = 0, flt = 'all', lbi = -1, picks = [];
    const $ = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);

    // ===== Token Encryption =====
    async function deriveKey(pin) {
        const enc = new TextEncoder();
        const km = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: enc.encode('subroto-gallery-salt-2024'), iterations: 100000, hash: 'SHA-256' },
            km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
        );
    }

    async function encryptToken(token, pin) {
        const key = await deriveKey(pin);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
        const buf = new Uint8Array(iv.length + ct.byteLength);
        buf.set(iv); buf.set(new Uint8Array(ct), iv.length);
        return btoa(String.fromCharCode(...buf));
    }

    async function decryptToken(encB64, pin) {
        const key = await deriveKey(pin);
        const buf = Uint8Array.from(atob(encB64), c => c.charCodeAt(0));
        const iv = buf.slice(0, 12);
        const ct = buf.slice(12);
        const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
        return new TextDecoder().decode(dec);
    }

    async function loadEncryptedToken(pin) {
        try {
            const r = await fetch(`${RAW_BASE}/${ENC_KEY_FILE}`);
            if (!r.ok) return false;
            const encData = await r.text();
            const token = await decryptToken(encData.trim(), pin);
            if (!token || token.length < 10) return false;
            const check = await fetch('https://api.github.com/user', { headers: { 'Authorization': `Bearer ${token}` } });
            if (check.ok) { ghToken = token; return true; }
        } catch (e) { console.log('Token load failed:', e.message); }
        return false;
    }

    async function saveEncryptedToken(token, pin) {
        const encData = await encryptToken(token, pin);
        const content = btoa(encData);
        let sha = null;
        try {
            const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${ENC_KEY_FILE}?ref=${GH_BRANCH}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' }
            });
            if (r.ok) sha = (await r.json()).sha;
        } catch {}
        const body = { message: 'Update encrypted config', content, branch: GH_BRANCH };
        if (sha) body.sha = sha;
        const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${ENC_KEY_FILE}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error('Failed to save config');
    }

    // ===== Init =====
    window.addEventListener('load', () => {
        setTimeout(() => $('#preloader').classList.add('hidden'), 300);
        lucide.createIcons();
        loadGallery();
    });

    // ===== Nav =====
    addEventListener('scroll', () => $('#navbar').classList.toggle('scrolled', scrollY > 20));
    $('#hamburger').addEventListener('click', () => $('#navMenu').classList.toggle('open'));
    document.addEventListener('click', e => {
        if (!$('#navMenu').contains(e.target) && !$('#hamburger').contains(e.target)) $('#navMenu').classList.remove('open');
    });
    $$('.nav-link').forEach(l => l.addEventListener('click', () => $('#navMenu').classList.remove('open')));

    // ===== Modal =====
    const modal = $('#uploadModal');
    $('#openUploadBtn').addEventListener('click', () => {
        modal.classList.add('open');
        $('#pinInput').value = '';
        $('#pinError').classList.remove('show');
        $('#tokenRow').style.display = 'none';
        $('#pinGate').style.display = 'block';
        $('#uploadForm').style.display = 'none';
        setTimeout(() => $('#pinInput').focus(), 60);
    });
    $('#closeModal').addEventListener('click', () => modal.classList.remove('open'));

    $('#pinSubmitBtn').addEventListener('click', doPin);
    $('#pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') doPin(); });

    async function doPin() {
        const pin = $('#pinInput').value;
        if (pin !== PIN_HASH) {
            $('#pinError').classList.add('show');
            $('#pinInput').value = '';
            $('#pinInput').focus();
            return;
        }

        const btn = $('#pinSubmitBtn');
        btn.disabled = true;
        btn.textContent = 'Loading...';

        const loaded = await loadEncryptedToken(pin);
        if (loaded) {
            toast('Authenticated!', 'success');
            $('#pinGate').style.display = 'none';
            $('#uploadForm').style.display = 'block';
            lucide.createIcons();
        } else {
            $('#tokenRow').style.display = 'block';
            $('#tokenInput').focus();
            toast('Enter your GitHub token', 'info');
        }
        btn.disabled = false;
        btn.textContent = 'Unlock';
    }

    $('#tokenSaveBtn').addEventListener('click', async () => {
        const token = $('#tokenInput').value.trim();
        if (!token) return;

        const btn = $('#tokenSaveBtn');
        btn.disabled = true;
        btn.textContent = 'Verifying...';

        try {
            const check = await fetch('https://api.github.com/user', { headers: { 'Authorization': `Bearer ${token}` } });
            if (!check.ok) { toast('Invalid token!', 'error'); btn.disabled = false; btn.textContent = 'Save & Continue'; return; }

            btn.textContent = 'Saving...';
            await saveEncryptedToken(token, PIN_HASH);
            ghToken = token;
            toast('Token saved securely!', 'success');
            $('#pinGate').style.display = 'none';
            $('#uploadForm').style.display = 'block';
            lucide.createIcons();
        } catch (e) {
            toast(`Error: ${e.message}`, 'error');
        }
        btn.disabled = false;
        btn.textContent = 'Save & Continue';
    });

    // ===== Files =====
    const dz = $('#dropZone'), fi = $('#fileInput');
    dz.addEventListener('click', () => fi.click());
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); addF(e.dataTransfer.files); });
    fi.addEventListener('change', () => addF(fi.files));

    function addF(fl) {
        const imgs = Array.from(fl).filter(f => f.type.startsWith('image/'));
        if (!imgs.length) { toast('Select image files', 'error'); return; }
        picks = [...picks, ...imgs];
        renderThumbs();
        $('#uploadBtn').disabled = false;
    }

    function renderThumbs() {
        const g = $('#previewGrid'); g.innerHTML = '';
        picks.forEach((f, i) => {
            const d = document.createElement('div'); d.className = 'thumb';
            const img = document.createElement('img'); img.src = URL.createObjectURL(f); img.alt = f.name;
            const rm = document.createElement('button'); rm.className = 'thumb-rm'; rm.textContent = '×';
            rm.addEventListener('click', () => { picks.splice(i, 1); renderThumbs(); if (!picks.length) $('#uploadBtn').disabled = true; });
            d.append(img, rm); g.appendChild(d);
        });
    }

    // ===== EXIF =====
    async function extractExif(file) {
        const meta = {};
        try {
            const exif = await exifr.parse(file, {
                pick: ['DateTimeOriginal','CreateDate','Make','Model','ExposureTime','FNumber','ISO','FocalLength','GPSLatitude','GPSLongitude','ImageWidth','ImageHeight','LensModel']
            });
            if (!exif) return meta;
            if (exif.DateTimeOriginal) meta.dateTaken = new Date(exif.DateTimeOriginal).toISOString();
            else if (exif.CreateDate) meta.dateTaken = new Date(exif.CreateDate).toISOString();
            if (exif.Make) meta.cameraMake = exif.Make.trim();
            if (exif.Model) meta.cameraModel = exif.Model.trim();
            if (exif.ExposureTime) meta.exposure = exif.ExposureTime < 1 ? `1/${Math.round(1/exif.ExposureTime)}s` : `${exif.ExposureTime}s`;
            if (exif.FNumber) meta.aperture = `f/${exif.FNumber}`;
            if (exif.ISO) meta.iso = `ISO ${exif.ISO}`;
            if (exif.FocalLength) meta.focalLength = `${exif.FocalLength}mm`;
            if (exif.LensModel) meta.lens = exif.LensModel.trim();
            if (exif.ImageWidth) meta.width = exif.ImageWidth;
            if (exif.ImageHeight) meta.height = exif.ImageHeight;
            if (exif.GPSLatitude && exif.GPSLongitude) { meta.gpsLat = exif.GPSLatitude; meta.gpsLng = exif.GPSLongitude; }
        } catch {}
        return meta;
    }

    // ===== GitHub API (authenticated) =====
    async function ghAPI(path, opts = {}) {
        if (!ghToken) throw new Error('Not authenticated');
        const { headers: extraHeaders, soft, ...fetchOpts } = opts;
        const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/${path}`, {
            ...fetchOpts,
            headers: { 'Authorization': `Bearer ${ghToken}`, 'Accept': 'application/vnd.github.v3+json', ...(extraHeaders || {}) }
        });
        if (!r.ok && !soft) {
            const e = await r.json().catch(() => ({}));
            throw new Error(e.message || `API error ${r.status}`);
        }
        return r;
    }

    async function getSHA(p) {
        try { const r = await ghAPI(`contents/${p}?ref=${GH_BRANCH}`, { soft: true }); if (r.ok) return (await r.json()).sha; } catch {} return null;
    }

    async function putFile(p, content, msg) {
        const sha = await getSHA(p);
        const body = { message: msg, content, branch: GH_BRANCH };
        if (sha) body.sha = sha;
        await ghAPI(`contents/${p}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }

    function toB64(f) {
        return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
    }

    // Gallery data - no auth needed (public repo, use raw URL)
    async function getData() {
        try {
            const r = await fetch(`${RAW_BASE}/${DATA}?t=${Date.now()}`);
            if (r.ok) return JSON.parse(await r.text());
        } catch {}
        return { photos: [] };
    }

    // ===== Upload =====
    $('#uploadBtn').addEventListener('click', async () => {
        if (!picks.length) return;
        if (!ghToken) { toast('Not authenticated! Re-enter PIN.', 'error'); return; }

        const cap = $('#photoCaption').value.trim();
        const cat = $('#photoCategory').value.trim() || 'General';
        const pf = $('#progressFill'), pt = $('#progressText'), pp = $('#uploadProgress');
        $('#uploadBtn').disabled = true;
        pp.style.display = 'block';

        try {
            const gd = await getData();
            const total = picks.length;
            let done = 0;

            for (const file of picks) {
                const ts = Date.now();
                const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                const fp = `${DIR}/${cat.toLowerCase().replace(/\s+/g, '-')}/${ts}-${safe}`;

                pt.textContent = `Reading EXIF ${done + 1}/${total}...`;
                const exifData = await extractExif(file);

                const b64 = await toB64(file);
                pt.textContent = `Uploading ${done + 1}/${total}...`;
                pf.style.width = `${((done + .5) / total) * 100}%`;

                await putFile(fp, b64, `Add: ${safe}`);

                const photoCaption = cap || safe.replace(/[-_]/g, ' ').replace(/\.\w+$/, '');
                const photoEntry = {
                    id: `p-${ts}-${Math.random().toString(36).slice(2, 7)}`,
                    src: `${RAW_BASE}/${fp}`,
                    caption: photoCaption,
                    category: cat,
                    date: new Date().toISOString(),
                    filename: safe,
                    alt: `${photoCaption} — Photo by Subroto Das, Software Engineer`
                };

                if (exifData.dateTaken) photoEntry.dateTaken = exifData.dateTaken;
                if (exifData.cameraMake) photoEntry.cameraMake = exifData.cameraMake;
                if (exifData.cameraModel) photoEntry.cameraModel = exifData.cameraModel;
                if (exifData.exposure) photoEntry.exposure = exifData.exposure;
                if (exifData.aperture) photoEntry.aperture = exifData.aperture;
                if (exifData.iso) photoEntry.iso = exifData.iso;
                if (exifData.focalLength) photoEntry.focalLength = exifData.focalLength;
                if (exifData.lens) photoEntry.lens = exifData.lens;
                if (exifData.width) photoEntry.width = exifData.width;
                if (exifData.height) photoEntry.height = exifData.height;
                if (exifData.gpsLat) { photoEntry.gpsLat = exifData.gpsLat; photoEntry.gpsLng = exifData.gpsLng; }

                gd.photos.push(photoEntry);
                done++;
                pf.style.width = `${(done / total) * 100}%`;
            }

            const json = btoa(unescape(encodeURIComponent(JSON.stringify(gd, null, 2))));
            await putFile(DATA, json, `Gallery: +${total} photo(s)`);

            pt.textContent = 'Done!';
            toast(`${total} photo(s) uploaded & deployed!`, 'success');

            picks = [];
            $('#previewGrid').innerHTML = '';
            $('#photoCaption').value = '';
            $('#photoCategory').value = '';
            fi.value = '';
            setTimeout(() => { pp.style.display = 'none'; pf.style.width = '0%'; }, 1000);

            photos = gd.photos;
            applyFilter();
            updCount();
        } catch (e) {
            toast(`Upload failed: ${e.message}`, 'error');
            pt.textContent = 'Failed';
        }
        $('#uploadBtn').disabled = false;
    });

    // ===== Date search =====
    function matchesDateQuery(photo, query) {
        const q = query.toLowerCase().trim();
        if (!q) return true;
        const dateStr = photo.dateTaken || photo.date;
        if (!dateStr) return false;
        const d = new Date(dateStr);
        if (isNaN(d)) return false;

        const year = d.getFullYear().toString();
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const day = d.getDate().toString().padStart(2, '0');
        const monthName = MONTHS[d.getMonth()];
        const monthShort = MONTHS_SHORT[d.getMonth()];
        const iso = `${year}-${month}-${day}`;
        const full = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toLowerCase();

        if (q === year) return true;
        if (q === `${year}-${month}` || q === `${month}/${year}`) return true;
        if (q === iso || q === `${day}/${month}/${year}` || q === `${month}/${day}/${year}`) return true;
        if (q === monthName || q === monthShort) return true;
        if (q === `${monthName} ${year}` || q === `${monthShort} ${year}`) return true;
        if (full.includes(q)) return true;

        const rm = q.match(/^(\d{4}-\d{2}-\d{2})\s*(?:to|-)\s*(\d{4}-\d{2}-\d{2})$/);
        if (rm) { const from = new Date(rm[1]), to = new Date(rm[2]); return d >= from && d <= to; }
        return false;
    }

    // ===== Gallery =====
    async function loadGallery() {
        try { photos = (await getData()).photos || []; } catch { photos = []; }
        applyFilter();
        updCount();
    }

    function applyFilter() {
        const q = ($('#searchInput')?.value || '').trim();
        const ql = q.toLowerCase();
        filtered = photos.filter(p => {
            const catOk = flt === 'all' || p.category === flt;
            if (!catOk) return false;
            if (!q) return true;
            if (p.caption.toLowerCase().includes(ql)) return true;
            if (p.category.toLowerCase().includes(ql)) return true;
            if (p.cameraModel && p.cameraModel.toLowerCase().includes(ql)) return true;
            if (p.cameraMake && p.cameraMake.toLowerCase().includes(ql)) return true;
            if (p.lens && p.lens.toLowerCase().includes(ql)) return true;
            if (matchesDateQuery(p, q)) return true;
            return false;
        });
        shown = 0;
        $('#galleryGrid').innerHTML = '';
        renderCats();
        loadMore();
    }

    function loadMore() {
        const grid = $('#galleryGrid'), lmc = $('#loadMoreContainer');
        if (!filtered.length) {
            if (!grid.children.length) {
                grid.innerHTML = `<div class="empty-state"><i data-lucide="image"></i><p>${flt === 'all' ? 'No photos yet' : 'No photos in this category'}</p></div>`;
                lucide.createIcons();
            }
            lmc.style.display = 'none'; return;
        }

        const batch = filtered.slice(shown, shown + PP);
        batch.forEach(photo => {
            const card = document.createElement('article');
            card.className = 'g-card skel';
            card.setAttribute('itemscope', '');
            card.setAttribute('itemtype', 'https://schema.org/ImageObject');

            const img = document.createElement('img');
            img.alt = photo.alt || photo.caption;
            img.setAttribute('loading', 'lazy');
            img.setAttribute('itemprop', 'contentUrl');
            img.onload = () => { card.classList.remove('skel'); img.classList.add('loaded'); card.style.aspectRatio = ''; };
            img.src = photo.src;

            const over = document.createElement('div'); over.className = 'g-over';
            const cap = document.createElement('span'); cap.className = 'g-cap'; cap.setAttribute('itemprop', 'caption'); cap.textContent = photo.caption;
            const meta = document.createElement('span'); meta.className = 'g-meta';
            const displayDate = photo.dateTaken ? new Date(photo.dateTaken) : new Date(photo.date);
            meta.textContent = `${photo.category} · ${displayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

            const dateEl = document.createElement('span'); dateEl.className = 'g-date';
            if (photo.cameraModel) dateEl.textContent = photo.cameraModel;
            over.append(cap, meta, dateEl);

            const authorMeta = document.createElement('meta'); authorMeta.setAttribute('itemprop', 'author'); authorMeta.content = 'Subroto Das';
            const nameMeta = document.createElement('meta'); nameMeta.setAttribute('itemprop', 'name'); nameMeta.content = photo.caption;

            card.append(img, over, authorMeta, nameMeta);
            card.addEventListener('click', () => {
                const all = Array.from(grid.querySelectorAll('.g-card'));
                openLB(all.indexOf(card));
            });
            grid.appendChild(card);
        });

        shown += batch.length;
        lmc.style.display = shown < filtered.length ? 'block' : 'none';
    }

    function renderCats() {
        const cats = [...new Set(photos.map(p => p.category))];
        const c = $('#categoryFilters'); c.innerHTML = '';
        cats.forEach(cat => {
            const b = document.createElement('button');
            b.className = `pill${flt === cat ? ' active' : ''}`;
            b.dataset.filter = cat; b.textContent = cat;
            b.addEventListener('click', () => { flt = cat; $$('.pill').forEach(p => p.classList.remove('active')); b.classList.add('active'); applyFilter(); });
            c.appendChild(b);
        });
        const allBtn = $('.pill[data-filter="all"]');
        if (allBtn) {
            allBtn.classList.toggle('active', flt === 'all');
            allBtn.onclick = () => { flt = 'all'; $$('.pill').forEach(p => p.classList.remove('active')); allBtn.classList.add('active'); applyFilter(); };
        }
    }

    function updCount() { $('#totalPhotos').textContent = photos.length; }

    let st;
    $('#searchInput').addEventListener('input', () => { clearTimeout(st); st = setTimeout(applyFilter, 250); });
    $('#loadMoreBtn').addEventListener('click', loadMore);

    // ===== Lightbox =====
    const lb = $('#lightbox');
    function openLB(i) {
        lbi = i; const p = filtered[i]; if (!p) return;
        $('#lightboxImg').src = p.src;
        $('#lightboxImg').alt = p.alt || p.caption;
        $('#lightboxCaption').textContent = p.caption;
        const displayDate = p.dateTaken ? new Date(p.dateTaken) : new Date(p.date);
        $('#lightboxMeta').textContent = `${p.category} · ${displayDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;

        const exifEl = $('#lightboxExif');
        exifEl.innerHTML = '';
        const bits = [];
        if (p.cameraModel) bits.push(p.cameraMake ? `${p.cameraMake} ${p.cameraModel}` : p.cameraModel);
        if (p.lens) bits.push(p.lens);
        if (p.focalLength) bits.push(p.focalLength);
        if (p.aperture) bits.push(p.aperture);
        if (p.exposure) bits.push(p.exposure);
        if (p.iso) bits.push(p.iso);
        if (p.width && p.height) bits.push(`${p.width}×${p.height}`);
        bits.forEach(b => { const s = document.createElement('span'); s.textContent = b; exifEl.appendChild(s); });

        lb.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    function closeLB() { lb.classList.remove('open'); document.body.style.overflow = ''; lbi = -1; }

    $('#lightboxClose').addEventListener('click', closeLB);
    lb.addEventListener('click', e => { if (e.target === lb) closeLB(); });
    $('#lightboxPrev').addEventListener('click', e => { e.stopPropagation(); if (lbi > 0) openLB(lbi - 1); });
    $('#lightboxNext').addEventListener('click', e => { e.stopPropagation(); if (lbi < filtered.length - 1) openLB(lbi + 1); });
    document.addEventListener('keydown', e => {
        if (!lb.classList.contains('open')) return;
        if (e.key === 'Escape') closeLB();
        if (e.key === 'ArrowLeft' && lbi > 0) openLB(lbi - 1);
        if (e.key === 'ArrowRight' && lbi < filtered.length - 1) openLB(lbi + 1);
    });

    let tx = 0;
    lb.addEventListener('touchstart', e => { tx = e.changedTouches[0].screenX; }, { passive: true });
    lb.addEventListener('touchend', e => {
        const d = e.changedTouches[0].screenX - tx;
        if (Math.abs(d) > 50) { if (d > 0 && lbi > 0) openLB(lbi - 1); if (d < 0 && lbi < filtered.length - 1) openLB(lbi + 1); }
    }, { passive: true });

    // ===== Toast =====
    function toast(msg, type = 'info') {
        const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg;
        $('#toastContainer').appendChild(t);
        setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 200); }, 3000);
    }

    $$('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
        const t = document.querySelector(a.getAttribute('href'));
        if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth' }); }
    }));
})();
