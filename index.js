// index.js – Worms-style duel
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const turnIndicator = document.getElementById('turnIndicator');
const statusMsg = document.getElementById('statusMsg');

// ---- dimensions ----
const W = 800, H = 400;
const GROUND_Y = 340;        // where the terrain sits
const GRAVITY = 0.25;
const MAX_POWER = 22;
const POWER_BAR_WIDTH = 140;
const POWER_BAR_HEIGHT = 12;
const POWER_BAR_X = W / 2 - POWER_BAR_WIDTH / 2;
const POWER_BAR_Y = 20;

// ---- player definitions ----
const players = {
    p1: {
        x: 100, y: GROUND_Y - 20,
        radius: 18,
        color: '#db3a3a',
        shadow: '#8f1f1f',
        alive: true,
        wins: 0
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

let currentPlayer = 'p1';          // 'p1' or 'p2'
let gameOver = false;
let turnLock = false;             // block while projectile flies

// ---- helper: get opponent ----
function getOpponent(playerId) {
    return playerId === 'p1' ? 'p2' : 'p1';
}

// ---- reset round (keep scores) ----
function resetRound() {
    players.p1.x = 100;
    players.p1.y = GROUND_Y - 20;
    players.p1.alive = true;

    players.p2.x = 700;
    players.p2.y = GROUND_Y - 20;
    players.p2.alive = true;

    projectile.active = false;
    projectile.trail = [];
    gameOver = false;
    turnLock = false;
    aiming = false;

    currentPlayer = 'p1';
    updateTurnUI();
    statusMsg.innerText = '👆 tap to aim, swipe for power';
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

// ---- draw terrain & characters ----
function draw() {
    ctx.clearRect(0, 0, W, H);

    // ---- ground ----
    ctx.fillStyle = '#5d814a';
    ctx.beginPath();
    ctx.rect(0, GROUND_Y, W, H - GROUND_Y + 10);
    ctx.fill();
    // grass edge
    ctx.fillStyle = '#7aa55a';
    ctx.beginPath();
    ctx.rect(0, GROUND_Y - 4, W, 8);
    ctx.fill();
    // small grass blades
    ctx.strokeStyle = '#4f7340';
    ctx.lineWidth = 2;
    for (let i = 0; i < 60; i++) {
        const x = (i * 15 + 7) % W;
        ctx.beginPath();
        ctx.moveTo(x, GROUND_Y - 2);
        ctx.lineTo(x - 3, GROUND_Y - 12);
        ctx.stroke();
    }

    // ---- draw players ----
    for (const [id, p] of Object.entries(players)) {
        if (!p.alive) continue;
        // shadow
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 4;
        // body
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
        const dir = id === 'p1' ? 1 : -1;
        ctx.moveTo(p.x + dir * 10, p.y - 4);
        ctx.lineTo(p.x + dir * 24, p.y - 10);
        ctx.stroke();
        ctx.fillStyle = '#3d3d3d';
        ctx.beginPath();
        ctx.arc(p.x + dir * 24, p.y - 10, 5, 0, Math.PI * 2);
        ctx.fill();
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

    // ---- player score overlay ----
    ctx.shadowBlur = 0;
    ctx.font = 'bold 18px "Segoe UI", monospace';
    ctx.fillStyle = '#f5f0d7';
    ctx.shadowColor = '#142014';
    ctx.shadowBlur = 8;
    ctx.fillText(`🏆 P1: ${players.p1.wins}`, 20, 50);
    ctx.fillText(`🏆 P2: ${players.p2.wins}`, W - 130, 50);

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

    // boundary collision (walls / ground)
    const rad = projectile.radius;
    // left/right walls (bounce)
    if (projectile.x - rad < 0) {
        projectile.x = rad;
        projectile.vx = -projectile.vx * 0.6;
    } else if (projectile.x + rad > W) {
        projectile.x = W - rad;
        projectile.vx = -projectile.vx * 0.6;
    }

    // ground collision (stop projectile)
    if (projectile.y + rad > GROUND_Y) {
        projectile.y = GROUND_Y - rad;
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
    if (dist < opp.radius + 14) {
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
    statusMsg.innerText = `👆 tap to aim, swipe for power`;
    draw();
}

// ---- get canvas-relative coordinates from pointer event ----
function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
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

// ---- explicit touch events (iOS Safari fallback) ----
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // CRITICAL: stops browser from canceling the touch
    const touch = e.changedTouches[0];
    pointerDownHandler(touch);
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.changedTouches[0];
    pointerMoveHandler(touch);
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    pointerUpHandler();
}, { passive: false });

// ---- shared handlers ----
function pointerDownHandler(e) {
    if (gameOver || turnLock) return;
    const shooter = players[currentPlayer];
    if (!shooter.alive) {
        statusMsg.innerText = `⛔ ${currentPlayer.toUpperCase()} is dead!`;
        return;
    }

    const pos = getCanvasCoords(e);
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
    // P1 (left): swipe right to increase, left to decrease
    // P2 (right): swipe left to increase, right to decrease
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