const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors({ origin: ['https://matblox.onrender.com', 'http://localhost:3000'], credentials: true }));
app.use(express.json({ limit: '50mb' }));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initDB() {
    try {
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
                data JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS published BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS thumbnail TEXT`);
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS video_url TEXT`);
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS likes INT DEFAULT 0`);
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS visits INT DEFAULT 0`);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS game_likes (
                game_id INT,
                username VARCHAR(50),
                PRIMARY KEY(game_id, username)
            )
        `);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) NOT NULL,
                text TEXT NOT NULL,
                time VARCHAR(20)
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reports (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) NOT NULL,
                text TEXT NOT NULL,
                time VARCHAR(50)
            )
        `);
        console.log('✅ База данных готова');
    } catch (err) { console.error('❌ Ошибка инициализации БД:', err); }
}
initDB();

app.get('/', (req, res) => { res.send('BlockVerse API running'); });

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    try {
        const existing = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (existing.rows.length) return res.status(400).json({ error: 'User already exists' });
        await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, password]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

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
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/games', async (req, res) => {
    try {
        const publishedOnly = req.query.published === 'true';
        let query = 'SELECT id, name, author, description, data, published, thumbnail, video_url, likes, visits FROM games';
        if (publishedOnly) query += ' WHERE published = true';
        query += ' ORDER BY created_at DESC';
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/games', async (req, res) => {
    const { name, author, description, data, published } = req.body;
    if (!name || !author) return res.status(400).json({ error: 'Missing fields' });
    const thumbnail = data?.thumbnail || null;
    const videoUrl = data?.videoUrl || null;
    try {
        const result = await pool.query(
            `INSERT INTO games (name, author, description, data, published, thumbnail, video_url) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [name, author, description || '', data, published || false, thumbnail, videoUrl]
        );
        res.json({ id: result.rows[0].id });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/games/:id', async (req, res) => {
    const { id } = req.params;
    const { name, description, data, published } = req.body;
    const thumbnail = data?.thumbnail || null;
    const videoUrl = data?.videoUrl || null;
    try {
        await pool.query(
            `UPDATE games SET name = $1, description = $2, data = $3, published = $4, thumbnail = $5, video_url = $6 WHERE id = $7`,
            [name, description || '', data, published || false, thumbnail, videoUrl, id]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/games/:id', async (req, res) => {
    const { id } = req.params;
    const { author } = req.body;
    try {
        const result = await pool.query('DELETE FROM games WHERE id = $1 AND author = $2', [id, author]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Game not found' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
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
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/games/:id/visit', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('UPDATE games SET visits = visits + 1 WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/users/:username/stats', async (req, res) => {
    const { username } = req.params;
    try {
        const gamesCount = await pool.query('SELECT COUNT(*) FROM games WHERE author = $1', [username]);
        const likesSum = await pool.query('SELECT COALESCE(SUM(likes),0) FROM games WHERE author = $1', [username]);
        const visitsSum = await pool.query('SELECT COALESCE(SUM(visits),0) FROM games WHERE author = $1', [username]);
        res.json({
            games: parseInt(gamesCount.rows[0].count),
            likes: parseInt(likesSum.rows[0].coalesce),
            visits: parseInt(visitsSum.rows[0].coalesce)
        });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/updateCoins', async (req, res) => {
    const { username, coins } = req.body;
    try {
        await pool.query('UPDATE users SET coins = $1 WHERE username = $2', [coins, username]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/chat', async (req, res) => {
    const { username, text, time } = req.body;
    try {
        await pool.query('INSERT INTO chat_messages (username, text, time) VALUES ($1, $2, $3)', [username, text, time]);
        await pool.query('DELETE FROM chat_messages WHERE id NOT IN (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 100)');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/chat', async (req, res) => {
    try {
        const result = await pool.query('SELECT username, text, time FROM chat_messages ORDER BY id ASC LIMIT 50');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/reports', async (req, res) => {
    const { username, text, time } = req.body;
    try {
        await pool.query('INSERT INTO reports (username, text, time) VALUES ($1, $2, $3)', [username, text, time]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/reports', async (req, res) => {
    try {
        const result = await pool.query('SELECT username, text, time FROM reports ORDER BY id DESC LIMIT 50');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 API сервер запущен на порту ${PORT}`));
