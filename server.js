const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors({ origin: ['https://matblox.onrender.com', 'http://localhost:3000'], credentials: true }));
app.use(express.json());

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
        // Добавляем колонку published, если её нет
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS published BOOLEAN DEFAULT FALSE`);
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
        console.log('Database ready');
    } catch (err) { console.error('DB init error:', err); }
}
initDB();

app.get('/', (req, res) => res.send('BlockVerse API'));

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, password]);
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: 'User exists' }); }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const r = await pool.query('SELECT * FROM users WHERE username=$1 AND password=$2', [username, password]);
    if (r.rows.length) {
        const u = r.rows[0];
        res.json({ success: true, user: { username: u.username, coins: u.coins, inventory: u.inventory ? JSON.parse(u.inventory) : [], friends: u.friends ? JSON.parse(u.friends) : [] } });
    } else res.status(401).json({ error: 'Invalid' });
});

app.get('/api/games', async (req, res) => {
    const publishedOnly = req.query.published === 'true';
    const q = publishedOnly ? 'SELECT * FROM games WHERE published=true ORDER BY created_at DESC' : 'SELECT * FROM games ORDER BY created_at DESC';
    const r = await pool.query(q);
    res.json(r.rows);
});

app.post('/api/games', async (req, res) => {
    const { name, author, description, data, published } = req.body;
    const r = await pool.query('INSERT INTO games (name, author, description, data, published) VALUES ($1,$2,$3,$4,$5) RETURNING id', [name, author, description||'', data, published||false]);
    res.json({ id: r.rows[0].id });
});

app.put('/api/games/:id', async (req, res) => {
    const { id } = req.params;
    const { name, description, data, published } = req.body;
    await pool.query('UPDATE games SET name=$1, description=$2, data=$3, published=$4 WHERE id=$5', [name, description||'', data, published||false, id]);
    res.json({ success: true });
});

app.delete('/api/games/:id', async (req, res) => {
    await pool.query('DELETE FROM games WHERE id=$1 AND author=$2', [req.params.id, req.body.author]);
    res.json({ success: true });
});

app.post('/api/updateCoins', async (req, res) => {
    await pool.query('UPDATE users SET coins=$1 WHERE username=$2', [req.body.coins, req.body.username]);
    res.json({ success: true });
});

app.post('/api/chat', async (req, res) => {
    const { username, text, time } = req.body;
    await pool.query('INSERT INTO chat_messages (username, text, time) VALUES ($1,$2,$3)', [username, text, time]);
    res.json({ success: true });
});

app.get('/api/chat', async (req, res) => {
    const r = await pool.query('SELECT * FROM chat_messages ORDER BY id DESC LIMIT 50');
    res.json(r.rows);
});

app.post('/api/reports', async (req, res) => {
    const { username, text, time } = req.body;
    await pool.query('INSERT INTO reports (username, text, time) VALUES ($1,$2,$3)', [username, text, time]);
    res.json({ success: true });
});

app.get('/api/reports', async (req, res) => {
    const r = await pool.query('SELECT * FROM reports ORDER BY id DESC LIMIT 50');
    res.json(r.rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on ${PORT}`));
