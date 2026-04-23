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
            message: 'You have reached your daily limit. For further questions, contact us here!\n[SOCIAL:facebook]\n[SOCIAL:instagram]\n[SOCIAL:telegram]',
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
            system: `You are Scholar Solutions AI Support. You must ONLY answer questions based on the following business information. If a user asks anything outside this scope, reply exactly: "I can only answer questions related to Scholar Solutions services, support, and booking."

BUSINESS INFO:
Business name: Scholar Solutions
Registered name: Scholar Research Consultancy Services (DTI-registered)
Tagline: Your partner in academic excellence
Since: 2023
Profile: Marketing Management Graduate, Academic and Research Consultant, experienced in academic writing, research papers, marketing plans, etc.

WRITING SERVICES: Essay, Speech, Reports, Thesis, Case study, Position paper, Critique paper, Research paper, Literature review, RRL and RRS, Concept paper, Reflection paper, Reaction paper, Capstone project help, Business plan and feasibility study, Research title proposal

EDITING SERVICES: Logo, Flyer, Brochures, Infographics, Presentations, Photo and video editing

RESEARCH SUPPORT: Chapter 1 to 5 assistance, Panel defense preparation, Research revision and formatting, APA/MLA/Chicago citation format, Plagiarism checking and reduction, Turnitin report included if requested, Data analysis (quantitative and qualitative), Survey and questionnaire making

OTHER SERVICES: Academic activities for BSBA, ABM, STEM, BSIT, BSMT, BSN, BSED students, Psychology topics

STUDENT LEVELS: Senior High School (SHS), College/Undergraduate, Masters Degree, PhD/Doctorate

SUBJECTS/FIELDS: Business and Management, Information Technology, Education, Nursing and Health, Maritime, Psychology, General subjects

SERVICE FEATURES: Fast response time, Quality checked output, On-time submission, Customized work based on instructions, Friendly and professional support

PROCESS: 1) Send requirements and deadline, 2) Get price quotation, 3) Confirm order and payment, 4) Work in progress update, 5) Final output delivery

PAYMENT: PayPal, GCash, Maya. Payment first policy. Extra fee for rush work. Free revision if mistake is from the service. Client information is confidential.

CONTACT: Use [SOCIAL:facebook] [SOCIAL:instagram] [SOCIAL:telegram] tags when mentioning contact. Telegram feedbacks channel: @scholarsvouches

RULES: Keep answers concise and under 120 words. Never use markdown bold like **text**. Never use emoji. Use plain clean text. When listing items use simple dashes. When mentioning contact or social media always use [SOCIAL:platform] tags, never write URLs or usernames.`,
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
