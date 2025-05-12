console.log('✅ script.js loaded');

// — Import Speed Run settings
import * as SpeedRunSettings from './speedRunSettings.js';

// — If launched from a group “Play” button, pick up the passed username:
const urlParams = new URLSearchParams(window.location.search);
const GROUP_USERNAME = urlParams.get('username');

// — Canvas & context
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// — Dynamic canvas sizing
let WIDTH, HEIGHT;
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  WIDTH = window.innerWidth;
  HEIGHT = window.innerHeight;
  canvas.width = WIDTH * dpr;
  canvas.height = HEIGHT * dpr;
  canvas.style.width = `${WIDTH}px`;
  canvas.style.height = `${HEIGHT}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// — Telegram Web App fullscreen
if (window.Telegram?.WebApp) {
  Telegram.WebApp.expand();
  Telegram.WebApp.setBackgroundColor('#000');
  Telegram.WebApp.onEvent('viewportChanged', resizeCanvas);
}

// — Game constants (Classic mode)
const CLASSIC_SETTINGS = {
  FPS: 60,
  GRAVITY: 975,
  FLAP_V: -250,
  PIPE_SPEED: 200,
  SPAWN_INT: 1.5,
  PIPE_GAP: 180,
  HITBOX_PADDING: 6
};

// — Asset paths
const PATH = 'assets/';
const SPRITES = {
  bg: [PATH + 'sprites/nyc.png'],
  pipe: [PATH + 'sprites/tower.png', PATH + 'sprites/tower.png'],
  base: PATH + 'sprites/base.png',
  bird: [
    PATH + 'sprites/plane.png',    
  ],
  nums: Array.from({ length: 10 }, (_, i) => PATH + `sprites/${i}.png`),
  msg: PATH + 'sprites/title.png',
  over: PATH + 'sprites/game_over.png'
};
const SOUNDS = {
  die: PATH + 'audio/die.ogg',
  hit: PATH + 'audio/hit.ogg',
  point: PATH + 'audio/point.ogg',
  wing: PATH + 'audio/wing.ogg'
};

// — State & core variables
let state = 'MODE_SELECT';
let lastDifficultyScore = 0;
let difficultyCycle = 0;  // track difficulty increases
let gameMode = null;
let lastTime = 0;
let spawnTimer = 0;
let score = 0;
let pipes = [];
let baseX = 0;
let topList = [];
let playStartTime = 0; // Tracks start of PLAY state

// — Duck (scaled)
const BIRD_W = 34, BIRD_H = 34, BIRD_SCALE = 1.9;
const bird = { x: 0, y: 0, vy: 0, w: BIRD_W * BIRD_SCALE, h: BIRD_H * BIRD_SCALE, frame: 0, flapped: false, variant: 0 };

// — Buttons
const Btn = {
  classic:       { x: 0, y: 0, w: 150, h: 50, label: 'Classic' },
  speedRun:      { x: 0, y: 0, w: 150, h: 50, label: 'Speed Run' },
  chooseQuakk:   { x: 0, y: 0, w: 150, h: 50, label: 'Choose Quakk' },
  start:         { x: 0, y: 0, w: 150, h: 50, label: 'Start' },
  leaderboard:   { x: 0, y: 0, w: 150, h: 50, label: 'Leaderboard' },
  srLeaderboard: { x: 0, y: 0, w: 150, h: 50, label: 'Speed Run\nLeaderboard' },
  back:          { x: 0, y: 0, w: 150, h: 50, label: 'Back' }
};

// — Hit areas for duck selection
let chooseAreas = {};

// — Asset containers & loading
const IMG = { bg: [], pipe: [], bird: [], nums: [], base: null, msg: null, over: null };
const AUD = {};
let loadedImages = 0;
const TOTAL_IMAGES = SPRITES.bg.length + SPRITES.pipe.length + 1 + SPRITES.bird.length + SPRITES.nums.length + 1 + 1;

function loadImage(src, store, key) {
  const img = new Image(); img.src = src;
  img.onload = () => { store[key] = img; if (++loadedImages === TOTAL_IMAGES) init(); };
  img.onerror = () => console.error('Failed to load:', src);
}
SPRITES.bg.forEach((u, i) => loadImage(u, IMG, `bg${i}`));
SPRITES.pipe.forEach((u, i) => loadImage(u, IMG, `pipe${i}`));
loadImage(SPRITES.base, IMG, 'base');
SPRITES.bird.forEach((u, i) => loadImage(u, IMG, `bird${i}`));
SPRITES.nums.forEach((u, i) => loadImage(u, IMG, `num${i}`));
loadImage(SPRITES.msg, IMG, 'msg');
loadImage(SPRITES.over, IMG, 'over');
Object.entries(SOUNDS).forEach(([k, url]) => { const a = new Audio(url); a.load(); AUD[k] = a; });

// — Variant bag to avoid repeats
let variantBag = [];
function refillVariantBag() {
  variantBag = SPRITES.bird.map((_, i) => i);
  for (let i = variantBag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [variantBag[i], variantBag[j]] = [variantBag[j], variantBag[i]];
  }
}
refillVariantBag();

// — Helpers
function randInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
function intersect(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

// — Pipe creation
function createPipe(x) {
  const settings = gameMode === 'SPEED_RUN' ? SpeedRunSettings : CLASSIC_SETTINGS;
  const margin = Math.floor(HEIGHT * 0.2);
  const gapY = randInt(margin, HEIGHT - settings.PIPE_GAP - margin);
  return { x, y: gapY, scored: false };
}
function spawnInitial() {
  pipes = [];
  const pw = IMG.pipe0.width;
  pipes.push(createPipe(WIDTH + pw * 6));
}

// — Load saved duck
async function loadServerVariant() {
  try {
    const tg = window.Telegram.WebApp;
    const user = tg.initDataUnsafe.user || {};
    const username = user.username ? '@' + user.username : `${user.first_name}_${user.id}`;
    const res = await fetch(`${location.origin}/bush_did_it/getQuakk?username=${encodeURIComponent(username)}`);
    if (!res.ok) throw 0;
    const { variant } = await res.json();
    if (variant != null) {
      bird.variant = variant;
      variantBag = variantBag.filter(v => v !== variant);
      localStorage.setItem('quakkVariant', variant);
    }
  } catch {}
}

// — Init when assets ready
function init() {
  const saved = localStorage.getItem('quakkVariant');
  if (saved !== null) {
    bird.variant = parseInt(saved, 10);
    variantBag = variantBag.filter(v => v !== bird.variant);
  }
  loadServerVariant().finally(() => {
    drawModeSelect();
    lastTime = performance.now();
    setInterval(gameLoop, 1000 / CLASSIC_SETTINGS.FPS);
  });
}

// — Input handling
canvas.addEventListener('pointerdown', handlePointer, { passive: false });
canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
document.addEventListener('keydown', e => { if (e.code === 'Space' && state === 'PLAY') { bird.flapped = true; e.preventDefault(); } });

function handlePointer(e) {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  const mx = (cx - rect.left) * (WIDTH / rect.width);
  const my = (cy - rect.top) * (HEIGHT / rect.height);

  if (state === 'MODE_SELECT') {
    if (intersect({ x: mx, y: my, w: 0, h: 0 }, Btn.classic)) { gameMode = 'CLASSIC'; state = 'WELCOME'; drawWelcome(); }
    else if (intersect({ x: mx, y: my, w: 0, h: 0 }, Btn.speedRun)) { gameMode = 'SPEED_RUN'; state = 'WELCOME'; drawWelcome(); }
    else if (intersect({ x: mx, y: my, w: 0, h: 0 }, Btn.chooseQuakk)) { state = 'PICK_QUAKK'; drawQuakkSelection(); }
  } else if (state === 'WELCOME') {
    if (intersect({ x: mx, y: my, w: 0, h: 0 }, Btn.start)) startPlay();
    else if (intersect({ x: mx, y: my, w: 0, h: 0 }, gameMode === 'CLASSIC' ? Btn.leaderboard : Btn.srLeaderboard)) fetchLeaderboard();
    else if (intersect({ x: mx, y: my, w: 0, h: 0 }, Btn.back)) { state = 'MODE_SELECT'; drawModeSelect(); }
  } else if (state === 'PICK_QUAKK') {
    for (let i in chooseAreas) {
      const a = chooseAreas[i];
      if (mx >= a.x && mx <= a.x + a.w && my >= a.y && my <= a.y + a.h) {
        bird.variant = Number(i);
        localStorage.setItem('quakkVariant', i);
        const tg = window.Telegram.WebApp;
        const user = tg.initDataUnsafe.user || {};
        const uname = user.username ? '@' + user.username : `${user.first_name}_${user.id}`;
        fetch(`${location.origin}/bush_did_it/selectQuakk`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: uname, variant: Number(i) })
        }).catch(console.error);
        state = 'MODE_SELECT'; drawModeSelect(); return;
      }
    }
  } else if (state === 'PLAY') { bird.flapped = true; }
  else if (state === 'GAMEOVER') {
    if (intersect({ x: mx, y: my, w: 0, h: 0 }, Btn.start)) startPlay();
    else if (intersect({ x: mx, y: my, w: 0, h: 0 }, gameMode === 'CLASSIC' ? Btn.leaderboard : Btn.srLeaderboard)) fetchLeaderboard();
  } else if (state === 'LEADERBOARD') { state = 'WELCOME'; drawWelcome(); }
}

// — Draw Mode Select
function drawModeSelect() {
  ctx.drawImage(IMG.bg0, 0, 0, WIDTH, HEIGHT);
  tileBase(); ctx.drawImage(IMG.msg, (WIDTH - IMG.msg.width) / 2, HEIGHT * 0.12);
  [Btn.classic, Btn.speedRun, Btn.chooseQuakk].forEach((b, i) => {
    b.x = WIDTH / 2 - 75; b.y = HEIGHT * (0.6 + i * 0.1);
    ctx.fillStyle = '#fff'; ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#000'; ctx.font = `${20 * (WIDTH / 288)}px Arial`;
    ctx.fillText(b.label, b.x + (b.w - ctx.measureText(b.label).width) / 2, b.y + 32 * (WIDTH / 288));
  });
  // Duck above Classic
  const duckX = Btn.classic.x + (Btn.classic.w - bird.w) / 2;
  const duckY = Btn.classic.y - bird.h - 10;
  const bob = 8 * Math.sin(performance.now() / 200);
  ctx.drawImage(IMG[`bird${bird.variant}`], duckX, duckY + bob, bird.w, bird.h);
}

// — Draw Choose Quakk
function drawQuakkSelection() {
  ctx.drawImage(IMG.bg0, 0, 0, WIDTH, HEIGHT);
  const cols = 3, size = 80, pad = 20;
  const rows = Math.ceil(SPRITES.bird.length / cols);
  const gridW = cols * size + (cols - 1) * pad;
  const gridH = rows * size + (rows - 1) * pad;
  const startX = (WIDTH - gridW) / 2;
  const startY = (HEIGHT - gridH) / 2;
  ctx.font = `${20 * (WIDTH / 288)}px Arial`;
  ctx.fillStyle = '#fff'; ctx.fillText('Select Your Duck', startX, startY - 10);
  for (let i = 0; i < SPRITES.bird.length; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const x = startX + col * (size + pad), y = startY + row * (size + pad);
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x, y, size, size);
    ctx.drawImage(IMG[`bird${i}`], x + 10, y + 10, size - 20, size - 20);
    chooseAreas[i] = { x, y, w: size, h: size };
  }
}

// — Draw Welcome
function drawWelcome() {
  ctx.drawImage(IMG.bg0, 0, 0, WIDTH, HEIGHT);
  tileBase(); ctx.drawImage(IMG.msg, (WIDTH - IMG.msg.width) / 2, HEIGHT * 0.12);
  // Buttons: Start, Leaderboard or SR Leaderboard, Back
  Btn.start.x = WIDTH / 2 - 75; Btn.start.y = HEIGHT * 0.6;
  const lb = gameMode === 'CLASSIC' ? Btn.leaderboard : Btn.srLeaderboard;
  lb.x = WIDTH / 2 - 75; lb.y = HEIGHT * 0.7;
  Btn.back.x = WIDTH / 2 - 75; Btn.back.y = HEIGHT * 0.8;
  // Draw buttons
  [Btn.start, lb, Btn.back].forEach(b => {
    ctx.fillStyle = '#fff'; ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#000';
    if (b === Btn.srLeaderboard) {
      // two-line text
      const lines = ['Speed Run', 'Leaderboard'];
      const fontSize = 16 * (WIDTH / 288);
      ctx.font = `${fontSize}px Arial`;
      const lh = fontSize + 4;
      lines.forEach((l, i) => {
        ctx.fillText(l, b.x + (b.w - ctx.measureText(l).width) / 2, b.y + (i + 1) * lh);
      });
    } else {
      ctx.font = `${20 * (WIDTH / 288)}px Arial`;
      ctx.fillText(
        b.label,
        b.x + (b.w - ctx.measureText(b.label).width) / 2,
        b.y + 32 * (WIDTH / 288)
      );
    }
  });
  // Duck above Start
  const duckX = Btn.start.x + (Btn.start.w - bird.w) / 2;
  const duckY = Btn.start.y - bird.h - 10;
  const bob = 8 * Math.sin(performance.now() / 200);
  ctx.drawImage(IMG[`bird${bird.variant}`], duckX, duckY + bob, bird.w, bird.h);
}

// — Draw Game Over
function drawGameOver() {
  ctx.drawImage(IMG.bg0, 0, 0, WIDTH, HEIGHT);
  tileBase();
  ctx.drawImage(IMG.over, (WIDTH - IMG.over.width) / 2, HEIGHT * 0.2);

  // display final score
  const scoreText = `Score: ${score}`;
  ctx.fillStyle = '#fff';
  const fontSize = 24 * (WIDTH / 288);
  ctx.font = `${fontSize}px Arial`;
  const textW = ctx.measureText(scoreText).width;
  ctx.fillText(scoreText, (WIDTH - textW) / 2, HEIGHT * 0.4);

  // position buttons
  Btn.start.x = WIDTH / 2 - 160;
  Btn.start.y = HEIGHT * 0.6;
  const lb = gameMode === 'CLASSIC' ? Btn.leaderboard : Btn.srLeaderboard;
  lb.x = WIDTH / 2 + 10;
  lb.y = HEIGHT * 0.6;

  // draw Start and Leaderboard with multiline for SR
  [Btn.start, lb].forEach(b => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#000';

    if (b === Btn.srLeaderboard) {
      const lines = ['Speed Run', 'Leaderboard'];
      const fm = 16 * (WIDTH / 288);
      ctx.font = `${fm}px Arial`;
      const lh = fm + 4;
      lines.forEach((line, i) => {
        const w = ctx.measureText(line).width;
        ctx.fillText(line, b.x + (b.w - w) / 2, b.y + (i + 1) * lh);
      });
    } else {
      const fm = 20 * (WIDTH / 288);
      ctx.font = `${fm}px Arial`;
      const w = ctx.measureText(b.label).width;
      ctx.fillText(b.label, b.x + (b.w - w) / 2, b.y + 32 * (WIDTH / 288));
    }
  });
}

// — Fetch & Draw Leaderboard
async function fetchLeaderboard(){
  try {
    const endpoint = gameMode==='CLASSIC'?'leaderboard':'SR-leaderboard';
    const res = await fetch(`${location.origin}/bush_did_it/${endpoint}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    topList = await res.json();
    state = 'LEADERBOARD';
    drawLeaderboard();
  } catch(e){
    console.error('Leaderboard load failed', e);
  }
}
function drawLeaderboard(){
  ctx.drawImage(IMG.bg0,0,0,WIDTH,HEIGHT);
  ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.fillRect(0,0,WIDTH,HEIGHT);
  ctx.fillStyle='#fff'; ctx.font=`${24*(WIDTH/288)}px Arial`;
  ctx.fillText(`🏆 Top 10 ${gameMode==='CLASSIC'?'Classic':'Speed Run'}`, WIDTH/2-120,50);
  ctx.font=`${18*(WIDTH/288)}px Arial`;
  topList.slice(0,10).forEach((e,i)=>{
    ctx.fillText(`${i+1}. ${e.username}: ${e.score}`,30,100+i*30);
  });
  ctx.fillText('Tap anywhere to restart', WIDTH/2-90, HEIGHT-40);
}

// — Start Play
function startPlay(){
  state      = 'PLAY';
  score      = 0;
  bird.vy    = 0;
  bird.x     = WIDTH * 0.2;
  bird.y     = (HEIGHT - bird.h)/2;
  // reset timing & pipes
  spawnTimer = -CLASSIC_SETTINGS.SPAWN_INT;
  lastTime   = performance.now();
  pipes      = [];
  // reset difficulty
  lastDifficultyScore = 0;
  difficultyCycle     = 0;
  playStartTime = performance.now(); // Set play start time
  // ensure variantbag has current pick at top
  if (variantBag.length === 0) refillVariantBag();
  // do not pop a new variant: keep current bird.variant
  // spawn initial pipes
  spawnInitial();
  AUD.wing.play();
}

// — Update Play
function updatePlay(){
  const settings = gameMode==='SPEED_RUN'?SpeedRunSettings:CLASSIC_SETTINGS;
  const now = performance.now(), dt=(now-lastTime)/1000;
  lastTime = now;
  if (score>=25 && score%25===0 && score>lastDifficultyScore && !pipes.some(p=>!p.scored)){
    if      (difficultyCycle%3===0) settings.PIPE_GAP   = Math.max(100, settings.PIPE_GAP-10);
    else if (difficultyCycle%3===1) settings.PIPE_SPEED = Math.min(400, settings.PIPE_SPEED+20);
    else                            settings.SPAWN_INT  = Math.max(0.5, settings.SPAWN_INT-0.1);
    difficultyCycle++;
    lastDifficultyScore = score;
  }
  spawnTimer += dt;
  if (spawnTimer >= settings.SPAWN_INT){
    pipes.push({ x: WIDTH+IMG.pipe0.width, y: randInt(HEIGHT*0.2, HEIGHT-settings.PIPE_GAP-HEIGHT*0.2), scored:false });
    spawnTimer -= settings.SPAWN_INT;
  }
  const pv = settings.PIPE_SPEED * dt;
  pipes.forEach(p=>p.x -= pv);
  pipes = pipes.filter(p=>p.x + IMG.pipe0.width > 0);
  bird.vy += settings.GRAVITY * dt;
  if (bird.flapped){ bird.vy=settings.FLAP_V; bird.flapped=false; AUD.wing.play(); }
  bird.y += bird.vy * dt;
  if (bird.y<0 || bird.y+bird.h>HEIGHT*0.85) return handleGameOver();
  pipes.forEach(p=>{
    const pw=IMG.pipe0.width, ph=IMG.pipe0.height;
    const topR ={ x:p.x, y:p.y-ph+settings.HITBOX_PADDING, w:pw, h:ph-settings.HITBOX_PADDING };
    const botR ={ x:p.x, y:p.y+settings.PIPE_GAP, w:pw, h:ph-settings.HITBOX_PADDING };
    const birdR={ x:bird.x+settings.HITBOX_PADDING, y:bird.y+settings.HITBOX_PADDING,
                  w:bird.w-2*settings.HITBOX_PADDING, h:bird.h-2*settings.HITBOX_PADDING };
    if (intersect(birdR, topR) || intersect(birdR, botR)) return handleGameOver();
    if (!p.scored && p.x+pw < bird.x){ p.scored = true; score++; AUD.point.play(); }
  });
}

// — Draw Play
function drawPlay(){
  ctx.drawImage(IMG.bg0,0,0,WIDTH,HEIGHT);
  pipes.forEach(p=>{
    ctx.save(); ctx.translate(p.x+IMG.pipe0.width/2,p.y); ctx.scale(1,-1);
    ctx.drawImage(IMG.pipe0,-IMG.pipe0.width/2,0); ctx.restore();
    ctx.drawImage(IMG.pipe0,p.x,p.y+ (gameMode==='SPEED_RUN'? SpeedRunSettings.PIPE_GAP : CLASSIC_SETTINGS.PIPE_GAP));
  });
  ctx.drawImage(IMG[`bird${bird.variant}`], bird.x,bird.y,bird.w,bird.h);
  let totalW=0, digits=Array.from(String(score),Number);
  digits.forEach(d=> totalW+= IMG[`num${d}`].width );
  let x0 = (WIDTH-totalW)/2;
  digits.forEach(d=> {
    ctx.drawImage(IMG[`num${d}`], x0, 20*(WIDTH/288));
    x0 += IMG[`num${d}`].width;
  });
  tileBase();
}

// — Tile Base
function tileBase(){
  const b = IMG.base, by = HEIGHT - b.height + 20;
  baseX = (baseX - 2) % b.width;
  for (let x = baseX - b.width; x < WIDTH; x += b.width) {
    ctx.drawImage(b, x, by);
  }
}

// — Handle Game Over
async function handleGameOver() {
  if (state !== 'PLAY') return;
  state = 'GAMEOVER';
  AUD.hit.play(); AUD.die.play();

  // build username
  const tg   = window.Telegram?.WebApp;
  const user = tg?.initDataUnsafe?.user || {};
  const username = user.username
    ? '@' + user.username
    : `${user.first_name}_${user.id}`;
  const durationMs = performance.now() - playStartTime; // Calculate play time
  const mode       = gameMode === 'CLASSIC' ? 'classic' : 'speed';

  try {
    const endpoint = mode === 'classic' ? 'submit' : 'SR-submit';
    await fetch(`${location.origin}/bush_did_it/${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, mode, score, durationMs })
    });
  } catch (e) {
    console.error('Submit error:', e);
  }
}

// — Main Loop
function gameLoop(){
  if (state==='PLAY') {
    updatePlay();
    drawPlay();
  } else if (state==='GAMEOVER') {
    drawGameOver();
  }
}

// — Kick off timing
lastTime = performance.now();