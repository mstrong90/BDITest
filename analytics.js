const path = require('path');
const fs = require('fs');

// Paths
const PLAY_TIMES_PATH = path.resolve(__dirname, 'public', 'flappy_quakks', 'play-times.json');
const LB_PATH = path.resolve(__dirname, 'public', 'flappy_quakks', 'leaderboard.json');
const SR_PATH = path.resolve(__dirname, 'public', 'flappy_quakks', 'sr-leaderboard.json');

// Initialize play-times.json if it doesn't exist
if (!fs.existsSync(PLAY_TIMES_PATH)) {
  fs.writeFileSync(PLAY_TIMES_PATH, '[]', 'utf8');
}

// Helper functions to read/write JSON
function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8') || '[]');
  } catch (e) {
    console.error(`Failed to read ${filePath}:`, e);
    return [];
  }
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`Failed to write ${filePath}:`, e);
    throw e;
  }
}

/**
 * Record a single play session duration.
 */
function recordPlayTime(username, mode, durationMs) {
  const minutes = durationMs / 60000;
  const playTimes = readJSON(PLAY_TIMES_PATH);
  let user = playTimes.find(p => p.username === username);
  if (!user) {
    user = { username, classic_time_played: 0, speed_time_played: 0 };
    playTimes.push(user);
  }
  const key = mode === 'classic' ? 'classic_time_played' : 'speed_time_played';
  user[key] = parseFloat((user[key] + minutes).toFixed(2));
  writeJSON(PLAY_TIMES_PATH, playTimes);
}

/**
 * Record or update the high score for a mode (no-op, handled by leaderboard JSONs).
 */
function recordHighScore(username, mode, score) {
  // No-op: High scores are managed in leaderboard.json and sr-leaderboard.json
  // This function is kept for compatibility with existing calls in bot.js
}

/**
 * Get a summary report merging play times and leaderboard high scores.
 */
function getAnalytics(callback) {
  try {
    const playTimes = readJSON(PLAY_TIMES_PATH);
    const classicBoard = readJSON(LB_PATH);
    const speedBoard = readJSON(SR_PATH);

    // Merge play times with leaderboard high scores
    const summary = playTimes.map(user => {
      const classicHighScore = classicBoard.find(e => e.username === user.username)?.score || 0;
      const speedHighScore = speedBoard.find(e => e.username === user.username)?.score || 0;
      return {
        username: user.username,
        classic_time_played: user.classic_time_played,
        speed_time_played: user.speed_time_played,
        classic_high_score: classicHighScore,
        speed_high_score: speedHighScore
      };
    });

    callback(null, summary);
  } catch (e) {
    callback(e);
  }
}

module.exports = { recordPlayTime, recordHighScore, getAnalytics };