const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors({ origin: ['https://matblox.onrender.com', 'http://localhost:3000'], credentials: true }));
app.use(express.json());

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'uploads/';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + path.extname(file.originalname));
    }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });
app.use('/uploads', express.static('uploads'));

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
    } catch (err) { console.error('Ошибка инициализации БД:', err); }
}
initDB();

app.get('/', (req, res) => { res.send('BlockVerse API работает'); });

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ url });
});

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Требуется имя и пароль' });
    try {
        const existing = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (existing.rows.length) return res.status(400).json({ error: 'Пользователь уже существует' });
        await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, password]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
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
        } else res.status(401).json({ error: 'Неверные данные' });
    } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/games', async (req, res) => {
    try {
        const publishedOnly = req.query.published === 'true';
        let query = 'SELECT id, name, author, description, data, published, thumbnail, video_url FROM games';
        if (publishedOnly) query += ' WHERE published = true';
        query += ' ORDER BY created_at DESC';
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/games', async (req, res) => {
    const { name, author, description, data, published } = req.body;
    if (!name || !author) return res.status(400).json({ error: 'Отсутствуют обязательные поля' });
    const thumbnail = data?.thumbnail || null;
    const videoUrl = data?.videoUrl || null;
    try {
        const result = await pool.query(
            `INSERT INTO games (name, author, description, data, published, thumbnail, video_url) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [name, author, description || '', data, published || false, thumbnail, videoUrl]
        );
        res.json({ id: result.rows[0].id });
    } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
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
    } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.delete('/api/games/:id', async (req, res) => {
    const { id } = req.params;
    const { author } = req.body;
    try {
        const result = await pool.query('DELETE FROM games WHERE id = $1 AND author = $2', [id, author]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Игра не найдена' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/updateCoins', async (req, res) => {
    const { username, coins } = req.body;
    try {
        await pool.query('UPDATE users SET coins = $1 WHERE username = $2', [coins, username]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/updateInventory', async (req, res) => {
    const { username, inventory } = req.body;
    try {
        await pool.query('UPDATE users SET inventory = $1 WHERE username = $2', [JSON.stringify(inventory), username]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/chat', async (req, res) => {
    const { username, text, time } = req.body;
    try {
        await pool.query('INSERT INTO chat_messages (username, text, time) VALUES ($1, $2, $3)', [username, text, time]);
        await pool.query('DELETE FROM chat_messages WHERE id NOT IN (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 100)');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/chat', async (req, res) => {
    try {
        const result = await pool.query('SELECT username, text, time FROM chat_messages ORDER BY id ASC LIMIT 50');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/reports', async (req, res) => {
    const { username, text, time } = req.body;
    try {
        await pool.query('INSERT INTO reports (username, text, time) VALUES ($1, $2, $3)', [username, text, time]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/reports', async (req, res) => {
    try {
        const result = await pool.query('SELECT username, text, time FROM reports ORDER BY id DESC LIMIT 50');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 API сервер на порту ${PORT}`));
