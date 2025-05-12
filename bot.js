require('dotenv').config();
const express     = require('express');
const path        = require('path');
const fs          = require('fs');
const TelegramBot = require('node-telegram-bot-api');

// ── Config ───────────────────────────────────────────────────────────────────
const TOKEN      = process.env.BOT_TOKEN;
const GAME_URL   = process.env.GAME_URL;
const PORT       = process.env.PORT || 3000;
const ADMIN_ID   = process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID, 10) : null;

// ── File paths for leaderboards ──────────────────────────────────────────────
const LB_PATH = path.join(__dirname, 'public', 'bush_did_it', 'leaderboard.json');
const SR_PATH = path.join(__dirname, 'public', 'bush_did_it', 'sr-leaderboard.json');
console.log('Saving SR scores to →', SR_PATH);

const { recordPlayTime, recordHighScore, getAnalytics } = require('./analytics');


// ── Quakk pick persistence ───────────────────────────────────────────────────
const PICKS_PATH = path.join(__dirname, 'QuakkPicks.json');
if (!fs.existsSync(PICKS_PATH)) {
  fs.writeFileSync(PICKS_PATH, '{}', 'utf8');
}
function readPicks() {
  try {
    return JSON.parse(fs.readFileSync(PICKS_PATH, 'utf8') || '{}');
  } catch {
    return {};
  }
}
function writePicks(picks) {
  fs.writeFileSync(PICKS_PATH, JSON.stringify(picks, null, 2), 'utf8');
}

// ── In-memory stores ─────────────────────────────────────────────────────────
let leaderboard   = [];
let srLeaderboard = [];

// ── Load/Save helpers ─────────────────────────────────────────────────────────
function loadLeaderboard() {
  try {
    const raw = fs.readFileSync(LB_PATH, 'utf-8');
    const data = JSON.parse(raw);
    leaderboard = Array.isArray(data) ? data : [];
  } catch {
    leaderboard = [];
    saveLeaderboard();
  }
}
function saveLeaderboard() {
  fs.writeFileSync(LB_PATH, JSON.stringify(leaderboard, null, 2), 'utf-8');
}
if (!fs.existsSync(SR_PATH)) {
  fs.writeFileSync(SR_PATH, '[]', 'utf-8');
}
function loadSRLeaderboard() {
  try {
    const raw = fs.readFileSync(SR_PATH, 'utf-8');
    srLeaderboard = JSON.parse(raw);
  } catch {
    srLeaderboard = [];
    saveSRLeaderboard();
  }
}
function saveSRLeaderboard() {
  console.log('🔄 Saving SR leaderboard to:', SR_PATH);
  console.log('   Data:', JSON.stringify(srLeaderboard, null, 2));
  try {
    fs.writeFileSync(SR_PATH, JSON.stringify(srLeaderboard, null, 2), 'utf-8');
    console.log('✅ SR leaderboard saved successfully');
  } catch (err) {
    console.error('❌ Failed to save SR leaderboard:', err);
    throw err;
  }
}

// initialize data stores
loadLeaderboard();
loadSRLeaderboard();

// ── Telegram Bot Setup ────────────────────────────────────────────────────────
const bot = new TelegramBot(TOKEN, { polling: true });
bot.on('polling_error', console.error);
// Command pattern for /start and /flap
const cmdPattern = /^\/(start|flap)(@\w+)?$/;
bot.onText(cmdPattern, msg => sendWelcome(msg));
bot.on('callback_query', q => bot.answerCallbackQuery(q.id));

// ── Admin-only Reset Commands ─────────────────────────────────────────────────
bot.onText(/^\/resetclassic(@\w+)?$/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (ADMIN_ID === null || userId !== ADMIN_ID) {
    return bot.sendMessage(chatId, '🚫 You are not authorized to use this command.');
  }
  leaderboard = [];
  saveLeaderboard();
  bot.sendMessage(chatId, '🦆 Classic leaderboard has been reset.');
});
bot.onText(/^\/resetspeed(@\w+)?$/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (ADMIN_ID === null || userId !== ADMIN_ID) {
    return bot.sendMessage(chatId, '🚫 You are not authorized to use this command.');
  }
  srLeaderboard = [];
  saveSRLeaderboard();
  bot.sendMessage(chatId, '🦆 Speed-Run leaderboard has been reset.');
});
// ── Admin-only Change Classic Score ──────────────────────────────────────────
bot.onText(/^!changeclassic\s+(\d+)$/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (ADMIN_ID === null || userId !== ADMIN_ID) {
    return bot.sendMessage(chatId, '🚫 You are not authorized to use this command.');
  }
  const newScore = parseInt(match[1], 10);
  const username = '@TheCryptoGuyOG';
  const existing = leaderboard.find(e => e.username === username);
  if (existing) existing.score = newScore;
  else leaderboard.push({ username, score: newScore });
  leaderboard.sort((a,b)=>b.score - a.score);
  leaderboard = leaderboard.slice(0,10);
  saveLeaderboard();
  bot.sendMessage(chatId, `✅ Classic score for ${username} set to ${newScore}.`);
});
// ── Admin-only Change Speed-Run Score ─────────────────────────────────────────
bot.onText(/^!changespeed\s+(\d+)$/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (ADMIN_ID === null || userId !== ADMIN_ID) {
    return bot.sendMessage(chatId, '🚫 You are not authorized to use this command.');
  }
  const newScore = parseInt(match[1], 10);
  const username = '@TheCryptoGuyOG';
  const existing = srLeaderboard.find(e => e.username === username);
  if (existing) existing.score = newScore;
  else srLeaderboard.push({ username, score: newScore });
  srLeaderboard.sort((a,b)=>b.score - a.score);
  srLeaderboard = srLeaderboard.slice(0,10);
  saveSRLeaderboard();
  bot.sendMessage(chatId, `✅ Speed-Run score for ${username} set to ${newScore}.`);
});
// ── Admin-only Kill Command ───────────────────────────────────────────────────
bot.onText(/^!kill\s+(\S+)\s+(classic|speed)$/i, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (ADMIN_ID === null || userId !== ADMIN_ID) {
    return bot.sendMessage(chatId, '🚫 You are not authorized to use this command.');
  }
  let username = match[1]; if (!username.startsWith('@')) username = '@'+username;
  const mode = match[2].toLowerCase();
  if (mode==='classic'){
    const before = leaderboard.length;
    leaderboard = leaderboard.filter(e=>e.username!==username);
    if (leaderboard.length<before){ saveLeaderboard(); bot.sendMessage(chatId, `✅ Removed ${username} from Classic leaderboard.`);} 
    else bot.sendMessage(chatId, `⚠️ ${username} not found on Classic leaderboard.`);
  } else {
    const before = srLeaderboard.length;
    srLeaderboard = srLeaderboard.filter(e=>e.username!==username);
    if (srLeaderboard.length<before){ saveSRLeaderboard(); bot.sendMessage(chatId, `✅ Removed ${username} from Speed-Run leaderboard.`);} 
    else bot.sendMessage(chatId, `⚠️ ${username} not found on Speed-Run leaderboard.`);
  }
});

bot.onText(/^!analytics$/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (ADMIN_ID === null || userId !== ADMIN_ID) {
    return bot.sendMessage(chatId, 'You are not authorized to use this command.');
  }

  getAnalytics((err, rows) => {
    if (err) {
      console.error('Analytics error:', err);
      return bot.sendMessage(chatId, 'Failed to fetch analytics.');
    }
    if (!rows.length) {
      return bot.sendMessage(chatId, 'No analytics data yet.');
    }

    // Helper function to convert decimal minutes to HH:MM:SS
    function formatTime(minutes) {
      const totalSeconds = Math.round(minutes * 60); // Convert minutes to seconds
      const hours = Math.floor(totalSeconds / 3600);
      const mins = Math.floor((totalSeconds % 3600) / 60);
      const secs = totalSeconds % 60;
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // Calculate totals across all players
    const totalClassicMinutes = rows.reduce((sum, r) => sum + r.classic_time_played, 0);
    const totalSpeedMinutes = rows.reduce((sum, r) => sum + r.speed_time_played, 0);

    // Format per-player data as plain text
    const lines = rows.map(r => {
      return `${r.username}, Classic Time: ${formatTime(r.classic_time_played)}, Classic Score: ${r.classic_high_score}, Speed Run Time: ${formatTime(r.speed_time_played)}, Speed Run Score: ${r.speed_high_score}`;
    });

    // Construct message
    const text = [
      '🦆Game Analytics🦆\n',

      ...lines,
      '',
      `Total Classic Time: ${formatTime(totalClassicMinutes)}`,
      `Total Speed Run Time: ${formatTime(totalSpeedMinutes)}`
    ].join('\n');

    bot.sendMessage(chatId, text);
  });
});
// ── sendWelcome ──────────────────────────────────────────────────────────────
function sendWelcome(msg) {
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === 'private';
  let button;
  if (isPrivate) button = { text: '▶️ Play Flappy Quakks', web_app:{url:GAME_URL} };
  else {
    const from=msg.from;
    const uname = from.username? '@'+from.username : `${from.first_name}_${from.id}`;
    const urlWithUser = `${GAME_URL}?username=${encodeURIComponent(uname)}`;
    button = { text: '▶️ Play Flappy Quakks', url:urlWithUser };
  }
  bot.sendMessage(chatId,
    'Welcome to 🦆 Flappy Quakks!\nTap below to begin.',
    { reply_markup:{ inline_keyboard:[[button]] } }
  );
}

// ── Express Server Setup ─────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(
  '/bush_did_it',
  express.static(path.join(__dirname, 'public', 'bush_did_it'))
);

// ── Quakk pick endpoints ───────────────────────────────────────────────────
app.get('/bush_did_it/getQuakk', (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error:'username required' });
  const picks = readPicks();
  res.json({ variant: picks[username] ?? null });
});

app.post('/bush_did_it/selectQuakk', (req, res) => {
  const { username, variant } = req.body;
  if (!username || variant == null) return res.status(400).json({ error:'username & variant required' });
  const picks = readPicks();
  picks[username] = variant;
  writePicks(picks);
  res.json({ success:true });
});

// ── Classic Leaderboard Endpoints ─────────────────────────────────────────
app.post('/bush_did_it/submit', (req, res) => {
  const { username, score, mode, durationMs } = req.body;
  if (typeof username!=='string' 
      || typeof score!=='number' 
      || typeof durationMs!=='number') {
    return res.status(400).json({ error:'Invalid payload' });
  }
  // leaderboard JSON logic (unchanged)…
  const existing = leaderboard.find(e=>e.username===username);
  if (existing) {
    if (score > existing.score) existing.score = score;
  } else {
    leaderboard.push({ username, score });
  }
  leaderboard.sort((a,b)=>b.score-a.score);
  leaderboard = leaderboard.slice(0,10);
  try {
    saveLeaderboard();
    // record into analytics.db
    recordPlayTime(username, 'classic', durationMs);
    recordHighScore(username, 'classic', score);
    res.json({ status:'ok' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error:'Could not save leaderboard' });
  }
});

// ── Speed-Run Leaderboard Endpoints ─────────────────────────────────────────
app.post('/bush_did_it/SR-submit', (req, res) => {
  const { username, score, mode, durationMs } = req.body;
  if (typeof username!=='string' 
      || typeof score!=='number' 
      || typeof durationMs!=='number') {
    return res.status(400).json({ error:'Invalid payload' });
  }
  // srLeaderboard JSON logic (unchanged)…
  const existing = srLeaderboard.find(e=>e.username===username);
  if (existing) {
    if (score > existing.score) existing.score = score;
  } else {
    srLeaderboard.push({ username, score });
  }
  srLeaderboard.sort((a,b)=>b.score-a.score);
  srLeaderboard = srLeaderboard.slice(0,10);
  try {
    saveSRLeaderboard();
    // record into analytics.db
    recordPlayTime(username, 'speed', durationMs);
    recordHighScore(username, 'speed', score);
    res.json({ status:'ok' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error:'Could not save SR leaderboard' });
  }
});

// Classic Leaderboard JSON
app.get('/bush_did_it/leaderboard', (req, res) => {
  res.json(leaderboard.slice(0, 10));
});

// Speed-Run Leaderboard JSON
app.get('/bush_did_it/SR-leaderboard', (req, res) => {
  res.json(srLeaderboard.slice(0, 10));
});


// ── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});