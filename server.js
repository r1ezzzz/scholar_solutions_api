const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS - allow your domain
app.use(cors({
    origin: ['https://scholarsolutions.site', 'http://scholarsolutions.site', 'http://localhost:3000'],
    methods: ['POST', 'GET'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// Trust proxy for Render (to get real IP)
app.set('trust proxy', true);

// ── IP Rate Limiting (5 prompts per IP per day) ──
const rateLimitMap = new Map();
const MAX_PROMPTS = 5;
const RESET_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

// Clean up old entries every hour
setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of rateLimitMap.entries()) {
        if (now - data.firstRequest > RESET_INTERVAL) {
            rateLimitMap.delete(ip);
        }
    }
}, 60 * 60 * 1000);

function getRateLimit(ip) {
    const now = Date.now();
    let data = rateLimitMap.get(ip);

    if (!data || now - data.firstRequest > RESET_INTERVAL) {
        data = { count: 0, firstRequest: now };
        rateLimitMap.set(ip, data);
    }

    return data;
}

function checkRateLimit(ip) {
    const data = getRateLimit(ip);
    return data.count < MAX_PROMPTS;
}

function incrementRateLimit(ip) {
    const data = getRateLimit(ip);
    data.count++;
    rateLimitMap.set(ip, data);
}

function getRemainingPrompts(ip) {
    const data = getRateLimit(ip);
    return Math.max(0, MAX_PROMPTS - data.count);
}

// ── Claude API Client ──
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// ── Health Check ──
app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'Scholar Solutions AI' });
});

// ── Check remaining prompts ──
app.get('/api/remaining', (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    const remaining = getRemainingPrompts(ip);
    res.json({ remaining, max: MAX_PROMPTS });
});

// ── Chat Endpoint ──
app.post('/api/chat', async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;

    // Check rate limit
    if (!checkRateLimit(ip)) {
        return res.status(429).json({
            error: 'Rate limit exceeded',
            message: 'You have used all 5 free prompts for today. Please try again tomorrow!',
            remaining: 0
        });
    }

    const { message } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ error: 'Message is required' });
    }

    if (message.length > 1000) {
        return res.status(400).json({ error: 'Message too long (max 1000 characters)' });
    }

    try {
        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            system: 'You are Scholar Solutions AI Assistant. You help students with academic questions, study tips, and general guidance about our tutoring services. Be helpful, encouraging, and concise. Keep responses under 200 words. If asked about services, mention: Academic Tutoring, Essay Writing, Research Papers, Math & Science, Language Learning, and Study Strategies. Direct them to our social media for booking: Facebook (SolutionsScholar), Instagram (solutions_scholar), or Telegram (scholarsolutions).',
            messages: [
                { role: 'user', content: message.trim() }
            ]
        });

        // Increment rate limit only on success
        incrementRateLimit(ip);

        const remaining = getRemainingPrompts(ip);

        res.json({
            reply: response.content[0].text,
            remaining: remaining
        });
    } catch (error) {
        console.error('Claude API error:', error.message);
        res.status(500).json({
            error: 'AI service temporarily unavailable',
            message: 'Please try again in a moment.'
        });
    }
});

app.listen(PORT, () => {
    console.log(`Scholar Solutions API running on port ${PORT}`);
});
