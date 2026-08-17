/* ==========================================================================
   Volleyball Player ID Card Studio - Core Canvas & App Logic
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // --- Canvas setup ---
    const canvas = document.getElementById('cardCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Canvas target dimensions (2x 300DPI scale of 941.5x567 => 1883x1134 px)
    const CARD_WIDTH = 1883;
    const CARD_HEIGHT = 1134;

    // Default Sample Data
    const DEFAULT_DATA = {
        playerName: '孔鏘',
        teamName: '巴豆妖排球隊',
        jerseyNumber: '03',
        idNumber: 'BDYxTAKO',
        associationName: 'TAKO盃 - 第10屆',
        validThru: '2026/09/05',
        footerNote2: 'NVA Club House 排球俱樂部',
        primaryColor: '#ffffff',
        accentColor: '#ff6b00',
        textColor: '#111111',
        cardPattern: 'volleyball',
        cardBorderRadius: 'rounded',
        photoZoom: 100,
        photoOffsetX: 0,
        photoOffsetY: 0
    };

    // User Uploaded Media & Logo Cache
    let userTeamLogoImg = null;
    const teamLogoCache = new Map(); // stem/teamName -> HTMLImageElement

    // Preset color themes
    const PRESETS = {
        karasuno: { primary: '#f8fafc', accent: '#ff6b00', text: '#111111' },
        nekoma: { primary: '#ffffff', accent: '#cc0000', text: '#111111' },
        aoba: { primary: '#f0fdfa', accent: '#00a896', text: '#111111' },
        fukurodani: { primary: '#ffffff', accent: '#e6ad00', text: '#111111' },
        inarizaki: { primary: '#f4f4f5', accent: '#18181b', text: '#111111' },
        shiratorizawa: { primary: '#ffffff', accent: '#501898', text: '#111111' }
    };

    // DOM Elements
    const fields = {
        playerName: document.getElementById('playerName'),
        teamName: document.getElementById('teamName'),
        jerseyNumber: document.getElementById('jerseyNumber'),
        idNumber: document.getElementById('idNumber'),
        associationName: document.getElementById('associationName'),
        validThru: document.getElementById('validThru'),
        footerNote2: document.getElementById('footerNote2'),
        primaryColor: document.getElementById('primaryColor'),
        accentColor: document.getElementById('accentColor'),
        textColor: document.getElementById('textColor'),
        cardPattern: document.getElementById('cardPattern'),
        cardBorderRadius: document.getElementById('cardBorderRadius'),
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
    // Core Card Render Engine (HTML5 Canvas)
    // ==========================================

    function renderCard() {
        const data = getFormData();
        renderCardForData(data);
    }

    function renderCardForData(data, activeLogoImg) {
        ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

        const borderRadius = data.cardBorderRadius === 'rounded' ? 45 : 0;

        // 1. Base Rounded Card Clip & Background
        ctx.save();
        drawRoundedRect(ctx, 0, 0, CARD_WIDTH, CARD_HEIGHT, borderRadius);
        ctx.clip();

        // Solid Card Background Fill (Pure, clean, no unwanted gradient darkening)
        ctx.fillStyle = data.primaryColor;
        ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

        // 2. Background Pattern Overlay
        drawBackgroundPattern(data.cardPattern, data.accentColor);

        // 3. Top Header Banner
        drawHeaderBanner(data);

        // 4. Square Team Logo Frame (Right side 1:1)
        drawTeamLogoSquareSection(data, activeLogoImg);

        // 5. Main Info (Name, Number, Team Name Box)
        drawMainInfo(data);

        // 6. Security Barcode & Footer
        drawFooterSecurity(data);

        // 7. Card Border Outline
        ctx.restore();
        ctx.save();
        drawRoundedRect(ctx, 2, 2, CARD_WIDTH - 4, CARD_HEIGHT - 4, borderRadius);
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = data.accentColor;
        ctx.stroke();
        ctx.restore();
    }

    // --- Sub-renderers ---

    function drawHeaderBanner(data) {
        ctx.save();

        const bannerHeight = 165;
        const bannerRightX = CARD_WIDTH * 0.65;
        const bannerCutX = CARD_WIDTH * 0.57;

        // 1. Banner Angled Background (Solid Black)
        ctx.fillStyle = '#11161d';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(bannerRightX, 0);
        ctx.lineTo(bannerCutX, bannerHeight);
        ctx.lineTo(0, bannerHeight);
        ctx.closePath();
        ctx.fill();

        // 2. Top Accent Stripe along top of card
        ctx.fillStyle = data.accentColor;
        ctx.fillRect(0, 0, bannerRightX, 8);

        // 3. Accent colored angled right slash edge line
        ctx.strokeStyle = data.accentColor;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(bannerRightX, 0);
        ctx.lineTo(bannerCutX, bannerHeight);
        ctx.stroke();

        // 4. Header Title (Issuer / Tournament Name - Pure White)
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 48px "Noto Sans TC", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`🏐  ${data.associationName}`, 60, 70);

        // 5. English Subtitle (Accent Color, e.g. Purple)
        ctx.font = '700 24px "Orbitron", sans-serif';
        ctx.fillStyle = data.accentColor;
        ctx.fillText('OFFICIAL ATHLETE IDENTIFICATION CARD', 60, 122);

        // 6. Right side badge
        ctx.fillStyle = data.textColor || '#111111';
        ctx.font = 'bold 36px "Orbitron", "Noto Sans TC", sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('【 排球選手證 】', CARD_WIDTH - 60, 75);

        ctx.restore();
    }

    function drawTeamLogoSquareSection(data, activeLogoImg) {
        const pX = 1040;
        const pY = 240;
        const pW = 760;
        const pH = 760; // 1:1 Square
        const pRadius = 24;

        ctx.save();

        // Drop shadow for outer frame
        ctx.shadowColor = 'rgba(0,0,0,0.12)';
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#ffffff';
        drawRoundedRect(ctx, pX - 4, pY - 4, pW + 8, pH + 8, pRadius + 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.beginPath();
        drawRoundedRect(ctx, pX, pY, pW, pH, pRadius);
        ctx.clip();

        // Effective logo: passed logoImg > userTeamLogoImg > teamLogoCache for teamName
        const logoImg = activeLogoImg || userTeamLogoImg || getCachedLogoForTeam(data.teamName);

        // Fill background inside square frame with clean White
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(pX, pY, pW, pH);

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
        } else {
            drawDefaultTeamCrest(pX, pY, pW, data.accentColor);
        }

        // Clean crisp border outline
        ctx.strokeStyle = data.accentColor;
        ctx.lineWidth = 4;
        drawRoundedRect(ctx, pX, pY, pW, pH, pRadius);
        ctx.stroke();

        ctx.restore();
    }

    function drawDefaultTeamCrest(x, y, size, accent) {
        ctx.save();
        const cx = x + size / 2;
        const cy = y + size / 2;

        const avBg = ctx.createLinearGradient(x, y, x + size, y + size);
        avBg.addColorStop(0, '#161c28');
        avBg.addColorStop(1, '#0c1018');
        ctx.fillStyle = avBg;
        ctx.fillRect(x, y, size, size);

        // Tech grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.lineWidth = 1.5;
        for (let i = 80; i < size; i += 80) {
            ctx.beginPath();
            ctx.moveTo(x + i, y);
            ctx.lineTo(x + i, y + size);
            ctx.moveTo(x, y + i);
            ctx.lineTo(x + size, y + i);
            ctx.stroke();
        }

        // Concentric tech circles
        ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.strokeStyle = rgbaColor(accent, 0.5);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy - 25, size * 0.32, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = rgbaColor(accent, 0.2);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy - 25, size * 0.40, 0, Math.PI * 2);
        ctx.stroke();

        // Volleyball icon
        ctx.fillStyle = rgbaColor(accent, 0.95);
        ctx.font = `bold ${Math.round(size * 0.32)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🏐', cx, cy - 28);

        // Clean label
        ctx.fillStyle = '#ffffff';
        ctx.font = `900 ${Math.round(size * 0.048)}px "Orbitron", sans-serif`;
        ctx.fillText('TEAM CREST / LOGO', cx, cy + size * 0.24);

        ctx.fillStyle = rgbaColor(accent, 0.8);
        ctx.font = `600 ${Math.round(size * 0.032)}px "Orbitron", sans-serif`;
        ctx.fillText('1:1 SQUARE OFFICIAL FORMAT', cx, cy + size * 0.31);

        ctx.restore();
    }

    function drawMainInfo(data) {
        ctx.save();

        const numX = 70;
        const numY = 220;
        const numH = 195;

        // 1. Enlarge Jersey Number Badge Background Width (#03)
        const numStr = '#' + data.jerseyNumber;
        let numW = 310;
        if (numStr.length >= 4) numW = 340;

        ctx.fillStyle = data.accentColor;
        drawRoundedRect(ctx, numX, numY, numW, numH, 28);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = '900 102px "Orbitron", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(numStr, numX + numW / 2, numY + numH / 2);

        // 2. Enlarge Player Name Block (Vertically Centered with Badge)
        const contentX = numX + numW + 35;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        ctx.fillStyle = data.textColor || '#111111';
        let nameFontSize = 115;
        ctx.font = `900 ${nameFontSize}px "Noto Sans TC", "Outfit", sans-serif`;
        const maxNameW = 1000 - contentX;
        while (ctx.measureText(data.playerName).width > maxNameW && nameFontSize > 60) {
            nameFontSize -= 1;
            ctx.font = `900 ${nameFontSize}px "Noto Sans TC", "Outfit", sans-serif`;
        }
        ctx.fillText(data.playerName, contentX, numY + numH / 2);

        // 3. Team Name Box (Balanced Height: 260px)
        const teamY = 450;
        const teamW = 920;
        const teamH = 260;

        // Solid opaque background (RGB 242/234/248 for Shiratorizawa)
        ctx.fillStyle = getSolidPastelColor(data.accentColor);
        ctx.strokeStyle = rgbaColor(data.accentColor, 0.55);
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, numX, teamY, teamW, teamH, 24);
        ctx.fill();
        ctx.stroke();

        // Accent strip on left of Team Box
        ctx.fillStyle = data.accentColor;
        drawRoundedRect(ctx, numX, teamY, 12, teamH, 6);
        ctx.fill();

        // Line 1: Header Label (TEAM NAME / 隊伍名稱)
        ctx.fillStyle = data.accentColor;
        ctx.font = 'bold 22px "Orbitron", "Noto Sans TC", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('TEAM NAME / 隊伍名稱', numX + 40, teamY + 35);

        // Line 2: Actual Team Name (Maintains consistent 66px font size)
        ctx.fillStyle = data.textColor || '#111111';
        let teamFontSize = 66;
        ctx.font = `900 ${teamFontSize}px "Noto Sans TC", "Outfit", sans-serif`;
        const maxTeamW = teamW - 80;
        while (ctx.measureText(data.teamName).width > maxTeamW && teamFontSize > 36) {
            teamFontSize -= 1;
            ctx.font = `900 ${teamFontSize}px "Noto Sans TC", "Outfit", sans-serif`;
        }
        ctx.fillText(data.teamName, numX + 40, teamY + 88);

        // Line 3: Subtitle / Squad decoration
        ctx.fillStyle = rgbaColor(data.textColor || '#111111', 0.5);
        ctx.font = '700 16px "Orbitron", sans-serif';
        ctx.fillText('OFFICIAL REGISTERED ATHLETE SQUAD', numX + 40, teamY + 195);

        ctx.restore();
    }

    function drawFooterSecurity(data) {
        ctx.save();

        const numX = 70;
        const footerY = 740;

        // 1. Render Barcode & ID Number (Left Column, x = 70)
        const idStr = data.idNumber || 'NMB-2026-0905';
        drawBarcode(ctx, numX, footerY + 8, 250, 78, idStr, data.textColor || '#111111');

        ctx.fillStyle = data.textColor || '#111111';
        ctx.font = '700 22px "Orbitron", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('ID: ' + idStr, numX, footerY + 98);

        // 2. Middle Validity Info (x = 355) - Enlarged Date
        const infoX = 355;
        ctx.textAlign = 'left';

        // Line 1: VALID THRU label
        ctx.fillStyle = data.accentColor;
        ctx.font = '700 20px "Orbitron", sans-serif';
        ctx.fillText('VALID THRU', infoX, footerY + 12);

        // Line 2: Prominently Enlarged Date Value (Font 40px)
        ctx.fillStyle = data.textColor || '#111111';
        ctx.font = '900 40px "Orbitron", sans-serif';
        ctx.fillText(data.validThru || '2026/09/05', infoX, footerY + 48);

        // 3. Fixed NVA Seal Badge Circle (Centered at x = 880, y = 800)
        const jvaX = 880;
        const jvaY = footerY + 60;
        
        ctx.strokeStyle = data.accentColor;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(jvaX, jvaY, 44, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = rgbaColor(data.accentColor, 0.50);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(jvaX, jvaY, 36, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = data.accentColor;
        ctx.font = '900 30px "Orbitron", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('NVA', jvaX, jvaY);

        // 4. Enlarged Full-Width Dedicated Bottom Location Capsule (x = 70, y = 875, w = 920, h = 92)
        const locY = 875;
        const locW = 920;
        const locH = 92;

        // Solid opaque background (RGB 242/234/248 for Shiratorizawa)
        ctx.fillStyle = getSolidPastelColor(data.accentColor);
        ctx.strokeStyle = rgbaColor(data.accentColor, 0.55);
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, numX, locY, locW, locH, 20);
        ctx.fill();
        ctx.stroke();

        // Location text processing
        let rawLoc = data.footerNote2 || 'NVA Club House 排球俱樂部';
        
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        // Prominently Enlarged LOCATION Tag
        ctx.fillStyle = data.accentColor;
        ctx.font = '900 24px "Orbitron", sans-serif';
        ctx.fillText('LOCATION', numX + 26, locY + locH / 2);

        // Vertical Divider
        ctx.fillStyle = rgbaColor(data.textColor || '#111111', 0.25);
        ctx.fillRect(numX + 180, locY + 16, 2, locH - 32);

        // Prominently Enlarged Address / Club House String (Font 34px)
        let addrStr = rawLoc.replace(/^Location:\s*/i, '').trim();
        ctx.fillStyle = data.textColor || '#111111';
        let addrFontSize = 34;
        ctx.font = `900 ${addrFontSize}px "Noto Sans TC", "Outfit", sans-serif`;

        const maxAddrW = locW - 220;
        while (ctx.measureText(addrStr).width > maxAddrW && addrFontSize > 16) {
            addrFontSize -= 1;
            ctx.font = `900 ${addrFontSize}px "Noto Sans TC", "Outfit", sans-serif`;
        }

        ctx.fillText(addrStr, numX + 202, locY + locH / 2);

        ctx.restore();
    }

    function drawBackgroundPattern(patternType, accentColor) {
        ctx.save();

        // Significantly enhanced opacity & line weight for high visibility
        ctx.strokeStyle = rgbaColor(accentColor, 0.22);
        ctx.fillStyle = rgbaColor(accentColor, 0.16);
        ctx.lineWidth = 3.5;

        if (patternType === 'volleyball') {
            const cx = CARD_WIDTH * 0.35;
            const cy = CARD_HEIGHT * 0.6;
            ctx.lineWidth = 4;
            ctx.strokeStyle = rgbaColor(accentColor, 0.22);
            for (let r = 180; r <= 1100; r += 140) {
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.stroke();
            }
        } else if (patternType === 'stripes') {
            // High-energy dynamic diagonal speed lines
            ctx.lineWidth = 4;
            ctx.strokeStyle = rgbaColor(accentColor, 0.24);
            for (let x = -CARD_HEIGHT * 1.5; x < CARD_WIDTH * 1.5; x += 55) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x + CARD_HEIGHT * 1.2, CARD_HEIGHT);
                ctx.stroke();
            }

            // Accent thick bars
            ctx.lineWidth = 10;
            ctx.strokeStyle = rgbaColor(accentColor, 0.14);
            for (let x = -CARD_HEIGHT * 1.5; x < CARD_WIDTH * 1.5; x += 220) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x + CARD_HEIGHT * 1.2, CARD_HEIGHT);
                ctx.stroke();
            }

        } else if (patternType === 'dots') {
            // Bold high-tech matrix dot grid
            ctx.fillStyle = rgbaColor(accentColor, 0.25);
            for (let x = 45; x < CARD_WIDTH; x += 50) {
                for (let y = 45; y < CARD_HEIGHT; y += 50) {
                    ctx.beginPath();
                    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // Target crosshairs in tech matrix
            ctx.strokeStyle = rgbaColor(accentColor, 0.30);
            ctx.lineWidth = 2;
            for (let x = 145; x < CARD_WIDTH; x += 250) {
                for (let y = 145; y < CARD_HEIGHT; y += 250) {
                    ctx.beginPath();
                    ctx.arc(x, y, 14, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }
        }

        ctx.restore();
    }

    function drawBarcode(ctx, x, y, width, height, text, color = '#111111') {
        ctx.fillStyle = color;
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            hash = (hash << 5) - hash + text.charCodeAt(i);
            hash |= 0;
        }

        const barCount = 42;
        const unitW = width / barCount;
        let currX = x;

        for (let i = 0; i < barCount; i++) {
            const barW = ((i + Math.abs(hash)) % 3 + 1) * (unitW * 0.5);
            if (i % 2 === 0) {
                ctx.fillRect(currX, y, barW, height);
            }
            currX += barW + (unitW * 0.4);
            if (currX >= x + width) break;
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

    function getFormData() {
        return {
            playerName: fields.playerName ? fields.playerName.value : DEFAULT_DATA.playerName,
            teamName: fields.teamName ? fields.teamName.value : DEFAULT_DATA.teamName,
            jerseyNumber: fields.jerseyNumber ? fields.jerseyNumber.value : DEFAULT_DATA.jerseyNumber,
            idNumber: fields.idNumber ? fields.idNumber.value : DEFAULT_DATA.idNumber,
            associationName: fields.associationName ? fields.associationName.value : DEFAULT_DATA.associationName,
            validThru: fields.validThru ? fields.validThru.value : DEFAULT_DATA.validThru,
            footerNote2: fields.footerNote2 ? fields.footerNote2.value : DEFAULT_DATA.footerNote2,
            primaryColor: fields.primaryColor.value,
            accentColor: fields.accentColor.value,
            textColor: fields.textColor ? fields.textColor.value : (DEFAULT_DATA.textColor || '#111111'),
            cardPattern: fields.cardPattern.value,
            cardBorderRadius: fields.cardBorderRadius.value,
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

        const presetBtns = document.querySelectorAll('.preset-btn');
        presetBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                presetBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const presetKey = btn.getAttribute('data-preset');
                if (PRESETS[presetKey]) {
                    fields.primaryColor.value = PRESETS[presetKey].primary;
                    fields.accentColor.value = PRESETS[presetKey].accent;
                    if (fields.textColor && PRESETS[presetKey].text) {
                        fields.textColor.value = PRESETS[presetKey].text;
                    }
                    renderCard();
                }
            });
        });
    }

    function initFileUploads() {
        const photoInput = document.getElementById('photoUpload');
        if (photoInput) {
            photoInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const img = new Image();
                        img.onload = () => {
                            userPhotoImg = img;
                            renderCard();
                        };
                        img.src = event.target.result;
                    };
                    reader.readAsDataURL(file);
                }
            });
        }

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
                    const cardData = {
                        ...baseForm,
                        playerName: item.playerName,
                        teamName: item.teamName,
                        jerseyNumber: item.jerseyNumber,
                        idNumber: baseForm.idNumber || 'NMB-2026-0905'
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
            fields.primaryColor.value = DEFAULT_DATA.primaryColor;
            fields.accentColor.value = DEFAULT_DATA.accentColor;
            if (fields.textColor) fields.textColor.value = DEFAULT_DATA.textColor;
            fields.cardPattern.value = DEFAULT_DATA.cardPattern;
            fields.cardBorderRadius.value = DEFAULT_DATA.cardBorderRadius;
            fields.photoZoom.value = DEFAULT_DATA.photoZoom;
            fields.photoOffsetX.value = DEFAULT_DATA.photoOffsetX;
            fields.photoOffsetY.value = DEFAULT_DATA.photoOffsetY;
            fields.zoomVal.innerText = '100%';

            userTeamLogoImg = getCachedLogoForTeam(DEFAULT_DATA.teamName);
            const logoEl = document.getElementById('teamLogoUpload');
            if (logoEl) logoEl.value = '';

            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            const defaultPresetBtn = document.querySelector('.preset-btn[data-preset="karasuno"]');
            if (defaultPresetBtn) defaultPresetBtn.classList.add('active');

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
    // Utility Helpers
    // ==========================================

    function drawRoundedRect(ctx, x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function rgbaColor(hex, alpha) {
        const c = hex.replace('#', '');
        let r, g, b;
        if (c.length === 3) {
            r = parseInt(c[0] + c[0], 16);
            g = parseInt(c[1] + c[1], 16);
            b = parseInt(c[2] + c[2], 16);
        } else {
            r = parseInt(c.substring(0, 2), 16);
            g = parseInt(c.substring(2, 4), 16);
            b = parseInt(c.substring(4, 6), 16);
        }
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function adjustColor(hex, percent) {
        let num = parseInt(hex.replace('#', ''), 16);
        let amt = Math.round(2.55 * percent);
        let R = (num >> 16) + amt;
        let G = (num >> 8 & 0x00FF) + amt;
        let B = (num & 0x0000FF) + amt;
        return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 + (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 + (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
    }

    function getSolidPastelColor(hexColor) {
        if (!hexColor || hexColor.length < 7) return 'rgb(242, 234, 248)';
        if (hexColor.toLowerCase() === '#501898') return 'rgb(242, 234, 248)';
        const r = parseInt(hexColor.slice(1, 3), 16) || 0;
        const g = parseInt(hexColor.slice(3, 5), 16) || 0;
        const b = parseInt(hexColor.slice(5, 7), 16) || 0;
        const pr = Math.min(255, Math.round(r * 0.07 + 255 * 0.93));
        const pg = Math.min(255, Math.round(g * 0.07 + 255 * 0.93));
        const pb = Math.min(255, Math.round(b * 0.07 + 255 * 0.93));
        return `rgb(${pr}, ${pg}, ${pb})`;
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

    // Auto load server logos and render
    loadAllTeamLogosFromServer().then(() => {
        renderCard();
    });

    renderCard();
});
