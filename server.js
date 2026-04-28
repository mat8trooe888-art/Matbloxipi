const express = require('express');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// Подключение к PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(express.json());

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    next();
});

// Инициализация таблиц
async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(100) NOT NULL,
                coins INTEGER DEFAULT 0,
                inventory TEXT DEFAULT '[]',
                friends TEXT DEFAULT '[]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS games (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                author VARCHAR(50) NOT NULL,
                description TEXT DEFAULT '',
                data JSONB DEFAULT '{}',
                published BOOLEAN DEFAULT false,
                likes INTEGER DEFAULT 0,
                visits INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS game_likes (
                id SERIAL PRIMARY KEY,
                game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
                username VARCHAR(50) NOT NULL,
                UNIQUE(game_id, username)
            );
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                room_id VARCHAR(100),
                username VARCHAR(50),
                text TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ База данных готова');
    } catch (err) {
        console.error('❌ Ошибка инициализации БД:', err);
    } finally {
        client.release();
    }
}

// Проверка reCAPTCHA (используем встроенный fetch)
async function verifyRecaptcha(token) {
    const secret = process.env.RECAPTCHA_SECRET || '6LenLM4sAAAAADfpByD4FChLels6okmu9hpPFn75';
    const response = await fetch(`https://www.google.com/recaptcha/api/siteverify?secret=${secret}&response=${token}`, {
        method: 'POST'
    });
    const data = await response.json();
    return data.success;
}

// ========== ЭНДПОИНТЫ ==========

app.post('/api/register', async (req, res) => {
    const { username, password, recaptchaToken } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Имя и пароль обязательны' });
    }
    const captchaOk = await verifyRecaptcha(recaptchaToken);
    if (!captchaOk) {
        return res.status(400).json({ success: false, error: 'Не пройдена проверка reCAPTCHA' });
    }

    try {
        await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, password]);
        res.json({ success: true });
    } catch (err) {
        if (err.code === '23505') {
            res.status(400).json({ success: false, error: 'Пользователь уже существует' });
        } else {
            console.error(err);
            res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
        }
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            res.json({
                success: true,
                user: {
                    username: user.username,
                    coins: user.coins,
                    inventory: JSON.parse(user.inventory || '[]'),
                    friends: JSON.parse(user.friends || '[]')
                }
            });
        } else {
            res.status(401).json({ success: false, error: 'Неверное имя пользователя или пароль' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Ошибка сервера' });
    }
});

app.get('/api/games', async (req, res) => {
    const { published } = req.query;
    try {
        let query = 'SELECT id, name, author, description, data, published, likes, visits FROM games';
        if (published === 'true') query += ' WHERE published = true';
        query += ' ORDER BY created_at DESC LIMIT 50';
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }
});

app.post('/api/games', async (req, res) => {
    const { name, author, description, data, published } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO games (name, author, description, data, published) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [name, author, description || '', data || {}, published || false]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Не удалось сохранить игру' });
    }
});

app.put('/api/games/:id', async (req, res) => {
    const { id } = req.params;
    const { name, description, data, published } = req.body;
    try {
        await pool.query(
            'UPDATE games SET name = $1, description = $2, data = $3, published = $4 WHERE id = $5',
            [name, description, data, published, id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Не удалось обновить игру' });
    }
});

app.delete('/api/games/:id', async (req, res) => {
    const { id } = req.params;
    const { author } = req.body;
    try {
        await pool.query('DELETE FROM games WHERE id = $1 AND author = $2', [id, author]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.post('/api/games/:id/like', async (req, res) => {
    const { id } = req.params;
    const { username } = req.body;
    try {
        const existing = await pool.query('SELECT * FROM game_likes WHERE game_id = $1 AND username = $2', [id, username]);
        if (existing.rows.length > 0) {
            await pool.query('DELETE FROM game_likes WHERE game_id = $1 AND username = $2', [id, username]);
            await pool.query('UPDATE games SET likes = likes - 1 WHERE id = $1', [id]);
            res.json({ liked: false });
        } else {
            await pool.query('INSERT INTO game_likes (game_id, username) VALUES ($1, $2)', [id, username]);
            await pool.query('UPDATE games SET likes = likes + 1 WHERE id = $1', [id]);
            res.json({ liked: true });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.post('/api/games/:id/visit', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('UPDATE games SET visits = visits + 1 WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.get('/api/users/:username/stats', async (req, res) => {
    const { username } = req.params;
    try {
        const gamesCount = await pool.query('SELECT COUNT(*) FROM games WHERE author = $1', [username]);
        const likesSum = await pool.query('SELECT SUM(likes) FROM games WHERE author = $1', [username]);
        const visitsSum = await pool.query('SELECT SUM(visits) FROM games WHERE author = $1', [username]);
        res.json({
            games: parseInt(gamesCount.rows[0].count),
            likes: parseInt(likesSum.rows[0].sum || 0),
            visits: parseInt(visitsSum.rows[0].sum || 0)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ games: 0, likes: 0, visits: 0 });
    }
});

// Запуск
app.listen(PORT, async () => {
    console.log(`🚀 API сервер запущен на порту ${PORT}`);
    await initDB();
});
