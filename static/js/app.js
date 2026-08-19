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

    // Physical card size. Defaults to the documented 79.7×48mm spec but is
    // user-editable (see Card Shape Correction below) since different print
    // vendors cut to slightly different physical dimensions. Height is kept
    // in sync with the *actual* canvas pixel ratio (not typed in directly
    // except via the mm input) so DPI stays uniform on both axes.
    let PHYSICAL_WIDTH_MM = 79.7;
    let PHYSICAL_HEIGHT_MM = 48;

    // The uploaded template image's true, undistorted pixel dimensions —
    // the reference point every "minimal scaling" ratio correction measures
    // from, so repeated corrections never compound distortion.
    let NATIVE_TEMPLATE_WIDTH = 0;
    let NATIVE_TEMPLATE_HEIGHT = 0;

    // Populated once the config JSON has loaded. Canvas size mirrors the
    // template image's native pixel size (config.canvasWidth/Height) unless
    // the user has applied a card-shape correction (see below).
    let LAYOUT = null;
    let CARD_WIDTH = 0;
    let CARD_HEIGHT = 0;
    let templateImg = null;

    // Trim guide (刀板): the actual post-cut card size, shown centered over
    // the (possibly larger, bleed-inclusive) canvas as a pure visual guide.
    // Stored/restored via LAYOUT.trimGuide but never drawn onto the canvas
    // itself, so it's structurally impossible for it to leak into an export.
    let TRIM_WIDTH_PX = 0;
    let TRIM_HEIGHT_PX = 0;
    let TRIM_ENABLED = false;

    // Trims a mm value to 2 decimals without trailing zeros (79.70 -> "79.7").
    function fmtMm(v) {
        return Number((v || 0).toFixed(2)).toString();
    }

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
    const customLogoImgCache = new Map(); // customLogo element id -> HTMLImageElement

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
            badge.innerHTML = `🛡️ <strong>${stem}</strong> `;

            const reprocessBtn = document.createElement('button');
            reprocessBtn.type = 'button';
            reprocessBtn.className = 'logo-reprocess-btn';
            reprocessBtn.title = '補做自動去背 + 自動改配色（套用模板色調）+ 去除多餘白邊/邊框';
            reprocessBtn.textContent = '✨';
            reprocessBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                reprocessBtn.disabled = true;
                reprocessBtn.textContent = '⏳';
                try {
                    const res = await fetch('/api/reprocess_team_logo', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            team_name: stem,
                            remove_bg: true,
                            recolor_hex: detectTemplateAccentColor(),
                            trim: true
                        })
                    });
                    const data = await res.json();
                    if (data.success) {
                        await loadLogoImageFromUrl(data.team_name, `${data.logo_url}?v=${Date.now()}`);
                    } else {
                        alert('補做去背/改色/去外框失敗: ' + (data.error || '未知錯誤'));
                    }
                } catch (err) {
                    console.error(err);
                    alert('無法連接伺服器補做去背/改色/去外框。');
                } finally {
                    reprocessBtn.disabled = false;
                    reprocessBtn.textContent = '✨';
                }
            });

            badge.appendChild(reprocessBtn);
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
        // The real image file's intrinsic pixel size — independent of whatever
        // canvasWidth/Height a prior shape-correction may have saved — is the
        // true "undistorted" baseline for future minimal-scale corrections.
        NATIVE_TEMPLATE_WIDTH = img.naturalWidth || img.width;
        NATIVE_TEMPLATE_HEIGHT = img.naturalHeight || img.height;
        // Restore a previously-saved physical size / trim guide, if any,
        // so a shape correction survives a page reload correctly.
        if (config.physicalWidthMm) PHYSICAL_WIDTH_MM = config.physicalWidthMm;
        if (config.physicalHeightMm) PHYSICAL_HEIGHT_MM = config.physicalHeightMm;
        if (config.trimGuide) {
            TRIM_WIDTH_PX = config.trimGuide.widthPx || 0;
            TRIM_HEIGHT_PX = config.trimGuide.heightPx || 0;
            TRIM_ENABLED = !!config.trimGuide.enabled;
            const trimToggle = document.getElementById('trimGuideEnabled');
            if (trimToggle) trimToggle.checked = TRIM_ENABLED;
        }
        resolveAutoBorderColorIfNeeded();
        if (exportCustomWidthInput) exportCustomWidthInput.max = CARD_WIDTH;
        updateExportSizeInfo();
        updateCardShapeCurrentInfo();
        updatePhysicalSizeLabels();
        syncCanvasWrapperAspect();
        updateTrimGuideCurrentInfo();
        updateTrimGuideOverlay();
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
        NATIVE_TEMPLATE_WIDTH = img.naturalWidth || img.width;
        NATIVE_TEMPLATE_HEIGHT = img.naturalHeight || img.height;
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
            const colorRow = document.querySelector(`.field-color-row[data-field="${fc.id}"]`);
            if (colorRow) syncColorRow(colorRow, fc);
            const typoRow = document.querySelector(`.field-typo-row[data-field="${fc.id}"]`);
            if (typoRow) syncTypographyRow(typoRow, fc);
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

        rebuildCustomElementLists();
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

    // ==========================================
    // Field text auto-contrast color picking
    // ==========================================

    function hexToRgb(hex) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
        return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 0, b: 0 };
    }

    function relativeLuminance({ r, g, b }) {
        const srgb = [r, g, b].map(v => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
    }

    function contrastRatio(lumA, lumB) {
        const lighter = Math.max(lumA, lumB);
        const darker = Math.min(lumA, lumB);
        return (lighter + 0.05) / (darker + 0.05);
    }

    // Samples a small rect of a pre-drawn background snapshot (taken after the
    // template/logo/barcode are drawn but before any text) and returns whichever
    // of `candidates` has the best WCAG contrast against that local background —
    // so a field's "auto" color isn't hardcoded to black/white and can be any
    // admin-defined pair (e.g. white/purple) per field.
    function pickBestContrastColor(candidates, bgSnapshot, x, y, sampleW, sampleH) {
        if (!candidates || candidates.length === 0) return '#111111';
        if (!bgSnapshot) return candidates[0];

        const left = Math.max(0, Math.round(x - sampleW / 2));
        const top = Math.max(0, Math.round(y - sampleH / 2));
        const right = Math.min(bgSnapshot.width, left + sampleW);
        const bottom = Math.min(bgSnapshot.height, top + sampleH);

        const data = bgSnapshot.data;
        let rSum = 0, gSum = 0, bSum = 0, count = 0;
        for (let yy = top; yy < bottom; yy += 2) {
            for (let xx = left; xx < right; xx += 2) {
                const idx = (yy * bgSnapshot.width + xx) * 4;
                rSum += data[idx]; gSum += data[idx + 1]; bSum += data[idx + 2];
                count++;
            }
        }
        if (count === 0) return candidates[0];

        const bgLum = relativeLuminance({ r: rSum / count, g: gSum / count, b: bSum / count });

        let best = candidates[0], bestRatio = -1;
        for (const c of candidates) {
            const ratio = contrastRatio(relativeLuminance(hexToRgb(c)), bgLum);
            if (ratio > bestRatio) { bestRatio = ratio; best = c; }
        }
        return best;
    }

    function findFieldConfig(fieldId) {
        if (!LAYOUT) return null;
        return LAYOUT.fields.find(f => f.id === fieldId) ||
            (LAYOUT.customTexts || []).find(f => f.id === fieldId) ||
            null;
    }

    // Builds a text-color control (fixed color picker + "auto" toggle + 2
    // candidate color pickers) for a field, identified only by id — LAYOUT is
    // still null when this runs at bootstrap (mirrors how `.pos-control` X/Y
    // inputs are wired: bound by id now, populated later by
    // syncLayoutControlsFromLAYOUT once the config has actually loaded).
    function buildFieldColorControl(fieldId) {
        const wrap = document.createElement('div');
        wrap.className = 'field-color-row';
        wrap.dataset.field = fieldId;

        const tag = document.createElement('span');
        tag.className = 'pos-tag';
        tag.textContent = '文字顏色';

        const fixedColorInput = document.createElement('input');
        fixedColorInput.type = 'color';
        fixedColorInput.className = 'field-color-fixed';
        fixedColorInput.value = '#111111';

        const autoLabel = document.createElement('label');
        autoLabel.className = 'checkbox-label field-color-auto-label';
        const autoCheckbox = document.createElement('input');
        autoCheckbox.type = 'checkbox';
        autoCheckbox.className = 'field-color-auto-toggle';
        autoLabel.appendChild(autoCheckbox);
        autoLabel.appendChild(document.createTextNode('🎨 自動配色'));

        const candWrap = document.createElement('div');
        candWrap.className = 'field-color-candidates';
        candWrap.style.display = 'none';

        const cand1 = document.createElement('input');
        cand1.type = 'color';
        cand1.className = 'field-color-cand field-color-cand-0';
        cand1.value = '#1a1a1a';
        const cand2 = document.createElement('input');
        cand2.type = 'color';
        cand2.className = 'field-color-cand field-color-cand-1';
        cand2.value = '#ffffff';
        candWrap.appendChild(cand1);
        candWrap.appendChild(cand2);

        function commit() {
            const fc = findFieldConfig(fieldId);
            if (!fc) return;
            if (autoCheckbox.checked) {
                fc.colorMode = 'auto';
                fc.colorCandidates = [cand1.value, cand2.value];
            } else {
                fc.colorMode = 'fixed';
                fc.color = fixedColorInput.value;
            }
            renderCard();
        }

        autoCheckbox.addEventListener('change', () => {
            fixedColorInput.style.display = autoCheckbox.checked ? 'none' : '';
            candWrap.style.display = autoCheckbox.checked ? 'flex' : 'none';
            commit();
        });
        fixedColorInput.addEventListener('input', commit);
        cand1.addEventListener('input', commit);
        cand2.addEventListener('input', commit);

        wrap.appendChild(tag);
        wrap.appendChild(fixedColorInput);
        wrap.appendChild(autoLabel);
        wrap.appendChild(candWrap);
        return wrap;
    }

    function syncColorRow(rowEl, fc) {
        const fixedColorInput = rowEl.querySelector('.field-color-fixed');
        const autoCheckbox = rowEl.querySelector('.field-color-auto-toggle');
        const candWrap = rowEl.querySelector('.field-color-candidates');
        const cand1 = rowEl.querySelector('.field-color-cand-0');
        const cand2 = rowEl.querySelector('.field-color-cand-1');
        const isAuto = fc.colorMode === 'auto';

        if (fixedColorInput && fc.color && /^#[0-9a-f]{6}$/i.test(fc.color)) fixedColorInput.value = fc.color;
        if (autoCheckbox) autoCheckbox.checked = isAuto;
        if (fixedColorInput) fixedColorInput.style.display = isAuto ? 'none' : '';
        if (candWrap) candWrap.style.display = isAuto ? 'flex' : 'none';

        const candidates = Array.isArray(fc.colorCandidates) ? fc.colorCandidates : [];
        if (cand1 && candidates[0]) cand1.value = candidates[0];
        if (cand2 && candidates[1]) cand2.value = candidates[1];
    }

    // ==========================================
    // Field typography (font family / size / bold / italic)
    // ==========================================

    // Curated combos matching what's already used across the built-in fields,
    // rather than a free-text font name — keeps every option guaranteed to
    // actually be loaded (see the Google Fonts <link> in index.html).
    const FONT_FAMILY_OPTIONS = [
        { label: '中文黑體 (Noto Sans TC)', value: '"Noto Sans TC", sans-serif' },
        { label: '中英混合 (Noto Sans TC + Outfit)', value: '"Noto Sans TC", "Outfit", sans-serif' },
        { label: '科技感英文 (Orbitron)', value: '"Orbitron", sans-serif' },
        { label: '科技感英文+中文 (Orbitron + Noto Sans TC)', value: '"Orbitron", "Noto Sans TC", sans-serif' },
        { label: '等寬證號/數字 (Orbitron)', value: '"Orbitron", monospace' },
        { label: '現代英文 (Outfit)', value: '"Outfit", sans-serif' }
    ];

    // Builds a font-family select + size(px) + 粗體/斜體 checkboxes for a field,
    // identified only by id (same "bound now, populated later" pattern as
    // buildFieldColorControl — LAYOUT is still null when this runs at bootstrap).
    function buildFieldTypographyControl(fieldId) {
        const wrap = document.createElement('div');
        wrap.className = 'field-typo-row';
        wrap.dataset.field = fieldId;

        const tag = document.createElement('span');
        tag.className = 'pos-tag';
        tag.textContent = '字體樣式';
        wrap.appendChild(tag);

        const familySelect = document.createElement('select');
        familySelect.className = 'field-typo-family';
        FONT_FAMILY_OPTIONS.forEach(opt => {
            const o = document.createElement('option');
            o.value = opt.value;
            o.textContent = opt.label;
            familySelect.appendChild(o);
        });
        wrap.appendChild(familySelect);

        const sizeLabel = document.createElement('label');
        sizeLabel.textContent = '大小(px) ';
        const sizeInput = document.createElement('input');
        sizeInput.type = 'number';
        sizeInput.min = 6;
        sizeInput.max = 400;
        sizeInput.className = 'field-typo-size';
        sizeLabel.appendChild(sizeInput);
        wrap.appendChild(sizeLabel);

        const boldLabel = document.createElement('label');
        boldLabel.className = 'checkbox-label field-typo-toggle';
        const boldCb = document.createElement('input');
        boldCb.type = 'checkbox';
        boldCb.className = 'field-typo-bold';
        boldLabel.appendChild(boldCb);
        boldLabel.appendChild(document.createTextNode(' 粗體'));
        wrap.appendChild(boldLabel);

        const italicLabel = document.createElement('label');
        italicLabel.className = 'checkbox-label field-typo-toggle';
        const italicCb = document.createElement('input');
        italicCb.type = 'checkbox';
        italicCb.className = 'field-typo-italic';
        italicLabel.appendChild(italicCb);
        italicLabel.appendChild(document.createTextNode(' 斜體'));
        wrap.appendChild(italicLabel);

        function commit() {
            const fc = findFieldConfig(fieldId);
            if (!fc) return;
            fc.font = fc.font || {};
            fc.font.family = familySelect.value;
            const px = parseFloat(sizeInput.value);
            if (!isNaN(px) && px > 0) fc.font.sizeFrac = px / CARD_HEIGHT;
            fc.font.weight = boldCb.checked ? 700 : 400;
            fc.font.italic = italicCb.checked;
            renderCard();
        }

        familySelect.addEventListener('change', commit);
        sizeInput.addEventListener('input', commit);
        boldCb.addEventListener('change', commit);
        italicCb.addEventListener('change', commit);

        return wrap;
    }

    function syncTypographyRow(rowEl, fc) {
        const familySelect = rowEl.querySelector('.field-typo-family');
        const sizeInput = rowEl.querySelector('.field-typo-size');
        const boldCb = rowEl.querySelector('.field-typo-bold');
        const italicCb = rowEl.querySelector('.field-typo-italic');
        const font = fc.font || {};

        if (familySelect) {
            const match = FONT_FAMILY_OPTIONS.find(o => o.value === font.family);
            if (match) {
                familySelect.value = match.value;
            } else if (font.family) {
                // Hand-edited/unrecognized combo — add it as an extra option
                // instead of silently switching the field to a different font
                // just because the editor tab was opened.
                let customOpt = familySelect.querySelector('option[data-custom="true"]');
                if (!customOpt) {
                    customOpt = document.createElement('option');
                    customOpt.dataset.custom = 'true';
                    familySelect.appendChild(customOpt);
                }
                customOpt.value = font.family;
                customOpt.textContent = '目前設定：' + font.family;
                familySelect.value = font.family;
            }
        }
        if (sizeInput) sizeInput.value = Math.round((font.sizeFrac || 0.03) * CARD_HEIGHT);
        if (boldCb) boldCb.checked = (font.weight || 400) >= 700;
        if (italicCb) italicCb.checked = !!font.italic;
    }

    // ==========================================
    // Template-level custom text/logo elements
    // (freely added/removed by the admin, shared by every card)
    // ==========================================

    function genElementId(prefix) {
        return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
    }

    // A generic X%/Y%/W(px)/H(px) box editor, center-anchored on resize (reuses
    // resizeBoxKeepingCenter without needing global input IDs, since a template
    // can now have any number of these boxes at once).
    //
    // getImage (optional) returns the HTMLImageElement currently shown in this
    // box, if any. When present, W/H are kept locked to that image's natural
    // aspect ratio — editing one recalculates the other — so a LOGO never gets
    // squashed/stretched. Falls back to independent W/H resizing (the old
    // behavior) when no image is loaded yet.
    function buildBoxPositionControl(box, onChange, getImage) {
        const wrap = document.createElement('div');
        wrap.className = 'pos-control';

        const tag = document.createElement('span');
        tag.className = 'pos-tag';
        tag.textContent = '位置/大小';
        wrap.appendChild(tag);

        function numInput(labelText, value, step, min) {
            const label = document.createElement('label');
            label.textContent = labelText + ' ';
            const input = document.createElement('input');
            input.type = 'number';
            input.step = step;
            input.min = min;
            input.value = value;
            label.appendChild(input);
            wrap.appendChild(label);
            return input;
        }

        const xInput = numInput('X%', (box.x * 100).toFixed(1), 0.1, 0);
        const yInput = numInput('Y%', (box.y * 100).toFixed(1), 0.1, 0);
        const wInput = numInput('寬px', Math.round(box.w * CARD_WIDTH), 1, 10);
        const hInput = numInput('高px', Math.round(box.h * CARD_HEIGHT), 1, 10);

        function currentImageRatio() {
            const img = getImage ? getImage() : null;
            return (img && img.naturalWidth > 0 && img.naturalHeight > 0)
                ? img.naturalWidth / img.naturalHeight
                : null;
        }

        // Resize from center, recalculating the OTHER axis from `ratio` (image
        // width/height) when known, so the box never distorts the image.
        function resizeLocked(axis, pxValue, ratio) {
            const num = parseFloat(pxValue);
            if (isNaN(num) || num <= 0) return false;
            const centerX = box.x + box.w / 2;
            const centerY = box.y + box.h / 2;
            if (axis === 'w') {
                box.w = num / CARD_WIDTH;
                box.h = (num / ratio) / CARD_HEIGHT;
            } else {
                box.h = num / CARD_HEIGHT;
                box.w = (num * ratio) / CARD_WIDTH;
            }
            box.x = centerX - box.w / 2;
            box.y = centerY - box.h / 2;
            return true;
        }

        xInput.addEventListener('input', () => {
            const n = parseFloat(xInput.value);
            if (!isNaN(n)) { box.x = n / 100; onChange(); }
        });
        yInput.addEventListener('input', () => {
            const n = parseFloat(yInput.value);
            if (!isNaN(n)) { box.y = n / 100; onChange(); }
        });
        wInput.addEventListener('input', () => {
            const ratio = currentImageRatio();
            const resized = ratio
                ? resizeLocked('w', wInput.value, ratio)
                : resizeBoxKeepingCenter(box, 'w', wInput.value, null, null);
            if (resized) {
                xInput.value = (box.x * 100).toFixed(1);
                yInput.value = (box.y * 100).toFixed(1);
                if (ratio) hInput.value = Math.round(box.h * CARD_HEIGHT);
                onChange();
            }
        });
        hInput.addEventListener('input', () => {
            const ratio = currentImageRatio();
            const resized = ratio
                ? resizeLocked('h', hInput.value, ratio)
                : resizeBoxKeepingCenter(box, 'h', hInput.value, null, null);
            if (resized) {
                xInput.value = (box.x * 100).toFixed(1);
                yInput.value = (box.y * 100).toFixed(1);
                if (ratio) wInput.value = Math.round(box.w * CARD_WIDTH);
                onChange();
            }
        });

        return { el: wrap, wInput, hInput };
    }

    function loadCustomLogoImage(id, url) {
        return new Promise((resolve) => {
            if (!url) return resolve(null);
            const img = new Image();
            img.onload = () => {
                customLogoImgCache.set(id, img);
                renderCard();
                resolve(img);
            };
            img.onerror = () => {
                console.error('自訂 LOGO 圖片載入失敗:', url);
                alert('圖片已上傳成功，但瀏覽器載入圖片時失敗，所以預覽沒有更新。\n請按 F12 開啟開發者工具的 Console 分頁，看看是否有紅色錯誤訊息，並回報給我。\n圖片網址: ' + url);
                resolve(null);
            };
            img.src = `${url}?v=${Date.now()}`;
        });
    }

    function renderCustomTextRow(item) {
        const row = document.createElement('div');
        row.className = 'custom-element-row';
        row.dataset.id = item.id;

        const header = document.createElement('div');
        header.className = 'custom-element-header';

        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.className = 'custom-text-input';
        textInput.placeholder = '輸入文字內容';
        textInput.value = (item.source && item.source.text) || '';

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn-sm btn-outline custom-element-delete';
        delBtn.textContent = '🗑️ 刪除';

        header.appendChild(textInput);
        header.appendChild(delBtn);

        const posControl = buildBoxPositionControlForText(item);
        const typoRow = buildFieldTypographyControl(item.id);
        syncTypographyRow(typoRow, item);
        const colorRow = buildFieldColorControl(item.id);
        syncColorRow(colorRow, item);

        row.appendChild(header);
        row.appendChild(posControl);
        row.appendChild(typoRow);
        row.appendChild(colorRow);

        textInput.addEventListener('input', () => {
            item.source.text = textInput.value;
            renderCard();
        });
        delBtn.addEventListener('click', () => {
            if (!LAYOUT || !LAYOUT.customTexts) return;
            const idx = LAYOUT.customTexts.findIndex(f => f.id === item.id);
            if (idx >= 0) LAYOUT.customTexts.splice(idx, 1);
            row.remove();
            renderCard();
        });

        return row;
    }

    // Simple X%/Y% position editor for a text element (no W/H — text has no box).
    function buildBoxPositionControlForText(item) {
        const wrap = document.createElement('div');
        wrap.className = 'pos-control';

        const tag = document.createElement('span');
        tag.className = 'pos-tag';
        tag.textContent = '文字位置';
        wrap.appendChild(tag);

        const xLabel = document.createElement('label');
        xLabel.textContent = 'X ';
        const xInput = document.createElement('input');
        xInput.type = 'number'; xInput.className = 'pos-x'; xInput.min = 0; xInput.max = 100; xInput.step = 0.1;
        xInput.value = (item.position.x * 100).toFixed(1);
        xLabel.appendChild(xInput);

        const yLabel = document.createElement('label');
        yLabel.textContent = 'Y ';
        const yInput = document.createElement('input');
        yInput.type = 'number'; yInput.className = 'pos-y'; yInput.min = 0; yInput.max = 100; yInput.step = 0.1;
        yInput.value = (item.position.y * 100).toFixed(1);
        yLabel.appendChild(yInput);

        wrap.appendChild(xLabel);
        wrap.appendChild(yLabel);

        xInput.addEventListener('input', () => {
            const n = parseFloat(xInput.value);
            if (!isNaN(n)) { item.position.x = n / 100; renderCard(); }
        });
        yInput.addEventListener('input', () => {
            const n = parseFloat(yInput.value);
            if (!isNaN(n)) { item.position.y = n / 100; renderCard(); }
        });

        return wrap;
    }

    function renderCustomLogoRow(item) {
        const row = document.createElement('div');
        row.className = 'custom-element-row';
        row.dataset.id = item.id;

        const header = document.createElement('div');
        header.className = 'custom-element-header';

        // "更換圖片" ONLY ever means "pick a different image file" — it must
        // never be the button someone has to press just to make a checkbox
        // they already ticked take effect. That's what btnApply is for.
        const uploadBtn = document.createElement('button');
        uploadBtn.type = 'button';
        uploadBtn.className = 'btn btn-sm btn-outline';
        uploadBtn.textContent = item.imageUrl ? '🖼️ 更換圖片' : '🖼️ 上傳圖片';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/png, image/jpeg, image/jpg, image/webp';
        fileInput.style.display = 'none';

        // Re-applies the CURRENT checkbox/color settings to the already-picked
        // file — lets someone tick 自動去背/改配色/去外框 (or tweak the color)
        // AFTER uploading without having to re-pick the same file.
        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'btn btn-sm btn-primary';
        applyBtn.textContent = '🔄 套用目前設定';
        applyBtn.title = '用下面目前勾選的去背/改配色/去外框設定，重新處理剛剛選的圖片';
        applyBtn.disabled = true;

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn-sm btn-outline custom-element-delete';
        delBtn.textContent = '🗑️ 刪除';

        header.appendChild(uploadBtn);
        header.appendChild(fileInput);
        header.appendChild(applyBtn);
        header.appendChild(delBtn);

        const processOptions = document.createElement('div');
        processOptions.className = 'logo-process-options';
        const removeBgLabel = document.createElement('label');
        removeBgLabel.className = 'checkbox-label';
        const removeBgCb = document.createElement('input');
        removeBgCb.type = 'checkbox';
        removeBgLabel.appendChild(removeBgCb);
        removeBgLabel.appendChild(document.createTextNode(' 🪄 自動去背'));
        const recolorLabel = document.createElement('label');
        recolorLabel.className = 'checkbox-label';
        const recolorCb = document.createElement('input');
        recolorCb.type = 'checkbox';
        recolorLabel.appendChild(recolorCb);
        recolorLabel.appendChild(document.createTextNode(' 🎨 自動改配色'));

        // Target color for recolor — defaults to the auto-detected template
        // accent the first time it's shown, but stays fully user-adjustable
        // afterward (auto-pick isn't always what people want).
        const recolorColorInput = document.createElement('input');
        recolorColorInput.type = 'color';
        recolorColorInput.className = 'logo-recolor-color';
        recolorColorInput.title = '改配色的目標顏色（預設抓模板主色，可自行調整）';
        recolorColorInput.style.display = 'none';
        recolorCb.addEventListener('change', () => {
            if (recolorCb.checked && !recolorColorInput.dataset.userSet) {
                recolorColorInput.value = detectTemplateAccentColor();
            }
            recolorColorInput.style.display = recolorCb.checked ? 'inline-block' : 'none';
        });
        recolorColorInput.addEventListener('input', () => { recolorColorInput.dataset.userSet = 'true'; });

        const trimLabel = document.createElement('label');
        trimLabel.className = 'checkbox-label';
        const trimCb = document.createElement('input');
        trimCb.type = 'checkbox';
        trimLabel.appendChild(trimCb);
        trimLabel.appendChild(document.createTextNode(' ✂️ 去除多餘白邊/邊框'));
        processOptions.appendChild(removeBgLabel);
        processOptions.appendChild(recolorLabel);
        processOptions.appendChild(recolorColorInput);
        processOptions.appendChild(trimLabel);

        const processingHint = document.createElement('span');
        processingHint.className = 'logo-processing-hint';
        processingHint.textContent = '⏳ 處理中（依選項可能需要數秒到數十秒，第一次使用去背功能會更久），請稍候…';
        processingHint.style.display = 'none';

        const boxControl = buildBoxPositionControl(item.box, () => renderCard(), () => customLogoImgCache.get(item.id));

        row.appendChild(header);
        row.appendChild(processOptions);
        row.appendChild(processingHint);
        row.appendChild(boxControl.el);

        // A freshly (re)loaded image's natural aspect ratio becomes the box's
        // locked ratio: keep the box's current width, recompute height to match
        // so the LOGO is never shown squashed/stretched.
        async function fitBoxToImage(url) {
            const img = await loadCustomLogoImage(item.id, url);
            if (!img || !img.naturalWidth || !img.naturalHeight) return;
            const ratio = img.naturalWidth / img.naturalHeight;
            const centerX = item.box.x + item.box.w / 2;
            const centerY = item.box.y + item.box.h / 2;
            const pxW = item.box.w * CARD_WIDTH;
            item.box.h = (pxW / ratio) / CARD_HEIGHT;
            item.box.x = centerX - item.box.w / 2;
            item.box.y = centerY - item.box.h / 2;
            boxControl.hInput.value = Math.round(item.box.h * CARD_HEIGHT);
            renderCard();
        }

        let selectedFile = null;

        async function uploadWithCurrentSettings(file) {
            const fd = new FormData();
            fd.append('file', file);
            if (removeBgCb.checked) fd.append('remove_bg', 'true');
            if (recolorCb.checked) fd.append('recolor_hex', recolorColorInput.value || detectTemplateAccentColor());
            if (trimCb.checked) fd.append('trim', 'true');
            uploadBtn.disabled = true;
            applyBtn.disabled = true;
            processingHint.style.display = (removeBgCb.checked || recolorCb.checked || trimCb.checked) ? 'inline' : 'none';
            try {
                const res = await fetch('/api/upload_custom_asset', { method: 'POST', body: fd });
                const data = await res.json();
                if (data.success) {
                    item.imageUrl = data.url;
                    uploadBtn.textContent = '🖼️ 更換圖片';
                    await fitBoxToImage(data.url);
                } else {
                    alert('上傳失敗: ' + (data.error || '未知錯誤'));
                }
            } catch (err) {
                console.error(err);
                alert('無法連接伺服器上傳圖片。');
            } finally {
                uploadBtn.disabled = false;
                applyBtn.disabled = !selectedFile;
                processingHint.style.display = 'none';
            }
        }

        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            fileInput.value = '';
            if (!file) return;
            selectedFile = file;
            applyBtn.disabled = false;
            await uploadWithCurrentSettings(file);
        });

        applyBtn.addEventListener('click', () => {
            if (!selectedFile) return;
            uploadWithCurrentSettings(selectedFile);
        });

        delBtn.addEventListener('click', () => {
            if (!LAYOUT || !LAYOUT.customLogos) return;
            const idx = LAYOUT.customLogos.findIndex(f => f.id === item.id);
            if (idx >= 0) LAYOUT.customLogos.splice(idx, 1);
            customLogoImgCache.delete(item.id);
            row.remove();
            renderCard();
        });

        if (item.imageUrl) loadCustomLogoImage(item.id, item.imageUrl);

        return row;
    }

    function addCustomText() {
        if (!LAYOUT) return;
        if (!LAYOUT.customTexts) LAYOUT.customTexts = [];
        const item = {
            id: genElementId('custom_text'),
            source: { mode: 'static', text: '新文字' },
            position: { x: 0.5, y: 0.5 },
            align: { h: 'left', v: 'middle' },
            font: { family: '"Noto Sans TC", sans-serif', weight: 700, sizeFrac: 0.03, italic: false },
            color: '#ffffff',
            colorMode: 'fixed',
            colorCandidates: []
        };
        LAYOUT.customTexts.push(item);
        const list = document.getElementById('customTextsList');
        if (list) list.appendChild(renderCustomTextRow(item));
        renderCard();
    }

    function addCustomLogo() {
        if (!LAYOUT) return;
        if (!LAYOUT.customLogos) LAYOUT.customLogos = [];
        const item = {
            id: genElementId('custom_logo'),
            imageUrl: '',
            box: { x: 0.35, y: 0.35, w: 0.2, h: 0.2 },
            fit: 'contain',
            border: { enabled: false, color: '#4b1a8f', widthFrac: 0.005 },
            shadow: { enabled: false }
        };
        LAYOUT.customLogos.push(item);
        const list = document.getElementById('customLogosList');
        if (list) list.appendChild(renderCustomLogoRow(item));
        renderCard();
    }

    function rebuildCustomElementLists() {
        if (!LAYOUT) return;
        const customTextsList = document.getElementById('customTextsList');
        if (customTextsList) {
            customTextsList.innerHTML = '';
            (LAYOUT.customTexts || []).forEach(item => customTextsList.appendChild(renderCustomTextRow(item)));
        }
        const customLogosList = document.getElementById('customLogosList');
        if (customLogosList) {
            customLogosList.innerHTML = '';
            (LAYOUT.customLogos || []).forEach(item => customLogosList.appendChild(renderCustomLogoRow(item)));
        }
    }

    function initLayoutControls() {
        document.querySelectorAll('.pos-control').forEach(el => {
            const fieldId = el.dataset.field;
            const xInput = el.querySelector('.pos-x');
            const yInput = el.querySelector('.pos-y');
            if (xInput) xInput.addEventListener('input', () => updateFieldPosition(fieldId, 'x', xInput.value));
            if (yInput) yInput.addEventListener('input', () => updateFieldPosition(fieldId, 'y', yInput.value));

            // Inject matching text-color and typography controls right after
            // each field's position box (built here instead of hand-duplicated
            // per field in HTML). Typography goes first so color sits directly
            // below the position box, matching the original layout order.
            const typoRow = buildFieldTypographyControl(fieldId);
            el.parentNode.insertBefore(typoRow, el.nextSibling);
            const colorRow = buildFieldColorControl(fieldId);
            el.parentNode.insertBefore(colorRow, typoRow.nextSibling);
        });

        // Template-level custom text/logo elements: add buttons
        const btnAddCustomText = document.getElementById('btnAddCustomText');
        if (btnAddCustomText) btnAddCustomText.addEventListener('click', addCustomText);
        const btnAddCustomLogo = document.getElementById('btnAddCustomLogo');
        if (btnAddCustomLogo) btnAddCustomLogo.addEventListener('click', addCustomLogo);

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
                        // A freshly uploaded template is undistorted by definition — keep
                        // the user's chosen physical width but re-derive height from its
                        // (new) native pixel ratio so DPI stays correct.
                        PHYSICAL_HEIGHT_MM = PHYSICAL_WIDTH_MM * (CARD_HEIGHT / CARD_WIDTH);
                        LAYOUT.physicalWidthMm = PHYSICAL_WIDTH_MM;
                        LAYOUT.physicalHeightMm = PHYSICAL_HEIGHT_MM;
                        if (exportCustomWidthInput) exportCustomWidthInput.max = CARD_WIDTH;
                        updateExportSizeInfo();
                        updateCardShapeCurrentInfo();
                        updatePhysicalSizeLabels();
                        syncCanvasWrapperAspect();
                        updateTrimGuideCurrentInfo();
                        updateTrimGuideOverlay();
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

        // Export the current layout as a downloadable JSON backup
        const btnExportLayout = document.getElementById('btnExportLayout');
        if (btnExportLayout) {
            btnExportLayout.addEventListener('click', () => {
                if (!LAYOUT) return;
                const blob = new Blob([JSON.stringify(LAYOUT, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'card_layout_backup.json';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            });
        }

        // Import a previously exported layout JSON and apply it to the live preview
        const btnImportLayout = document.getElementById('btnImportLayout');
        const layoutImportInput = document.getElementById('layoutImportInput');
        if (btnImportLayout && layoutImportInput) {
            btnImportLayout.addEventListener('click', () => layoutImportInput.click());
            layoutImportInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    try {
                        const imported = JSON.parse(ev.target.result);
                        if (!Array.isArray(imported.fields) || !imported.logo) {
                            alert('這不是有效的版面設定檔（缺少 fields 或 logo）。');
                            return;
                        }
                        if (!LAYOUT) return;

                        // Merge by field id — a backup made before a newer field
                        // (e.g. barcode) existed won't delete what's here now.
                        imported.fields.forEach(importedField => {
                            const idx = LAYOUT.fields.findIndex(f => f.id === importedField.id);
                            if (idx >= 0) LAYOUT.fields[idx] = importedField;
                            else LAYOUT.fields.push(importedField);
                        });
                        LAYOUT.logo = Object.assign({}, LAYOUT.logo, imported.logo);
                        if (imported.barcode) LAYOUT.barcode = Object.assign({}, LAYOUT.barcode, imported.barcode);

                        syncLayoutControlsFromLAYOUT();
                        renderCard();
                        alert('✅ 版面設定已匯入到目前畫面！記得按「💾 儲存目前版面設定」才會真正寫回伺服器，之後產圖才會套用。');
                    } catch (err) {
                        console.error(err);
                        alert('版面設定檔格式錯誤，無法匯入：' + err.message);
                    } finally {
                        layoutImportInput.value = '';
                    }
                };
                reader.readAsText(file);
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

        // 2b. Admin-added custom logo/image elements (template-level, shared by every card).
        // Guarded per-item so one malformed/corrupt entry can't silently abort every
        // element drawn after it (the barcode, all text fields, everything).
        (LAYOUT.customLogos || []).forEach(cfg => {
            try { drawCustomLogo(cfg); } catch (e) { console.error('自訂 LOGO 繪製失敗:', cfg.id, e); }
        });

        // 3. Scannable barcode generated from the ID number
        drawIdBarcode(data);

        // Snapshot the canvas now — template/logo/barcode/custom logos are drawn,
        // no text yet — so "auto" text colors sample the true background instead
        // of glyphs left behind by an earlier field drawn in this same pass.
        let bgSnapshot = null;
        try {
            bgSnapshot = ctx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
        } catch (e) {
            bgSnapshot = null; // e.g. canvas tainted by a cross-origin image
        }

        // 4. Every text field, positioned purely from the config file
        LAYOUT.fields.forEach(fieldCfg => drawConfigField(fieldCfg, data, bgSnapshot));

        // 4b. Admin-added custom text elements, drawn last so they stay on top
        (LAYOUT.customTexts || []).forEach(fieldCfg => {
            try { drawConfigField(fieldCfg, data, bgSnapshot); } catch (e) { console.error('自訂文字繪製失敗:', fieldCfg.id, e); }
        });
    }

    // Simplified variant of drawLogo() for a template-level custom logo/image
    // element: same "contain" fit + optional border/shadow, but reads its own
    // box/border/shadow (not LAYOUT.logo) and its own cached image (not the
    // per-team logo lookup).
    function drawCustomLogo(logoCfg) {
        const box = logoCfg.box;
        if (!box) return;
        const pX = box.x * CARD_WIDTH;
        const pY = box.y * CARD_HEIGHT;
        const pW = box.w * CARD_WIDTH;
        const pH = box.h * CARD_HEIGHT;

        const border = logoCfg.border || {};
        const shadow = logoCfg.shadow || {};

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

        const img = customLogoImgCache.get(logoCfg.id);

        ctx.save();
        ctx.beginPath();
        ctx.rect(pX, pY, pW, pH);
        ctx.clip();

        if (img && img.width > 0 && img.height > 0) {
            const imgRatio = img.width / img.height;
            const boxRatio = pW / pH;
            let drawW, drawH;
            if (imgRatio > boxRatio) {
                drawW = pW;
                drawH = drawW / imgRatio;
            } else {
                drawH = pH;
                drawW = drawH * imgRatio;
            }
            const drawX = pX + (pW - drawW) / 2;
            const drawY = pY + (pH - drawH) / 2;
            ctx.drawImage(img, drawX, drawY, drawW, drawH);
        }

        ctx.restore();

        if (border.enabled) {
            ctx.save();
            ctx.strokeStyle = border.color || '#4b1a8f';
            ctx.lineWidth = (border.widthFrac || 0.005) * CARD_HEIGHT;
            ctx.strokeRect(pX, pY, pW, pH);
            ctx.restore();
        }
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

    function drawConfigField(fieldCfg, data, bgSnapshot) {
        const text = resolveFieldText(fieldCfg, data);
        if (!text) return;

        ctx.save();

        const family = fieldCfg.font.family;
        const weight = fieldCfg.font.weight || 400;
        const italic = fieldCfg.font.italic ? 'italic ' : '';
        let sizePx = Math.round(fieldCfg.font.sizeFrac * CARD_HEIGHT);
        ctx.textAlign = fieldCfg.align.h;
        ctx.textBaseline = fieldCfg.align.v;
        ctx.font = `${italic}${weight} ${sizePx}px ${family}`;

        const x = fieldCfg.position.x * CARD_WIDTH;
        const y = fieldCfg.position.y * CARD_HEIGHT;

        if (fieldCfg.colorMode === 'auto' && Array.isArray(fieldCfg.colorCandidates) && fieldCfg.colorCandidates.length) {
            const sampleSize = Math.max(20, sizePx * 1.4);
            ctx.fillStyle = pickBestContrastColor(fieldCfg.colorCandidates, bgSnapshot, x, y, sampleSize, sampleSize);
        } else {
            ctx.fillStyle = fieldCfg.color || '#111111';
        }

        // Auto-shrink to fit maxWidthFrac, down to minSizeFrac
        if (fieldCfg.maxWidthFrac) {
            const maxWidthPx = fieldCfg.maxWidthFrac * CARD_WIDTH;
            const minSizePx = (fieldCfg.minSizeFrac || fieldCfg.font.sizeFrac) * CARD_HEIGHT;
            while (ctx.measureText(text).width > maxWidthPx && sizePx > minSizePx) {
                sizePx -= 1;
                ctx.font = `${italic}${weight} ${sizePx}px ${family}`;
            }
        }

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
    // Card Shape Correction
    // Different print vendors cut cards to slightly different physical
    // dimensions. The template's native pixel ratio rarely matches a given
    // vendor's spec exactly, which throws off X/Y DPI once printed. This
    // lets the user specify the target size in mm, px, or a bare ratio
    // (each field independent — no auto-locking between width and height)
    // and reshapes the working canvas by the *smallest* possible distortion
    // needed to hit that ratio, always measured from the template's true,
    // undistorted native pixel size (NATIVE_TEMPLATE_WIDTH/HEIGHT) so
    // repeated corrections never compound.
    // ==========================================

    // Splits the ratio correction evenly across both axes (scaleX * scaleY
    // == 1, i.e. total pixel area is preserved) rather than dumping all the
    // distortion onto a single axis — the smallest change that still hits
    // the target ratio exactly.
    function computeMinimalReshapeForRatio(targetRatio) {
        const R0 = NATIVE_TEMPLATE_WIDTH / NATIVE_TEMPLATE_HEIGHT;
        const k = targetRatio / R0;
        const scaleX = Math.sqrt(k);
        const scaleY = 1 / scaleX;
        const w = Math.max(50, Math.round(NATIVE_TEMPLATE_WIDTH * scaleX));
        const h = Math.max(50, Math.round(NATIVE_TEMPLATE_HEIGHT * scaleY));
        return { w, h };
    }

    // Applies a new working canvas size. The template image is redrawn
    // stretched to fit (renderCard()'s drawImage call already targets
    // CARD_WIDTH/CARD_HEIGHT regardless of the source image's own pixel
    // size, so no extra offscreen resampling step is needed here).
    function applyCardShape(newW, newH, physicalWidthMm) {
        if (!newW || !newH || newW < 50 || newH < 50) {
            alert('請輸入有效的寬度與高度數值（至少 50）。');
            return false;
        }
        CARD_WIDTH = Math.round(newW);
        CARD_HEIGHT = Math.round(newH);
        canvas.width = CARD_WIDTH;
        canvas.height = CARD_HEIGHT;
        if (LAYOUT) {
            LAYOUT.canvasWidth = CARD_WIDTH;
            LAYOUT.canvasHeight = CARD_HEIGHT;
        }
        if (physicalWidthMm) PHYSICAL_WIDTH_MM = physicalWidthMm;
        // Re-derive height-mm from the actual achieved pixel ratio (not the
        // pre-rounding target) so DPI comes out uniform on both axes.
        PHYSICAL_HEIGHT_MM = PHYSICAL_WIDTH_MM * (CARD_HEIGHT / CARD_WIDTH);
        if (LAYOUT) {
            LAYOUT.physicalWidthMm = PHYSICAL_WIDTH_MM;
            LAYOUT.physicalHeightMm = PHYSICAL_HEIGHT_MM;
        }
        if (exportCustomWidthInput) exportCustomWidthInput.max = CARD_WIDTH;
        updateExportSizeInfo();
        updateCardShapeCurrentInfo();
        updatePhysicalSizeLabels();
        syncCanvasWrapperAspect();
        updateTrimGuideCurrentInfo();
        updateTrimGuideOverlay();
        renderCard();
        return true;
    }

    function updateCardShapeCurrentInfo() {
        const el = document.getElementById('cardShapeCurrentInfo');
        if (el && CARD_WIDTH && CARD_HEIGHT) {
            const ratio = (CARD_WIDTH / CARD_HEIGHT).toFixed(3);
            el.innerText = `目前畫布：${CARD_WIDTH} × ${CARD_HEIGHT} px（比例 ${ratio}）｜ 對應實體尺寸：${fmtMm(PHYSICAL_WIDTH_MM)} × ${fmtMm(PHYSICAL_HEIGHT_MM)} mm ｜ 模板原始像素：${NATIVE_TEMPLATE_WIDTH} × ${NATIVE_TEMPLATE_HEIGHT} px`;
        }
        // Keep all three unit groups showing the same size — whichever one
        // was just used to apply a change, the other two get filled in with
        // the equivalent values so they never look stale/inconsistent.
        const mmWEl = document.getElementById('shapeMmWidth');
        const mmHEl = document.getElementById('shapeMmHeight');
        const pxWEl = document.getElementById('shapePxWidth');
        const pxHEl = document.getElementById('shapePxHeight');
        const rWEl = document.getElementById('shapeRatioWidth');
        const rHEl = document.getElementById('shapeRatioHeight');
        if (mmWEl) mmWEl.value = fmtMm(PHYSICAL_WIDTH_MM);
        if (mmHEl) mmHEl.value = fmtMm(PHYSICAL_HEIGHT_MM);
        if (pxWEl) pxWEl.value = CARD_WIDTH || '';
        if (pxHEl) pxHEl.value = CARD_HEIGHT || '';
        if (rWEl) rWEl.value = CARD_WIDTH || '';
        if (rHEl) rHEl.value = CARD_HEIGHT || '';
    }

    // Refreshes every "79.7 × 48 mm" style label throughout the page
    // (header, download buttons, preview panel, print guide) to reflect
    // whatever physical size is currently in effect.
    function updatePhysicalSizeLabels() {
        const text = `${fmtMm(PHYSICAL_WIDTH_MM)} × ${fmtMm(PHYSICAL_HEIGHT_MM)} mm`;
        document.querySelectorAll('.physical-size-text').forEach(el => { el.textContent = text; });

        const dimBadge = document.getElementById('dimBadge');
        if (dimBadge && CARD_WIDTH && CARD_HEIGHT) dimBadge.textContent = `${CARD_WIDTH} × ${CARD_HEIGHT} px`;

        const printInfo = document.getElementById('printGuideResInfo');
        if (printInfo && CARD_WIDTH && CARD_HEIGHT) {
            const nativeDpi = Math.round(CARD_WIDTH / (PHYSICAL_WIDTH_MM / 25.4));
            printInfo.textContent = `本系統下載之圖檔預設為 ${CARD_WIDTH} × ${CARD_HEIGHT} px（依目前模板畫布尺寸輸出），約 ${nativeDpi} DPI 印刷等級解析度；實際下載解析度依上方「輸出圖片大小 / 解析度」設定而定。`;
        }
    }

    function initCardShapeControls() {
        const mmW = document.getElementById('shapeMmWidth');
        const mmH = document.getElementById('shapeMmHeight');
        const pxW = document.getElementById('shapePxWidth');
        const pxH = document.getElementById('shapePxHeight');
        const ratioW = document.getElementById('shapeRatioWidth');
        const ratioH = document.getElementById('shapeRatioHeight');
        const btnMm = document.getElementById('btnApplyShapeMm');
        const btnPx = document.getElementById('btnApplyShapePx');
        const btnRatio = document.getElementById('btnApplyShapeRatio');
        const btnReset = document.getElementById('btnResetShape');

        if (btnMm) {
            btnMm.addEventListener('click', () => {
                const w = parseFloat(mmW && mmW.value);
                const h = parseFloat(mmH && mmH.value);
                if (!w || !h || w <= 0 || h <= 0) { alert('請輸入有效的毫米寬度與高度。'); return; }
                const { w: newW, h: newH } = computeMinimalReshapeForRatio(w / h);
                if (applyCardShape(newW, newH, w)) {
                    alert(`✅ 已依 ${fmtMm(w)} × ${fmtMm(h)} mm 的比例校正模板（畫布已縮放為 ${newW} × ${newH} px）。\n記得點上方「💾 儲存目前版面設定」才會永久保留此設定。`);
                }
            });
        }

        if (btnPx) {
            btnPx.addEventListener('click', () => {
                const w = parseInt(pxW && pxW.value, 10);
                const h = parseInt(pxH && pxH.value, 10);
                if (!w || !h) { alert('請輸入有效的像素寬度與高度。'); return; }
                if (applyCardShape(w, h, null)) {
                    alert(`✅ 已將畫布設定為 ${w} × ${h} px。\n記得點上方「💾 儲存目前版面設定」才會永久保留此設定。`);
                }
            });
        }

        if (btnRatio) {
            btnRatio.addEventListener('click', () => {
                const rw = parseFloat(ratioW && ratioW.value);
                const rh = parseFloat(ratioH && ratioH.value);
                if (!rw || !rh || rw <= 0 || rh <= 0) { alert('請輸入有效的比例數值。'); return; }
                const { w: newW, h: newH } = computeMinimalReshapeForRatio(rw / rh);
                if (applyCardShape(newW, newH, null)) {
                    alert(`✅ 已依 ${rw} : ${rh} 比例校正模板（畫布已縮放為 ${newW} × ${newH} px）。\n記得點上方「💾 儲存目前版面設定」才會永久保留此設定。`);
                }
            });
        }

        if (btnReset) {
            btnReset.addEventListener('click', () => {
                if (!NATIVE_TEMPLATE_WIDTH || !NATIVE_TEMPLATE_HEIGHT) return;
                applyCardShape(NATIVE_TEMPLATE_WIDTH, NATIVE_TEMPLATE_HEIGHT, 79.7);
                alert(`✅ 已還原為模板原始比例（${NATIVE_TEMPLATE_WIDTH} × ${NATIVE_TEMPLATE_HEIGHT} px）。\n記得點上方「💾 儲存目前版面設定」才會永久保留此設定。`);
            });
        }
    }

    // Keeps the on-screen canvas wrapper's aspect ratio pixel-perfect with
    // the actual canvas, so #cardCanvas (object-fit: contain) never
    // letterboxes — required for the trim guide overlay's percentage-based
    // positioning below to line up exactly with the rendered card.
    function syncCanvasWrapperAspect() {
        const wrapper = document.getElementById('canvasWrapper');
        if (wrapper && CARD_WIDTH && CARD_HEIGHT) {
            wrapper.style.aspectRatio = `${CARD_WIDTH} / ${CARD_HEIGHT}`;
        }
    }

    // ==========================================
    // Trim Guide (刀板 / 出血參考框)
    // Purely a visual reference for where the vendor will actually cut the
    // card, centered over the total (bleed-inclusive) canvas set above. It
    // is a plain absolutely-positioned <div> layered on top of the canvas
    // in the DOM — never drawn into the canvas's own pixels — so it is
    // structurally impossible for it to end up in any exported/downloaded
    // image, no matter which export path is used.
    // ==========================================

    function updateTrimGuideOverlay() {
        const overlay = document.getElementById('trimGuideOverlay');
        const caption = document.getElementById('trimGuideCaption');
        if (!overlay) return;
        const active = TRIM_ENABLED && TRIM_WIDTH_PX && TRIM_HEIGHT_PX && CARD_WIDTH && CARD_HEIGHT;
        if (!active) {
            overlay.style.display = 'none';
            if (caption) caption.style.display = 'none';
            return;
        }
        const w = Math.min(TRIM_WIDTH_PX, CARD_WIDTH);
        const h = Math.min(TRIM_HEIGHT_PX, CARD_HEIGHT);
        overlay.style.left = `${((CARD_WIDTH - w) / 2 / CARD_WIDTH) * 100}%`;
        overlay.style.top = `${((CARD_HEIGHT - h) / 2 / CARD_HEIGHT) * 100}%`;
        overlay.style.width = `${(w / CARD_WIDTH) * 100}%`;
        overlay.style.height = `${(h / CARD_HEIGHT) * 100}%`;
        overlay.style.display = 'block';
        if (caption) caption.style.display = 'block';
    }

    function updateTrimGuideCurrentInfo() {
        const el = document.getElementById('trimGuideCurrentInfo');
        if (el) {
            if (!TRIM_WIDTH_PX || !TRIM_HEIGHT_PX) {
                el.innerText = '尚未設定刀板尺寸（設定後會置中顯示於畫布，做為排版參考）';
            } else {
                const bleedXpx = CARD_WIDTH - TRIM_WIDTH_PX;
                const bleedYpx = CARD_HEIGHT - TRIM_HEIGHT_PX;
                const bleedXmm = CARD_WIDTH ? (bleedXpx / 2) * (PHYSICAL_WIDTH_MM / CARD_WIDTH) : 0;
                const bleedYmm = CARD_HEIGHT ? (bleedYpx / 2) * (PHYSICAL_HEIGHT_MM / CARD_HEIGHT) : 0;
                const warn = (TRIM_WIDTH_PX > CARD_WIDTH || TRIM_HEIGHT_PX > CARD_HEIGHT)
                    ? ' ⚠️ 刀板大於總畫布，已限制在畫布範圍內顯示'
                    : '';
                el.innerText = `目前刀板：${TRIM_WIDTH_PX} × ${TRIM_HEIGHT_PX} px ｜ 四周出血約：左右 ${fmtMm(bleedXmm)} mm、上下 ${fmtMm(bleedYmm)} mm${warn}`;
            }
        }
        // Same as the total-canvas group above: whichever unit was just used
        // to apply the trim size, fill the other two groups with the
        // equivalent values so all three always agree.
        const mmWEl = document.getElementById('trimMmWidth');
        const mmHEl = document.getElementById('trimMmHeight');
        const pxWEl = document.getElementById('trimPxWidth');
        const pxHEl = document.getElementById('trimPxHeight');
        const rWEl = document.getElementById('trimRatioWidth');
        const rHEl = document.getElementById('trimRatioHeight');
        const trimMmW = TRIM_WIDTH_PX && PHYSICAL_WIDTH_MM && CARD_WIDTH ? fmtMm(TRIM_WIDTH_PX * (PHYSICAL_WIDTH_MM / CARD_WIDTH)) : '';
        const trimMmH = TRIM_HEIGHT_PX && PHYSICAL_HEIGHT_MM && CARD_HEIGHT ? fmtMm(TRIM_HEIGHT_PX * (PHYSICAL_HEIGHT_MM / CARD_HEIGHT)) : '';
        if (mmWEl) mmWEl.value = trimMmW;
        if (mmHEl) mmHEl.value = trimMmH;
        if (pxWEl) pxWEl.value = TRIM_WIDTH_PX || '';
        if (pxHEl) pxHEl.value = TRIM_HEIGHT_PX || '';
        if (rWEl) rWEl.value = TRIM_WIDTH_PX || '';
        if (rHEl) rHEl.value = TRIM_HEIGHT_PX || '';
    }

    // Sets the trim size (in px) and turns the guide on; shared by all three
    // apply paths below since they only differ in how they arrive at a px
    // width/height.
    function applyTrimGuide(pxW, pxH) {
        if (!pxW || !pxH || pxW < 10 || pxH < 10) {
            alert('請輸入有效的刀板寬度與高度數值（至少 10）。');
            return false;
        }
        TRIM_WIDTH_PX = Math.round(pxW);
        TRIM_HEIGHT_PX = Math.round(pxH);
        TRIM_ENABLED = true;
        const toggle = document.getElementById('trimGuideEnabled');
        if (toggle) toggle.checked = true;
        if (LAYOUT) {
            LAYOUT.trimGuide = { enabled: TRIM_ENABLED, widthPx: TRIM_WIDTH_PX, heightPx: TRIM_HEIGHT_PX };
        }
        updateTrimGuideCurrentInfo();
        updateTrimGuideOverlay();
        return true;
    }

    function initTrimGuideControls() {
        const mmW = document.getElementById('trimMmWidth');
        const mmH = document.getElementById('trimMmHeight');
        const pxW = document.getElementById('trimPxWidth');
        const pxH = document.getElementById('trimPxHeight');
        const ratioW = document.getElementById('trimRatioWidth');
        const ratioH = document.getElementById('trimRatioHeight');
        const btnMm = document.getElementById('btnApplyTrimMm');
        const btnPx = document.getElementById('btnApplyTrimPx');
        const btnRatio = document.getElementById('btnApplyTrimRatio');
        const toggle = document.getElementById('trimGuideEnabled');

        if (btnMm) {
            btnMm.addEventListener('click', () => {
                const w = parseFloat(mmW && mmW.value);
                const h = parseFloat(mmH && mmH.value);
                if (!w || !h || w <= 0 || h <= 0) { alert('請輸入有效的毫米寬度與高度。'); return; }
                if (!CARD_WIDTH || !CARD_HEIGHT || !PHYSICAL_WIDTH_MM || !PHYSICAL_HEIGHT_MM) {
                    alert('請先在上方設定好「總畫布尺寸」。');
                    return;
                }
                const pxW = w * (CARD_WIDTH / PHYSICAL_WIDTH_MM);
                const pxH = h * (CARD_HEIGHT / PHYSICAL_HEIGHT_MM);
                if (applyTrimGuide(pxW, pxH)) {
                    alert(`✅ 已設定刀板為 ${fmtMm(w)} × ${fmtMm(h)} mm，置中顯示於畫布（僅供預覽參考，不會輸出到圖檔）。`);
                }
            });
        }

        if (btnPx) {
            btnPx.addEventListener('click', () => {
                const w = parseInt(pxW && pxW.value, 10);
                const h = parseInt(pxH && pxH.value, 10);
                if (!w || !h) { alert('請輸入有效的像素寬度與高度。'); return; }
                if (applyTrimGuide(w, h)) {
                    alert(`✅ 已設定刀板為 ${w} × ${h} px，置中顯示於畫布（僅供預覽參考，不會輸出到圖檔）。`);
                }
            });
        }

        if (btnRatio) {
            btnRatio.addEventListener('click', () => {
                const rw = parseFloat(ratioW && ratioW.value);
                const rh = parseFloat(ratioH && ratioH.value);
                if (!rw || !rh || rw <= 0 || rh <= 0) { alert('請輸入有效的比例數值。'); return; }
                if (!CARD_WIDTH || !CARD_HEIGHT) return;
                // No absolute size is implied by a bare ratio, so default to
                // the largest centered box at that ratio that still fits
                // fully inside the current canvas.
                const canvasRatio = CARD_WIDTH / CARD_HEIGHT;
                const targetRatio = rw / rh;
                let w, h;
                if (targetRatio > canvasRatio) {
                    w = CARD_WIDTH;
                    h = w / targetRatio;
                } else {
                    h = CARD_HEIGHT;
                    w = h * targetRatio;
                }
                if (applyTrimGuide(w, h)) {
                    alert(`✅ 已依 ${rw} : ${rh} 比例設定刀板，置中顯示於畫布（僅供預覽參考，不會輸出到圖檔）。`);
                }
            });
        }

        if (toggle) {
            toggle.addEventListener('change', () => {
                TRIM_ENABLED = toggle.checked;
                if (LAYOUT) {
                    LAYOUT.trimGuide = { enabled: TRIM_ENABLED, widthPx: TRIM_WIDTH_PX, heightPx: TRIM_HEIGHT_PX };
                }
                updateTrimGuideOverlay();
            });
        }
    }

    // ==========================================
    // Export Size Controls
    // Lets the user cap the exported PNG's resolution (via a DPI preset or a
    // custom pixel width) instead of always exporting at the template's full
    // native resolution — some print vendors reject files that are "too big".
    // Every export path (download, batch save, QR, clipboard copy) reads
    // through getExportCanvas() so the setting applies everywhere uniformly.
    // ==========================================

    const exportSizePreset = document.getElementById('exportSizePreset');
    const exportCustomWidthGroup = document.getElementById('exportCustomWidthGroup');
    const exportCustomWidthInput = document.getElementById('exportCustomWidth');
    const exportSizeInfo = document.getElementById('exportSizeInfo');

    function computeExportDimensions() {
        if (!CARD_WIDTH || !CARD_HEIGHT) return { w: CARD_WIDTH, h: CARD_HEIGHT };
        const mode = exportSizePreset ? exportSizePreset.value : 'original';

        if (mode === 'original') {
            return { w: CARD_WIDTH, h: CARD_HEIGHT };
        }

        if (mode === 'custom') {
            let w = parseInt(exportCustomWidthInput && exportCustomWidthInput.value, 10);
            if (!w || w <= 0) w = CARD_WIDTH;
            w = Math.min(w, CARD_WIDTH); // never upscale past the template's native pixels
            const h = Math.max(1, Math.round(w * (CARD_HEIGHT / CARD_WIDTH)));
            return { w, h };
        }

        // DPI preset: scale the whole canvas so its width matches the target
        // DPI at the card's physical width, keeping the native aspect ratio.
        const targetDpi = parseInt(mode, 10);
        const nativeDpi = CARD_WIDTH / (PHYSICAL_WIDTH_MM / 25.4);
        const scale = Math.min(targetDpi / nativeDpi, 1); // never upscale
        const w = Math.max(1, Math.round(CARD_WIDTH * scale));
        const h = Math.max(1, Math.round(CARD_HEIGHT * scale));
        return { w, h };
    }

    // Returns the canvas to actually export from: the live preview canvas
    // itself when no downscale is needed, or a freshly-drawn offscreen
    // canvas at the computed export size otherwise.
    function getExportCanvas() {
        const { w, h } = computeExportDimensions();
        if (!w || !h || (w === CARD_WIDTH && h === CARD_HEIGHT)) return canvas;
        const off = document.createElement('canvas');
        off.width = w;
        off.height = h;
        const octx = off.getContext('2d');
        octx.imageSmoothingEnabled = true;
        octx.imageSmoothingQuality = 'high';
        octx.drawImage(canvas, 0, 0, w, h);
        return off;
    }

    function updateExportSizeInfo() {
        if (!exportSizeInfo || !CARD_WIDTH) return;
        const { w, h } = computeExportDimensions();
        const approxDpi = Math.round(w / (PHYSICAL_WIDTH_MM / 25.4));
        exportSizeInfo.innerText = `輸出尺寸：${w} × ${h} px（約 ${approxDpi} DPI）`;
    }

    function initExportSizeControls() {
        if (exportSizePreset) {
            exportSizePreset.addEventListener('change', () => {
                if (exportCustomWidthGroup) {
                    exportCustomWidthGroup.style.display = exportSizePreset.value === 'custom' ? 'flex' : 'none';
                }
                if (exportSizePreset.value === 'custom' && exportCustomWidthInput && !exportCustomWidthInput.value) {
                    exportCustomWidthInput.value = Math.round(CARD_WIDTH / 2) || 1000;
                }
                updateExportSizeInfo();
            });
        }
        if (exportCustomWidthInput) {
            exportCustomWidthInput.addEventListener('input', updateExportSizeInfo);
        }
    }

    // ==========================================
    // QR Code API Integration
    // ==========================================

    function generateQRCode() {
        const imgData = getExportCanvas().toDataURL('image/png', 1.0);

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
        const teamLogoRemoveBgCb = document.getElementById('teamLogoRemoveBg');
        const teamLogoRecolorCb = document.getElementById('teamLogoRecolor');
        const teamLogoRecolorColorInput = document.getElementById('teamLogoRecolorColor');
        const teamLogoTrimCb = document.getElementById('teamLogoTrim');
        const btnApplyTeamLogoSettings = document.getElementById('btnApplyTeamLogoSettings');
        const singleUploadHint = singleDropZone ? singleDropZone.querySelector('.upload-hint') : null;
        const singleUploadHintDefaultText = singleUploadHint ? singleUploadHint.textContent : '';
        let teamLogoSelectedFile = null;

        if (teamLogoRecolorCb && teamLogoRecolorColorInput) {
            teamLogoRecolorCb.addEventListener('change', () => {
                if (teamLogoRecolorCb.checked && !teamLogoRecolorColorInput.dataset.userSet) {
                    teamLogoRecolorColorInput.value = detectTemplateAccentColor();
                }
                teamLogoRecolorColorInput.style.display = teamLogoRecolorCb.checked ? 'inline-block' : 'none';
            });
            teamLogoRecolorColorInput.addEventListener('input', () => {
                teamLogoRecolorColorInput.dataset.userSet = 'true';
            });
        }

        function setSingleLogoProcessing(isProcessing) {
            if (!singleUploadHint) return;
            singleUploadHint.textContent = isProcessing
                ? '⏳ 處理中（依選項可能需要數秒到數十秒，第一次使用去背功能會更久），請稍候…'
                : singleUploadHintDefaultText;
        }

        function getLogoProcessOpts() {
            return {
                removeBg: !!(teamLogoRemoveBgCb && teamLogoRemoveBgCb.checked),
                recolorHex: (teamLogoRecolorCb && teamLogoRecolorCb.checked)
                    ? (teamLogoRecolorColorInput.value || detectTemplateAccentColor())
                    : null,
                trim: !!(teamLogoTrimCb && teamLogoTrimCb.checked)
            };
        }

        // "更換圖片" 只用來重新挑檔案；勾選框改變後要套用，按下面的「🔄 套用目前設定」
        // 用同一張已選檔案重新處理，不用重新選一次圖檔。
        const processSingleLogo = (file, opts) => {
            if (!file) return;
            opts = opts || {};
            const curTeam = fields.teamName ? fields.teamName.value.trim() : '';
            const stem = file.name.replace(/\.[^/.]+$/, "").trim();

            if (opts.removeBg || opts.recolorHex || opts.trim) {
                // Server-side processing changes the actual pixels, so wait for
                // the processed image back instead of instantly previewing the
                // raw (unprocessed) upload. This can take a while (AI background
                // removal especially), so show a "processing" hint — otherwise it
                // looks like nothing happened while the request is in flight.
                const fd = new FormData();
                fd.append('file', file);
                fd.append('team_name', curTeam || stem);
                if (opts.removeBg) fd.append('remove_bg', 'true');
                if (opts.recolorHex) fd.append('recolor_hex', opts.recolorHex);
                if (opts.trim) fd.append('trim', 'true');
                setSingleLogoProcessing(true);
                if (btnApplyTeamLogoSettings) btnApplyTeamLogoSettings.disabled = true;
                fetch('/api/upload_team_logo', { method: 'POST', body: fd })
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            return loadLogoImageFromUrl(data.team_name, `${data.logo_url}?v=${Date.now()}`);
                        }
                        alert('上傳/處理失敗: ' + (data.error || '未知錯誤'));
                    })
                    .catch(err => {
                        console.error('Logo upload error:', err);
                        alert('無法連接伺服器處理 LOGO。');
                    })
                    .finally(() => {
                        setSingleLogoProcessing(false);
                        if (btnApplyTeamLogoSettings) btnApplyTeamLogoSettings.disabled = !teamLogoSelectedFile;
                    });
                return;
            }

            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    userTeamLogoImg = img;
                    if (curTeam) teamLogoCache.set(curTeam, img);
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
                const file = e.target.files[0];
                if (!file) return;
                teamLogoSelectedFile = file;
                if (btnApplyTeamLogoSettings) btnApplyTeamLogoSettings.disabled = false;
                processSingleLogo(file, getLogoProcessOpts());
            });
        }

        if (btnApplyTeamLogoSettings) {
            btnApplyTeamLogoSettings.addEventListener('click', () => {
                if (!teamLogoSelectedFile) return;
                processSingleLogo(teamLogoSelectedFile, getLogoProcessOpts());
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
                    teamLogoSelectedFile = dt.files[0];
                    if (btnApplyTeamLogoSettings) btnApplyTeamLogoSettings.disabled = false;
                    processSingleLogo(dt.files[0], getLogoProcessOpts());
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
                    const imgData = getExportCanvas().toDataURL('image/png', 1.0);

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

            const dataUrl = getExportCanvas().toDataURL('image/png', 1.0);

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
                getExportCanvas().toBlob((blob) => {
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
    // Sticky Preview Offset
    // Keeps the sticky right-hand preview panel positioned right under the
    // header, whatever the header's actual rendered height turns out to be
    // (it can shift slightly once web fonts finish loading).
    // ==========================================
    function syncHeaderHeightVar() {
        const header = document.querySelector('.app-header');
        if (!header) return;
        document.documentElement.style.setProperty('--header-height', `${header.offsetHeight}px`);
    }

    function initStickyPreviewOffset() {
        syncHeaderHeightVar();
        window.addEventListener('resize', syncHeaderHeightVar);
        window.addEventListener('load', syncHeaderHeightVar);
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(syncHeaderHeightVar).catch(() => {});
        }
        const header = document.querySelector('.app-header');
        if (header && window.ResizeObserver) {
            new ResizeObserver(syncHeaderHeightVar).observe(header);
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
    initStickyPreviewOffset();
    initCardShapeControls();
    initTrimGuideControls();
    initExportSizeControls();

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
