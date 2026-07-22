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

let currentPlayer = 'p1';          // 'p1' or 'p2'
let gameOver = false;
let turnLock = false;             // block clicks while projectile flies

// ---- helper: get opponent ----
function getOpponent(playerId) {
    return playerId === 'p1' ? 'p2' : 'p1';
}

// ---- reset round (keep scores) ----
function resetRound() {
    // reset positions & health
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

    // start with player 1
    currentPlayer = 'p1';
    updateTurnUI();
    statusMsg.innerText = '⚔️  aim & fire';
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

// ---- fire projectile toward click ----
function fireProjectile(clickX, clickY) {
    if (gameOver || turnLock) return false;

    const shooter = players[currentPlayer];
    if (!shooter.alive) {
        // should never happen, but safety
        return false;
    }

    const dx = clickX - shooter.x;
    const dy = clickY - shooter.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 5) return false;   // too close, ignore

    // power scaling: max power when click is far (clamp)
    const power = Math.min(MAX_POWER, dist / 32);
    const angle = Math.atan2(dy, dx);

    projectile.x = shooter.x + Math.cos(angle) * 22;
    projectile.y = shooter.y + Math.sin(angle) * 22 - 6;
    projectile.vx = Math.cos(angle) * power;
    projectile.vy = Math.sin(angle) * power;
    projectile.active = true;
    projectile.trail = [];
    turnLock = true;

    statusMsg.innerText = `🎯 ${currentPlayer.toUpperCase()} fires!`;
    return true;
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
        // check hit on ground (if near opponent)
        checkHitGround();
        // next turn
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
            turnLock = true;   // block further clicks
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
    // if projectile stopped on ground, check if it's near opponent
    const opponentId = getOpponent(currentPlayer);
    const opp = players[opponentId];
    if (!opp.alive) return;

    const dx = projectile.x - opp.x;
    const dy = projectile.y - opp.y;
    const dist = Math.hypot(dx, dy);
    // if close enough, it's a hit (direct impact on ground)
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
    // switch player
    currentPlayer = getOpponent(currentPlayer);
    // if opponent is dead, game already over
    if (!players[currentPlayer].alive) {
        // but if somehow the opponent died earlier, we should have gameOver already
        // but safety: declare winner
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
    statusMsg.innerText = `🔫 ${currentPlayer.toUpperCase()} turn`;
    draw();
}

// ---- canvas click handler ----
canvas.addEventListener('click', (e) => {
    if (gameOver || turnLock) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    const shooter = players[currentPlayer];
    if (!shooter.alive) {
        statusMsg.innerText = `⛔ ${currentPlayer.toUpperCase()} is dead!`;
        return;
    }

    const success = fireProjectile(mouseX, mouseY);
    if (success) {
        // start animation loop
        updateProjectile();
        // continue animation until projectile stops
        const interval = setInterval(() => {
            if (!projectile.active || gameOver) {
                clearInterval(interval);
                // if gameOver draw one last time
                if (gameOver) draw();
                return;
            }
            updateProjectile();
        }, 20);
    }
});

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

// ---- start draw loop (idle) ----
function idleLoop() {
    if (!projectile.active && !gameOver) {
        draw();
    }
    requestAnimationFrame(idleLoop);
}
idleLoop();

// ---- handle window resize / redraw ----
window.addEventListener('resize', () => { draw(); });
