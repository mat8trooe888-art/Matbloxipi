const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Подключение к PostgreSQL (используем переменную окружения DATABASE_URL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // для разработки и Render (требуется SSL)
  }
});

// Создание таблиц при старте (если их нет)
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      coins INT DEFAULT 500,
      inventory TEXT,
      friends TEXT,
      isGuest BOOLEAN DEFAULT FALSE
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      author VARCHAR(50) NOT NULL,
      description TEXT,
      data TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      user VARCHAR(50) NOT NULL,
      text TEXT NOT NULL,
      time VARCHAR(20)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      user VARCHAR(50) NOT NULL,
      text TEXT NOT NULL,
      time VARCHAR(50)
    )
  `);
  console.log('Database tables ready');
}
initDB();

// ---- API роуты ----

// Регистрация
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const existing = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (existing.rows.length) return res.status(400).json({ error: 'User already exists' });
    await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, password]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Логин
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
    if (result.rows.length) {
      const user = result.rows[0];
      res.json({
        success: true,
        user: {
          username: user.username,
          coins: user.coins,
          inventory: user.inventory ? JSON.parse(user.inventory) : [],
          friends: user.friends ? JSON.parse(user.friends) : []
        }
      });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Получить все игры
app.get('/api/games', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, author, description FROM games ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Сохранить игру
app.post('/api/games', async (req, res) => {
  const { name, author, description, data } = req.body;
  if (!name || !author || !data) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO games (name, author, description, data) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, author, description || '', JSON.stringify(data)]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Удалить игру (только автор)
app.delete('/api/games/:id', async (req, res) => {
  const { id } = req.params;
  const { author } = req.body;
  if (!author) return res.status(400).json({ error: 'Author required' });
  try {
    const result = await pool.query('DELETE FROM games WHERE id = $1 AND author = $2', [id, author]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Game not found or not yours' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Обновить монеты
app.post('/api/updateCoins', async (req, res) => {
  const { username, coins } = req.body;
  try {
    await pool.query('UPDATE users SET coins = $1 WHERE username = $2', [coins, username]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Добавить сообщение в чат
app.post('/api/chat', async (req, res) => {
  const { user, text, time } = req.body;
  try {
    await pool.query('INSERT INTO chat_messages (user, text, time) VALUES ($1, $2, $3)', [user, text, time]);
    await pool.query('DELETE FROM chat_messages WHERE id NOT IN (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 100)');
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Получить последние 50 сообщений чата
app.get('/api/chat', async (req, res) => {
  try {
    const result = await pool.query('SELECT user, text, time FROM chat_messages ORDER BY id ASC LIMIT 50');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Добавить репорт
app.post('/api/reports', async (req, res) => {
  const { user, text, time } = req.body;
  try {
    await pool.query('INSERT INTO reports (user, text, time) VALUES ($1, $2, $3)', [user, text, time]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Получить репорты
app.get('/api/reports', async (req, res) => {
  try {
    const result = await pool.query('SELECT user, text, time FROM reports ORDER BY id DESC LIMIT 50');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API server running on port ${PORT}`));