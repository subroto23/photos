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
            document.body.classList.add('authed');
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
        const desc = $('#photoDescription').value.trim();
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
                if (desc) entry.description = desc;
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
            picks = []; $('#previewGrid').innerHTML = ''; capInput.value = ''; catInput.value = ''; $('#photoDescription').value = ''; selectedCat = ''; fi.value = '';
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
    const hasName = s => /subroto\s*das/i.test(s || '');
    function withName(s, suffix) { return hasName(s) ? s : (s ? `${s}${suffix}` : 'Photo by Subroto Das'); }

    function seoAlt(p) {
        const base = (p.alt && p.alt.trim()) ? p.alt.trim() : `${seoTitle(p)} | Subroto Das Photography`;
        return withName(base, ' — Photo by Subroto Das');
    }
    function seoDesc(p) {
        // Custom description (if the author wrote one) takes priority for SEO
        if (p.description && p.description.trim()) {
            return withName(p.description.trim(), ' — Photo by Subroto Das');
        }
        const parts = [seoTitle(p)];
        if (p.cameraModel) parts.push(`Shot on ${p.cameraMake ? p.cameraMake + ' ' : ''}${p.cameraModel}`);
        if (p.aperture) parts.push(p.aperture);
        if (p.iso) parts.push(p.iso);
        if (p.focalLength) parts.push(p.focalLength);
        return withName(parts.join(' · '), ' · Photo by Subroto Das');
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

    // Lightbox — two-layer crossfade driven by the Web Animations API.
    // Each slide randomly combines an "enter" style, a Ken-Burns drift and an
    // easing curve → 800+ smooth variations, any one can appear at any time.
    const lb = $('#lightbox');
    const layers = [$('#lbLayerA'), $('#lbLayerB')];
    let activeLayer = 0;
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Named transition presets (PowerPoint-style). User picks which ones are
    // in the random pool; "enters" = possible start states for that style.
    const TRANSITIONS = [
        { id: 'fade', name: 'Fade', enters: [{ t: 'scale(1.0)' }] },
        { id: 'zoomin', name: 'Zoom In', enters: [{ t: 'scale(0.86)' }] },
        { id: 'zoomout', name: 'Zoom Out', enters: [{ t: 'scale(1.28)' }] },
        { id: 'slideL', name: 'Slide Left', enters: [{ t: 'translateX(8%) scale(1.06)' }] },
        { id: 'slideR', name: 'Slide Right', enters: [{ t: 'translateX(-8%) scale(1.06)' }] },
        { id: 'slideU', name: 'Slide Up', enters: [{ t: 'translateY(8%) scale(1.06)' }] },
        { id: 'slideD', name: 'Slide Down', enters: [{ t: 'translateY(-8%) scale(1.06)' }] },
        { id: 'diag', name: 'Diagonal', enters: [{ t: 'translate(7%,7%) scale(1.08)' }, { t: 'translate(-7%,-7%) scale(1.08)' }, { t: 'translate(7%,-7%) scale(1.08)' }, { t: 'translate(-7%,7%) scale(1.08)' }] },
        { id: 'rotate', name: 'Rotate', enters: [{ t: 'scale(1.1) rotate(3deg)' }, { t: 'scale(1.1) rotate(-3deg)' }] },
        { id: 'blur', name: 'Blur', enters: [{ t: 'scale(1.12)', f: 'blur(20px)' }, { t: 'scale(0.95)', f: 'blur(14px)' }] },
        { id: 'glow', name: 'Glow', enters: [{ t: 'scale(1.08)', f: 'blur(10px) brightness(1.5)' }] },
        { id: 'darkfade', name: 'Dark Fade', enters: [{ t: 'scale(1.1)', f: 'brightness(0.3)' }] },
        { id: 'flipH', name: 'Flip Horizontal', enters: [{ t: 'perspective(1200px) rotateY(16deg) scale(1.06)' }, { t: 'perspective(1200px) rotateY(-16deg) scale(1.06)' }] },
        { id: 'flipV', name: 'Flip Vertical', enters: [{ t: 'perspective(1200px) rotateX(16deg) scale(1.06)' }, { t: 'perspective(1200px) rotateX(-16deg) scale(1.06)' }] },
    ];
    const TRANS_BY_ID = Object.fromEntries(TRANSITIONS.map(t => [t.id, t]));
    let enabledFx = new Set(TRANSITIONS.map(t => t.id));
    try { const s = JSON.parse(localStorage.getItem('ss-fx') || 'null'); if (Array.isArray(s)) enabledFx = new Set(s.filter(id => TRANS_BY_ID[id])); } catch {}
    const saveFx = () => { try { localStorage.setItem('ss-fx', JSON.stringify([...enabledFx])); } catch {} };
    function pickEnter() {
        const ids = [...enabledFx];
        if (!ids.length) return { t: 'scale(1.0)' }; // nothing selected → plain fade
        const tr = TRANS_BY_ID[ids[rnd(ids.length)]];
        return tr.enters[rnd(tr.enters.length)];
    }
    // Continuous Ken-Burns drift (start → end over the whole slide)
    const MOTIONS = [
        { s: 'scale(1.06)', e: 'scale(1.17)' }, { s: 'scale(1.17)', e: 'scale(1.06)' },
        { s: 'scale(1.12) translateX(3%)', e: 'scale(1.15) translateX(-3%)' },
        { s: 'scale(1.12) translateX(-3%)', e: 'scale(1.15) translateX(3%)' },
        { s: 'scale(1.12) translateY(3%)', e: 'scale(1.15) translateY(-3%)' },
        { s: 'scale(1.12) translateY(-3%)', e: 'scale(1.15) translateY(3%)' },
        { s: 'scale(1.1) translate(3%,2%)', e: 'scale(1.17) translate(-3%,-2%)' },
        { s: 'scale(1.1) translate(-3%,-2%)', e: 'scale(1.17) translate(3%,2%)' },
        { s: 'scale(1.1) translate(3%,-2%)', e: 'scale(1.17) translate(-3%,2%)' },
        { s: 'scale(1.1) translate(-3%,2%)', e: 'scale(1.17) translate(3%,-2%)' },
        { s: 'scale(1.08) rotate(-1deg)', e: 'scale(1.16) rotate(1deg)' },
        { s: 'scale(1.08) rotate(1deg)', e: 'scale(1.16) rotate(-1deg)' },
        { s: 'scale(1.05)', e: 'scale(1.22)' }, { s: 'scale(1.2)', e: 'scale(1.05)' },
    ];
    const EASES = ['linear', 'ease-in-out', 'cubic-bezier(.33,0,.2,1)', 'cubic-bezier(.4,0,.2,1)', 'cubic-bezier(.45,.05,.55,.95)'];
    const rnd = n => Math.floor(Math.random() * n);

    function showImage(p) {
        const outEl = layers[activeLayer];
        const inEl = layers[activeLayer ^ 1];
        inEl.src = p.src; inEl.alt = p.alt || p.caption;

        const run = () => {
            layers.forEach(el => el.getAnimations().forEach(a => a.cancel()));
            const slideshow = isPlaying();
            const dur = slideshow ? SLIDE_MS : 650;

            if (reduceMotion || !slideshow) {
                inEl.animate([{ opacity: 0, transform: 'scale(1.02)' }, { opacity: 1, transform: 'scale(1)' }],
                    { duration: reduceMotion ? 300 : dur, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'both' });
            } else {
                const en = pickEnter(), mo = MOTIONS[rnd(MOTIONS.length)], ez = EASES[rnd(EASES.length)];
                inEl.animate([
                    { opacity: 0, transform: en.t, filter: en.f || 'blur(0px)', offset: 0, easing: 'cubic-bezier(.22,.61,.36,1)' },
                    { opacity: 1, transform: mo.s, filter: 'blur(0px) brightness(1)', offset: 0.16, easing: ez },
                    { opacity: 1, transform: mo.e, filter: 'blur(0px) brightness(1)', offset: 1 },
                ], { duration: dur, fill: 'both' });
            }
            // crossfade the previous image out
            if (outEl.src) outEl.animate([{ opacity: 1 }, { opacity: 0 }],
                { duration: Math.min(1100, dur), easing: 'ease', fill: 'forwards' });
        };

        if (inEl.complete && inEl.naturalWidth) run();
        else { inEl.onload = run; inEl.onerror = run; }
        activeLayer ^= 1;
    }

    function openLB(i) {
        lbi = i; const p = filtered[i]; if (!p) return;
        showImage(p);
        $('#lightboxCaption').textContent = p.caption;
        const d = getPhotoDate(p);
        $('#lightboxMeta').textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        const ex = $('#lightboxExif'); ex.innerHTML = '';
        [p.cameraMake && p.cameraModel ? `${p.cameraMake} ${p.cameraModel}` : p.cameraModel, p.lens, p.focalLength, p.aperture, p.exposure, p.iso].filter(Boolean).forEach(t => { const s = document.createElement('span'); s.textContent = t; ex.appendChild(s); });
        lb.classList.add('open'); document.body.style.overflow = 'hidden';
    }
    function closeLB() { stopSlideshow(); closeFxPanel(); lb.classList.remove('open'); document.body.style.overflow = ''; lbi = -1; }
    $('#lightboxClose').addEventListener('click', closeLB);

    // === Slideshow / autoplay ===
    const SLIDE_MS = 6000;
    let slideTimer = null;
    lb.style.setProperty('--slide-dur', (SLIDE_MS / 1000) + 's');
    const isPlaying = () => slideTimer !== null;
    function setPlayBtn(playing) { $('#lightboxPlay').innerHTML = `<i data-lucide="${playing ? 'pause' : 'play'}"></i><span>${playing ? 'Pause' : 'Slideshow'}</span>`; lucide.createIcons(); }
    function startSlideshow() {
        if (filtered.length < 2) { toast('Need more photos', 'info'); return; }
        clearInterval(slideTimer);
        lb.classList.add('slideshow');
        lb.classList.toggle('has-music', musicTracks.length > 0);
        slideTimer = setInterval(() => openLB((lbi + 1) % filtered.length), SLIDE_MS);
        setPlayBtn(true);
        setSoundBtn();
        startMusic();
    }
    function stopSlideshow() { if (slideTimer) { clearInterval(slideTimer); slideTimer = null; } lb.classList.remove('slideshow'); if (document.getElementById('lightboxPlay')) setPlayBtn(false); stopMusic(); closeMusicPanel(); }
    function toggleSlideshow() { isPlaying() ? stopSlideshow() : startSlideshow(); }
    $('#lightboxPlay').addEventListener('click', e => { e.stopPropagation(); toggleSlideshow(); });

    // === Background music — free & royalty-free, random each time ===
    // Works out of the box with keyless royalty-free tracks (SoundHelix).
    // For Bollywood/Indian royalty-free music, get a FREE client id from
    // https://developer.jamendo.com and paste it below — tracks load automatically.
    const JAMENDO_CLIENT_ID = '';
    let musicTracks = Array.from({ length: 16 }, (_, i) => `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${i + 1}.mp3`);
    async function loadMusic() {
        if (!JAMENDO_CLIENT_ID) return;
        try {
            const url = `https://api.jamendo.com/v3.0/tracks/?client_id=${JAMENDO_CLIENT_ID}&format=json&limit=50&fuzzytags=bollywood+indian+instrumental&audioformat=mp31&order=popularity_total&include=musicinfo`;
            const r = await fetch(url);
            const j = await r.json();
            const urls = (j.results || []).map(t => t.audio).filter(Boolean);
            if (urls.length) musicTracks = urls;
        } catch {}
    }
    loadMusic();

    const audio = $('#ssAudio');
    let soundMuted = false;
    let manualTrack = null; // {url, name} chosen by the user via search
    function pickTrack() {
        if (!musicTracks.length) return null;
        return musicTracks[Math.floor(Math.random() * musicTracks.length)];
    }
    function setNowPlaying(txt) { const el = $('#mpNow'); if (el) el.textContent = txt; }
    function startMusic() {
        if (manualTrack) { playChosen(manualTrack); return; }
        const t = pickTrack();
        if (!t) return;
        if (!audio.src || audio.ended || audio.paused) { audio.src = t; }
        audio.loop = false; audio.volume = 0.55; audio.muted = soundMuted;
        audio.play().catch(() => {});
        setNowPlaying('Auto · random music');
    }
    function playChosen(track) {
        manualTrack = track;
        audio.src = track.url; audio.loop = true; audio.volume = 0.6; audio.muted = soundMuted;
        audio.play().catch(() => {});
        setNowPlaying('♪ ' + track.name);
    }
    function nextRandom() {
        manualTrack = null;
        const t = pickTrack(); if (!t) return;
        audio.src = t; audio.loop = false; audio.muted = soundMuted;
        audio.play().catch(() => {});
        setNowPlaying('Auto · random music');
        document.querySelectorAll('.mp-item.playing').forEach(el => el.classList.remove('playing'));
    }
    function stopMusic() { try { audio.pause(); } catch {} }
    audio.addEventListener('ended', () => { if (manualTrack) return; const t = pickTrack(); if (t) { audio.src = t; audio.play().catch(() => {}); } });
    function setSoundBtn() {
        const b = $('#lightboxSound');
        b.classList.toggle('muted', soundMuted);
        b.innerHTML = `<i data-lucide="${soundMuted ? 'volume-x' : 'volume-2'}"></i>`;
        lucide.createIcons();
    }
    $('#lightboxSound').addEventListener('click', e => {
        e.stopPropagation();
        soundMuted = !soundMuted;
        audio.muted = soundMuted;
        if (!soundMuted && audio.src && audio.paused && isPlaying()) audio.play().catch(() => {});
        setSoundBtn();
    });

    // === Music search panel (iTunes Search API — free, keyless, legal previews) ===
    const musicPanel = $('#musicPanel');
    $('#lightboxMusicBtn').addEventListener('click', e => {
        e.stopPropagation();
        const open = musicPanel.classList.toggle('open');
        $('#lightboxMusicBtn').classList.toggle('active', open);
        if (open) setTimeout(() => $('#mpSearch').focus(), 50);
    });
    $('#mpSkip').addEventListener('click', e => { e.stopPropagation(); nextRandom(); toast('Next track', 'info'); });
    musicPanel.addEventListener('click', e => e.stopPropagation());

    let searchTimer = null;
    $('#mpSearch').addEventListener('input', e => {
        clearTimeout(searchTimer);
        const q = e.target.value.trim();
        if (!q) { $('#mpResults').innerHTML = ''; return; }
        searchTimer = setTimeout(() => searchMusic(q), 400);
    });
    async function searchMusic(q) {
        const box = $('#mpResults');
        box.innerHTML = '<div class="mp-empty">Searching…</div>';
        try {
            const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=25`);
            const j = await r.json();
            const list = (j.results || []).filter(t => t.previewUrl);
            if (!list.length) { box.innerHTML = '<div class="mp-empty">No results</div>'; return; }
            box.innerHTML = '';
            list.forEach(t => {
                const it = document.createElement('div');
                it.className = 'mp-item';
                const art = (t.artworkUrl60 || t.artworkUrl100 || '').replace('60x60', '80x80');
                it.innerHTML = `<img src="${art}" alt=""><div class="mp-item-txt"><div class="mp-item-title"></div><div class="mp-item-artist"></div></div>`;
                it.querySelector('.mp-item-title').textContent = t.trackName;
                it.querySelector('.mp-item-artist').textContent = t.artistName;
                it.addEventListener('click', () => {
                    document.querySelectorAll('.mp-item.playing').forEach(el => el.classList.remove('playing'));
                    it.classList.add('playing');
                    playChosen({ url: t.previewUrl, name: `${t.trackName} — ${t.artistName}` });
                    if (soundMuted) { soundMuted = false; audio.muted = false; setSoundBtn(); }
                    toast('Playing: ' + t.trackName, 'success');
                });
                box.appendChild(it);
            });
        } catch (err) { box.innerHTML = '<div class="mp-empty">Search failed</div>'; }
    }
    function closeMusicPanel() { musicPanel.classList.remove('open'); $('#lightboxMusicBtn').classList.remove('active'); }

    // === Transition picker (PowerPoint-style) ===
    const fxPanel = $('#fxPanel');
    function renderFx() {
        const g = $('#fxGrid'); g.innerHTML = '';
        TRANSITIONS.forEach(tr => {
            const b = document.createElement('button');
            b.className = 'fx-chip' + (enabledFx.has(tr.id) ? ' on' : '');
            b.textContent = tr.name;
            b.addEventListener('click', ev => {
                ev.stopPropagation();
                if (enabledFx.has(tr.id)) enabledFx.delete(tr.id); else enabledFx.add(tr.id);
                b.classList.toggle('on');
                saveFx();
            });
            g.appendChild(b);
        });
    }
    function closeFxPanel() { fxPanel.classList.remove('open'); $('#lightboxFxBtn').classList.remove('active'); }
    $('#lightboxFxBtn').addEventListener('click', e => {
        e.stopPropagation();
        const open = fxPanel.classList.toggle('open');
        $('#lightboxFxBtn').classList.toggle('active', open);
        if (open) { renderFx(); closeMusicPanel(); }
    });
    $('#fxAll').addEventListener('click', e => { e.stopPropagation(); enabledFx = new Set(TRANSITIONS.map(t => t.id)); saveFx(); renderFx(); });
    $('#fxNone').addEventListener('click', e => { e.stopPropagation(); enabledFx = new Set(); saveFx(); renderFx(); });
    fxPanel.addEventListener('click', e => e.stopPropagation());

    // Close open panels when clicking outside (capture phase catches all clicks)
    document.addEventListener('click', e => {
        if (musicPanel.classList.contains('open') && !e.target.closest('#musicPanel') && !e.target.closest('#lightboxMusicBtn')) closeMusicPanel();
        if (fxPanel.classList.contains('open') && !e.target.closest('#fxPanel') && !e.target.closest('#lightboxFxBtn')) closeFxPanel();
    }, true);

    // Delete (only works with a valid PIN — Worker verifies server-side)
    async function deletePhoto(photo) {
        if (!userPin || !photo) { toast('Unlock with PIN first', 'error'); return; }
        if (!confirm('Delete this photo permanently? This cannot be undone.')) return;
        const path = photo.src && photo.src.startsWith(RAW + '/') ? photo.src.slice(RAW.length + 1) : null;
        const delBtn = $('#lightboxDelete'); delBtn.disabled = true;
        try {
            await worker('/api/delete', { id: photo.id, path });
            photos = photos.filter(p => p !== photo);
            toast('Photo deleted', 'success');
            closeLB();
            updateSEO(); buildCatFilter(); applyFilter();
        } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
        delBtn.disabled = false;
    }
    $('#lightboxDelete').addEventListener('click', e => { e.stopPropagation(); const p = filtered[lbi]; if (p) deletePhoto(p); });

    lb.addEventListener('click', e => { if (e.target === lb) closeLB(); });
    const navLB = step => { const n = lbi + step; if (n >= 0 && n < filtered.length) { openLB(n); if (isPlaying()) startSlideshow(); } };
    $('#lightboxPrev').addEventListener('click', e => { e.stopPropagation(); navLB(-1); });
    $('#lightboxNext').addEventListener('click', e => { e.stopPropagation(); navLB(1); });
    document.addEventListener('keydown', e => {
        if (!lb.classList.contains('open')) return;
        // Don't hijack keys while the user is typing (e.g. music search box)
        const el = e.target;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
            if (e.key === 'Escape') el.blur();
            return;
        }
        if (e.key === 'Escape') closeLB();
        else if (e.key === 'ArrowLeft') navLB(-1);
        else if (e.key === 'ArrowRight') navLB(1);
        else if (e.key === ' ') { e.preventDefault(); toggleSlideshow(); }
    });
    let tx = 0;
    lb.addEventListener('touchstart', e => { tx = e.changedTouches[0].screenX; }, { passive: true });
    lb.addEventListener('touchend', e => { const d = e.changedTouches[0].screenX - tx; if (Math.abs(d) > 50) { d > 0 && lbi > 0 ? openLB(lbi-1) : d < 0 && lbi < filtered.length-1 && openLB(lbi+1); } }, { passive: true });

    function toast(msg, type = 'info') { const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg; $('#toastContainer').appendChild(t); setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 200); }, 3000); }
})();
