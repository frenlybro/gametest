// index.js – Worms-style duel
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const turnIndicator = document.getElementById('turnIndicator');
const statusMsg = document.getElementById('statusMsg');

// ---- dimensions ----
const W = 800, H = 400;

// sharp rendering: upscale canvas internal resolution
const RENDER_SCALE = 2;
canvas.width = W * RENDER_SCALE;
canvas.height = H * RENDER_SCALE;
ctx.scale(RENDER_SCALE, RENDER_SCALE);
const GROUND_Y = 340;        // baseline ground level (used for player start)
const GRAVITY = 0.25;
const MAX_POWER = 22;
const POWER_BAR_WIDTH = 140;
const POWER_BAR_HEIGHT = 12;
const POWER_BAR_X = W / 2 - POWER_BAR_WIDTH / 2;
const POWER_BAR_Y = 20;

// ---- terrain types ----
const TERRAIN_TYPES = ['rust', 'crimson', 'ember'];
const TERRAIN_COLORS = {
    rust:    { base: '#a0522d', top: '#cd853f', blade: '#8b4513', rock: '#6b3a2a', shadow: '#5c2a1a' },
    crimson: { base: '#b22222', top: '#dc3535', blade: '#8b1a1a', rock: '#6b2a2a', shadow: '#4a1a1a' },
    ember:   { base: '#d2691e', top: '#e8832a', blade: '#a0522d', rock: '#7a4a3a', shadow: '#5c3a2a' }
};

// ---- terrain state ----
let terrain = {
    type: 'grass',
    colors: TERRAIN_COLORS.grass,
    heights: [],   // height[] per x column, 0..0.8 (0 = flat ground, 0.8 = 80% up from bottom)
    rocks: []      // {x, y, r}
};

// ---- generate terrain ----
function generateTerrain(type) {
    terrain.type = type;
    terrain.colors = TERRAIN_COLORS[type];
    terrain.heights = [];
    terrain.rocks = [];

    // Seed based on type + round for consistent randomness within a type
    const seed = (type.charCodeAt(0) * 1000 + Math.floor(Math.random() * 9999));
    const rng = mulberry32(seed);

    // Generate terrain: never flat, always rolling hills 25-80% height
    const terrainVariance = Math.pow(rng(), 0.5); // strong bias toward higher values
    const maxAmplitude = 0.25 + terrainVariance * 0.55; // min 25%, max 80%
    const ridgeFreq = 0.0015 + rng() * 0.002; // lower freq = broader, rounder hills
    const ridgeOffset = rng() * Math.PI * 2;

    for (let x = 0; x < W; x++) {
        let h = 0.15; // base so it's never flat

        // 5-7 overlapping sine waves for many curves
        h += Math.sin(x * ridgeFreq + ridgeOffset) * maxAmplitude * 0.55;
        h += Math.sin(x * ridgeFreq * 1.8 + ridgeOffset * 1.4) * maxAmplitude * 0.45;
        h += Math.sin(x * ridgeFreq * 2.6 + ridgeOffset * 2.1) * maxAmplitude * 0.35;
        h += Math.sin(x * ridgeFreq * 3.7 + ridgeOffset * 0.7) * maxAmplitude * 0.25;
        h += Math.sin(x * ridgeFreq * 5.2 + ridgeOffset * 1.9) * maxAmplitude * 0.2;
        h += Math.sin(x * ridgeFreq * 7.1 + ridgeOffset * 3.3) * maxAmplitude * 0.15;
        h += Math.sin(x * 0.025 + rng() * 6.28) * maxAmplitude * 0.08;

        // clamp to 0.1..0.8
        h = Math.max(0.1, Math.min(0.8, h));
        terrain.heights.push(h);
    }

    // Smooth heavily for roundness
    for (let pass = 0; pass < 8; pass++) {
        for (let x = 1; x < W - 1; x++) {
            terrain.heights[x] = (terrain.heights[x-1] + terrain.heights[x] + terrain.heights[x+1]) / 3;
        }
    }

    // Place rocks (10-25 rocks)
    const numRocks = 10 + Math.floor(rng() * 15);
    for (let i = 0; i < numRocks; i++) {
        const rx = rng() * (W - 40) + 20;
        const yi = Math.floor(rx);
        const rh = terrain.heights[Math.min(Math.max(yi, 0), W-1)];
        const ry = getTerrainYAt(rx);
        const rr = 3 + rng() * 12;
        // don't place rocks too close to players
        if ((rx < 160 && rx > 60) || (rx > 640 && rx < 740)) continue;
        terrain.rocks.push({ x: rx, y: ry, r: rr });
    }
}

// Simple seeded PRNG (mulberry32)
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
    const h = terrain.heights[xi] || 0.0;
    // h=0 -> bottom of screen (flat ground), h=0.8 -> 80% up from bottom
    return H - h * H;
}

// ---- player definitions ----
const players = {
    p1: {
        x: 100, y: GROUND_Y - 20,
        radius: 18,
        color: '#db3a3a',
        shadow: '#8f1f1f',
        alive: true,
        wins: 0,
        facingRight: true
    },
    p2: {
        x: 700, y: GROUND_Y - 20,
        radius: 18,
        color: '#3a7bd5',
        shadow: '#1f4f8f',
        alive: true,
        wins: 0
    }
};

// ---- projectile state ----
let projectile = {
    active: false,
    x: 0, y: 0,
    vx: 0, vy: 0,
    radius: 6,
    trail: []
};

// ---- aiming state ----
let aiming = false;
let aimAngle = 0;
let aimPower = 0;
let aimPointerX = 0;
let aimPointerY = 0;

// ---- movement state ----
let lastMoveClickTime = null; // null = no previous click yet
let lastMoveClickX = 0;
const DOUBLE_CLICK_MS = 400;
const GROUND_ZONE = 0.2;          // bottom 20% of screen height
const P1_MAX_X = W * 0.45;        // P1 can move within left 45%
const P2_MIN_X = W * 0.55;        // P2 can move within right 45%
let moveAnim = null;              // { shooter, fromX, toX, startedAt, duration }

let currentPlayer = 'p1';          // 'p1' or 'p2'
let gameOver = false;
let turnLock = false;             // block while projectile flies

// ---- helper: get opponent ----
function getOpponent(playerId) {
    return playerId === 'p1' ? 'p2' : 'p1';
}

// ---- reset round (keep scores) ----
function resetRound() {
    // Randomize terrain type
    const type = TERRAIN_TYPES[Math.floor(Math.random() * TERRAIN_TYPES.length)];
    generateTerrain(type);

    // Place players on terrain at their start positions
    players.p1.x = 100;
    players.p1.y = getTerrainYAt(100) - 20;
    players.p1.alive = true;

    players.p2.x = 700;
    players.p2.y = getTerrainYAt(700) - 20;
    players.p2.alive = true;

    projectile.active = false;
    projectile.trail = [];
    gameOver = false;
    turnLock = false;
    aiming = false;

    currentPlayer = 'p1';
    updateTurnUI();
    loadRandomBackground();
    statusMsg.innerText = `🗺️ ${type} terrain — double tap bottom to move`;
    draw();
}

// ---- full game reset (scores zero) ----
function fullReset() {
    players.p1.wins = 0;
    players.p2.wins = 0;
    resetRound();
}

// ---- update turn indicator ----
function updateTurnUI() {
    const turn = currentPlayer === 'p1' ? 'P1' : 'P2';
    turnIndicator.innerText = `▶ ${turn}`;
    turnIndicator.style.color = currentPlayer === 'p1' ? '#db3a3a' : '#3a7bd5';
}

// ---- draw terrain ----
function drawTerrain() {
    const c = terrain.colors;

    // build ground polygon points
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 2) {
        const y = getTerrainYAt(x);
        ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();

    // gradient fill from top of terrain to bottom
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, c.top);
    grad.addColorStop(0.5, c.base);
    grad.addColorStop(1, c.shadow);
    ctx.fillStyle = grad;
    ctx.fill();

    // subtle surface texture
    ctx.strokeStyle = c.blade;
    ctx.lineWidth = 1.0;
    ctx.globalAlpha = 0.4;
    for (let x = 0; x < W; x += 18) {
        const y = getTerrainYAt(x);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 1, y - 3);
        ctx.stroke();
    }
    ctx.globalAlpha = 1.0;

    // rocks
    for (const rock of terrain.rocks) {
        ctx.fillStyle = c.rock;
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;
        ctx.beginPath();
        ctx.ellipse(rock.x, rock.y, rock.r, rock.r * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
    }

    // ---- terrain-type specific texture ----
    if (terrain.type === 'rust') {
        // rust speckles and small rocks
        ctx.fillStyle = '#8b4513';
        ctx.globalAlpha = 0.3;
        for (let i = 0; i < 60; i++) {
            const sx = (i * 137.5) % W;
            const sy = getTerrainYAt(sx) - 2 - (i % 6);
            ctx.beginPath();
            ctx.arc(sx, sy, 1 + (i % 3), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;
    } else if (terrain.type === 'crimson') {
        // red crystal shards
        ctx.fillStyle = '#dc3535';
        ctx.globalAlpha = 0.4;
        for (let i = 0; i < 50; i++) {
            const sx = (i * 97.3) % W;
            const sy = getTerrainYAt(sx) - 3 - (i % 10);
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + 2, sy - 6);
            ctx.lineTo(sx + 4, sy);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;
    } else if (terrain.type === 'ember') {
        // ember dots (glowing coals)
        ctx.fillStyle = '#ff8c42';
        ctx.globalAlpha = 0.6;
        for (let i = 0; i < 70; i++) {
            const sx = (i * 111.7) % W;
            const sy = getTerrainYAt(sx) - 2 - (i % 8);
            ctx.beginPath();
            ctx.arc(sx, sy, 1.2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;
    }
}

// ---- draw sky background ----
let bgImage = null;
let bgImageLoaded = false;

// ---- player image (red player) ----
let playerImg = null;
let playerImgLoaded = false;

function loadPlayerImage() {
    playerImgLoaded = false;
    playerImg = new Image();
    playerImg.onload = () => { playerImgLoaded = true; draw(); };
    playerImg.onerror = () => { playerImgLoaded = false; };
    playerImg.src = 'backgrounds/player1.png';
}

function loadRandomBackground() {
    bgImageLoaded = false;
    bgImage = new Image();
    bgImage.onload = () => { bgImageLoaded = true; draw(); };
    bgImage.onerror = () => { bgImageLoaded = false; draw(); };
    const files = ['bg1.jpg'];
    const pick = files[Math.floor(Math.random() * files.length)];
    bgImage.src = `backgrounds/${pick}?v=${Date.now()}`;
}

function drawSky() {
    if (bgImageLoaded && bgImage.complete && bgImage.naturalWidth > 0) {
        const imgRatio = bgImage.naturalWidth / bgImage.naturalHeight;
        const canvasRatio = W / H;
        let drawW, drawH, offX, offY;
        if (imgRatio > canvasRatio) {
            drawH = H; drawW = H * imgRatio; offX = -(drawW - W) / 2; offY = 0;
        } else {
            drawW = W; drawH = W / imgRatio; offX = 0; offY = -(drawH - H) / 2;
        }
        ctx.drawImage(bgImage, offX, offY, drawW, drawH);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillRect(0, 0, W, H);
    } else {
        const colors = {
            rust:    ['#f4e4c1', '#d4a574'],
            crimson: ['#f0c0c0', '#c88080'],
            ember:   ['#fce4c8', '#e0a060']
        };
        const [top, bottom] = colors[terrain.type] || colors.rust;
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, top);
        grad.addColorStop(1, bottom);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
    }
}

// ---- draw terrain & characters ----
function draw() {
    ctx.clearRect(0, 0, W, H);

    drawSky();
    drawTerrain();

    // ---- draw players ----
    for (const [id, p] of Object.entries(players)) {
        if (!p.alive) continue;
        const dir = id === 'p1' ? 1 : -1;

        // Use image for red player (p1), circle for blue player (p2)
        if (id === 'p1' && playerImgLoaded && playerImg.complete && playerImg.naturalWidth > 0) {
            // crisp image rendering: no shadow, no smoothing
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
            ctx.imageSmoothingEnabled = false;
            // determine facing direction: during movement follow direction, else face right
            let facingRight = p.facingRight !== undefined ? p.facingRight : true;
            if (moveAnim && moveAnim.shooter === p) {
                facingRight = moveAnim.toX >= moveAnim.fromX;
                p.facingRight = facingRight;
            } else {
                p.facingRight = true;
            }
            // draw image centered at player position, maintaining aspect ratio
            const maxSize = p.radius * 2;
            const imgAspect = playerImg.naturalWidth / playerImg.naturalHeight;
            let drawW, drawH;
            if (imgAspect > 1) {
                drawW = maxSize;
                drawH = maxSize / imgAspect;
            } else {
                drawH = maxSize;
                drawW = maxSize * imgAspect;
            }
            const offX = p.x - drawW / 2;
            const offY = p.y - drawH / 2;
            if (!facingRight) {
                ctx.save();
                ctx.translate(p.x, p.y - drawH / 2);
                ctx.scale(-1, 1);
                ctx.drawImage(playerImg, -drawW / 2, 0, drawW, drawH);
                ctx.restore();
            } else {
                ctx.drawImage(playerImg, offX, offY, drawW, drawH);
            }
            // weapon (small cannon)
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
            ctx.strokeStyle = '#2a2a2a';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(p.x + dir * 10, p.y - 4);
            ctx.lineTo(p.x + dir * 24, p.y - 10);
            ctx.stroke();
            ctx.fillStyle = '#3d3d3d';
            ctx.beginPath();
            ctx.arc(p.x + dir * 24, p.y - 10, 5, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // fallback / p2: circle body
            ctx.shadowColor = 'rgba(0,0,0,0.3)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 4;
            ctx.shadowColor = p.shadow;
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
            // highlight
            ctx.shadowBlur = 4;
            ctx.shadowOffsetY = 0;
            ctx.beginPath();
            ctx.arc(p.x - 4, p.y - 5, 6, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,240,0.3)';
            ctx.fill();
            // eyes
            ctx.shadowBlur = 0;
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(p.x - 6, p.y - 7, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(p.x + 6, p.y - 7, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#1f2a1f';
            ctx.beginPath();
            ctx.arc(p.x - 8, p.y - 9, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(p.x + 4, p.y - 9, 2.5, 0, Math.PI * 2);
            ctx.fill();
            // pupil highlight
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(p.x - 9, p.y - 11, 1, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(p.x + 3, p.y - 11, 1, 0, Math.PI * 2);
            ctx.fill();
            // weapon (small cannon)
            ctx.strokeStyle = '#2a2a2a';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(p.x + dir * 10, p.y - 4);
            ctx.lineTo(p.x + dir * 24, p.y - 10);
            ctx.stroke();
            ctx.fillStyle = '#3d3d3d';
            ctx.beginPath();
            ctx.arc(p.x + dir * 24, p.y - 10, 5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // ---- aiming visualization ----
    if (aiming) {
        const shooter = players[currentPlayer];
        if (shooter.alive) {
            const startX = shooter.x + Math.cos(aimAngle) * 24;
            const startY = shooter.y + Math.sin(aimAngle) * 24 - 6;
            const lineLen = 20 + aimPower * 12;
            const endX = startX + Math.cos(aimAngle) * lineLen;
            const endY = startY + Math.sin(aimAngle) * lineLen;

            // Aim direction dashed line
            ctx.save();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(255, 255, 200, 0.7)';
            ctx.lineWidth = 3;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Arrow tip
            ctx.fillStyle = 'rgba(255, 255, 200, 0.8)';
            ctx.beginPath();
            ctx.arc(endX, endY, 5, 0, Math.PI * 2);
            ctx.fill();

            // Power bar
            const powerFrac = aimPower / MAX_POWER;
            const barColor = powerFrac < 0.33 ? '#7ae07a' : powerFrac < 0.66 ? '#e0d07a' : '#e07a7a';
            
            // Background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.roundRect(POWER_BAR_X - 2, POWER_BAR_Y - 2, POWER_BAR_WIDTH + 4, POWER_BAR_HEIGHT + 4, 4);
            ctx.fill();
            
            // Label
            ctx.fillStyle = '#f0f7d8';
            ctx.font = 'bold 11px "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('POWER', W / 2, POWER_BAR_Y - 6);
            ctx.textAlign = 'left';
            
            // Bar track
            ctx.fillStyle = 'rgba(30, 30, 30, 0.6)';
            ctx.roundRect(POWER_BAR_X, POWER_BAR_Y, POWER_BAR_WIDTH, POWER_BAR_HEIGHT, 3);
            ctx.fill();
            
            // Bar fill
            ctx.fillStyle = barColor;
            ctx.roundRect(POWER_BAR_X, POWER_BAR_Y, POWER_BAR_WIDTH * powerFrac, POWER_BAR_HEIGHT, 3);
            ctx.fill();
            
            // Bar border
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1;
            ctx.roundRect(POWER_BAR_X, POWER_BAR_Y, POWER_BAR_WIDTH, POWER_BAR_HEIGHT, 3);
            ctx.stroke();

            ctx.restore();
        }
    }

    // ---- projectile ----
    if (projectile.active || projectile.trail.length > 0) {
        // trail
        for (let i = 0; i < projectile.trail.length; i++) {
            const t = projectile.trail[i];
            const alpha = 0.25 + 0.6 * (i / projectile.trail.length);
            ctx.beginPath();
            ctx.arc(t.x, t.y, projectile.radius * 0.7, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 220, 80, ${alpha * 0.6})`;
            ctx.fill();
        }
        // projectile body
        if (projectile.active) {
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#ffcc44';
            ctx.beginPath();
            ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
            ctx.fillStyle = '#f5d742';
            ctx.fill();
            ctx.shadowBlur = 8;
            ctx.fillStyle = '#ffb82b';
            ctx.beginPath();
            ctx.arc(projectile.x - 2, projectile.y - 2, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // ---- game over overlay ----
    if (gameOver) {
        ctx.shadowBlur = 14;
        ctx.shadowColor = 'black';
        ctx.font = 'bold 44px "Segoe UI", sans-serif';
        ctx.fillStyle = '#f7f2c0';
        ctx.textAlign = 'center';
        ctx.fillText('💥 GAME OVER', W/2, 120);
        ctx.font = 'bold 24px sans-serif';
        ctx.fillStyle = '#e6e0b0';
        const winner = players.p1.alive ? 'Player 1' : 'Player 2';
        ctx.fillText(`${winner} wins!`, W/2, 170);
        ctx.textAlign = 'left';
    }

    // reset shadow
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
}

// ---- round rect helper ----
CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    this.beginPath();
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.quadraticCurveTo(x + w, y, x + w, y + r);
    this.lineTo(x + w, y + h - r);
    this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.lineTo(x + r, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r);
    this.lineTo(x, y + r);
    this.quadraticCurveTo(x, y, x + r, y);
    this.closePath();
    return this;
};

// ---- fire projectile using current aimAngle and aimPower ----
function fireProjectile() {
    if (gameOver || turnLock) return false;
    if (!aiming) return false;

    const shooter = players[currentPlayer];
    if (!shooter.alive) return false;

    if (aimPower < 0.5) {
        // Too weak, ignore
        statusMsg.innerText = `💨 too weak! swipe further`;
        aiming = false;
        draw();
        return false;
    }

    projectile.x = shooter.x + Math.cos(aimAngle) * 24;
    projectile.y = shooter.y + Math.sin(aimAngle) * 24 - 6;
    projectile.vx = Math.cos(aimAngle) * aimPower;
    projectile.vy = Math.sin(aimAngle) * aimPower;
    projectile.active = true;
    projectile.trail = [];
    turnLock = true;
    aiming = false;

    statusMsg.innerText = `🎯 ${currentPlayer.toUpperCase()} fires!`;
    draw();

    // start animation loop
    runProjectileAnimation();
    return true;
}

function runProjectileAnimation() {
    const interval = setInterval(() => {
        if (!projectile.active || gameOver) {
            clearInterval(interval);
            if (gameOver) draw();
            return;
        }
        updateProjectile();
    }, 20);
}

// ---- update projectile physics & collision ----
function updateProjectile() {
    if (!projectile.active || gameOver) return;

    // store trail
    projectile.trail.push({ x: projectile.x, y: projectile.y });
    if (projectile.trail.length > 24) projectile.trail.shift();

    // physics
    projectile.x += projectile.vx;
    projectile.y += projectile.vy;
    projectile.vy += GRAVITY;

    // boundary collision (walls / ground using terrain)
    const rad = projectile.radius;
    // left/right walls (bounce)
    if (projectile.x - rad < 0) {
        projectile.x = rad;
        projectile.vx = -projectile.vx * 0.6;
    } else if (projectile.x + rad > W) {
        projectile.x = W - rad;
        projectile.vx = -projectile.vx * 0.6;
    }

    // terrain collision (use terrain height)
    const groundY = getTerrainYAt(projectile.x);
    if (projectile.y + rad > groundY) {
        projectile.y = groundY - rad;
        projectile.active = false;
        projectile.vx = 0;
        projectile.vy = 0;
        checkHitGround();
        endTurn();
        draw();
        return;
    }

    // check hit on players (only if alive)
    for (const [id, p] of Object.entries(players)) {
        if (!p.alive) continue;
        const dx = projectile.x - p.x;
        const dy = projectile.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < p.radius + rad) {
            // HIT !
            p.alive = false;
            projectile.active = false;
            gameOver = true;
            const winner = currentPlayer;
            players[winner].wins += 1;
            statusMsg.innerText = `🏆 ${winner.toUpperCase()} wins!`;
            turnLock = true;
            draw();
            return;
        }
    }

    // projectile out of screen (safety)
    if (projectile.y > H + 50) {
        projectile.active = false;
        endTurn();
        draw();
        return;
    }

    draw();
}

// ---- check if projectile landed near opponent (ground hit) ----
function checkHitGround() {
    const opponentId = getOpponent(currentPlayer);
    const opp = players[opponentId];
    if (!opp.alive) return;

    const dx = projectile.x - opp.x;
    const dy = projectile.y - opp.y;
    const dist = Math.hypot(dx, dy);
    // use approximate ground level at opponent position
    const oppGroundY = getTerrainYAt(opp.x);
    if (dist < opp.radius + 15) {
        opp.alive = false;
        gameOver = true;
        players[currentPlayer].wins += 1;
        statusMsg.innerText = `🏆 ${currentPlayer.toUpperCase()} wins!`;
        turnLock = true;
        draw();
    }
}

// ---- end turn, switch player ----
function endTurn() {
    if (gameOver) return;
    currentPlayer = getOpponent(currentPlayer);
    if (!players[currentPlayer].alive) {
        const alivePlayer = players.p1.alive ? 'p1' : 'p2';
        if (players.p1.alive || players.p2.alive) {
            gameOver = true;
            players[alivePlayer].wins += 1;
            statusMsg.innerText = `🏆 ${alivePlayer.toUpperCase()} wins!`;
            turnLock = true;
            draw();
            return;
        }
    }
    updateTurnUI();
    turnLock = false;
    statusMsg.innerText = `👆 tap to aim, swipe for power, double tap to move`;
    draw();
}

// ---- get canvas-relative coordinates from pointer event ----
function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (W / rect.width),
        y: (e.clientY - rect.top) * (H / rect.height)
    };
}

// ---- animated movement ----
function animateMove(shooter, targetX) {
    const fromX = shooter.x;
    const targetY = getTerrainYAt(targetX) - 20;
    moveAnim = { shooter, fromX, toX: targetX, startedAt: performance.now(), duration: Math.abs(targetX - fromX) * 8 };

    function tick() {
        const elapsed = performance.now() - moveAnim.startedAt;
        const t = Math.min(elapsed / moveAnim.duration, 1);
        const eased = t < 1 ? 1 - Math.pow(1 - t, 2) : 1;
        shooter.x = fromX + (targetX - fromX) * eased;
        shooter.y = getTerrainYAt(shooter.x) - 20;
        draw();
        if (t < 1) {
            requestAnimationFrame(tick);
        } else {
            moveAnim = null;
            statusMsg.innerText = `🎯 ${currentPlayer.toUpperCase()} turn`;
            draw();
        }
    }
    tick();
}

// ---- pointer events (works for both touch and mouse) ----
canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // stop browser from stealing the gesture
    pointerDownHandler(e);
});

canvas.addEventListener('pointermove', (e) => {
    e.preventDefault();
    pointerMoveHandler(e);
});

canvas.addEventListener('pointerup', (e) => {
    e.preventDefault();
    pointerUpHandler();
});

canvas.addEventListener('pointercancel', () => {
    // Mobile often fires pointercancel instead of pointerup.
    // Fire the shot with whatever power/angle was set.
    pointerUpHandler();
});

// ---- shared handlers ----
function pointerDownHandler(e) {
    if (gameOver || turnLock || moveAnim) return;
    const shooter = players[currentPlayer];
    if (!shooter.alive) return;

    const pos = getCanvasCoords(e);
    const now = Date.now();

    // ---- double-click / double-tap detection for movement ----
    const prevClick = lastMoveClickTime !== null && !isNaN(lastMoveClickTime);
    const isDoubleClick = prevClick && (now - lastMoveClickTime < DOUBLE_CLICK_MS);
    lastMoveClickTime = now;

    // Check if click is near the terrain surface at this X
    const terrainSurfaceY = getTerrainYAt(pos.x);
    const nearGround = pos.y > terrainSurfaceY - 40 && pos.y < terrainSurfaceY + 40;

    if (isDoubleClick && nearGround) {
        // Move the current player
        let newX = pos.x;
        if (currentPlayer === 'p1') {
            newX = Math.max(30, Math.min(P1_MAX_X, newX));
        } else {
            newX = Math.max(P2_MIN_X, Math.min(W - 30, newX));
        }
        statusMsg.innerText = `🚶 ${currentPlayer.toUpperCase()} moving`;
        animateMove(shooter, newX);
        return;
    }

    // ---- normal aim ----
    const dx = pos.x - shooter.x;
    const dy = pos.y - shooter.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 10) return; // too close, ignore

    aimAngle = Math.atan2(dy, dx);
    aimPower = 0;
    aiming = true;
    aimPointerX = pos.x;
    aimPointerY = pos.y;

    statusMsg.innerText = `↔️ swipe left/right for power, ↑↓ for angle`;
    draw();
}

function pointerMoveHandler(e) {
    if (!aiming) return;
    const shooter = players[currentPlayer];
    if (!shooter || !shooter.alive) return;

    const pos = getCanvasCoords(e);

    // --- Angle: directly follows the finger/mouse from shooter ---
    const dx = pos.x - shooter.x;
    const dy = pos.y - shooter.y;
    aimAngle = Math.atan2(dy, dx);

    // --- Power: swipe away from opponent direction ---
    const dir = shooter.x < 400 ? 1 : -1;
    const deltaX = (pos.x - aimPointerX) * dir;
    const effectiveDist = Math.max(0, deltaX - 9);
    aimPower = Math.min(MAX_POWER, effectiveDist / 17);

    draw();
}

function pointerUpHandler() {
    if (!aiming) return;
    fireProjectile();
}

// ---- reset button ----
document.getElementById('resetBtn').addEventListener('click', () => {
    fullReset();
});

// ---- init ----
loadPlayerImage();
resetRound();

// ---- extra: keyboard R for reset ----
window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
        fullReset();
        e.preventDefault();
    }
});

// ---- handle window resize / redraw ----
window.addEventListener('resize', () => { draw(); });