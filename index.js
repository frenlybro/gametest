// index.js – Worms-style duel (with @telegram-apps/sdk)
import { init, miniApp, viewport, swipeBehavior, isTMA, postEvent } from '@telegram-apps/sdk';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const turnIndicator = document.getElementById('turnIndicator');
const statusMsg = document.getElementById('statusMsg');

// ---- dimensions ----
const W = 800, H = 400;
const GROUND_Y = 340;

// ---- canvas sizing ----
function getViewportSize() {
    if (isTMA() && viewport.isMounted()) {
        return { width: viewport.width() || window.innerWidth, height: viewport.height() || window.innerHeight };
    }
    return { width: window.innerWidth, height: window.innerHeight };
}

function resizeCanvas() {
    const vp = getViewportSize();
    const vw = vp.width;
    const vh = vp.height;
    const scale = Math.max(vw / W, vh / H);
    const cw = Math.ceil(W * scale);
    const ch = Math.ceil(H * scale);
    canvas.width = cw;
    canvas.height = ch;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const displayScale = Math.min(cw / W, ch / H);
    ctx.scale(displayScale, displayScale);
    draw();
}
window.addEventListener('resize', resizeCanvas);

const GRAVITY = 0.25;
const MAX_POWER = 22;
const POWER_BAR_WIDTH = 140;
const POWER_BAR_HEIGHT = 12;
const POWER_BAR_X = W / 2 - POWER_BAR_WIDTH / 2;
const POWER_BAR_Y = 20;

// ---- terrain ----
const TERRAIN_TYPES = ['rust', 'crimson', 'ember'];
const TERRAIN_COLORS = {
    rust:    { base: '#a0522d', top: '#cd853f', blade: '#8b4513', shadow: '#5c2a1a' },
    crimson: { base: '#b22222', top: '#dc3535', blade: '#8b1a1a', shadow: '#4a1a1a' },
    ember:   { base: '#d2691e', top: '#e8832a', blade: '#a0522d', shadow: '#5c3a2a' }
};

let terrain = { type: 'rust', colors: TERRAIN_COLORS.rust, heights: [] };

function generateTerrain(type) {
    terrain.type = type;
    terrain.colors = TERRAIN_COLORS[type];
    terrain.heights = [];

    const seed = (type.charCodeAt(0) * 1000 + Math.floor(Math.random() * 9999));
    const rng = mulberry32(seed);
    const baseFreq1 = 0.0015 + rng() * 0.0012;
    const baseFreq2 = 0.0030 + rng() * 0.0020;
    const offset1 = rng() * Math.PI * 2;
    const offset2 = rng() * Math.PI * 2;
    const baseAmp = 0.04 + rng() * 0.04;
    const hillCount = 2 + Math.floor(rng() * 4);
    const hills = [];
    for (let i = 0; i < hillCount; i++) {
        const cx = (W / hillCount) * (i + 0.5) + (rng() - 0.5) * (W / hillCount) * 0.6;
        const peakHeight = 0.40 + rng() * 0.20;
        const halfWidth = 40 + rng() * 80;
        hills.push({ cx, peakHeight, halfWidth });
    }

    for (let x = 0; x < W; x++) {
        let h = 0.05 + rng() * 0.05;
        h += Math.sin(x * baseFreq1 + offset1) * baseAmp;
        h += Math.sin(x * baseFreq2 + offset2) * baseAmp * 0.5;
        for (const hill of hills) {
            const dist = Math.abs(x - hill.cx);
            const gauss = Math.exp(-(dist * dist) / (2 * hill.halfWidth * hill.halfWidth));
            h += gauss * (hill.peakHeight - h);
        }
        h += Math.sin(x * 0.025 + rng()) * 0.02;
        h += Math.sin(x * 0.045 + rng() * 2) * 0.015;
        h = Math.max(0.03, Math.min(0.60, h));
        terrain.heights.push(h);
    }
    for (let pass = 0; pass < 2; pass++)
        for (let x = 1; x < W - 1; x++)
            terrain.heights[x] = (terrain.heights[x-1] + terrain.heights[x] + terrain.heights[x+1]) / 3;
    for (let x = 0; x < W; x++)
        terrain.heights[x] = Math.max(0.03, Math.min(0.60, terrain.heights[x]));
}

function mulberry32(a) {
    return function() {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

function getTerrainYAt(x) {
    const xi = Math.max(0, Math.min(Math.floor(x), W - 1));
    return H - (terrain.heights[xi] || 0.0) * H;
}

const players = {
    p1: { x: 100, y: GROUND_Y - 19.2, radius: 18, color: '#db3a3a', shadow: '#8f1f1f', alive: true, wins: 0, facingRight: true },
    p2: { x: 700, y: GROUND_Y - 19.2, radius: 18, color: '#3a7bd5', shadow: '#1f4f8f', alive: true, wins: 0 }
};

let projectile = { active: false, x: 0, y: 0, vx: 0, vy: 0, radius: 6, trail: [] };
let aiming = false, aimAngle = 0, aimPower = 0;
let lastMoveClickTime = null;
const DOUBLE_CLICK_MS = 400, P1_MAX_X = W * 0.45, P2_MIN_X = W * 0.55;
let moveAnim = null, currentPlayer = 'p1', gameOver = false, turnLock = false;

function getOpponent(id) { return id === 'p1' ? 'p2' : 'p1'; }

function resetRound() {
    const type = TERRAIN_TYPES[Math.floor(Math.random() * TERRAIN_TYPES.length)];
    generateTerrain(type);
    players.p1.x = 100; players.p1.y = getTerrainYAt(100) - 19.2; players.p1.alive = true;
    players.p2.x = 700; players.p2.y = getTerrainYAt(700) - 19.2; players.p2.alive = true;
    projectile.active = false; projectile.trail = [];
    gameOver = false; turnLock = false; aiming = false;
    currentPlayer = 'p1';
    updateTurnUI();
    loadRandomBackground();
    statusMsg.innerText = `🗺️ ${type} terrain`;
    draw();
}

function fullReset() { players.p1.wins = 0; players.p2.wins = 0; resetRound(); }

function updateTurnUI() {
    turnIndicator.innerText = `▶ ${currentPlayer === 'p1' ? 'P1' : 'P2'}`;
    turnIndicator.style.color = currentPlayer === 'p1' ? '#db3a3a' : '#3a7bd5';
}

let bgImage = null, bgImageLoaded = false;
let playerImg = null, playerImgLoaded = false;
let player2Img = null, player2ImgLoaded = false;
let dirtImg = null, dirtImgLoaded = false, dirtPattern = null;
const DIRT_TILE_SIZE = 100;

function loadDirtImage() {
    dirtImgLoaded = false; dirtImg = new Image();
    dirtImg.onload = () => {
        const tileW = DIRT_TILE_SIZE;
        const tileH = Math.round(tileW * dirtImg.naturalHeight / dirtImg.naturalWidth);
        const offC = document.createElement('canvas'); offC.width = tileW; offC.height = tileH;
        offC.getContext('2d').drawImage(dirtImg, 0, 0, tileW, tileH);
        dirtPattern = ctx.createPattern(offC, 'repeat'); dirtImgLoaded = true; draw();
    };
    dirtImg.onerror = () => { dirtImgLoaded = false; };
    dirtImg.src = `backgrounds/${['dirt.jpg','dirt2.jpg'][Math.floor(Math.random()*2)]}?v=1.0.1`;
}

function loadPlayerImage() {
    playerImgLoaded = false; playerImg = new Image();
    playerImg.onload = () => { playerImgLoaded = true; draw(); };
    playerImg.onerror = () => { playerImgLoaded = false; };
    playerImg.src = 'backgrounds/player1.png?v=1.0.1';
}

function loadPlayer2Image() {
    player2ImgLoaded = false; player2Img = new Image();
    player2Img.onload = () => { player2ImgLoaded = true; draw(); };
    player2Img.onerror = () => { player2ImgLoaded = false; };
    player2Img.src = 'backgrounds/player2.png?v=1.0.1';
}

function loadRandomBackground() {
    bgImageLoaded = false; bgImage = new Image();
    bgImage.onload = () => { bgImageLoaded = true; draw(); };
    bgImage.onerror = () => { bgImageLoaded = false; draw(); };
    bgImage.src = `backgrounds/bg1.jpg?v=${Date.now()}`;
}

function drawSky() {
    if (bgImageLoaded && bgImage.complete && bgImage.naturalWidth > 0) {
        const imgRatio = bgImage.naturalWidth / bgImage.naturalHeight;
        const canvasRatio = W / H;
        let drawW, drawH, offX, offY;
        if (imgRatio > canvasRatio) { drawH = H; drawW = H * imgRatio; offX = -(drawW - W) / 2; offY = 0; }
        else { drawW = W; drawH = W / imgRatio; offX = 0; offY = -(drawH - H) / 2; }
        ctx.drawImage(bgImage, offX, offY, drawW, drawH);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, W, H);
    } else {
        const colors = { rust: ['#f4e4c1','#d4a574'], crimson: ['#f0c0c0','#c88080'], ember: ['#fce4c8','#e0a060'] };
        const [top, bottom] = colors[terrain.type] || colors.rust;
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, top); grad.addColorStop(1, bottom);
        ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    }
}

function drawTerrain() {
    const c = terrain.colors;
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 2) ctx.lineTo(x, getTerrainYAt(x));
    ctx.lineTo(W, H); ctx.closePath();
    if (dirtImgLoaded && dirtPattern) {
        ctx.fillStyle = dirtPattern; ctx.fill();
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, 'rgba(255,255,255,0.15)'); g.addColorStop(0.5, 'rgba(0,0,0,0.08)'); g.addColorStop(1, 'rgba(0,0,0,0.15)');
        ctx.fillStyle = g; ctx.fill();
    } else {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, c.top); g.addColorStop(0.5, c.base); g.addColorStop(1, c.shadow);
        ctx.fillStyle = g; ctx.fill();
    }
    // surface lines
    ctx.strokeStyle = c.blade; ctx.lineWidth = 1; ctx.globalAlpha = 0.4;
    for (let x = 0; x < W; x += 18) { const y = getTerrainYAt(x); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x-1, y-3); ctx.stroke(); }
    ctx.globalAlpha = 1;
    // type-specific details
    if (terrain.type === 'rust') {
        ctx.fillStyle = '#8b4513'; ctx.globalAlpha = 0.3;
        for (let i = 0; i < 60; i++) { const sx = (i * 137.5) % W; const sy = getTerrainYAt(sx) - 2 - (i%6); ctx.beginPath(); ctx.arc(sx, sy, 1+(i%3), 0, Math.PI*2); ctx.fill(); }
        ctx.globalAlpha = 1;
    } else if (terrain.type === 'crimson') {
        ctx.fillStyle = '#dc3535'; ctx.globalAlpha = 0.4;
        for (let i = 0; i < 50; i++) { const sx = (i * 97.3) % W; const sy = getTerrainYAt(sx) - 3 - (i%10); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx+2, sy-6); ctx.lineTo(sx+4, sy); ctx.fill(); }
        ctx.globalAlpha = 1;
    } else if (terrain.type === 'ember') {
        ctx.fillStyle = '#ff8c42'; ctx.globalAlpha = 0.6;
        for (let i = 0; i < 70; i++) { const sx = (i * 111.7) % W; const sy = getTerrainYAt(sx) - 2 - (i%8); ctx.beginPath(); ctx.arc(sx, sy, 1.2, 0, Math.PI*2); ctx.fill(); }
        ctx.globalAlpha = 1;
    }
}

function draw() {
    ctx.clearRect(0, 0, W, H);
    drawSky();
    drawTerrain();

    for (const [id, p] of Object.entries(players)) {
        if (!p.alive) continue;
        const dir = id === 'p1' ? 1 : -1;
        const img = id === 'p1' ? playerImg : player2Img;
        const imgLoaded = id === 'p1' ? playerImgLoaded : player2ImgLoaded;

        if (imgLoaded && img.complete && img.naturalWidth > 0) {
            ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; ctx.imageSmoothingEnabled = false;
            let facingRight = p.facingRight !== undefined ? p.facingRight : (id === 'p1');
            if (moveAnim && moveAnim.shooter === p) { facingRight = (id === 'p1') === (moveAnim.toX >= moveAnim.fromX); p.facingRight = facingRight; }
            else p.facingRight = true;
            const maxSize = p.radius * 2;
            const imgAspect = img.naturalWidth / img.naturalHeight;
            const drawW = imgAspect > 1 ? maxSize : maxSize * imgAspect;
            const drawH = imgAspect > 1 ? maxSize / imgAspect : maxSize;
            const offX = p.x - drawW / 2, offY = p.y - drawH / 2;
            if (!facingRight) { ctx.save(); ctx.translate(p.x, p.y - drawH / 2); ctx.scale(-1, 1); ctx.drawImage(img, -drawW / 2, 0, drawW, drawH); ctx.restore(); }
            else ctx.drawImage(img, offX, offY, drawW, drawH);
            ctx.shadowBlur = 0; ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 5;
            ctx.beginPath(); ctx.moveTo(p.x + dir * 10, p.y - 4); ctx.lineTo(p.x + dir * 24, p.y - 10); ctx.stroke();
            ctx.fillStyle = '#3d3d3d'; ctx.beginPath(); ctx.arc(p.x + dir * 24, p.y - 10, 5, 0, Math.PI*2); ctx.fill();
        } else {
            ctx.shadowColor = p.shadow; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI*2); ctx.fillStyle = p.color; ctx.fill();
            ctx.shadowBlur = 0; ctx.fillStyle = 'white';
            ctx.beginPath(); ctx.arc(p.x-6, p.y-7, 5, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(p.x+6, p.y-7, 5, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#1f2a1f';
            ctx.beginPath(); ctx.arc(p.x-8, p.y-9, 2.5, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(p.x+4, p.y-9, 2.5, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 5;
            ctx.beginPath(); ctx.moveTo(p.x + dir * 10, p.y - 4); ctx.lineTo(p.x + dir * 24, p.y - 10); ctx.stroke();
            ctx.fillStyle = '#3d3d3d'; ctx.beginPath(); ctx.arc(p.x + dir * 24, p.y - 10, 5, 0, Math.PI*2); ctx.fill();
        }
    }

    if (aiming) {
        const shooter = players[currentPlayer];
        if (shooter.alive) {
            const startX = shooter.x + Math.cos(aimAngle) * 24;
            const startY = shooter.y + Math.sin(aimAngle) * 24 - 6;
            const endX = startX + Math.cos(aimAngle) * (20 + aimPower * 12);
            const endY = startY + Math.sin(aimAngle) * (20 + aimPower * 12);
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,200,0.7)'; ctx.lineWidth = 3; ctx.setLineDash([6,6]);
            ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(endX, endY); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(255,255,200,0.8)'; ctx.beginPath(); ctx.arc(endX, endY, 5, 0, Math.PI*2); ctx.fill();
            const pf = aimPower / MAX_POWER;
            ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.roundRect(POWER_BAR_X-2, POWER_BAR_Y-2, POWER_BAR_WIDTH+4, POWER_BAR_HEIGHT+4, 4); ctx.fill();
            ctx.fillStyle = '#f0f7d8'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('POWER', W/2, POWER_BAR_Y-6); ctx.textAlign = 'left';
            ctx.fillStyle = 'rgba(30,30,30,0.6)'; ctx.roundRect(POWER_BAR_X, POWER_BAR_Y, POWER_BAR_WIDTH, POWER_BAR_HEIGHT, 3); ctx.fill();
            ctx.fillStyle = pf < 0.33 ? '#7ae07a' : pf < 0.66 ? '#e0d07a' : '#e07a7a';
            ctx.roundRect(POWER_BAR_X, POWER_BAR_Y, POWER_BAR_WIDTH * pf, POWER_BAR_HEIGHT, 3); ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.roundRect(POWER_BAR_X, POWER_BAR_Y, POWER_BAR_WIDTH, POWER_BAR_HEIGHT, 3); ctx.stroke();
            ctx.restore();
        }
    }

    if (projectile.active || projectile.trail.length > 0) {
        for (let i = 0; i < projectile.trail.length; i++) {
            const t = projectile.trail[i];
            ctx.beginPath(); ctx.arc(t.x, t.y, projectile.radius * 0.7, 0, Math.PI*2);
            ctx.fillStyle = `rgba(255,220,80,${(0.25+0.6*(i/projectile.trail.length))*0.6})`; ctx.fill();
        }
        if (projectile.active) {
            ctx.shadowBlur = 20; ctx.shadowColor = '#ffcc44';
            ctx.beginPath(); ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI*2); ctx.fillStyle = '#f5d742'; ctx.fill();
            ctx.shadowBlur = 8; ctx.fillStyle = '#ffb82b'; ctx.beginPath(); ctx.arc(projectile.x-2, projectile.y-2, 3, 0, Math.PI*2); ctx.fill();
        }
    }

    if (gameOver) {
        ctx.shadowBlur = 14; ctx.shadowColor = 'black';
        ctx.font = 'bold 44px sans-serif'; ctx.fillStyle = '#f7f2c0'; ctx.textAlign = 'center';
        ctx.fillText('💥 GAME OVER', W/2, 120);
        ctx.font = 'bold 24px sans-serif'; ctx.fillStyle = '#e6e0b0';
        ctx.fillText(`${players.p1.alive ? 'Player 1' : 'Player 2'} wins!`, W/2, 170);
        ctx.textAlign = 'left';
    }
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
}

CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    if (w < 2*r) r = w/2; if (h < 2*r) r = h/2;
    this.beginPath(); this.moveTo(x+r, y); this.lineTo(x+w-r, y); this.quadraticCurveTo(x+w, y, x+w, y+r);
    this.lineTo(x+w, y+h-r); this.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    this.lineTo(x+r, y+h); this.quadraticCurveTo(x, y+h, x, y+h-r);
    this.lineTo(x, y+r); this.quadraticCurveTo(x, y, x+r, y); this.closePath(); return this;
};

function fireProjectile() {
    if (gameOver || turnLock || !aiming) return false;
    const shooter = players[currentPlayer];
    if (!shooter.alive) return false;
    if (aimPower < 0.5) { statusMsg.innerText = '💨 too weak!'; aiming = false; draw(); return false; }
    projectile.x = shooter.x + Math.cos(aimAngle) * 24;
    projectile.y = shooter.y + Math.sin(aimAngle) * 24 - 6;
    projectile.vx = Math.cos(aimAngle) * aimPower;
    projectile.vy = Math.sin(aimAngle) * aimPower;
    projectile.active = true; projectile.trail = []; turnLock = true; aiming = false;
    statusMsg.innerText = `🎯 ${currentPlayer.toUpperCase()} fires!`; draw();
    const interval = setInterval(() => {
        if (!projectile.active || gameOver) { clearInterval(interval); if (gameOver) draw(); return; }
        projectile.trail.push({x:projectile.x, y:projectile.y});
        if (projectile.trail.length > 24) projectile.trail.shift();
        projectile.x += projectile.vx; projectile.y += projectile.vy; projectile.vy += GRAVITY;
        if (projectile.x - projectile.radius < 0) { projectile.x = projectile.radius; projectile.vx *= -0.6; }
        else if (projectile.x + projectile.radius > W) { projectile.x = W - projectile.radius; projectile.vx *= -0.6; }
        const groundY = getTerrainYAt(projectile.x);
        if (projectile.y + projectile.radius > groundY) {
            projectile.y = groundY - projectile.radius; projectile.active = false; projectile.vx = 0; projectile.vy = 0;
            const opp = players[getOpponent(currentPlayer)];
            if (opp.alive && Math.hypot(projectile.x-opp.x, projectile.y-opp.y) < opp.radius+15)
                { opp.alive = false; gameOver = true; players[currentPlayer].wins += 1; statusMsg.innerText = `🏆 ${currentPlayer.toUpperCase()} wins!`; turnLock = true; draw(); return; }
            endTurn(); draw(); return;
        }
        for (const [id, p] of Object.entries(players)) {
            if (!p.alive) continue;
            if (Math.hypot(projectile.x-p.x, projectile.y-p.y) < p.radius+projectile.radius) {
                p.alive = false; projectile.active = false; gameOver = true;
                players[currentPlayer].wins += 1; statusMsg.innerText = `🏆 ${currentPlayer.toUpperCase()} wins!`; turnLock = true; draw(); return;
            }
        }
        if (projectile.y > H+50) { projectile.active = false; endTurn(); draw(); return; }
        draw();
    }, 20);
    return true;
}

function endTurn() {
    if (gameOver) return;
    currentPlayer = getOpponent(currentPlayer);
    if (!players[currentPlayer].alive) {
        const alive = players.p1.alive ? 'p1' : 'p2';
        gameOver = true; players[alive].wins += 1; statusMsg.innerText = `🏆 ${alive.toUpperCase()} wins!`; turnLock = true; draw(); return;
    }
    updateTurnUI(); turnLock = false;
    statusMsg.innerText = '👆 tap to aim, swipe for power, double tap to move'; draw();
}

function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX-rect.left) * (W/rect.width), y: (e.clientY-rect.top) * (H/rect.height) };
}

function animateMove(shooter, targetX) {
    const fromX = shooter.x;
    moveAnim = { shooter, fromX, toX: targetX, startedAt: performance.now(), duration: Math.abs(targetX-fromX)*8 };
    (function tick() {
        const t = Math.min((performance.now()-moveAnim.startedAt)/moveAnim.duration, 1);
        const eased = t < 1 ? 1-Math.pow(1-t,2) : 1;
        shooter.x = fromX + (targetX-fromX)*eased; shooter.y = getTerrainYAt(shooter.x)-19.2; draw();
        if (t < 1) requestAnimationFrame(tick);
        else { moveAnim = null; statusMsg.innerText = `🎯 ${currentPlayer.toUpperCase()} turn`; draw(); }
    })();
}

canvas.addEventListener('pointerdown', e => { e.preventDefault();
    if (gameOver||turnLock||moveAnim) return;
    const shooter = players[currentPlayer]; if (!shooter.alive) return;
    const pos = getCanvasCoords(e); const now = Date.now();
    const isDbl = lastMoveClickTime !== null && (now - lastMoveClickTime < DOUBLE_CLICK_MS);
    lastMoveClickTime = now;
    if (isDbl && pos.y > getTerrainYAt(pos.x)-40 && pos.y < getTerrainYAt(pos.x)+40) {
        const newX = currentPlayer === 'p1' ? Math.max(30, Math.min(P1_MAX_X, pos.x)) : Math.max(P2_MIN_X, Math.min(W-30, pos.x));
        statusMsg.innerText = `🚶 ${currentPlayer.toUpperCase()} moving`; animateMove(shooter, newX); return;
    }
    if (Math.hypot(pos.x-shooter.x, pos.y-shooter.y) < 10) return;
    aimAngle = Math.atan2(pos.y-shooter.y, pos.x-shooter.x); aimPower = 0; aiming = true;
    statusMsg.innerText = '🎯 point to aim'; draw();
});
canvas.addEventListener('pointermove', e => { e.preventDefault(); if (!aiming) return;
    const shooter = players[currentPlayer]; if (!shooter||!shooter.alive) return;
    const pos = getCanvasCoords(e);
    aimAngle = Math.atan2(pos.y-shooter.y, pos.x-shooter.x);
    aimPower = Math.min(MAX_POWER, Math.hypot(pos.x-shooter.x, pos.y-shooter.y)/18); draw();
});
canvas.addEventListener('pointerup', e => { e.preventDefault(); if (aiming) fireProjectile(); });
canvas.addEventListener('pointercancel', () => { if (aiming) fireProjectile(); });

document.getElementById('resetBtn').addEventListener('click', fullReset);

// ---- Telegram ----
async function initTelegram() {
    if (!isTMA()) return;
    init();
    await miniApp.mount();
    miniApp.ready();
    await viewport.mount();
    await viewport.expand();
    try { if (viewport.requestFullscreen.isAvailable()) await viewport.requestFullscreen(); }
    catch (e) { console.log('Fullscreen request failed:', e); }
    await swipeBehavior.mount();
    swipeBehavior.disableVerticalSwipes();
    postEvent('web_app_request_orientation_lock', { orientation: 'landscape' });
    postEvent('web_app_lock_orientation', { orientation: 'landscape' });
    try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); }
    catch (e) { console.log('NSO lock failed:', e); }
    viewport.on('change', resizeCanvas);
}

async function initGame() {
    await initTelegram();
    resizeCanvas();
    loadPlayerImage();
    loadPlayer2Image();
    loadDirtImage();
    resetRound();
}

initGame().catch(err => console.error('Game init failed:', err));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
window.addEventListener('keydown', e => { if (e.key === 'r'||e.key==='R') { fullReset(); e.preventDefault(); } });