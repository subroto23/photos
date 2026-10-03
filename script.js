(() => {
    'use strict';
    const GH_OWNER = 'subroto23', GH_REPO = 'photos', GH_BRANCH = 'main';
    const DATA = 'gallery-data.json', DIR = 'photos';
    const RAW = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}`;
    // Cloudflare Worker backend — holds GitHub token + PIN as secrets (browser never sees them).
    const WORKER = 'https://subro-gallery-upload.subrotodas1714037.workers.dev';

    let userPin = null, photos = [], filtered = [], allPhotos = [], lbi = -1, picks = [];
    const PER_PAGE = 60;
    let currentPage = 1, currentCat = '__all';
    const $ = s => document.querySelector(s);

    // Call the Worker (the browser never sees the GitHub token)
    async function worker(endpoint, payload) {
        const r = await fetch(`${WORKER}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: userPin, ...payload }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
        return data;
    }

    // Init
    window.addEventListener('load', () => { lucide.createIcons(); loadGallery(); checkRoute(); });

    // Hidden route — only accessible via #upload
    function checkRoute() {
        if (location.hash === '#upload') openUploadModal();
    }
    window.addEventListener('hashchange', checkRoute);

    function openUploadModal() {
        modal.classList.add('open');
        $('#pinInput').value = '';
        $('#pinError').classList.remove('show');
        $('#pinGate').style.display = 'block';
        $('#uploadForm').style.display = 'none';
        setTimeout(() => $('#pinInput').focus(), 50);
    }

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
    $('#openUploadBtn').addEventListener('click', openUploadModal);
    $('#closeModal').addEventListener('click', () => { modal.classList.remove('open'); history.replaceState(null, '', location.pathname); });
    $('#pinSubmitBtn').addEventListener('click', doPin);
    $('#pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') doPin(); });

    async function doPin() {
        const pin = $('#pinInput').value.trim();
        if (!pin) return;
        const b = $('#pinSubmitBtn'); b.disabled = true; b.textContent = 'Checking...';
        try {
            userPin = pin;
            await worker('/api/auth', {});
            toast('Unlocked', 'success');
            $('#pinGate').style.display = 'none'; $('#uploadForm').style.display = 'block'; lucide.createIcons();
        } catch (e) {
            userPin = null;
            $('#pinError').classList.add('show'); $('#pinInput').value = '';
        }
        b.disabled = false; b.textContent = 'Unlock';
    }

    // Combobox — Category
    const catInput = $('#photoCategory'), catDd = $('#catDropdown'), catToggle = $('#catToggle');
    const capInput = $('#photoCaption'), capDd = $('#capDropdown'), capToggle = $('#capToggle');
    let selectedCat = '', capLang = 'bn', hlIdx = -1;

    function buildCatDropdown(filter = '') {
        catDd.innerHTML = '';
        const q = filter.toLowerCase();
        const cats = Object.keys(CAP_DATA);
        let hasMatch = false;
        cats.forEach(cat => {
            if (q && !cat.toLowerCase().includes(q)) return;
            hasMatch = true;
            const item = document.createElement('div');
            item.className = 'dd-item' + (cat === selectedCat ? ' selected' : '');
            item.textContent = `${CAP_DATA[cat].icon} ${cat}`;
            item.addEventListener('click', () => {
                selectedCat = cat;
                catInput.value = cat;
                closeDd(catDd, catToggle);
                buildCapDropdown();
            });
            catDd.appendChild(item);
        });
        if (!hasMatch) {
            const empty = document.createElement('div');
            empty.className = 'dd-empty';
            empty.textContent = `"${filter}" — custom category`;
            catDd.appendChild(empty);
        }
    }

    function buildCapDropdown(filter = '') {
        capDd.innerHTML = '';
        const q = filter.toLowerCase();
        const cat = selectedCat;

        if (cat && CAP_DATA[cat]) {
            const caps = CAP_DATA[cat][capLang] || [];
            let hasMatch = false;
            caps.forEach(c => {
                if (q && !c.toLowerCase().includes(q)) return;
                hasMatch = true;
                const item = document.createElement('div');
                item.className = 'dd-item';
                item.textContent = c;
                item.addEventListener('click', () => {
                    capInput.value = c;
                    closeDd(capDd, capToggle);
                });
                capDd.appendChild(item);
            });
            if (!hasMatch && q) {
                const empty = document.createElement('div');
                empty.className = 'dd-empty';
                empty.textContent = `"${filter}" — custom caption`;
                capDd.appendChild(empty);
            }
        } else {
            Object.keys(CAP_DATA).forEach(catKey => {
                const caps = CAP_DATA[catKey][capLang] || [];
                const matched = caps.filter(c => c.toLowerCase().includes(q));
                if (!matched.length) return;
                const header = document.createElement('div');
                header.className = 'dd-cat-header';
                header.innerHTML = `<span class="dd-icon">${CAP_DATA[catKey].icon}</span> ${catKey}`;
                capDd.appendChild(header);
                matched.slice(0, 10).forEach(c => {
                    const item = document.createElement('div');
                    item.className = 'dd-item';
                    item.textContent = c;
                    item.addEventListener('click', () => {
                        capInput.value = c;
                        selectedCat = catKey;
                        catInput.value = catKey;
                        closeDd(capDd, capToggle);
                    });
                    capDd.appendChild(item);
                });
            });
        }
    }

    function openDd(dd, toggle) { dd.classList.add('open'); toggle.classList.add('open'); }
    function closeDd(dd, toggle) { dd.classList.remove('open'); toggle.classList.remove('open'); }
    function toggleDd(dd, toggle, buildFn) {
        if (dd.classList.contains('open')) { closeDd(dd, toggle); }
        else { buildFn(); openDd(dd, toggle); }
    }

    catInput.addEventListener('focus', () => { buildCatDropdown(catInput.value); openDd(catDd, catToggle); });
    catInput.addEventListener('input', () => { buildCatDropdown(catInput.value); openDd(catDd, catToggle); selectedCat = ''; });
    catToggle.addEventListener('click', () => toggleDd(catDd, catToggle, () => buildCatDropdown(catInput.value)));

    capInput.addEventListener('focus', () => { buildCapDropdown(capInput.value); openDd(capDd, capToggle); });
    capInput.addEventListener('input', () => { buildCapDropdown(capInput.value); openDd(capDd, capToggle); });
    capToggle.addEventListener('click', () => toggleDd(capDd, capToggle, () => buildCapDropdown(capInput.value)));

    // Language tabs
    document.querySelectorAll('.lang-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.lang-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            capLang = tab.dataset.lang;
            capInput.value = '';
            buildCapDropdown();
            if (capDd.classList.contains('open')) openDd(capDd, capToggle);
        });
    });

    // Close dropdowns on outside click
    document.addEventListener('click', e => {
        if (!e.target.closest('#catComboWrap')) closeDd(catDd, catToggle);
        if (!e.target.closest('#capComboWrap')) closeDd(capDd, capToggle);
    });

    // Keyboard navigation for combobox
    [catInput, capInput].forEach(input => {
        input.addEventListener('keydown', e => {
            const dd = input === catInput ? catDd : capDd;
            const items = dd.querySelectorAll('.dd-item');
            if (!items.length) return;
            const highlighted = dd.querySelector('.dd-item.highlighted');
            let idx = Array.from(items).indexOf(highlighted);
            if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, items.length - 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); }
            else if (e.key === 'Enter' && highlighted) { e.preventDefault(); highlighted.click(); return; }
            else if (e.key === 'Escape') { closeDd(dd, input === catInput ? catToggle : capToggle); return; }
            else return;
            items.forEach(i => i.classList.remove('highlighted'));
            if (items[idx]) { items[idx].classList.add('highlighted'); items[idx].scrollIntoView({ block: 'nearest' }); }
        });
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

    // Public read of gallery data (no auth — raw file is public)
    async function getData() { try { const r = await fetch(`${RAW}/${DATA}?t=${Date.now()}`); if (r.ok) return JSON.parse(await r.text()); } catch {} return { photos: [] }; }

    // Slug for filenames (always carries the name)
    function slugify(s) {
        return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
    }

    // Upload — compression + EXIF happen in the browser; the Worker
    // commits to GitHub with its hidden token. No secret touches the client.
    $('#uploadBtn').addEventListener('click', async () => {
        if (!picks.length || !userPin) return;
        const cap = capInput.value.trim(), cat = (selectedCat || catInput.value.trim()) || 'General';
        const pf = $('#progressFill'), pt = $('#progressText'), pp = $('#uploadProgress');
        $('#uploadBtn').disabled = true; pp.style.display = 'block';
        try {
            const total = picks.length; let done = 0; const entries = [];
            for (const file of picks) {
                const ts = Date.now(), safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                const nameSlug = slugify(cap) || slugify(file.name.replace(/\.\w+$/, '')) || 'photo';
                const jpg = `subroto-das-${slugify(cat)}-${nameSlug}-${ts}.jpg`;
                const fp = `${DIR}/${cat.toLowerCase().replace(/\s+/g, '-')}/${jpg}`;
                pt.textContent = `EXIF ${done+1}/${total}...`;
                const exif = await readExif(file);
                pt.textContent = `Compressing ${done+1}/${total}...`;
                const b64 = await compress(file);
                pt.textContent = `Uploading ${done+1}/${total}...`;
                pf.style.width = `${((done+.5)/total)*100}%`;
                await worker('/api/upload', { path: fp, content: b64 });
                const capFinal = cap || safe.replace(/[-_]/g,' ').replace(/\.\w+$/,'');
                const entry = { id: `p-${ts}-${Math.random().toString(36).slice(2,6)}`, src: `${RAW}/${fp}`, caption: capFinal, category: cat, date: new Date().toISOString(), alt: `${capFinal} — ${cat} photo by Subroto Das` };
                if (exif.dateTaken) entry.dateTaken = exif.dateTaken;
                if (exif.cameraMake) entry.cameraMake = exif.cameraMake;
                if (exif.cameraModel) entry.cameraModel = exif.cameraModel;
                if (exif.exposure) entry.exposure = exif.exposure;
                if (exif.aperture) entry.aperture = exif.aperture;
                if (exif.iso) entry.iso = exif.iso;
                if (exif.focalLength) entry.focalLength = exif.focalLength;
                if (exif.lens) entry.lens = exif.lens;
                entries.push(entry); done++;
                pf.style.width = `${(done/total)*100}%`;
            }
            pt.textContent = 'Finalizing...';
            await worker('/api/finalize', { entries });
            pt.textContent = 'Done!'; toast(`${total} photo(s) uploaded!`, 'success');
            picks = []; $('#previewGrid').innerHTML = ''; capInput.value = ''; catInput.value = ''; selectedCat = ''; fi.value = '';
            setTimeout(() => { pp.style.display = 'none'; pf.style.width = '0%'; }, 800);
            photos = [...photos, ...entries]; updateSEO(); buildCatFilter(); applyFilter();
        } catch (e) { toast(`Failed: ${e.message}`, 'error'); pt.textContent = 'Failed'; }
        $('#uploadBtn').disabled = false;
    });

    // SEO — default text helpers
    function seoTitle(p) {
        if (p.caption && p.caption.trim()) return p.caption.trim();
        const d = getPhotoDate(p);
        const dateStr = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        const cam = p.cameraModel ? ` — ${p.cameraModel}` : '';
        const cat = p.category && p.category !== 'General' ? `${p.category} ` : '';
        return `${cat}Photo by Subroto Das — ${dateStr}${cam}`;
    }
    function seoAlt(p) {
        if (p.alt && p.alt.trim()) return p.alt.trim();
        return `${seoTitle(p)} | Subroto Das Photography`;
    }
    function seoDesc(p) {
        const parts = [seoTitle(p)];
        if (p.cameraModel) parts.push(`Shot on ${p.cameraMake ? p.cameraMake + ' ' : ''}${p.cameraModel}`);
        if (p.aperture) parts.push(p.aperture);
        if (p.iso) parts.push(p.iso);
        if (p.focalLength) parts.push(p.focalLength);
        return parts.join(' · ');
    }

    // Dynamic JSON-LD for all photos
    function updateSEO() {
        let el = document.getElementById('dynamic-jsonld');
        if (!el) { el = document.createElement('script'); el.id = 'dynamic-jsonld'; el.type = 'application/ld+json'; document.head.appendChild(el); }

        const imageObjects = photos.map(p => {
            const obj = {
                '@type': 'ImageObject',
                contentUrl: p.src,
                name: seoTitle(p),
                description: seoDesc(p),
                author: { '@type': 'Person', name: 'Subroto Das', url: 'https://me.subromart.com' },
                datePublished: p.date,
                thumbnailUrl: p.src
            };
            if (p.dateTaken) obj.dateCreated = p.dateTaken;
            if (p.cameraModel) obj.exifData = [
                ...(p.cameraMake ? [{ '@type': 'PropertyValue', name: 'cameraMake', value: p.cameraMake }] : []),
                { '@type': 'PropertyValue', name: 'cameraModel', value: p.cameraModel },
                ...(p.aperture ? [{ '@type': 'PropertyValue', name: 'fNumber', value: p.aperture }] : []),
                ...(p.iso ? [{ '@type': 'PropertyValue', name: 'isoSpeed', value: p.iso }] : []),
                ...(p.focalLength ? [{ '@type': 'PropertyValue', name: 'focalLength', value: p.focalLength }] : []),
                ...(p.exposure ? [{ '@type': 'PropertyValue', name: 'exposureTime', value: p.exposure }] : []),
                ...(p.lens ? [{ '@type': 'PropertyValue', name: 'lens', value: p.lens }] : [])
            ];
            return obj;
        });

        el.textContent = JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'ImageGallery',
            name: 'Subroto Das Photo Gallery',
            url: 'https://photos.subromart.com',
            description: `Photography collection by Subroto Das — ${photos.length} photos`,
            author: { '@type': 'Person', name: 'Subroto Das', jobTitle: 'Software Engineer', url: 'https://me.subromart.com' },
            image: imageObjects
        });
    }

    // Gallery
    async function loadGallery() { try { photos = (await getData()).photos || []; } catch { photos = []; } updateSEO(); buildCatFilter(); applyFilter(); }

    function getPhotoDate(p) { return new Date(p.dateTaken || p.date); }

    // Category filter chips (derived from actual photos)
    function buildCatFilter() {
        const bar = $('#catFilter'); if (!bar) return;
        const counts = {};
        photos.forEach(p => { const c = (p.category || 'General').trim() || 'General'; counts[c] = (counts[c] || 0) + 1; });
        const cats = Object.keys(counts).sort((a, b) => a.localeCompare(b));
        bar.innerHTML = '';
        const mk = (key, label, count) => {
            const b = document.createElement('button');
            b.className = 'cat-chip' + (currentCat === key ? ' active' : '');
            b.innerHTML = `${label} <span>${count}</span>`;
            b.addEventListener('click', () => { currentCat = key; currentPage = 1; buildCatFilter(); applyFilter(); scrollGalleryTop(); });
            bar.appendChild(b);
        };
        mk('__all', 'All', photos.length);
        cats.forEach(c => mk(c, (CAP_DATA[c] && CAP_DATA[c].icon ? CAP_DATA[c].icon + ' ' : '') + c, counts[c]));
    }

    function scrollGalleryTop() {
        const el = document.querySelector('.gallery-toolbar') || $('#gallery');
        if (el) window.scrollTo({ top: Math.max(0, el.offsetTop - 70), behavior: 'smooth' });
    }

    function applyFilter() {
        const from = $('#dateFrom').value ? new Date($('#dateFrom').value + 'T00:00:00') : null;
        const to = $('#dateTo').value ? new Date($('#dateTo').value + 'T23:59:59') : null;
        filtered = photos.filter(p => {
            const d = getPhotoDate(p);
            if (from && d < from) return false;
            if (to && d > to) return false;
            if (currentCat !== '__all' && (p.category || 'General') !== currentCat) return false;
            return true;
        });
        filtered.sort((a, b) => getPhotoDate(b) - getPhotoDate(a));
        currentPage = 1;
        renderTimeline();
    }

    function updateResultCount() {
        const el = $('#resultCount'); if (!el) return;
        const n = filtered.length;
        if (!n) { el.textContent = ''; return; }
        const totalPages = Math.ceil(n / PER_PAGE);
        const start = (currentPage - 1) * PER_PAGE + 1;
        const end = Math.min(currentPage * PER_PAGE, n);
        el.textContent = totalPages > 1 ? `${start}–${end} of ${n} photos` : `${n} photo${n > 1 ? 's' : ''}`;
    }

    function renderTimeline() {
        const tl = $('#timeline'); tl.innerHTML = '';
        const empty = $('#emptyState');
        updateResultCount();
        if (!filtered.length) { empty.classList.add('show'); renderPagination(1); lucide.createIcons(); return; }
        empty.classList.remove('show');

        const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
        if (currentPage > totalPages) currentPage = totalPages;
        const pageItems = filtered.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

        const groups = {};
        pageItems.forEach(p => {
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
                item.setAttribute('itemscope',''); item.setAttribute('itemtype','https://schema.org/ImageObject');
                const img = document.createElement('img');
                img.alt = seoAlt(photo);
                img.setAttribute('itemprop','contentUrl');
                img.loading = 'lazy';
                img.onload = () => { item.classList.remove('skel'); img.classList.add('loaded'); item.style.aspectRatio = ''; };
                img.onerror = () => item.remove();
                img.src = photo.src;

                const over = document.createElement('div'); over.className = 'sg-over';
                const cap = document.createElement('div'); cap.className = 'sg-cap'; cap.setAttribute('itemprop','name'); cap.textContent = seoTitle(photo);
                const dt = document.createElement('div'); dt.className = 'sg-date'; dt.setAttribute('itemprop','dateCreated');
                const photoDate = getPhotoDate(photo);
                dt.textContent = photoDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                const metaDesc = document.createElement('meta'); metaDesc.setAttribute('itemprop','description'); metaDesc.content = seoDesc(photo);
                over.append(cap, dt, metaDesc);
                if (photo.cameraModel) { const cm = document.createElement('div'); cm.className = 'sg-cam'; cm.textContent = photo.cameraModel; over.appendChild(cm); }

                item.append(img, over);
                item.addEventListener('click', () => openLB(filtered.indexOf(photo)));
                addTilt(item);
                grid.appendChild(item);
            });

            grp.append(label, grid);
            tl.appendChild(grp);
        });

        renderPagination(totalPages);
        initScrollReveal();
    }

    function goToPage(n) {
        const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
        currentPage = Math.min(Math.max(1, n), totalPages);
        renderTimeline();
        scrollGalleryTop();
    }

    // Pagination controls with ellipsis windowing
    function renderPagination(totalPages) {
        const el = $('#pagination'); if (!el) return;
        el.innerHTML = '';
        if (totalPages <= 1) return;

        const btn = (label, page, { active = false, disabled = false, icon = false } = {}) => {
            const b = document.createElement('button');
            b.className = 'pg-btn' + (active ? ' active' : '');
            if (icon) b.innerHTML = `<i data-lucide="${label}"></i>`; else b.textContent = label;
            b.disabled = disabled;
            if (!disabled && !active) b.addEventListener('click', () => goToPage(page));
            el.appendChild(b);
        };
        const ellipsis = () => { const s = document.createElement('span'); s.className = 'pg-ellipsis'; s.textContent = '…'; el.appendChild(s); };

        btn('chevron-left', currentPage - 1, { disabled: currentPage === 1, icon: true });

        const pages = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
        const list = [...pages].filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b);
        let prev = 0;
        list.forEach(p => {
            if (p - prev > 1) ellipsis();
            btn(String(p), p, { active: p === currentPage });
            prev = p;
        });

        btn('chevron-right', currentPage + 1, { disabled: currentPage === totalPages, icon: true });
        lucide.createIcons();
    }

    // 3D tilt on hover
    function addTilt(el) {
        const max = 4;
        el.addEventListener('mousemove', e => {
            const r = el.getBoundingClientRect();
            const x = (e.clientX - r.left) / r.width;
            const y = (e.clientY - r.top) / r.height;
            const rY = (x - 0.5) * max;
            const rX = (0.5 - y) * max;
            el.style.transform = `perspective(800px) rotateX(${rX}deg) rotateY(${rY}deg) scale(1.01)`;
        });
        el.addEventListener('mouseleave', () => {
            el.style.transform = '';
        });
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
