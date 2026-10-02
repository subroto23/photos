(() => {
    'use strict';

    const GH_OWNER = 'subroto23';
    const GH_REPO = 'photos';
    const GH_BRANCH = 'main';
    const PIN_HASH = '150602';
    const PP = 20;
    const DATA = 'gallery-data.json';
    const DIR = 'photos';
    const ENC_KEY_FILE = 'config.enc';
    const RAW = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}`;

    let ghToken = null;
    let photos = [], filtered = [], shown = 0, lbi = -1, picks = [];
    const $ = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);

    // ===== Crypto =====
    async function deriveKey(pin) {
        const e = new TextEncoder();
        const km = await crypto.subtle.importKey('raw', e.encode(pin), 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: e.encode('subroto-gallery-salt-2024'), iterations: 100000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }

    async function encryptToken(token, pin) {
        const key = await deriveKey(pin);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
        const buf = new Uint8Array(iv.length + ct.byteLength);
        buf.set(iv); buf.set(new Uint8Array(ct), iv.length);
        return btoa(String.fromCharCode(...buf));
    }

    async function decryptToken(b64, pin) {
        const key = await deriveKey(pin);
        const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12)));
    }

    async function loadToken(pin) {
        try {
            const r = await fetch(`${RAW}/${ENC_KEY_FILE}?t=${Date.now()}`);
            if (!r.ok) return false;
            const token = await decryptToken((await r.text()).trim(), pin);
            if (!token || token.length < 10) return false;
            const ck = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}` } });
            if (ck.ok) { ghToken = token; return true; }
        } catch (e) { console.warn('Token load:', e.message); }
        return false;
    }

    async function saveToken(token, pin) {
        const enc = await encryptToken(token, pin);
        const content = btoa(enc);
        let sha = null;
        try {
            const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${ENC_KEY_FILE}?ref=${GH_BRANCH}`, {
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' }
            });
            if (r.ok) sha = (await r.json()).sha;
        } catch {}
        const body = { message: 'config', content, branch: GH_BRANCH };
        if (sha) body.sha = sha;
        await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${ENC_KEY_FILE}`, {
            method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/vnd.github.v3+json' },
            body: JSON.stringify(body)
        });
    }

    // ===== Init =====
    window.addEventListener('load', () => {
        setTimeout(() => $('#preloader').classList.add('hidden'), 250);
        lucide.createIcons();
        loadGallery();
    });

    // ===== Nav scroll =====
    addEventListener('scroll', () => {
        $('#navbar').style.boxShadow = scrollY > 10 ? '0 2px 12px rgba(0,0,0,.05)' : 'none';
    });

    // ===== Date range =====
    $('#dateFrom').addEventListener('change', applyFilter);
    $('#dateTo').addEventListener('change', applyFilter);
    $('#dateClear').addEventListener('click', () => {
        $('#dateFrom').value = '';
        $('#dateTo').value = '';
        applyFilter();
    });

    // ===== Modal =====
    const modal = $('#uploadModal');
    $('#openUploadBtn').addEventListener('click', () => {
        modal.classList.add('open');
        $('#pinInput').value = '';
        $('#pinError').classList.remove('show');
        $('#tokenRow').style.display = 'none';
        $('#pinGate').style.display = 'block';
        $('#uploadForm').style.display = 'none';
        setTimeout(() => $('#pinInput').focus(), 50);
    });
    $('#closeModal').addEventListener('click', () => modal.classList.remove('open'));

    $('#pinSubmitBtn').addEventListener('click', doPin);
    $('#pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') doPin(); });

    async function doPin() {
        if ($('#pinInput').value !== PIN_HASH) {
            $('#pinError').classList.add('show');
            $('#pinInput').value = '';
            return;
        }
        const btn = $('#pinSubmitBtn');
        btn.disabled = true; btn.textContent = 'Loading...';
        if (await loadToken(PIN_HASH)) {
            toast('Authenticated!', 'success');
            $('#pinGate').style.display = 'none';
            $('#uploadForm').style.display = 'block';
            lucide.createIcons();
        } else {
            $('#tokenRow').style.display = 'block';
            $('#tokenInput').focus();
        }
        btn.disabled = false; btn.textContent = 'Unlock';
    }

    $('#tokenSaveBtn').addEventListener('click', async () => {
        const token = $('#tokenInput').value.trim();
        if (!token) return;
        const btn = $('#tokenSaveBtn');
        btn.disabled = true; btn.textContent = 'Saving...';
        try {
            const ck = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}` } });
            if (!ck.ok) { toast('Invalid token', 'error'); btn.disabled = false; btn.textContent = 'Save'; return; }
            await saveToken(token, PIN_HASH);
            ghToken = token;
            toast('Saved!', 'success');
            $('#pinGate').style.display = 'none';
            $('#uploadForm').style.display = 'block';
            lucide.createIcons();
        } catch (e) { toast(e.message, 'error'); }
        btn.disabled = false; btn.textContent = 'Save';
    });

    // ===== File picks =====
    const dz = $('#dropZone'), fi = $('#fileInput');
    dz.addEventListener('click', () => fi.click());
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); addFiles(e.dataTransfer.files); });
    fi.addEventListener('change', () => addFiles(fi.files));

    function addFiles(fl) {
        const imgs = Array.from(fl).filter(f => f.type.startsWith('image/'));
        if (!imgs.length) return;
        picks = [...picks, ...imgs];
        renderThumbs();
        $('#uploadBtn').disabled = false;
    }

    function renderThumbs() {
        const g = $('#previewGrid'); g.innerHTML = '';
        picks.forEach((f, i) => {
            const d = document.createElement('div'); d.className = 'thumb';
            const img = document.createElement('img'); img.src = URL.createObjectURL(f);
            const rm = document.createElement('button'); rm.className = 'thumb-rm'; rm.textContent = '×';
            rm.onclick = () => { picks.splice(i, 1); renderThumbs(); if (!picks.length) $('#uploadBtn').disabled = true; };
            d.append(img, rm); g.appendChild(d);
        });
    }

    // ===== EXIF =====
    async function readExif(file) {
        const m = {};
        try {
            const x = await exifr.parse(file, { pick: ['DateTimeOriginal','CreateDate','Make','Model','ExposureTime','FNumber','ISO','FocalLength','LensModel','ImageWidth','ImageHeight'] });
            if (!x) return m;
            if (x.DateTimeOriginal) m.dateTaken = new Date(x.DateTimeOriginal).toISOString();
            else if (x.CreateDate) m.dateTaken = new Date(x.CreateDate).toISOString();
            if (x.Make) m.cameraMake = x.Make.trim();
            if (x.Model) m.cameraModel = x.Model.trim();
            if (x.ExposureTime) m.exposure = x.ExposureTime < 1 ? `1/${Math.round(1/x.ExposureTime)}s` : `${x.ExposureTime}s`;
            if (x.FNumber) m.aperture = `f/${x.FNumber}`;
            if (x.ISO) m.iso = `ISO ${x.ISO}`;
            if (x.FocalLength) m.focalLength = `${x.FocalLength}mm`;
            if (x.LensModel) m.lens = x.LensModel.trim();
            if (x.ImageWidth) m.width = x.ImageWidth;
            if (x.ImageHeight) m.height = x.ImageHeight;
        } catch {}
        return m;
    }

    // ===== Compress =====
    const MAX_KB = 200 * 1024;

    function compress(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = async () => {
                let { width: w, height: h } = img;
                if (w > 1920 || h > 1920) {
                    const s = Math.min(1920 / w, 1920 / h);
                    w = Math.round(w * s); h = Math.round(h * s);
                }
                const c = document.createElement('canvas');
                c.width = w; c.height = h;
                const ctx = c.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, w, h);

                let q = 0.92, blob;
                while (q >= 0.3) {
                    blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
                    if (blob.size <= MAX_KB) break;
                    q -= 0.05;
                }
                if (blob.size > MAX_KB) {
                    const s = Math.sqrt(MAX_KB / blob.size) * 0.95;
                    c.width = Math.round(w * s); c.height = Math.round(h * s);
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(img, 0, 0, c.width, c.height);
                    blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
                }
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
                URL.revokeObjectURL(img.src);
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    }

    // ===== GitHub API =====
    async function ghAPI(path, opts = {}) {
        if (!ghToken) throw new Error('Not authenticated');
        const { headers: hd, soft, ...rest } = opts;
        const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/${path}`, {
            ...rest, headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github.v3+json', ...(hd || {}) }
        });
        if (!r.ok && !soft) throw new Error((await r.json().catch(() => ({}))).message || `Error ${r.status}`);
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

    async function getData() {
        try {
            const r = await fetch(`${RAW}/${DATA}?t=${Date.now()}`);
            if (r.ok) return JSON.parse(await r.text());
        } catch {}
        return { photos: [] };
    }

    // ===== Upload =====
    $('#uploadBtn').addEventListener('click', async () => {
        if (!picks.length || !ghToken) return;
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
                const jpgName = safe.replace(/\.\w+$/, '.jpg');
                const fp = `${DIR}/${cat.toLowerCase().replace(/\s+/g, '-')}/${ts}-${jpgName}`;

                pt.textContent = `EXIF ${done + 1}/${total}...`;
                const exif = await readExif(file);

                pt.textContent = `Compressing ${done + 1}/${total}...`;
                const b64 = await compress(file);

                pt.textContent = `Uploading ${done + 1}/${total}...`;
                pf.style.width = `${((done + .5) / total) * 100}%`;
                await putFile(fp, b64, `Add: ${jpgName}`);

                const photoCaption = cap || safe.replace(/[-_]/g, ' ').replace(/\.\w+$/, '');
                const entry = {
                    id: `p-${ts}-${Math.random().toString(36).slice(2, 6)}`,
                    src: `${RAW}/${fp}`,
                    caption: photoCaption,
                    category: cat,
                    date: new Date().toISOString(),
                    alt: `${photoCaption} — Photo by Subroto Das`
                };
                if (exif.dateTaken) entry.dateTaken = exif.dateTaken;
                if (exif.cameraMake) entry.cameraMake = exif.cameraMake;
                if (exif.cameraModel) entry.cameraModel = exif.cameraModel;
                if (exif.exposure) entry.exposure = exif.exposure;
                if (exif.aperture) entry.aperture = exif.aperture;
                if (exif.iso) entry.iso = exif.iso;
                if (exif.focalLength) entry.focalLength = exif.focalLength;
                if (exif.lens) entry.lens = exif.lens;

                gd.photos.push(entry);
                done++;
                pf.style.width = `${(done / total) * 100}%`;
            }

            await putFile(DATA, btoa(unescape(encodeURIComponent(JSON.stringify(gd, null, 2)))), `Gallery +${total}`);
            pt.textContent = 'Done!';
            toast(`${total} photo(s) uploaded!`, 'success');

            picks = [];
            $('#previewGrid').innerHTML = '';
            $('#photoCaption').value = '';
            $('#photoCategory').value = '';
            fi.value = '';
            setTimeout(() => { pp.style.display = 'none'; pf.style.width = '0%'; }, 800);

            photos = gd.photos;
            applyFilter();
        } catch (e) {
            toast(`Failed: ${e.message}`, 'error');
            pt.textContent = 'Failed';
        }
        $('#uploadBtn').disabled = false;
    });

    // ===== Gallery =====
    async function loadGallery() {
        try { photos = (await getData()).photos || []; } catch { photos = []; }
        applyFilter();
    }

    function applyFilter() {
        const from = $('#dateFrom').value ? new Date($('#dateFrom').value + 'T00:00:00') : null;
        const to = $('#dateTo').value ? new Date($('#dateTo').value + 'T23:59:59') : null;

        filtered = photos.filter(p => {
            if (!from && !to) return true;
            const d = new Date(p.dateTaken || p.date);
            if (from && d < from) return false;
            if (to && d > to) return false;
            return true;
        });

        shown = 0;
        $('#galleryGrid').innerHTML = '';
        const empty = $('#emptyState');
        if (!filtered.length) { empty.classList.add('show'); lucide.createIcons(); }
        else { empty.classList.remove('show'); }
        loadMore();
    }

    function loadMore() {
        const grid = $('#galleryGrid'), lmc = $('#loadMoreContainer');
        if (!filtered.length) { lmc.style.display = 'none'; return; }

        const batch = filtered.slice(shown, shown + PP);
        batch.forEach(photo => {
            const card = document.createElement('div');
            card.className = 'g-card skel';

            const img = document.createElement('img');
            img.alt = photo.alt || photo.caption;
            img.loading = 'lazy';
            img.onload = () => { card.classList.remove('skel'); img.classList.add('loaded'); card.style.aspectRatio = ''; };
            img.onerror = () => { card.remove(); };
            img.src = photo.src;

            const over = document.createElement('div'); over.className = 'g-over';
            const cap = document.createElement('span'); cap.className = 'g-cap'; cap.textContent = photo.caption;
            const meta = document.createElement('span'); meta.className = 'g-meta';
            const d = new Date(photo.dateTaken || photo.date);
            meta.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            if (photo.cameraModel) meta.textContent += ` · ${photo.cameraModel}`;
            over.append(cap, meta);

            card.append(img, over);
            card.addEventListener('click', () => openLB(filtered.indexOf(photo)));
            grid.appendChild(card);
        });

        shown += batch.length;
        lmc.style.display = shown < filtered.length ? 'block' : 'none';
    }

    $('#loadMoreBtn').addEventListener('click', loadMore);

    // ===== Lightbox =====
    const lb = $('#lightbox');
    function openLB(i) {
        lbi = i; const p = filtered[i]; if (!p) return;
        $('#lightboxImg').src = p.src;
        $('#lightboxImg').alt = p.alt || p.caption;
        $('#lightboxCaption').textContent = p.caption;
        const d = new Date(p.dateTaken || p.date);
        $('#lightboxMeta').textContent = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

        const ex = $('#lightboxExif'); ex.innerHTML = '';
        [p.cameraMake && p.cameraModel ? `${p.cameraMake} ${p.cameraModel}` : p.cameraModel, p.lens, p.focalLength, p.aperture, p.exposure, p.iso]
            .filter(Boolean).forEach(t => { const s = document.createElement('span'); s.textContent = t; ex.appendChild(s); });

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
        if (Math.abs(d) > 50) { d > 0 && lbi > 0 ? openLB(lbi - 1) : d < 0 && lbi < filtered.length - 1 && openLB(lbi + 1); }
    }, { passive: true });

    // ===== Toast =====
    function toast(msg, type = 'info') {
        const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg;
        $('#toastContainer').appendChild(t);
        setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 200); }, 3000);
    }
})();
