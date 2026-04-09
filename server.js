const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
require('dotenv').config();

const app = express();

// Безопасность
app.use(helmet({
    contentSecurityPolicy: false, // Для совместимости с Three.js
}));

app.use(cors({
    origin: ['https://matblox.onrender.com', 'http://localhost:3000', 'http://localhost:5500'],
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Слишком много запросов, попробуйте позже' }
});
app.use('/api/', limiter);

// Подключение к PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000
});

const JWT_SECRET = process.env.JWT_SECRET || 'blockverse-secret-key-' + Date.now();
const SALT_ROUNDS = 10;

// Middleware для проверки JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Недействительный токен' });
        req.user = user;
        next();
    });
}

// Инициализация БД
async function initDB() {
    const client = await pool.connect();
    try {
        // Таблица пользователей
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                coins INT DEFAULT 500,
                inventory JSONB DEFAULT '[]',
                friends JSONB DEFAULT '[]',
                is_guest BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Таблица игр
        await client.query(`
            CREATE TABLE IF NOT EXISTS games (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                author VARCHAR(50) NOT NULL,
                description TEXT,
                data JSONB NOT NULL,
                plays INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Таблица чата
        await client.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) NOT NULL,
                text TEXT NOT NULL,
                time VARCHAR(20),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Таблица отчётов
        await client.query(`
            CREATE TABLE IF NOT EXISTS reports (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) NOT NULL,
                text TEXT NOT NULL,
                time VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Индексы
        await client.query(`CREATE INDEX IF NOT EXISTS idx_games_author ON games(author)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_games_created ON games(created_at DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at DESC)`);
        
        console.log('✅ База данных готова');
    } catch (err) {
        console.error('❌ Ошибка инициализации БД:', err);
    } finally {
        client.release();
    }
}

initDB();

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: Date.now(),
        server: 'BlockVerse API'
    });
});

// Регистрация
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Имя пользователя и пароль обязательны' });
    }
    
    if (username.length < 3 || password.length < 6) {
        return res.status(400).json({ error: 'Неверный формат данных' });
    }
    
    try {
        const existing = await pool.query(
            'SELECT id FROM users WHERE username = $1',
            [username]
        );
        
        if (existing.rows.length) {
            return res.status(400).json({ error: 'Пользователь уже существует' });
        }
        
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        
        await pool.query(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
            [username, passwordHash]
        );
        
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка регистрации:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Вход
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        const result = await pool.query(
            'SELECT * FROM users WHERE username = $1',
            [username]
        );
        
        if (!result.rows.length) {
            return res.status(401).json({ error: 'Неверные учетные данные' });
        }
        
        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Неверные учетные данные' });
        }
        
        const token = jwt.sign(
            { id: user.id, username: user.username },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.json({
            success: true,
            token,
            user: {
                username: user.username,
                coins: user.coins,
                inventory: user.inventory || [],
                friends: user.friends || []
            }
        });
    } catch (err) {
        console.error('Ошибка входа:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение игр
app.get('/api/games', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, author, description, data, plays, created_at 
             FROM games 
             ORDER BY created_at DESC 
             LIMIT 100`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка получения игр:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение конкретной игры
app.get('/api/games/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const result = await pool.query(
            'SELECT id, name, author, description, data, plays, created_at FROM games WHERE id = $1',
            [id]
        );
        
        if (!result.rows.length) {
            return res.status(404).json({ error: 'Игра не найдена' });
        }
        
        // Увеличиваем счётчик просмотров
        await pool.query('UPDATE games SET plays = plays + 1 WHERE id = $1', [id]);
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Ошибка получения игры:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Создание игры
app.post('/api/games', authenticateToken, async (req, res) => {
    const { name, description, data } = req.body;
    const author = req.user.username;
    
    if (!name) {
        return res.status(400).json({ error: 'Название игры обязательно' });
    }
    
    try {
        const result = await pool.query(
            `INSERT INTO games (name, author, description, data) 
             VALUES ($1, $2, $3, $4) 
             RETURNING id`,
            [name, author, description || '', JSON.stringify(data)]
        );
        
        res.json({ id: result.rows[0].id, success: true });
    } catch (err) {
        console.error('Ошибка создания игры:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Обновление игры
app.put('/api/games/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { name, description, data } = req.body;
    const author = req.user.username;
    
    try {
        const checkResult = await pool.query(
            'SELECT author FROM games WHERE id = $1',
            [id]
        );
        
        if (!checkResult.rows.length) {
            return res.status(404).json({ error: 'Игра не найдена' });
        }
        
        if (checkResult.rows[0].author !== author) {
            return res.status(403).json({ error: 'Нет прав на редактирование' });
        }
        
        await pool.query(
            `UPDATE games 
             SET name = $1, description = $2, data = $3, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $4`,
            [name, description || '', JSON.stringify(data), id]
        );
        
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка обновления игры:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Удаление игры
app.delete('/api/games/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const author = req.user.username;
    
    try {
        const result = await pool.query(
            'DELETE FROM games WHERE id = $1 AND author = $2',
            [id, author]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Игра не найдена или нет прав' });
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка удаления игры:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Обновление монет
app.post('/api/updateCoins', authenticateToken, async (req, res) => {
    const { coins } = req.body;
    const username = req.user.username;
    
    try {
        await pool.query(
            'UPDATE users SET coins = $1 WHERE username = $2',
            [coins, username]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка обновления монет:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Отправка сообщения в чат
app.post('/api/chat', authenticateToken, async (req, res) => {
    const { text, time } = req.body;
    const username = req.user.username;
    
    if (!text || text.length > 200) {
        return res.status(400).json({ error: 'Неверное сообщение' });
    }
    
    try {
        await pool.query(
            'INSERT INTO chat_messages (username, text, time) VALUES ($1, $2, $3)',
            [username, text, time]
        );
        
        // Оставляем только последние 500 сообщений
        await pool.query(`
            DELETE FROM chat_messages 
            WHERE id NOT IN (
                SELECT id FROM chat_messages 
                ORDER BY created_at DESC 
                LIMIT 500
            )
        `);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка отправки сообщения:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение сообщений чата
app.get('/api/chat', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT username, text, time 
             FROM chat_messages 
             ORDER BY created_at DESC 
             LIMIT 50`
        );
        res.json(result.rows.reverse());
    } catch (err) {
        console.error('Ошибка получения чата:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Отправка отчёта об ошибке
app.post('/api/reports', authenticateToken, async (req, res) => {
    const { text, time } = req.body;
    const username = req.user.username;
    
    if (!text) {
        return res.status(400).json({ error: 'Текст отчёта обязателен' });
    }
    
    try {
        await pool.query(
            'INSERT INTO reports (username, text, time) VALUES ($1, $2, $3)',
            [username, text, time]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка отправки отчёта:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение отчётов
app.get('/api/reports', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT username, text, time 
             FROM reports 
             ORDER BY created_at DESC 
             LIMIT 50`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка получения отчётов:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 BlockVerse API запущен на порту ${PORT}`);
    console.log(`📍 API: https://matbloxipi-1.onrender.com/api`);
});
