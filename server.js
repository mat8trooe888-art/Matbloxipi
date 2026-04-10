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
        console.log('Database ready');
    } catch (err) { console.error('DB init error:', err); }
}
initDB();

app.get('/', (req, res) => { res.send('BlockVerse API running'); });
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ url });
});
app.post('/api/register', async (req, res) => { /* ... без изменений ... */ });
app.post('/api/login', async (req, res) => { /* ... */ });
app.get('/api/games', async (req, res) => { /* ... */ });
app.post('/api/games', async (req, res) => { /* ... */ });
app.put('/api/games/:id', async (req, res) => { /* ... */ });
app.delete('/api/games/:id', async (req, res) => { /* ... */ });
app.post('/api/updateCoins', async (req, res) => { /* ... */ });
app.post('/api/chat', async (req, res) => { /* ... */ });
app.get('/api/chat', async (req, res) => { /* ... */ });
app.post('/api/reports', async (req, res) => { /* ... */ });
app.get('/api/reports', async (req, res) => { /* ... */ });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API server running on port ${PORT}`));
