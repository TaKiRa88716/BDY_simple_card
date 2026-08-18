/* ==========================================================================
   Volleyball Player ID Card Studio - Core Canvas & App Logic
   Phase 1: text/logo is drawn ON TOP of a fixed template image, using a
   config file (static/config/card_layout.json) for every position, font,
   color and the logo box. Nothing about *where things go* is hardcoded
   here — that lives in the config so a future GUI editor can read/write
   the same file without touching this code.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // --- Canvas setup ---
    const canvas = document.getElementById('cardCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const CONFIG_URL = '/static/config/card_layout.json';

    // Populated once the config JSON has loaded. Canvas size mirrors the
    // template image's native pixel size (config.canvasWidth/Height).
    let LAYOUT = null;
    let CARD_WIDTH = 0;
    let CARD_HEIGHT = 0;
    let templateImg = null;

    // Default Sample Data
    const DEFAULT_DATA = {
        playerName: '孔鏘',
        teamName: '巴豆妖排球隊',
        jerseyNumber: '03',
        idNumber: 'BDYxTAKO',
        associationName: 'TAKO盃 - 第10屆',
        validThru: '2026/09/05',
        footerNote2: 'NVA Club House 排球俱樂部',
        photoZoom: 100,
        photoOffsetX: 0,
        photoOffsetY: 0
    };

    // User Uploaded Media & Logo Cache
    let userTeamLogoImg = null;
    const teamLogoCache = new Map(); // stem/teamName -> HTMLImageElement

    // DOM Elements
    const fields = {
        playerName: document.getElementById('playerName'),
        teamName: document.getElementById('teamName'),
        jerseyNumber: document.getElementById('jerseyNumber'),
        idNumber: document.getElementById('idNumber'),
        associationName: document.getElementById('associationName'),
        validThru: document.getElementById('validThru'),
        footerNote2: document.getElementById('footerNote2'),
        photoZoom: document.getElementById('photoZoom'),
        photoOffsetX: document.getElementById('photoOffsetX'),
        photoOffsetY: document.getElementById('photoOffsetY'),
        zoomVal: document.getElementById('zoomVal')
    };

    // Modal elements
    const qrModal = document.getElementById('qrModal');
    const modalClose = document.getElementById('modalClose');
    const qrCodeImg = document.getElementById('qrCodeImg');
    const qrUrlInput = document.getElementById('qrUrlInput');
    const btnCopyUrl = document.getElementById('btnCopyUrl');

    // ==========================================
    // Logo Auto-Loading & Discovery
    // ==========================================

    function loadLogoImageFromUrl(stem, url) {
        return new Promise((resolve) => {
            if (!url) return resolve(null);
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const cleanStem = stem.trim();
                teamLogoCache.set(cleanStem, img);
                updateDetectedLogosBadge();

                // If current teamName matches this logo, activate it
                const curTeam = fields.teamName ? fields.teamName.value.trim() : '';
                if (curTeam && (curTeam.includes(cleanStem) || cleanStem.includes(curTeam))) {
                    userTeamLogoImg = img;
                    renderCard();
                }
                resolve(img);
            };
            img.onerror = () => resolve(null);
            img.src = url;
        });
    }

    async function loadAllTeamLogosFromServer() {
        try {
            const res = await fetch('/api/list_team_logos');
            const data = await res.json();
            if (data.success && data.logos) {
                for (const [stem, url] of Object.entries(data.logos)) {
                    await loadLogoImageFromUrl(stem, url);
                }
            }
        } catch (e) {
            console.warn('Could not list team logos:', e);
        }
    }

    function updateDetectedLogosBadge() {
        const listEl = document.getElementById('detectedLogosList');
        if (!listEl) return;
        listEl.innerHTML = '';
        if (teamLogoCache.size === 0) {
            listEl.innerHTML = '<span style="font-size:0.8rem; color:var(--text-muted);">尚未上傳或偵測到隊伍 Logo</span>';
            return;
        }
        for (const [stem] of teamLogoCache.entries()) {
            const badge = document.createElement('span');
            badge.className = 'logo-tag-badge';
            badge.innerHTML = `🛡️ <strong>${stem}</strong>`;
            listEl.appendChild(badge);
        }
    }

    function getCachedLogoForTeam(teamName) {
        if (!teamName) return null;
        const clean = teamName.trim().toLowerCase();

        // 1. Exact match (case-insensitive)
        for (const [stem, img] of teamLogoCache.entries()) {
            if (stem.trim().toLowerCase() === clean) {
                return img;
            }
        }

        // 2. Sort candidate entries by stem length descending (so "白巴豆妖" / "黑巴豆妖" matches before "巴豆妖")
        const sortedEntries = Array.from(teamLogoCache.entries()).sort((a, b) => b[0].length - a[0].length);
        for (const [stem, img] of sortedEntries) {
            const s = stem.trim().toLowerCase();
            if (clean.includes(s) || s.includes(clean)) {
                return img;
            }
        }
        return null;
    }

    // ==========================================
    // Config-Driven Render Engine (HTML5 Canvas)
    // ==========================================

    async function loadLayoutConfig() {
        // Cache-busted on every call so a replaced template image / edited config
        // is always picked up immediately (no-store on the server is not always
        // enough to stop a browser's own image cache).
        const cacheBust = `v=${Date.now()}`;
        const res = await fetch(`${CONFIG_URL}?${cacheBust}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`無法載入版面設定檔: ${res.status}`);
        const config = await res.json();

        const img = await new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => reject(new Error(`無法載入模板圖片: ${config.templateImage}`));
            im.src = `${config.templateImage}?${cacheBust}`;
        });

        LAYOUT = config;
        templateImg = img;
        CARD_WIDTH = config.canvasWidth;
        CARD_HEIGHT = config.canvasHeight;
        canvas.width = CARD_WIDTH;
        canvas.height = CARD_HEIGHT;
        resolveAutoBorderColorIfNeeded();
    }

    async function reloadTemplateImageOnly() {
        // Used after a template upload: config JSON on disk already has the new
        // canvasWidth/Height (server updated it), so just refresh the bitmap.
        const cacheBust = `v=${Date.now()}`;
        const img = await new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => reject(new Error('無法載入模板圖片'));
            im.src = `${LAYOUT.templateImage}?${cacheBust}`;
        });
        templateImg = img;
        resolveAutoBorderColorIfNeeded();
    }

    // Only resolves when the border color is still the 'auto' sentinel — a
    // manually-picked color (or one already resolved) is left alone so the
    // explicit "🎨 自動偵測顏色" button stays the only way to override it later.
    function resolveAutoBorderColorIfNeeded() {
        if (!LAYOUT || !LAYOUT.logo || !LAYOUT.logo.border) return;
        if (LAYOUT.logo.border.color === 'auto') {
            LAYOUT.logo.border.color = detectTemplateAccentColor();
        }
    }

    // ==========================================
    // Layout Controls: template swap/refresh/save + inline field position tuning
    // ==========================================

    function syncLayoutControlsFromLAYOUT() {
        if (!LAYOUT) return;
        LAYOUT.fields.forEach(fc => {
            const el = document.querySelector(`.pos-control[data-field="${fc.id}"]`);
            if (el) {
                const xInput = el.querySelector('.pos-x');
                const yInput = el.querySelector('.pos-y');
                if (xInput) xInput.value = (fc.position.x * 100).toFixed(1);
                if (yInput) yInput.value = (fc.position.y * 100).toFixed(1);
            }
            if (fc.source.mode === 'static') {
                const textInput = document.querySelector(`.static-text-input[data-field="${fc.id}"]`);
                if (textInput) textInput.value = fc.source.text;
            }
        });

        const box = LAYOUT.logo.box;
        const logoBoxX = document.getElementById('logoBoxX');
        const logoBoxY = document.getElementById('logoBoxY');
        const logoBoxW = document.getElementById('logoBoxW');
        const logoBoxH = document.getElementById('logoBoxH');
        if (logoBoxX) logoBoxX.value = (box.x * 100).toFixed(1);
        if (logoBoxY) logoBoxY.value = (box.y * 100).toFixed(1);
        if (logoBoxW) logoBoxW.value = Math.round(box.w * CARD_WIDTH);
        if (logoBoxH) logoBoxH.value = Math.round(box.h * CARD_HEIGHT);

        const border = LAYOUT.logo.border || {};
        const shadow = LAYOUT.logo.shadow || {};
        const logoBorderEnabled = document.getElementById('logoBorderEnabled');
        const logoBorderColor = document.getElementById('logoBorderColor');
        const logoShadowEnabled = document.getElementById('logoShadowEnabled');
        if (logoBorderEnabled) logoBorderEnabled.checked = border.enabled !== false;
        if (logoBorderColor && border.color && border.color !== 'auto') logoBorderColor.value = border.color;
        if (logoShadowEnabled) logoShadowEnabled.checked = shadow.enabled !== false;

        if (LAYOUT.barcode) {
            const bcBox = LAYOUT.barcode.box;
            const barcodeEnabled = document.getElementById('barcodeEnabled');
            const barcodeBoxX = document.getElementById('barcodeBoxX');
            const barcodeBoxY = document.getElementById('barcodeBoxY');
            const barcodeBoxW = document.getElementById('barcodeBoxW');
            const barcodeBoxH = document.getElementById('barcodeBoxH');
            if (barcodeEnabled) barcodeEnabled.checked = LAYOUT.barcode.enabled !== false;
            if (barcodeBoxX) barcodeBoxX.value = (bcBox.x * 100).toFixed(1);
            if (barcodeBoxY) barcodeBoxY.value = (bcBox.y * 100).toFixed(1);
            if (barcodeBoxW) barcodeBoxW.value = Math.round(bcBox.w * CARD_WIDTH);
            if (barcodeBoxH) barcodeBoxH.value = Math.round(bcBox.h * CARD_HEIGHT);
        }
    }

    function updateFieldPosition(fieldId, axis, percentValue) {
        if (!LAYOUT) return;
        const num = parseFloat(percentValue);
        if (isNaN(num)) return;
        const fc = LAYOUT.fields.find(f => f.id === fieldId);
        if (!fc) return;
        fc.position[axis] = num / 100;
        renderCard();
    }

    function updateStaticFieldText(fieldId, text) {
        if (!LAYOUT) return;
        const fc = LAYOUT.fields.find(f => f.id === fieldId);
        if (!fc) return;
        fc.source.text = text;
        renderCard();
    }

    function updateLogoBoxAxis(axis, percentValue) {
        if (!LAYOUT) return;
        const num = parseFloat(percentValue);
        if (isNaN(num)) return;
        LAYOUT.logo.box[axis] = num / 100;
        renderCard();
    }

    // Resize the logo frame in absolute pixels, keeping its CENTER point fixed
    // (growing/shrinking from the corner made the box visually "move", which
    // was confusing — resizing now never changes where the frame appears to sit).
    // Resizes a {x,y,w,h} box (fractions) in absolute pixels while keeping its
    // CENTER point fixed, then re-syncs the box's own X/Y % inputs (they shift
    // as a side-effect of resizing from the center instead of the corner).
    // Shared by the logo frame and the barcode box.
    function resizeBoxKeepingCenter(box, axis, pxValue, xInputId, yInputId) {
        if (!box || !CARD_WIDTH || !CARD_HEIGHT) return false;
        const num = parseFloat(pxValue);
        if (isNaN(num) || num <= 0) return false;

        const centerX = box.x + box.w / 2;
        const centerY = box.y + box.h / 2;

        if (axis === 'w') {
            box.w = num / CARD_WIDTH;
            box.x = centerX - box.w / 2;
        } else {
            box.h = num / CARD_HEIGHT;
            box.y = centerY - box.h / 2;
        }

        // Only re-sync X/Y — leave the W/H inputs alone so we don't fight the
        // user's cursor while they're still typing into them.
        const xInput = document.getElementById(xInputId);
        const yInput = document.getElementById(yInputId);
        if (xInput) xInput.value = (box.x * 100).toFixed(1);
        if (yInput) yInput.value = (box.y * 100).toFixed(1);
        return true;
    }

    function updateLogoBoxSize(axis, pxValue) {
        if (!LAYOUT) return;
        if (resizeBoxKeepingCenter(LAYOUT.logo.box, axis, pxValue, 'logoBoxX', 'logoBoxY')) renderCard();
    }

    function updateBarcodeBoxAxis(axis, percentValue) {
        if (!LAYOUT) return;
        const num = parseFloat(percentValue);
        if (isNaN(num)) return;
        LAYOUT.barcode.box[axis] = num / 100;
        renderCard();
    }

    function updateBarcodeBoxSize(axis, pxValue) {
        if (!LAYOUT) return;
        if (resizeBoxKeepingCenter(LAYOUT.barcode.box, axis, pxValue, 'barcodeBoxX', 'barcodeBoxY')) renderCard();
    }

    // Samples the template image for its dominant "accent" color (skips
    // near-white/near-black/near-gray pixels) so the logo border can auto-match
    // whatever template is currently loaded, instead of a hardcoded color.
    function detectTemplateAccentColor() {
        if (!templateImg) return '#4b1a8f';
        const sampleW = 200;
        const sampleH = Math.max(1, Math.round(sampleW * (templateImg.naturalHeight / templateImg.naturalWidth)));
        const off = document.createElement('canvas');
        off.width = sampleW;
        off.height = sampleH;
        const octx = off.getContext('2d');
        octx.drawImage(templateImg, 0, 0, sampleW, sampleH);

        let data;
        try {
            data = octx.getImageData(0, 0, sampleW, sampleH).data;
        } catch (e) {
            return '#4b1a8f'; // e.g. blocked by canvas tainting
        }

        let rSum = 0, gSum = 0, bSum = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            const sat = max - min;
            const lum = (r + g + b) / 3;
            if (sat > 30 && lum > 15 && lum < 235) {
                rSum += r; gSum += g; bSum += b; count++;
            }
        }
        if (count === 0) return '#4b1a8f';

        const darken = (v) => Math.max(0, Math.round((v / count) * 0.72));
        const toHex = (v) => v.toString(16).padStart(2, '0');
        return `#${toHex(darken(rSum))}${toHex(darken(gSum))}${toHex(darken(bSum))}`;
    }

    function initLayoutControls() {
        document.querySelectorAll('.pos-control').forEach(el => {
            const fieldId = el.dataset.field;
            const xInput = el.querySelector('.pos-x');
            const yInput = el.querySelector('.pos-y');
            if (xInput) xInput.addEventListener('input', () => updateFieldPosition(fieldId, 'x', xInput.value));
            if (yInput) yInput.addEventListener('input', () => updateFieldPosition(fieldId, 'y', yInput.value));
        });

        // Editable caption/decorative text (not tied to card data)
        document.querySelectorAll('.static-text-input').forEach(el => {
            el.addEventListener('input', () => updateStaticFieldText(el.dataset.field, el.value));
        });

        const logoBoxX = document.getElementById('logoBoxX');
        const logoBoxY = document.getElementById('logoBoxY');
        const logoBoxW = document.getElementById('logoBoxW');
        const logoBoxH = document.getElementById('logoBoxH');
        if (logoBoxX) logoBoxX.addEventListener('input', () => updateLogoBoxAxis('x', logoBoxX.value));
        if (logoBoxY) logoBoxY.addEventListener('input', () => updateLogoBoxAxis('y', logoBoxY.value));
        if (logoBoxW) logoBoxW.addEventListener('input', () => updateLogoBoxSize('w', logoBoxW.value));
        if (logoBoxH) logoBoxH.addEventListener('input', () => updateLogoBoxSize('h', logoBoxH.value));

        // Logo frame border / shadow
        const logoBorderEnabled = document.getElementById('logoBorderEnabled');
        const logoBorderColor = document.getElementById('logoBorderColor');
        const logoShadowEnabled = document.getElementById('logoShadowEnabled');
        const btnAutoBorderColor = document.getElementById('btnAutoBorderColor');
        if (logoBorderEnabled) {
            logoBorderEnabled.addEventListener('change', () => {
                if (!LAYOUT) return;
                LAYOUT.logo.border.enabled = logoBorderEnabled.checked;
                renderCard();
            });
        }
        if (logoBorderColor) {
            logoBorderColor.addEventListener('input', () => {
                if (!LAYOUT) return;
                LAYOUT.logo.border.color = logoBorderColor.value;
                renderCard();
            });
        }
        if (logoShadowEnabled) {
            logoShadowEnabled.addEventListener('change', () => {
                if (!LAYOUT) return;
                LAYOUT.logo.shadow.enabled = logoShadowEnabled.checked;
                renderCard();
            });
        }
        if (btnAutoBorderColor) {
            btnAutoBorderColor.addEventListener('click', () => {
                if (!LAYOUT) return;
                const color = detectTemplateAccentColor();
                LAYOUT.logo.border.color = color;
                if (logoBorderColor) logoBorderColor.value = color;
                renderCard();
            });
        }

        // Barcode: on/off + position/size (same center-anchored resize as the logo frame)
        const barcodeEnabled = document.getElementById('barcodeEnabled');
        const barcodeBoxX = document.getElementById('barcodeBoxX');
        const barcodeBoxY = document.getElementById('barcodeBoxY');
        const barcodeBoxW = document.getElementById('barcodeBoxW');
        const barcodeBoxH = document.getElementById('barcodeBoxH');
        if (barcodeEnabled) {
            barcodeEnabled.addEventListener('change', () => {
                if (!LAYOUT) return;
                LAYOUT.barcode.enabled = barcodeEnabled.checked;
                renderCard();
            });
        }
        if (barcodeBoxX) barcodeBoxX.addEventListener('input', () => updateBarcodeBoxAxis('x', barcodeBoxX.value));
        if (barcodeBoxY) barcodeBoxY.addEventListener('input', () => updateBarcodeBoxAxis('y', barcodeBoxY.value));
        if (barcodeBoxW) barcodeBoxW.addEventListener('input', () => updateBarcodeBoxSize('w', barcodeBoxW.value));
        if (barcodeBoxH) barcodeBoxH.addEventListener('input', () => updateBarcodeBoxSize('h', barcodeBoxH.value));

        // Swap the template image file
        const btnUploadTemplate = document.getElementById('btnUploadTemplate');
        const templateUploadInput = document.getElementById('templateUploadInput');
        if (btnUploadTemplate && templateUploadInput) {
            btnUploadTemplate.addEventListener('click', () => templateUploadInput.click());
            templateUploadInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const fd = new FormData();
                fd.append('file', file);
                try {
                    const res = await fetch('/api/upload_template', { method: 'POST', body: fd });
                    const data = await res.json();
                    if (data.success) {
                        LAYOUT.canvasWidth = data.width;
                        LAYOUT.canvasHeight = data.height;
                        CARD_WIDTH = data.width;
                        CARD_HEIGHT = data.height;
                        canvas.width = CARD_WIDTH;
                        canvas.height = CARD_HEIGHT;
                        await reloadTemplateImageOnly();
                        syncLayoutControlsFromLAYOUT();
                        renderCard();
                        alert('✅ 模板圖片已更新！（欄位位置比例維持不變，如需微調請用下方的文字/框架位置設定）');
                    } else {
                        alert('更換模板失敗: ' + (data.error || '未知錯誤'));
                    }
                } catch (err) {
                    console.error(err);
                    alert('無法連接伺服器更換模板圖片。');
                } finally {
                    templateUploadInput.value = '';
                }
            });
        }

        // Force a fresh reload of config + template image (fixes any browser image caching)
        const btnRefreshTemplate = document.getElementById('btnRefreshTemplate');
        if (btnRefreshTemplate) {
            btnRefreshTemplate.addEventListener('click', async () => {
                try {
                    await loadLayoutConfig();
                    syncLayoutControlsFromLAYOUT();
                    renderCard();
                    alert('✅ 已重新載入最新的模板圖片與版面設定。');
                } catch (err) {
                    console.error(err);
                    alert('重新載入失敗: ' + err.message);
                }
            });
        }

        // Persist the current in-browser layout (positions + logo box) to the server
        const btnSaveLayout = document.getElementById('btnSaveLayout');
        if (btnSaveLayout) {
            btnSaveLayout.addEventListener('click', async () => {
                if (!LAYOUT) return;
                try {
                    const res = await fetch('/api/save_layout', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(LAYOUT)
                    });
                    const data = await res.json();
                    if (data.success) {
                        alert('✅ 版面設定已儲存！之後重新整理或批次產圖都會套用這份版面。');
                    } else {
                        alert('儲存失敗: ' + (data.error || '未知錯誤'));
                    }
                } catch (err) {
                    console.error(err);
                    alert('無法連接伺服器儲存版面設定。');
                }
            });
        }
    }

    function renderCard() {
        const data = getFormData();
        renderCardForData(data);
    }

    function renderCardForData(data, activeLogoImg) {
        if (!LAYOUT || !templateImg) return; // config still loading

        ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

        // 1. Template background (already contains all box art / borders / pattern)
        ctx.drawImage(templateImg, 0, 0, CARD_WIDTH, CARD_HEIGHT);

        // 2. Team Logo (drawn before text so text always stays on top)
        drawLogo(data, activeLogoImg);

        // 3. Scannable barcode generated from the ID number
        drawIdBarcode(data);

        // 4. Every text field, positioned purely from the config file
        LAYOUT.fields.forEach(fieldCfg => drawConfigField(fieldCfg, data));
    }

    function drawIdBarcode(data) {
        const bc = LAYOUT.barcode;
        if (!bc || !bc.enabled) return;
        const text = data[bc.sourceKey || 'idNumber'];
        if (!text) return;
        if (typeof JsBarcode === 'undefined') return; // vendor script failed to load — fail quietly

        const box = bc.box;
        const pX = box.x * CARD_WIDTH;
        const pY = box.y * CARD_HEIGHT;
        const pW = box.w * CARD_WIDTH;
        const pH = box.h * CARD_HEIGHT;

        const off = document.createElement('canvas');
        try {
            JsBarcode(off, text, {
                format: bc.format || 'CODE128',
                width: 2,
                height: 100,
                margin: 4,
                displayValue: false,
                background: bc.background || '#ffffff',
                lineColor: bc.lineColor || '#1a1a1a'
            });
        } catch (e) {
            // Some characters aren't valid for the chosen barcode format — skip
            // drawing rather than breaking the whole card render.
            console.warn('Barcode generation skipped for "' + text + '":', e.message);
            return;
        }

        ctx.drawImage(off, pX, pY, pW, pH);
    }

    function resolveFieldText(fieldCfg, data) {
        let text;
        if (fieldCfg.source.mode === 'static') {
            text = fieldCfg.source.text;
        } else {
            text = data[fieldCfg.source.key];
            if (text === undefined || text === null || text === '') {
                text = DEFAULT_DATA[fieldCfg.source.key] || '';
            }
        }
        if (fieldCfg.prefix) text = fieldCfg.prefix + text;
        if (fieldCfg.suffix) text = text + fieldCfg.suffix;
        return String(text);
    }

    function drawConfigField(fieldCfg, data) {
        const text = resolveFieldText(fieldCfg, data);
        if (!text) return;

        ctx.save();

        const family = fieldCfg.font.family;
        const weight = fieldCfg.font.weight || 400;
        let sizePx = Math.round(fieldCfg.font.sizeFrac * CARD_HEIGHT);
        ctx.fillStyle = fieldCfg.color || '#111111';
        ctx.textAlign = fieldCfg.align.h;
        ctx.textBaseline = fieldCfg.align.v;
        ctx.font = `${weight} ${sizePx}px ${family}`;

        // Auto-shrink to fit maxWidthFrac, down to minSizeFrac
        if (fieldCfg.maxWidthFrac) {
            const maxWidthPx = fieldCfg.maxWidthFrac * CARD_WIDTH;
            const minSizePx = (fieldCfg.minSizeFrac || fieldCfg.font.sizeFrac) * CARD_HEIGHT;
            while (ctx.measureText(text).width > maxWidthPx && sizePx > minSizePx) {
                sizePx -= 1;
                ctx.font = `${weight} ${sizePx}px ${family}`;
            }
        }

        const x = fieldCfg.position.x * CARD_WIDTH;
        const y = fieldCfg.position.y * CARD_HEIGHT;
        ctx.fillText(text, x, y);

        ctx.restore();
    }

    function drawLogo(data, activeLogoImg) {
        const box = LAYOUT.logo.box;
        const pX = box.x * CARD_WIDTH;
        const pY = box.y * CARD_HEIGHT;
        const pW = box.w * CARD_WIDTH;
        const pH = box.h * CARD_HEIGHT;

        const border = LAYOUT.logo.border || {};
        const shadow = LAYOUT.logo.shadow || {};

        // Soft drop shadow behind the frame, drawn before the clip so it
        // falls outside the frame's edges instead of being cut off.
        if (shadow.enabled) {
            ctx.save();
            ctx.shadowColor = shadow.color || 'rgba(0,0,0,0.35)';
            ctx.shadowBlur = (shadow.blurFrac != null ? shadow.blurFrac : 0.012) * CARD_HEIGHT;
            ctx.shadowOffsetX = (shadow.offsetXFrac || 0) * CARD_WIDTH;
            ctx.shadowOffsetY = (shadow.offsetYFrac != null ? shadow.offsetYFrac : 0.004) * CARD_HEIGHT;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(pX, pY, pW, pH);
            ctx.restore();
        }

        const logoImg = activeLogoImg || userTeamLogoImg || getCachedLogoForTeam(data.teamName);

        ctx.save();
        ctx.beginPath();
        ctx.rect(pX, pY, pW, pH);
        ctx.clip();

        if (logoImg && logoImg.width > 0 && logoImg.height > 0) {
            const zoom = (data.photoZoom || 100) / 100;
            const offsetX = ((data.photoOffsetX || 0) / 100) * (pW / 2);
            const offsetY = ((data.photoOffsetY || 0) / 100) * (pH / 2);

            const imgRatio = logoImg.width / logoImg.height;
            const boxRatio = pW / pH;

            let drawW, drawH;
            if (imgRatio > boxRatio) {
                drawW = pW * zoom;
                drawH = drawW / imgRatio;
            } else {
                drawH = pH * zoom;
                drawW = drawH * imgRatio;
            }

            const drawX = pX + (pW - drawW) / 2 + offsetX;
            const drawY = pY + (pH - drawH) / 2 + offsetY;

            ctx.drawImage(logoImg, drawX, drawY, drawW, drawH);
        } else if (LAYOUT.logo.placeholderText) {
            ctx.fillStyle = LAYOUT.logo.placeholderColor || '#999999';
            ctx.font = `700 ${Math.round(pH * 0.06)}px "Noto Sans TC", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(LAYOUT.logo.placeholderText, pX + pW / 2, pY + pH / 2);
        }

        ctx.restore();

        // Border drawn last, on top of the (now unclipped) context
        if (border.enabled) {
            ctx.save();
            ctx.strokeStyle = (border.color && border.color !== 'auto') ? border.color : '#4b1a8f';
            ctx.lineWidth = (border.widthFrac || 0.005) * CARD_HEIGHT;
            ctx.strokeRect(pX, pY, pW, pH);
            ctx.restore();
        }
    }

    // ==========================================
    // QR Code API Integration
    // ==========================================

    function generateQRCode() {
        const imgData = canvas.toDataURL('image/png', 1.0);

        fetch('/api/generate_qr', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ image_data: imgData })
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    qrCodeImg.src = data.qr_code;
                    qrUrlInput.value = data.card_url;
                    qrModal.style.display = 'flex';
                } else {
                    alert('生成 QR Code 失敗: ' + (data.error || '未知錯誤'));
                }
            })
            .catch(err => {
                console.error(err);
                alert('無法連接至伺服器 API 生成 QR Code。');
            });
    }

    function initModal() {
        if (modalClose) {
            modalClose.addEventListener('click', () => {
                qrModal.style.display = 'none';
            });
        }

        window.addEventListener('click', (e) => {
            if (e.target === qrModal) {
                qrModal.style.display = 'none';
            }
        });

        if (btnCopyUrl) {
            btnCopyUrl.addEventListener('click', () => {
                qrUrlInput.select();
                navigator.clipboard.writeText(qrUrlInput.value).then(() => {
                    btnCopyUrl.innerText = '已複製！';
                    setTimeout(() => { btnCopyUrl.innerText = '複製連結'; }, 2000);
                }).catch(() => {
                    document.execCommand('copy');
                    btnCopyUrl.innerText = '已複製！';
                    setTimeout(() => { btnCopyUrl.innerText = '複製連結'; }, 2000);
                });
            });
        }
    }

    // ==========================================
    // Event Handlers & Form Syncing
    // ==========================================

    // ==========================================
    // ID Number Mode: 統一編號 (manual) vs 流水編號 (sequential)
    // Session-only setting (not persisted to card_layout.json, which only
    // holds visual layout) — resets to manual on page reload.
    // ==========================================

    function getIdNumberSettings() {
        const checked = document.querySelector('input[name="idNumberMode"]:checked');
        return {
            mode: checked ? checked.value : 'manual',
            prefix: (document.getElementById('idSeqPrefix') || {}).value || '',
            start: parseInt((document.getElementById('idSeqStart') || {}).value, 10) || 0,
            digits: parseInt((document.getElementById('idSeqDigits') || {}).value, 10) || 1,
            suffix: (document.getElementById('idSeqSuffix') || {}).value || ''
        };
    }

    function formatSequentialId(settings, index) {
        const num = settings.start + index;
        const numStr = String(num).padStart(settings.digits, '0');
        return `${settings.prefix}${numStr}${settings.suffix}`;
    }

    function updateIdSeqPreview() {
        const preview = document.getElementById('idSeqPreview');
        if (!preview) return;
        preview.innerText = formatSequentialId(getIdNumberSettings(), 0);
    }

    function getFormData() {
        const idSettings = getIdNumberSettings();
        const idNumber = idSettings.mode === 'sequential'
            ? formatSequentialId(idSettings, 0)
            : (fields.idNumber ? fields.idNumber.value : DEFAULT_DATA.idNumber);

        return {
            playerName: fields.playerName ? fields.playerName.value : DEFAULT_DATA.playerName,
            teamName: fields.teamName ? fields.teamName.value : DEFAULT_DATA.teamName,
            jerseyNumber: fields.jerseyNumber ? fields.jerseyNumber.value : DEFAULT_DATA.jerseyNumber,
            idNumber,
            associationName: fields.associationName ? fields.associationName.value : DEFAULT_DATA.associationName,
            validThru: fields.validThru ? fields.validThru.value : DEFAULT_DATA.validThru,
            footerNote2: fields.footerNote2 ? fields.footerNote2.value : DEFAULT_DATA.footerNote2,
            photoZoom: parseFloat(fields.photoZoom.value),
            photoOffsetX: parseFloat(fields.photoOffsetX.value),
            photoOffsetY: parseFloat(fields.photoOffsetY.value)
        };
    }

    function initTabs() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));

                btn.classList.add('active');
                const targetId = btn.getAttribute('data-tab');
                const targetEl = document.getElementById(targetId);
                if (targetEl) targetEl.classList.add('active');
            });
        });
    }

    function initIdNumberModeControls() {
        const manualGroup = document.getElementById('idNumberManualGroup');
        const sequentialGroup = document.getElementById('idNumberSequentialGroup');
        const radios = document.querySelectorAll('input[name="idNumberMode"]');

        const applyModeVisibility = () => {
            const settings = getIdNumberSettings();
            const isSequential = settings.mode === 'sequential';
            if (manualGroup) manualGroup.style.display = isSequential ? 'none' : 'flex';
            if (sequentialGroup) sequentialGroup.style.display = isSequential ? 'flex' : 'none';
        };

        radios.forEach(r => r.addEventListener('change', () => {
            applyModeVisibility();
            updateIdSeqPreview();
            renderCard();
        }));

        ['idSeqPrefix', 'idSeqStart', 'idSeqDigits', 'idSeqSuffix'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => {
                updateIdSeqPreview();
                renderCard();
            });
        });

        applyModeVisibility();
        updateIdSeqPreview();
    }

    function initControls() {
        Object.values(fields).forEach(el => {
            if (el && el.addEventListener) {
                el.addEventListener('input', () => {
                    if (el === fields.photoZoom) {
                        fields.zoomVal.innerText = fields.photoZoom.value + '%';
                    }
                    if (el === fields.teamName) {
                        const matched = getCachedLogoForTeam(fields.teamName.value);
                        if (matched) userTeamLogoImg = matched;
                    }
                    renderCard();
                });
                el.addEventListener('change', renderCard);
            }
        });
    }

    function initFileUploads() {
        // Single Logo Upload in Logo Tab
        const teamLogoInput = document.getElementById('teamLogoUpload');
        const singleDropZone = document.getElementById('singleLogoDropZone');

        const processSingleLogo = (file) => {
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    userTeamLogoImg = img;
                    const curTeam = fields.teamName ? fields.teamName.value.trim() : '';
                    if (curTeam) teamLogoCache.set(curTeam, img);
                    const stem = file.name.replace(/\.[^/.]+$/, "").trim();
                    if (stem) teamLogoCache.set(stem, img);
                    updateDetectedLogosBadge();
                    renderCard();

                    // Persist to server
                    const fd = new FormData();
                    fd.append('file', file);
                    fd.append('team_name', curTeam || stem);
                    fetch('/api/upload_team_logo', { method: 'POST', body: fd })
                        .catch(err => console.error('Logo upload error:', err));
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        };

        if (teamLogoInput) {
            teamLogoInput.addEventListener('change', (e) => {
                processSingleLogo(e.target.files[0]);
            });
        }

        if (singleDropZone) {
            ['dragenter', 'dragover'].forEach(name => {
                singleDropZone.addEventListener(name, (e) => {
                    e.preventDefault();
                    singleDropZone.classList.add('dragover');
                });
            });
            ['dragleave', 'drop'].forEach(name => {
                singleDropZone.addEventListener(name, (e) => {
                    e.preventDefault();
                    singleDropZone.classList.remove('dragover');
                });
            });
            singleDropZone.addEventListener('drop', (e) => {
                const dt = e.dataTransfer;
                if (dt.files && dt.files.length > 0) {
                    processSingleLogo(dt.files[0]);
                }
            });
        }

        // Multi-Logo Upload in Batch Tab
        const batchLogoUpload = document.getElementById('batchLogoUpload');
        const batchLogoDropZone = document.getElementById('batchLogoDropZone');

        const processMultiLogos = (files) => {
            if (!files || files.length === 0) return;
            Array.from(files).forEach(file => {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        const stem = file.name.replace(/\.[^/.]+$/, "").trim();
                        teamLogoCache.set(stem, img);
                        updateDetectedLogosBadge();

                        const curTeam = fields.teamName ? fields.teamName.value.trim() : '';
                        if (curTeam && (curTeam.includes(stem) || stem.includes(curTeam))) {
                            userTeamLogoImg = img;
                            renderCard();
                        }

                        // Upload to server
                        const fd = new FormData();
                        fd.append('file', file);
                        fd.append('team_name', stem);
                        fetch('/api/upload_team_logo', { method: 'POST', body: fd })
                            .catch(err => console.error(err));
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(file);
            });
        };

        if (batchLogoUpload) {
            batchLogoUpload.addEventListener('change', (e) => {
                processMultiLogos(e.target.files);
            });
        }

        if (batchLogoDropZone) {
            ['dragenter', 'dragover'].forEach(name => {
                batchLogoDropZone.addEventListener(name, (e) => {
                    e.preventDefault();
                    batchLogoDropZone.classList.add('dragover');
                });
            });
            ['dragleave', 'drop'].forEach(name => {
                batchLogoDropZone.addEventListener(name, (e) => {
                    e.preventDefault();
                    batchLogoDropZone.classList.remove('dragover');
                });
            });
            batchLogoDropZone.addEventListener('drop', (e) => {
                const dt = e.dataTransfer;
                if (dt.files && dt.files.length > 0) {
                    processMultiLogos(dt.files);
                }
            });
        }
    }

    // ==========================================
    // Batch Generation Engine (Excel / CSV)
    // ==========================================
    let batchItems = [];
    let isBatchRunning = false;

    function initBatchGeneration() {
        const batchFileInput = document.getElementById('batchFileUpload');
        const batchDropZone = document.getElementById('batchDropZone');
        const batchPreviewContainer = document.getElementById('batchPreviewContainer');
        const batchTableBody = document.getElementById('batchTableBody');
        const batchCountBadge = document.getElementById('batchCountBadge');
        const btnClearBatch = document.getElementById('btnClearBatch');
        const btnStartBatch = document.getElementById('btnStartBatch');
        const batchProgressBox = document.getElementById('batchProgressBox');
        const batchProgressBar = document.getElementById('batchProgressBar');
        const batchProgressText = document.getElementById('batchProgressText');
        const batchProgressPercent = document.getElementById('batchProgressPercent');
        const batchResultActions = document.getElementById('batchResultActions');
        const btnOpenResults = document.getElementById('btnOpenResults');
        const btnDownloadZip = document.getElementById('btnDownloadZip');

        // 1. File Upload / Drag & Drop Handlers
        const handleBatchFile = (file) => {
            if (!file) return;

            const formData = new FormData();
            formData.append('file', file);

            // Show uploading state
            if (batchProgressText) batchProgressText.innerText = '正在解析檔案與配對 Logo...';

            fetch('/api/parse_batch_file', {
                method: 'POST',
                body: formData
            })
            .then(res => res.json())
            .then(data => {
                if (data.success && data.items && data.items.length > 0) {
                    batchItems = data.items;
                    renderBatchTable(batchItems);
                    if (batchCountBadge) batchCountBadge.innerText = batchItems.length;
                    if (batchPreviewContainer) batchPreviewContainer.style.display = 'flex';
                    if (batchResultActions) batchResultActions.style.display = 'none';
                    if (batchProgressBox) batchProgressBox.style.display = 'none';
                } else {
                    alert('❌ 解析檔案失敗: ' + (data.error || '未讀取到有效的隊員資料'));
                }
            })
            .catch(err => {
                console.error(err);
                alert('無法連接至伺服器解析 Excel/CSV 檔案。');
            });
        };

        if (batchFileInput) {
            batchFileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                handleBatchFile(file);
            });
        }

        if (batchDropZone) {
            ['dragenter', 'dragover'].forEach(name => {
                batchDropZone.addEventListener(name, (e) => {
                    e.preventDefault();
                    batchDropZone.classList.add('dragover');
                });
            });
            ['dragleave', 'drop'].forEach(name => {
                batchDropZone.addEventListener(name, (e) => {
                    e.preventDefault();
                    batchDropZone.classList.remove('dragover');
                });
            });
            batchDropZone.addEventListener('drop', (e) => {
                const dt = e.dataTransfer;
                const file = dt.files[0];
                handleBatchFile(file);
            });
        }

        // 2. Render Batch Preview Table
        function renderBatchTable(items) {
            if (!batchTableBody) return;
            batchTableBody.innerHTML = '';

            items.forEach((item, idx) => {
                const tr = document.createElement('tr');
                tr.id = `batch-row-${idx}`;

                const logoPreview = item.logoUrl
                    ? `<img src="${item.logoUrl}" style="height:26px; width:26px; object-fit:contain; background:#18202c; border-radius:4px; vertical-align:middle; margin-right:6px; border:1px solid rgba(255,255,255,0.1);"><strong>${item.teamName}</strong>`
                    : (userTeamLogoImg
                        ? `<span style="color:#00e676; margin-right:4px;">🛡️</span><strong>${item.teamName}</strong> <span style="font-size:0.75rem; color:var(--text-muted);">(手動Logo)</span>`
                        : `<strong>${item.teamName}</strong>`);

                tr.innerHTML = `
                    <td>${idx + 1}</td>
                    <td>${logoPreview}</td>
                    <td>${item.playerName}</td>
                    <td><span class="batch-num-badge">#${item.jerseyNumber}</span></td>
                    <td><code>${item.targetFilename}</code></td>
                    <td><span class="batch-status-tag batch-status-pending" id="batch-status-${idx}">待生成</span></td>
                `;
                batchTableBody.appendChild(tr);
            });
        }

        // 3. Clear List Button
        if (btnClearBatch) {
            btnClearBatch.addEventListener('click', () => {
                batchItems = [];
                if (batchTableBody) batchTableBody.innerHTML = '';
                if (batchPreviewContainer) batchPreviewContainer.style.display = 'none';
                if (batchFileInput) batchFileInput.value = '';
            });
        }

        // 4. Batch Generation Execution Pipeline (Exact 1:1 Canvas Engine)
        if (btnStartBatch) {
            btnStartBatch.addEventListener('click', async () => {
                if (isBatchRunning) return;
                if (!batchItems || batchItems.length === 0) {
                    alert('請先上傳 Excel 或 CSV 隊員名單！');
                    return;
                }

                isBatchRunning = true;
                btnStartBatch.disabled = true;
                if (btnStartBatch.querySelector('.btn-icon')) {
                    btnStartBatch.querySelector('.btn-icon').innerText = '⏳';
                }
                btnStartBatch.innerText = ' 批次生成中，請稍候...';

                if (batchProgressBox) batchProgressBox.style.display = 'flex';
                const total = batchItems.length;
                let successCount = 0;

                const baseForm = getFormData();
                const idSettings = getIdNumberSettings();

                for (let i = 0; i < total; i++) {
                    const item = batchItems[i];
                    const statusTag = document.getElementById(`batch-status-${i}`);
                    if (statusTag) {
                        statusTag.className = 'batch-status-tag batch-status-processing';
                        statusTag.innerText = '生成中...';
                    }

                    // 1. Resolve team logo
                    let teamLogo = null;
                    if (item.logoUrl) {
                        teamLogo = await loadLogoImageFromUrl(item.teamName, item.logoUrl);
                    }
                    if (!teamLogo) {
                        teamLogo = getCachedLogoForTeam(item.teamName);
                    }
                    if (!teamLogo && userTeamLogoImg) {
                        teamLogo = userTeamLogoImg;
                    }

                    // 2. Build Card Data for this Athlete
                    const idNumberForItem = idSettings.mode === 'sequential'
                        ? formatSequentialId(idSettings, i)
                        : (baseForm.idNumber || 'NMB-2026-0905');
                    const cardData = {
                        ...baseForm,
                        playerName: item.playerName,
                        teamName: item.teamName,
                        jerseyNumber: item.jerseyNumber,
                        idNumber: idNumberForItem
                    };

                    // 3. Render onto Canvas with the resolved team logo image!
                    renderCardForData(cardData, teamLogo);

                    // Yield to browser UI thread to prevent freeze
                    await new Promise(r => setTimeout(r, 40));

                    // 4. Convert to Base64 PNG
                    const imgData = canvas.toDataURL('image/png', 1.0);

                    // 5. Send to Backend for saving to results/{teamName}_{playerName}.png
                    try {
                        const res = await fetch('/api/save_batch_card', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                team_name: item.teamName,
                                player_name: item.playerName,
                                image_data: imgData
                            })
                        });
                        const saveRes = await res.json();
                        if (saveRes.success) {
                            successCount++;
                            if (statusTag) {
                                statusTag.className = 'batch-status-tag batch-status-done';
                                statusTag.innerText = '✅ 已儲存';
                            }
                        } else {
                            if (statusTag) {
                                statusTag.innerText = '❌ 失敗';
                            }
                        }
                    } catch (err) {
                        console.error('Error saving batch item:', err);
                        if (statusTag) statusTag.innerText = '❌ 錯誤';
                    }

                    // Update Progress Bar
                    const percent = Math.round(((i + 1) / total) * 100);
                    if (batchProgressBar) batchProgressBar.style.width = percent + '%';
                    if (batchProgressText) batchProgressText.innerText = `已生成 ${i + 1} / ${total} 張卡片...`;
                    if (batchProgressPercent) batchProgressPercent.innerText = `${percent}%`;
                }

                // Restore Current Live Card View
                renderCard();

                // Finish
                isBatchRunning = false;
                btnStartBatch.disabled = false;
                btnStartBatch.innerHTML = '<span class="btn-icon">⚡</span> 重新批次生成';
                if (batchProgressText) batchProgressText.innerText = `🎉 批次生成完成！共儲存 ${successCount} 張卡片至 results/ 資料夾。`;
                if (batchResultActions) batchResultActions.style.display = 'flex';

                alert(`🎉 批次生成完成！\n已成功將 ${successCount} 張高畫質卡片存入 results 資料夾。\n可點擊下方按鈕開啟資料夾或下載 ZIP 壓縮包。`);
            });
        }

        // 5. Open Results Folder Button
        if (btnOpenResults) {
            btnOpenResults.addEventListener('click', () => {
                fetch('/api/open_results_folder', { method: 'POST' })
                    .then(res => res.json())
                    .then(data => {
                        if (!data.success) {
                            alert('開啟資料夾失敗: ' + (data.error || '未知錯誤'));
                        }
                    })
                    .catch(err => {
                        console.error(err);
                        alert('無法開啟地端 results 資料夾。');
                    });
            });
        }

        // 6. Download ZIP Button
        if (btnDownloadZip) {
            btnDownloadZip.addEventListener('click', () => {
                window.location.href = '/api/download_results_zip';
            });
        }
    }

    function initButtons() {
        // Reset Button
        const btnReset = document.getElementById('btnReset');
        const btnResetTop = document.getElementById('btnResetTop');

        const handleReset = () => {
            fields.playerName.value = DEFAULT_DATA.playerName;
            fields.teamName.value = DEFAULT_DATA.teamName;
            fields.jerseyNumber.value = DEFAULT_DATA.jerseyNumber;
            if (fields.idNumber) fields.idNumber.value = DEFAULT_DATA.idNumber;
            fields.associationName.value = DEFAULT_DATA.associationName;
            if (fields.validThru) fields.validThru.value = DEFAULT_DATA.validThru;
            if (fields.footerNote2) fields.footerNote2.value = DEFAULT_DATA.footerNote2;
            fields.photoZoom.value = DEFAULT_DATA.photoZoom;
            fields.photoOffsetX.value = DEFAULT_DATA.photoOffsetX;
            fields.photoOffsetY.value = DEFAULT_DATA.photoOffsetY;
            fields.zoomVal.innerText = '100%';

            userTeamLogoImg = getCachedLogoForTeam(DEFAULT_DATA.teamName);
            const logoEl = document.getElementById('teamLogoUpload');
            if (logoEl) logoEl.value = '';

            renderCard();
        };

        if (btnReset) btnReset.addEventListener('click', handleReset);
        if (btnResetTop) btnResetTop.addEventListener('click', handleReset);

        // Download Button
        const btnDownload = document.getElementById('btnDownload');
        const btnDownloadTop = document.getElementById('btnDownloadTop');

        const handleDownload = () => {
            const data = getFormData();
            const filename = `${data.teamName}_${data.playerName}_#${data.jerseyNumber}.png`
                .replace(/[\\/*?:"<>|]/g, '_')
                .trim();

            const dataUrl = canvas.toDataURL('image/png', 1.0);

            const link = document.createElement('a');
            link.download = filename;
            link.href = dataUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };

        if (btnDownload) btnDownload.addEventListener('click', handleDownload);
        if (btnDownloadTop) btnDownloadTop.addEventListener('click', handleDownload);

        // QR Code Buttons
        const btnQR = document.getElementById('btnQR');
        const btnQRTop = document.getElementById('btnQRTop');
        const btnQRAction = document.getElementById('btnQRAction');

        if (btnQR) btnQR.addEventListener('click', generateQRCode);
        if (btnQRTop) btnQRTop.addEventListener('click', generateQRCode);
        if (btnQRAction) btnQRAction.addEventListener('click', generateQRCode);

        // Copy Button
        const btnCopy = document.getElementById('btnCopy');
        if (btnCopy) {
            btnCopy.addEventListener('click', () => {
                canvas.toBlob((blob) => {
                    if (navigator.clipboard && navigator.clipboard.write) {
                        navigator.clipboard.write([
                            new ClipboardItem({ 'image/png': blob })
                        ]).then(() => {
                            alert('✅ 身分證圖檔已成功複製到剪貼簿！');
                        }).catch(err => {
                            console.error(err);
                            alert('無法直接複製到剪貼簿，請使用「下載圖檔」。');
                        });
                    } else {
                        alert('您的瀏覽器不支援直接複製圖片，請點擊「下載圖檔」。');
                    }
                });
            });
        }

        // Print Guide Toggle
        const btnPrintHelp = document.getElementById('btnPrintHelp');
        const printGuide = document.getElementById('printGuide');
        if (btnPrintHelp && printGuide) {
            btnPrintHelp.addEventListener('click', () => {
                const isHidden = printGuide.style.display === 'none';
                printGuide.style.display = isHidden ? 'block' : 'none';
            });
        }
    }

    // ==========================================
    // Bootstrap App
    // ==========================================
    initTabs();
    initControls();
    initFileUploads();
    initBatchGeneration();
    initButtons();
    initModal();
    initLayoutControls();
    initIdNumberModeControls();

    loadLayoutConfig()
        .then(() => {
            syncLayoutControlsFromLAYOUT();
            return loadAllTeamLogosFromServer();
        })
        .then(() => renderCard())
        .catch(err => {
            console.error(err);
            alert('版面設定檔或模板圖片載入失敗，請確認 static/config/card_layout.json 與模板圖片是否存在。');
        });
});
