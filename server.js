const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS - allow your domain
app.use(cors({
    origin: '*',
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
            message: 'You have used all 5 free prompts for today. For further assistance, please contact Scholar Solutions on our social platforms.\n[SOCIAL:facebook]\n[SOCIAL:instagram]\n[SOCIAL:telegram]',
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
            system: 'You are Scholar Solutions FAQ Assistant. You must ONLY answer questions directly related to Scholar Solutions, including our services, booking process, tutoring support, research assistance, study help, availability, contact channels, and general academic support we offer. If a user asks anything outside Scholar Solutions or unrelated general knowledge, reply exactly: "I can only answer questions related to Scholar Solutions services, support, and booking." Keep answers concise, helpful, and under 120 words. Never use markdown bold like **text** and never use emoji bullets like 📚 or ✍️. If listing services, use clean plain lines in this exact format: Academic Tutoring - Personalized learning support, Essay Writing - Professional writing assistance, Research Papers - Comprehensive research help, Math & Science - Subject-specific tutoring, Language Learning - Language skills development, Study Strategies - Better study habits and academic planning. When mentioning contact or social media, always format them exactly like this on separate lines:\n[SOCIAL:facebook]\n[SOCIAL:instagram]\n[SOCIAL:telegram]\nDo not write out the URLs or usernames, just use the [SOCIAL:platform] tags.',
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
