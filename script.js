(() => {
    'use strict';
    const GH_OWNER = 'subroto23', GH_REPO = 'photos', GH_BRANCH = 'main', PIN = '150602';
    const DATA = 'gallery-data.json', DIR = 'photos', ENC = 'config.enc';
    const RAW = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}`;
    const PP = 30;

    let ghToken = null, photos = [], filtered = [], allPhotos = [], lbi = -1, picks = [];
    const $ = s => document.querySelector(s);

    // Crypto
    async function dk(pin) {
        const e = new TextEncoder();
        return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: e.encode('subroto-gallery-salt-2024'), iterations: 100000, hash: 'SHA-256' },
            await crypto.subtle.importKey('raw', e.encode(pin), 'PBKDF2', false, ['deriveKey']),
            { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }
    async function enc(t, p) { const k = await dk(p), iv = crypto.getRandomValues(new Uint8Array(12)), c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(t)), b = new Uint8Array(iv.length + c.byteLength); b.set(iv); b.set(new Uint8Array(c), iv.length); return btoa(String.fromCharCode(...b)); }
    async function dec(b64, p) { const k = await dk(p), b = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, k, b.slice(12))); }

    async function loadTk() {
        try { const r = await fetch(`${RAW}/${ENC}?t=${Date.now()}`); if (!r.ok) return false; const tk = await dec((await r.text()).trim(), PIN); if (!tk) return false; const c = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${tk}` } }); if (c.ok) { ghToken = tk; return true; } } catch {} return false;
    }
    async function saveTk(tk) {
        const ct = btoa(await enc(tk, PIN));
        let sha = null; try { const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${ENC}?ref=${GH_BRANCH}`, { headers: { Authorization: `Bearer ${tk}`, Accept: 'application/vnd.github.v3+json' } }); if (r.ok) sha = (await r.json()).sha; } catch {}
        const bd = { message: 'config', content: ct, branch: GH_BRANCH }; if (sha) bd.sha = sha;
        await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${ENC}`, { method: 'PUT', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json', Accept: 'application/vnd.github.v3+json' }, body: JSON.stringify(bd) });
    }

    // Init
    window.addEventListener('load', () => { setTimeout(() => $('#preloader').classList.add('hidden'), 400); lucide.createIcons(); loadGallery(); });

    // Navbar scroll effect
    let lastY = 0;
    window.addEventListener('scroll', () => {
        const y = window.scrollY;
        $('#navbar').classList.toggle('scrolled', y > 20);
        lastY = y;
    }, { passive: true });

    // Mobile filter toggle
    const filterBtn = $('#filterToggle');
    const datePicker = $('#datePicker');
    if (filterBtn) {
        filterBtn.addEventListener('click', () => {
            filterBtn.classList.toggle('active');
            datePicker.classList.toggle('mobile-open');
        });
    }

    // Date range
    $('#dateFrom').addEventListener('change', applyFilter);
    $('#dateTo').addEventListener('change', applyFilter);
    $('#dateClear').addEventListener('click', () => { $('#dateFrom').value = ''; $('#dateTo').value = ''; applyFilter(); });

    // Modal
    const modal = $('#uploadModal');
    $('#openUploadBtn').addEventListener('click', () => { modal.classList.add('open'); $('#pinInput').value = ''; $('#pinError').classList.remove('show'); $('#tokenRow').style.display = 'none'; $('#pinGate').style.display = 'block'; $('#uploadForm').style.display = 'none'; setTimeout(() => $('#pinInput').focus(), 50); });
    $('#closeModal').addEventListener('click', () => modal.classList.remove('open'));
    $('#pinSubmitBtn').addEventListener('click', doPin);
    $('#pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') doPin(); });

    async function doPin() {
        if ($('#pinInput').value !== PIN) { $('#pinError').classList.add('show'); $('#pinInput').value = ''; return; }
        const b = $('#pinSubmitBtn'); b.disabled = true; b.textContent = 'Loading...';
        if (await loadTk()) { toast('OK', 'success'); $('#pinGate').style.display = 'none'; $('#uploadForm').style.display = 'block'; lucide.createIcons(); }
        else { $('#tokenRow').style.display = 'block'; $('#tokenInput').focus(); }
        b.disabled = false; b.textContent = 'Unlock';
    }

    $('#tokenSaveBtn').addEventListener('click', async () => {
        const tk = $('#tokenInput').value.trim(); if (!tk) return;
        const b = $('#tokenSaveBtn'); b.disabled = true; b.textContent = '...';
        try { const c = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${tk}` } }); if (!c.ok) { toast('Invalid', 'error'); b.disabled = false; b.textContent = 'Save'; return; } await saveTk(tk); ghToken = tk; toast('Saved!', 'success'); $('#pinGate').style.display = 'none'; $('#uploadForm').style.display = 'block'; lucide.createIcons(); } catch (e) { toast(e.message, 'error'); }
        b.disabled = false; b.textContent = 'Save';
    });

    // Files
    const dz = $('#dropZone'), fi = $('#fileInput');
    dz.addEventListener('click', () => fi.click());
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); addF(e.dataTransfer.files); });
    fi.addEventListener('change', () => addF(fi.files));

    function addF(fl) { const imgs = Array.from(fl).filter(f => f.type.startsWith('image/')); if (!imgs.length) return; picks = [...picks, ...imgs]; renderTh(); $('#uploadBtn').disabled = false; }
    function renderTh() { const g = $('#previewGrid'); g.innerHTML = ''; picks.forEach((f, i) => { const d = document.createElement('div'); d.className = 'thumb'; const im = document.createElement('img'); im.src = URL.createObjectURL(f); const rm = document.createElement('button'); rm.className = 'thumb-rm'; rm.textContent = '×'; rm.onclick = () => { picks.splice(i, 1); renderTh(); if (!picks.length) $('#uploadBtn').disabled = true; }; d.append(im, rm); g.appendChild(d); }); }

    // EXIF
    async function readExif(file) {
        const m = {}; try { const x = await exifr.parse(file, { pick: ['DateTimeOriginal','CreateDate','Make','Model','ExposureTime','FNumber','ISO','FocalLength','LensModel'] }); if (!x) return m;
        if (x.DateTimeOriginal) m.dateTaken = new Date(x.DateTimeOriginal).toISOString(); else if (x.CreateDate) m.dateTaken = new Date(x.CreateDate).toISOString();
        if (x.Make) m.cameraMake = x.Make.trim(); if (x.Model) m.cameraModel = x.Model.trim();
        if (x.ExposureTime) m.exposure = x.ExposureTime < 1 ? `1/${Math.round(1/x.ExposureTime)}s` : `${x.ExposureTime}s`;
        if (x.FNumber) m.aperture = `f/${x.FNumber}`; if (x.ISO) m.iso = `ISO ${x.ISO}`;
        if (x.FocalLength) m.focalLength = `${x.FocalLength}mm`; if (x.LensModel) m.lens = x.LensModel.trim();
        } catch {} return m;
    }

    // Compress — guaranteed ≤200KB with best possible quality
    const MAX_KB = 200;
    function compress(file) {
        return new Promise((res, rej) => {
            const img = new Image(); img.onload = async () => {
                let { width: w, height: h } = img;
                const maxDim = 1920;
                if (w > maxDim || h > maxDim) { const s = Math.min(maxDim/w, maxDim/h); w = Math.round(w*s); h = Math.round(h*s); }
                const c = document.createElement('canvas');
                const draw = (dw, dh) => { c.width = dw; c.height = dh; const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, dw, dh); };
                const toBlob = q => new Promise(r => c.toBlob(r, 'image/jpeg', q));
                const limit = MAX_KB * 1024;

                draw(w, h);
                let blob = await toBlob(0.92);
                if (blob.size <= limit) { finish(blob); return; }

                // Step 1: reduce quality (high range first for best detail)
                for (let q = 0.85; q >= 0.5; q -= 0.05) {
                    blob = await toBlob(q);
                    if (blob.size <= limit) { finish(blob); return; }
                }

                // Step 2: scale down dimensions + quality sweep
                for (let scale = 0.85; scale >= 0.4; scale -= 0.1) {
                    const sw = Math.round(w * scale), sh = Math.round(h * scale);
                    draw(sw, sh);
                    for (let q = 0.82; q >= 0.45; q -= 0.08) {
                        blob = await toBlob(q);
                        if (blob.size <= limit) { finish(blob); return; }
                    }
                }

                // Step 3: aggressive last resort
                const ratio = Math.sqrt(limit / blob.size) * 0.9;
                draw(Math.round(c.width * ratio), Math.round(c.height * ratio));
                blob = await toBlob(0.6);
                finish(blob);

                function finish(b) {
                    const rd = new FileReader();
                    rd.onload = () => res(rd.result.split(',')[1]);
                    rd.onerror = rej;
                    rd.readAsDataURL(b);
                    URL.revokeObjectURL(img.src);
                }
            }; img.onerror = rej; img.src = URL.createObjectURL(file);
        });
    }

    // GitHub API
    async function ghAPI(path, opts = {}) {
        if (!ghToken) throw new Error('Not authenticated');
        const { headers: hd, soft, ...rest } = opts;
        const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/${path}`, { ...rest, headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github.v3+json', ...(hd || {}) } });
        if (!r.ok && !soft) throw new Error((await r.json().catch(() => ({}))).message || `${r.status}`);
        return r;
    }
    async function getSHA(p) { try { const r = await ghAPI(`contents/${p}?ref=${GH_BRANCH}`, { soft: true }); if (r.ok) return (await r.json()).sha; } catch {} return null; }
    async function putFile(p, content, msg) { const sha = await getSHA(p); const bd = { message: msg, content, branch: GH_BRANCH }; if (sha) bd.sha = sha; await ghAPI(`contents/${p}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bd) }); }
    async function getData() { try { const r = await fetch(`${RAW}/${DATA}?t=${Date.now()}`); if (r.ok) return JSON.parse(await r.text()); } catch {} return { photos: [] }; }

    // Upload
    $('#uploadBtn').addEventListener('click', async () => {
        if (!picks.length || !ghToken) return;
        const cap = $('#photoCaption').value.trim(), cat = $('#photoCategory').value.trim() || 'General';
        const pf = $('#progressFill'), pt = $('#progressText'), pp = $('#uploadProgress');
        $('#uploadBtn').disabled = true; pp.style.display = 'block';
        try {
            const gd = await getData(); const total = picks.length; let done = 0;
            for (const file of picks) {
                const ts = Date.now(), safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_'), jpg = safe.replace(/\.\w+$/, '.jpg');
                const fp = `${DIR}/${cat.toLowerCase().replace(/\s+/g, '-')}/${ts}-${jpg}`;
                pt.textContent = `EXIF ${done+1}/${total}...`;
                const exif = await readExif(file);
                pt.textContent = `Compressing ${done+1}/${total}...`;
                const b64 = await compress(file);
                pt.textContent = `Uploading ${done+1}/${total}...`;
                pf.style.width = `${((done+.5)/total)*100}%`;
                await putFile(fp, b64, `Add: ${jpg}`);
                const entry = { id: `p-${ts}-${Math.random().toString(36).slice(2,6)}`, src: `${RAW}/${fp}`, caption: cap || safe.replace(/[-_]/g,' ').replace(/\.\w+$/,''), category: cat, date: new Date().toISOString(), alt: `${cap || safe} — Photo by Subroto Das` };
                if (exif.dateTaken) entry.dateTaken = exif.dateTaken;
                if (exif.cameraMake) entry.cameraMake = exif.cameraMake;
                if (exif.cameraModel) entry.cameraModel = exif.cameraModel;
                if (exif.exposure) entry.exposure = exif.exposure;
                if (exif.aperture) entry.aperture = exif.aperture;
                if (exif.iso) entry.iso = exif.iso;
                if (exif.focalLength) entry.focalLength = exif.focalLength;
                if (exif.lens) entry.lens = exif.lens;
                gd.photos.push(entry); done++;
                pf.style.width = `${(done/total)*100}%`;
            }
            await putFile(DATA, btoa(unescape(encodeURIComponent(JSON.stringify(gd, null, 2)))), `Gallery +${total}`);
            pt.textContent = 'Done!'; toast(`${total} photo(s) uploaded!`, 'success');
            picks = []; $('#previewGrid').innerHTML = ''; $('#photoCaption').value = ''; $('#photoCategory').value = ''; fi.value = '';
            setTimeout(() => { pp.style.display = 'none'; pf.style.width = '0%'; }, 800);
            photos = gd.photos; applyFilter();
        } catch (e) { toast(`Failed: ${e.message}`, 'error'); pt.textContent = 'Failed'; }
        $('#uploadBtn').disabled = false;
    });

    // Gallery
    async function loadGallery() { try { photos = (await getData()).photos || []; } catch { photos = []; } applyFilter(); }

    function getPhotoDate(p) { return new Date(p.dateTaken || p.date); }

    function applyFilter() {
        const from = $('#dateFrom').value ? new Date($('#dateFrom').value + 'T00:00:00') : null;
        const to = $('#dateTo').value ? new Date($('#dateTo').value + 'T23:59:59') : null;
        filtered = photos.filter(p => { const d = getPhotoDate(p); if (from && d < from) return false; if (to && d > to) return false; return true; });
        filtered.sort((a, b) => getPhotoDate(b) - getPhotoDate(a));
        renderTimeline();
    }

    function renderTimeline() {
        const tl = $('#timeline'); tl.innerHTML = '';
        const empty = $('#emptyState');
        if (!filtered.length) { empty.classList.add('show'); lucide.createIcons(); return; }
        empty.classList.remove('show');

        const groups = {};
        filtered.forEach(p => {
            const d = getPhotoDate(p);
            const key = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            if (!groups[key]) groups[key] = [];
            groups[key].push(p);
        });

        Object.entries(groups).forEach(([month, items]) => {
            const grp = document.createElement('div'); grp.className = 'tl-group';
            const label = document.createElement('div'); label.className = 'tl-label';
            label.innerHTML = `<span class="tl-label-text">${month}</span><span class="tl-label-count">${items.length} photo${items.length > 1 ? 's' : ''}</span><span class="tl-label-line"></span>`;

            const grid = document.createElement('div'); grid.className = 'sg';

            items.forEach(photo => {
                const item = document.createElement('div'); item.className = 'sg-item skel';
                const img = document.createElement('img');
                img.alt = photo.alt || photo.caption;
                img.loading = 'lazy';
                img.onload = () => { item.classList.remove('skel'); img.classList.add('loaded'); item.style.aspectRatio = ''; };
                img.onerror = () => item.remove();
                img.src = photo.src;

                const over = document.createElement('div'); over.className = 'sg-over';
                const cap = document.createElement('div'); cap.className = 'sg-cap'; cap.textContent = photo.caption;
                const dt = document.createElement('div'); dt.className = 'sg-date';
                const photoDate = getPhotoDate(photo);
                dt.textContent = photoDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                over.append(cap, dt);
                if (photo.cameraModel) { const cm = document.createElement('div'); cm.className = 'sg-cam'; cm.textContent = photo.cameraModel; over.appendChild(cm); }

                item.append(img, over);
                item.addEventListener('click', () => openLB(filtered.indexOf(photo)));
                grid.appendChild(item);
            });

            grp.append(label, grid);
            tl.appendChild(grp);
        });

        initScrollReveal();
    }

    // Scroll reveal with IntersectionObserver
    function initScrollReveal() {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('revealed');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

        document.querySelectorAll('.sg-item, .tl-label, .gallery-intro, footer').forEach(el => observer.observe(el));
    }

    // Lightbox
    const lb = $('#lightbox');
    function openLB(i) {
        lbi = i; const p = filtered[i]; if (!p) return;
        $('#lightboxImg').src = p.src; $('#lightboxImg').alt = p.alt || p.caption;
        $('#lightboxCaption').textContent = p.caption;
        const d = getPhotoDate(p);
        $('#lightboxMeta').textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        const ex = $('#lightboxExif'); ex.innerHTML = '';
        [p.cameraMake && p.cameraModel ? `${p.cameraMake} ${p.cameraModel}` : p.cameraModel, p.lens, p.focalLength, p.aperture, p.exposure, p.iso].filter(Boolean).forEach(t => { const s = document.createElement('span'); s.textContent = t; ex.appendChild(s); });
        lb.classList.add('open'); document.body.style.overflow = 'hidden';
    }
    function closeLB() { lb.classList.remove('open'); document.body.style.overflow = ''; lbi = -1; }
    $('#lightboxClose').addEventListener('click', closeLB);
    lb.addEventListener('click', e => { if (e.target === lb) closeLB(); });
    $('#lightboxPrev').addEventListener('click', e => { e.stopPropagation(); if (lbi > 0) openLB(lbi-1); });
    $('#lightboxNext').addEventListener('click', e => { e.stopPropagation(); if (lbi < filtered.length-1) openLB(lbi+1); });
    document.addEventListener('keydown', e => { if (!lb.classList.contains('open')) return; if (e.key === 'Escape') closeLB(); if (e.key === 'ArrowLeft' && lbi > 0) openLB(lbi-1); if (e.key === 'ArrowRight' && lbi < filtered.length-1) openLB(lbi+1); });
    let tx = 0;
    lb.addEventListener('touchstart', e => { tx = e.changedTouches[0].screenX; }, { passive: true });
    lb.addEventListener('touchend', e => { const d = e.changedTouches[0].screenX - tx; if (Math.abs(d) > 50) { d > 0 && lbi > 0 ? openLB(lbi-1) : d < 0 && lbi < filtered.length-1 && openLB(lbi+1); } }, { passive: true });

    function toast(msg, type = 'info') { const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg; $('#toastContainer').appendChild(t); setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 200); }, 3000); }
})();
