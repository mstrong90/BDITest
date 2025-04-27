// bot.js

require('dotenv').config();
const express     = require('express');
const path        = require('path');
const fs          = require('fs');
const TelegramBot = require('node-telegram-bot-api');

// ── Config ───────────────────────────────────────────────────────────────────
const TOKEN    = process.env.BOT_TOKEN;
const GAME_URL = process.env.GAME_URL;
const PORT     = process.env.PORT || 3000;
const DB_PATH  = path.join(__dirname, 'leaderboard.json');

// ── Load or initialize leaderboard ────────────────────────────────────────────
let leaderboard = [];
try {
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  leaderboard = JSON.parse(raw);
  if (!Array.isArray(leaderboard)) throw new Error('Not an array');
} catch {
  console.log('Initializing leaderboard.json');
  leaderboard = [];
  fs.writeFileSync(DB_PATH, JSON.stringify(leaderboard, null, 2), 'utf-8');
}

// ── Helper to save ────────────────────────────────────────────────────────────
function saveLeaderboard() {
  fs.writeFileSync(DB_PATH, JSON.stringify(leaderboard, null, 2), 'utf-8');
}

// ── Telegram Bot Setup ─────────────────────────────────────────────────────────
const bot = new TelegramBot(TOKEN, { polling: true });
bot.on('polling_error', console.error);

function sendWelcome(msg) {
  const chatId    = msg.chat.id;
  const isPrivate = msg.chat.type === 'private';
  const button    = isPrivate
    ? { text: '▶️ Play Flappy Quakks', web_app: { url: GAME_URL } }
    : { text: '▶️ Play Flappy Quakks', url:      GAME_URL };

  bot.sendMessage(chatId,
    'Welcome to 🦆 Flappy Quakks!\nTap below to begin.',
    { reply_markup: { inline_keyboard: [[ button ]] } }
  );
}
const cmdPattern = /^\/(start|flap)(@\w+)?$/;
bot.onText(cmdPattern, msg => sendWelcome(msg));
bot.on('callback_query', q => bot.answerCallbackQuery(q.id));

// ── Express Server Setup ──────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.use(
  '/flappy_quakks',
  express.static(path.join(__dirname, 'public', 'flappy_quakks'))
);

// POST new score
app.post('/flappy_quakks/submit', (req, res) => {
  console.log('📝 Received SCORE SUBMIT:', req.body);
  const { username, score } = req.body;
  if (typeof username !== 'string' || typeof score !== 'number') {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const existing = leaderboard.find(e => e.username === username);
  if (existing) {
    if (score > existing.score) {
      console.log(`Updating ${username}: ${existing.score} → ${score}`);
      existing.score = score;
    }
  } else {
    console.log(`Adding ${username}: ${score}`);
    leaderboard.push({ username, score });
  }

  leaderboard.sort((a, b) => b.score - a.score);
  try {
    saveLeaderboard();
    console.log('Leaderboard saved:', leaderboard);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('❌ Failed to save leaderboard:', err);
    res.status(500).json({ error: 'Could not save leaderboard' });
  }
});

// GET top-10
app.get('/flappy_quakks/leaderboard', (req, res) => {
  console.log('GET LEADERBOARD →', leaderboard.slice(0, 10));
  res.json(leaderboard.slice(0, 10));
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  console.log(`   • Game URL:       ${GAME_URL}`);
  console.log(`   • Leaderboard DB: ${DB_PATH}`);
});
