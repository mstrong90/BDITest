console.log('✅ script.js loaded');

// — Import Speed Run settings
import * as SpeedRunSettings from './speedRunSettings.js';

// — If launched from a group “Play” button, pick up the passed username:
const urlParams      = new URLSearchParams(window.location.search);
const GROUP_USERNAME = urlParams.get('username');

// — Canvas & context
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

// — Dynamic canvas sizing
let WIDTH, HEIGHT;
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  WIDTH  = window.innerWidth;
  HEIGHT = window.innerHeight;
  canvas.width  = WIDTH  * dpr;
  canvas.height = HEIGHT * dpr;
  canvas.style.width  = `${WIDTH}px`;
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
  FPS:            60,
  GRAVITY:        975,   // px/s²
  FLAP_V:         -250,  // px/s
  PIPE_SPEED:     200,   // px/s
  SPAWN_INT:      1.5,   // seconds between pipes
  PIPE_GAP:       180,   // px
  HITBOX_PADDING: 6      // px inset for collision
};

// — Asset paths
const PATH = 'assets/';
const SPRITES = {
  bg:    [PATH+'sprites/bg.png'],
  pipe:  [PATH+'sprites/pipe-green.png', PATH+'sprites/pipe-red.png'],
  base:  PATH+'sprites/base.png',
  bird: [
    PATH + 'sprites/duck.png',
    PATH + 'sprites/duck1.png',
    PATH + 'sprites/duck2.png',
    PATH + 'sprites/duck3.png',
    PATH + 'sprites/duck4.png',
    PATH + 'sprites/duck5.png',
    PATH + 'sprites/duck6.png',
    PATH + 'sprites/duck7.png',
    PATH + 'sprites/duck8.png'
  ],
  nums:  Array.from({length:10},(_,i)=> PATH+`sprites/${i}.png`),
  msg:   PATH+'sprites/message.png',
  over:  PATH+'sprites/gameover.png'
};
const SOUNDS = {
  die:   PATH+'audio/die.ogg',
  hit:   PATH+'audio/hit.ogg',
  point: PATH+'audio/point.ogg',
  wing:  PATH+'audio/wing.ogg'
};

// — State & core variables
let state      = 'MODE_SELECT';
let gameMode   = null; // 'CLASSIC' or 'SPEED_RUN'
let lastTime   = 0;
let spawnTimer = 0;
let score      = 0;
let pipes      = [];
let baseX      = 0;
let topList    = [];
let lastDifficultyScore = 0;
let difficultyCycle     = 0;

// — Duck (scaled)
const BIRD_W     = 34, BIRD_H = 34, BIRD_SCALE = 1.9;
const bird = {
  x:      0,
  y:      0,
  vy:     0,
  w:      BIRD_W * BIRD_SCALE,
  h:      BIRD_H * BIRD_SCALE,
  frame:  0,
  flapped:false,
  variant: 0
};

// — Buttons
const Btn = {
  classic:     { x:0,y:0,w:150,h:50,label:'Classic'       },
  speedRun:    { x:0,y:0,w:150,h:50,label:'Speed Run'     },
  start:       { x:0,y:0,w:150,h:50,label:'Start'         },
  leaderboard: { x:0,y:0,w:150,h:50,label:'Leaderboard'   },
  srLeaderboard:{x:0,y:0,w:150,h:50,label:'SR Leaderboard'},
  chooseQuakk: { x:0,y:0,w:150,h:50,label:'Choose Quakk'  }
};

// — Hit areas for duck selection
const chooseAreas = {};

// — Asset containers & loading
const IMG = { bg:[], pipe:[], bird:[], nums:[], base:null, msg:null, over:null };
const AUD = {};
let loadedImages = 0;
const TOTAL_IMAGES =
  SPRITES.bg.length +
  SPRITES.pipe.length +
  1 +
  SPRITES.bird.length +
  SPRITES.nums.length +
  1 +
  1;

function loadImage(src, store, key){
  const img = new Image();
  img.src = src;
  img.onload  = () => { store[key] = img; if (++loadedImages === TOTAL_IMAGES) init(); };
  img.onerror = () => console.error('Failed to load:', src);
}

// load images
SPRITES.bg.forEach((u,i)=> loadImage(u, IMG, `bg${i}`));
SPRITES.pipe.forEach((u,i)=> loadImage(u, IMG, `pipe${i}`));
loadImage(SPRITES.base, IMG, 'base');
SPRITES.bird.forEach((u,i)=> loadImage(u, IMG, `bird${i}`));
SPRITES.nums.forEach((u,i)=> loadImage(u, IMG, `num${i}`));
loadImage(SPRITES.msg, IMG, 'msg');
loadImage(SPRITES.over, IMG, 'over');

// load sounds
Object.entries(SOUNDS).forEach(([k,url])=>{
  const a = new Audio(url);
  a.load();
  AUD[k] = a;
});

// — Variant bag to avoid repeats
let variantBag = [];
function refillVariantBag(){
  variantBag = SPRITES.bird.map((_,i) => i);
  for(let i = variantBag.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [variantBag[i], variantBag[j]] = [variantBag[j], variantBag[i]];
  }
}
refillVariantBag();

// — Helpers
function randInt(min,max){ return Math.floor(min + Math.random()*(max-min+1)); }
function intersect(a,b){
  return a.x < b.x + b.w &&
         a.x + a.w > b.x &&
         a.y < b.y + b.h &&
         a.y + a.h > b.y;
}

// — Load saved duck from server
async function loadServerVariant(){
  try {
    const tg = window.Telegram.WebApp;
    const user = tg.initDataUnsafe.user || {};
    const username = user.username
      ? '@' + user.username
      : `${user.first_name}_${user.id}`;
    const res = await fetch(
      `${location.origin}/flappy_quakks/getQuakk?username=${encodeURIComponent(username)}`
    );
    if (!res.ok) throw new Error();
    const { variant } = await res.json();
    if (variant != null){
      bird.variant = variant;
      variantBag = variantBag.filter(v => v !== variant);
      localStorage.setItem('quakkVariant', variant);
    }
  } catch {}
}

// — Init when assets ready
function init(){
  // load from localStorage first
  const savedLS = localStorage.getItem('quakkVariant');
  if (savedLS != null){
    bird.variant = parseInt(savedLS, 10);
    variantBag = variantBag.filter(v => v !== bird.variant);
  }
  // then override from server
  loadServerVariant().finally(()=>{
    drawModeSelect();
    lastTime = performance.now();
    setInterval(gameLoop, 1000/CLASSIC_SETTINGS.FPS);
  });
}

// — Input handling
canvas.addEventListener('pointerdown', handlePointer, { passive:false });
canvas.addEventListener('touchstart', e => e.preventDefault(), { passive:false });
document.addEventListener('keydown', e=>{
  if (e.code==='Space' && state==='PLAY'){
    bird.flapped = true;
    e.preventDefault();
  }
});

function handlePointer(e){
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  const mx = (cx - rect.left) * (WIDTH/rect.width);
  const my = (cy - rect.top ) * (HEIGHT/rect.height);

  if (state==='MODE_SELECT'){
    if (intersect({x:mx,y:my,w:0,h:0}, Btn.classic)){
      gameMode = 'CLASSIC';
      state = 'WELCOME';
      drawWelcome();
    }
    else if (intersect({x:mx,y:my,w:0,h:0}, Btn.speedRun)){
      gameMode = 'SPEED_RUN';
      state = 'WELCOME';
      drawWelcome();
    }
  }
  else if (state==='WELCOME'){
    if (intersect({x:mx,y:my,w:0,h:0}, Btn.start)){
      startPlay();
    }
    else if (intersect({x:mx,y:my,w:0,h:0}, gameMode==='CLASSIC'?Btn.leaderboard:Btn.srLeaderboard)){
      fetchLeaderboard();
    }
    else if (intersect({x:mx,y:my,w:0,h:0}, Btn.chooseQuakk)){
      state = 'PICK_QUAKK';
      drawQuakkSelection();
    }
  }
  else if (state==='PICK_QUAKK'){
    for (let i in chooseAreas){
      const a = chooseAreas[i];
      if (mx>=a.x && mx<=a.x+a.w && my>=a.y && my<=a.y+a.h){
        // user picked duck i
        bird.variant = Number(i);
        localStorage.setItem('quakkVariant', i);
        // persist to server
        const tg = window.Telegram.WebApp;
        const user = tg.initDataUnsafe.user || {};
        const uname = user.username
          ? '@'+user.username
          : `${user.first_name}_${user.id}`;
        fetch(`${location.origin}/flappy_quakks/selectQuakk`,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ username:uname, variant:Number(i) })
        }).catch(console.error);
        // back to welcome
        state='WELCOME';
        drawWelcome();
        return;
      }
    }
  }
  else if (state==='PLAY'){
    bird.flapped = true;
  }
  else if (state==='GAMEOVER'){
    if (intersect({x:mx,y:my,w:0,h:0}, Btn.start)){
      startPlay();
    }
    else if (intersect({x:mx,y:my,w:0,h:0}, gameMode==='CLASSIC'?Btn.leaderboard:Btn.srLeaderboard)){
      fetchLeaderboard();
    }
  }
  else if (state==='LEADERBOARD'){
    state='WELCOME';
    drawWelcome();
  }
}

// — Choose Quakk screen
function drawQuakkSelection(){
  ctx.drawImage(IMG.bg0,0,0,WIDTH,HEIGHT);
  ctx.font = `${20*(WIDTH/288)}px Arial`;
  ctx.fillStyle = '#fff';
  ctx.fillText('Tap your favorite duck:', 20, 40);
  const cols=3, size=60, padding=20;
  SPRITES.bird.forEach((_,i)=>{
    const col = i%cols, row=Math.floor(i/cols);
    const x=padding+col*(size+padding), y=60+row*(size+padding);
    ctx.drawImage(IMG[`bird${i}`], x,y, size,size);
    chooseAreas[i] = { x,y,w:size,h:size };
  });
}

// — DRAW MODE SELECT
function drawModeSelect(){
  ctx.drawImage(IMG.bg0,0,0,WIDTH,HEIGHT);
  tileBase();
  ctx.drawImage(IMG.msg,(WIDTH-IMG.msg.width)/2,HEIGHT*0.12);
  ctx.drawImage(IMG[`bird${bird.variant}`], bird.x,bird.y+8*Math.sin(performance.now()/200), bird.w,bird.h);
  [Btn.classic,Btn.speedRun].forEach((b,i)=>{
    b.x = WIDTH/2-75; b.y = HEIGHT*(i?0.7:0.6);
    ctx.fillStyle='#fff'; ctx.fillRect(b.x,b.y,b.w,b.h);
    ctx.fillStyle='#000'; ctx.font=`${20*(WIDTH/288)}px Arial`;
    ctx.fillText(b.label, b.x+(b.w-ctx.measureText(b.label).width)/2, b.y+32*(WIDTH/288));
  });
}

// — DRAW WELCOME
function drawWelcome(){
  ctx.drawImage(IMG.bg0,0,0,WIDTH,HEIGHT);
  tileBase();
  ctx.drawImage(IMG.msg,(WIDTH-IMG.msg.width)/2,HEIGHT*0.12);
  bird.frame = ++bird.frame % SPRITES.bird.length;
  ctx.drawImage(IMG[`bird${bird.frame}`], bird.x,bird.y+8*Math.sin(performance.now()/200), bird.w,bird.h);
  Btn.start.x=WIDTH/2-75; Btn.start.y=HEIGHT*0.6;
  const lbBtn = gameMode==='CLASSIC'?Btn.leaderboard:Btn.srLeaderboard;
  lbBtn.x=WIDTH/2-75; lbBtn.y=HEIGHT*0.7;
  [Btn.start, lbBtn].forEach(b=>{
    ctx.fillStyle='#fff'; ctx.fillRect(b.x,b.y,b.w,b.h);
    ctx.fillStyle='#000'; ctx.font=`${20*(WIDTH/288)}px Arial`;
    ctx.fillText(b.label, b.x+(b.w-ctx.measureText(b.label).width)/2, b.y+32*(WIDTH/288));
  });
  Btn.chooseQuakk.x=WIDTH/2-75; Btn.chooseQuakk.y=HEIGHT*0.8;
  ctx.fillStyle='#fff'; ctx.fillRect(Btn.chooseQuakk.x,Btn.chooseQuakk.y,Btn.chooseQuakk.w,Btn.chooseQuakk.h);
  ctx.fillStyle='#000'; ctx.font=`${20*(WIDTH/288)}px Arial`;
  ctx.fillText(Btn.chooseQuakk.label, Btn.chooseQuakk.x+(Btn.chooseQuakk.w-ctx.measureText(Btn.chooseQuakk.label).width)/2, Btn.chooseQuakk.y+32*(WIDTH/288));
}

// — DRAW GAME OVER
function drawGameOver(){
  ctx.drawImage(IMG.bg0,0,0,WIDTH,HEIGHT);
  tileBase();
  ctx.drawImage(IMG.over,(WIDTH-IMG.over.width)/2,HEIGHT*0.2);
  const scoreText = `Score: ${score}`;
  ctx.fillStyle='#fff'; ctx.font=`${24*(WIDTH/288)}px Arial`;
  const textW = ctx.measureText(scoreText).width;
  ctx.fillText(scoreText,(WIDTH-textW)/2,HEIGHT*0.4);
  const btnY = HEIGHT*0.6;
  Btn.start.x=WIDTH/2-160; Btn.start.y=btnY;
  const lb = gameMode==='CLASSIC'?Btn.leaderboard:Btn.srLeaderboard;
  lb.x=WIDTH/2+10; lb.y=btnY;
  [Btn.start, lb].forEach(b=>{
    ctx.fillStyle='#fff'; ctx.fillRect(b.x,b.y,b.w,b.h);
    ctx.fillStyle='#000'; ctx.font=`${20*(WIDTH/288)}px Arial`;
    ctx.fillText(b.label, b.x+(b.w-ctx.measureText(b.label).width)/2, b.y+32*(WIDTH/288));
  });
}

// — FETCH & DRAW LEADERBOARD
async function fetchLeaderboard(){
  try {
    const endpoint = gameMode==='CLASSIC'?'leaderboard':'SR-leaderboard';
    const res = await fetch(`${location.origin}/flappy_quakks/${endpoint}`);
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    topList = await res.json();
    state = 'LEADERBOARD';
    drawLeaderboard();
  } catch(e) {
    console.error('Leaderboard load failed', e);
  }
}
function drawLeaderboard(){
  ctx.drawImage(IMG.bg0,0,0,WIDTH,HEIGHT);
  ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.fillRect(0,0,WIDTH,HEIGHT);
  ctx.fillStyle='#fff'; ctx.font=`${24*(WIDTH/288)}px Arial`;
  ctx.fillText(`🏆 Top 10 ${gameMode==='CLASSIC'?'Classic':'Speed Run'}`, WIDTH/2-120, 50);
  ctx.font=`${18*(WIDTH/288)}px Arial`;
  topList.slice(0,10).forEach((e,i)=>{
    ctx.fillText(`${i+1}. ${e.username}: ${e.score}`, 30, 100 + i*30);
  });
  ctx.fillText('Tap anywhere to restart', WIDTH/2-90, HEIGHT-40);
}

// — START PLAY
function startPlay(){
  state      = 'PLAY';
  score      = 0;
  bird.vy    = 0;
  bird.x     = WIDTH * 0.2;
  bird.y     = (HEIGHT - bird.h)/2;
  spawnTimer = -CLASSIC_SETTINGS.SPAWN_INT;
  lastTime   = performance.now();
  lastDifficultyScore = 0;
  difficultyCycle     = 0;
  if (variantBag.length === 0) refillVariantBag();
  bird.variant = variantBag.pop();
  spawnInitial();
  AUD.wing.play();
}

// — UPDATE PLAY
function updatePlay(){
  const settings = gameMode==='SPEED_RUN'?SpeedRunSettings:CLASSIC_SETTINGS;
  const now = performance.now(), dt = (now-lastTime)/1000;
  lastTime = now;
  if(score>=25 && score%25===0 && score>lastDifficultyScore && !pipes.some(p=>!p.scored)){
    if      (difficultyCycle%3===0) settings.PIPE_GAP   = Math.max(100, settings.PIPE_GAP-10);
    else if (difficultyCycle%3===1) settings.PIPE_SPEED = Math.min(400, settings.PIPE_SPEED+20);
    else                            settings.SPAWN_INT  = Math.max(0.5, settings.SPAWN_INT-0.1);
    difficultyCycle++;
    lastDifficultyScore = score;
  }
  spawnTimer += dt;
  if(spawnTimer>=settings.SPAWN_INT){ spawnPipe(); spawnTimer-=settings.SPAWN_INT; }
  pipes.forEach(p=>p.x -= settings.PIPE_SPEED * dt);
  pipes = pipes.filter(p=>p.x + IMG.pipe0.width > 0);
  bird.vy += settings.GRAVITY * dt;
  if(bird.flapped){ bird.vy = settings.FLAP_V; bird.flapped=false; AUD.wing.play(); }
  bird.y += bird.vy * dt;
  if(bird.y<0 || bird.y+bird.h>HEIGHT*0.85) return handleGameOver();
  pipes.forEach(p=>{
    const pw=IMG.pipe0.width, ph=IMG.pipe0.height;
    const topR={x:p.x,y:p.y-ph+settings.HITBOX_PADDING,w:pw,h:ph-settings.HITBOX_PADDING};
    const botR={x:p.x,y:p.y+settings.PIPE_GAP,w:pw,h:ph-settings.HITBOX_PADDING};
    const birdR={x:bird.x+settings.HITBOX_PADDING,y:bird.y+settings.HITBOX_PADDING,
                 w:bird.w-2*settings.HITBOX_PADDING,h:bird.h-2*settings.HITBOX_PADDING};
    if(intersect(birdR, topR)||intersect(birdR, botR)) return handleGameOver();
    if(!p.scored && p.x+pw<bird.x){ p.scored=true; score++; AUD.point.play(); }
  });
}

// — DRAW PLAY
function drawPlay(){
  ctx.drawImage(IMG.bg0,0,0,WIDTH,HEIGHT);
  pipes.forEach(p=>{
    const pw=IMG.pipe0.width, ph=IMG.pipe0.height;
    ctx.save(); ctx.translate(p.x+pw/2,p.y); ctx.scale(1,-1);
    ctx.drawImage(IMG.pipe0,-pw/2,0); ctx.restore();
    ctx.drawImage(IMG.pipe0,p.x,p.y+settings.PIPE_GAP);
  });
  ctx.drawImage(IMG[`bird${bird.variant}`], bird.x,bird.y,bird.w,bird.h);
  let totalW=0, digits=Array.from(String(score),Number);
  digits.forEach(d=> totalW += IMG[`num${d}`].width );
  let x0 = (WIDTH - totalW)/2;
  digits.forEach(d=> {
    ctx.drawImage(IMG[`num${d}`], x0, 20*(WIDTH/288));
    x0 += IMG[`num${d}`].width;
  });
  tileBase();
}

// — TILE BASE
function tileBase(){
  const b = IMG.base, by = HEIGHT - b.height + 20;
  baseX = (baseX - 2) % b.width;
  for(let x = baseX - b.width; x < WIDTH; x += b.width) {
    ctx.drawImage(b, x, by);
  }
}

// — GAME OVER handler
async function handleGameOver(){
  if(state !== 'PLAY') return;
  state = 'GAMEOVER';
  AUD.hit.play();
  AUD.die.play();

  // 1) safely get the Telegram WebApp object:
  const tg = window.Telegram?.WebApp;
  // 2) then pull the initDataUnsafe.user out of it (or fallback to {})
  const user = tg?.initDataUnsafe?.user || {};
  // 3) build your username string exactly like in DM
  const username = user.username
    ? '@' + user.username
    : `${user.first_name || 'user'}_${user.id || 0}`;

  // now submit with that username
  try {
    const endpoint = gameMode === 'CLASSIC' ? 'submit' : 'SR-submit';
    await fetch(`${location.origin}/flappy_quakks/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, score })
    });
  } catch(e) {
    console.error('Submit error:', e);
  }
}

// — Kick off timing
lastTime = performance.now();
