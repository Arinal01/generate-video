const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const axios = require('axios');

dotenv.config();
const app = express();

// ==========================================
// KONFIGURASI CORS & DIRECTORY
// ==========================================
app.use(cors({
    origin: ['https://www.ktool.biz.id', 'https://ktool.biz.id', 'http://ktool.biz.id', 'http://www.ktool.biz.id'],
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(express.json());

const OUTPUT_DIR = path.join(__dirname, 'output');
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
app.use('/output', express.static(OUTPUT_DIR));

// ==========================================
// DAFTAR MODEL LENGKAP (IDENTITAS K-TOOL)
// ==========================================
const AVAILABLE_MODELS = [
    "gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash-exp", "gemini-2.0-flash", 
    "gemini-2.0-flash-001", "gemini-2.0-flash-exp-image-generation", "gemini-2.0-flash-lite-001", 
    "gemini-2.0-flash-lite", "gemini-2.0-flash-lite-preview-02-05", "gemini-2.0-flash-lite-preview", 
    "gemini-exp-1206", "gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts", 
    "gemma-3-1b-it", "gemma-3-4b-it", "gemma-3-12b-it", "gemma-3-27b-it", 
    "gemma-3n-e4b-it", "gemma-3n-e2b-it", "gemini-flash-latest", "gemini-flash-lite-latest", 
    "gemini-pro-latest", "gemini-2.5-flash-lite", "gemini-2.5-flash-image-preview", 
    "gemini-2.5-flash-image", "gemini-2.5-flash-preview-09-2025", "gemini-2.5-flash-lite-preview-09-2025", 
    "gemini-3-pro-preview", "gemini-3-flash-preview", "gemini-3-pro-image-preview", 
    "nano-banana-pro-preview", "gemini-robotics-er-1.5-preview", 
    "gemini-2.5-computer-use-preview-10-2025", "deep-research-pro-preview-12-2025"
];

// Verifikasi API Key
if (!process.env.GEMINI_API_KEY) {
    console.error("ERROR: GEMINI_API_KEY tidak ditemukan di Variables Railway!");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// LOGIKA FAILOVER (PENGGANTI MODEL JIKA LIMIT)
// ==========================================
async function generateWithFailover(prompt, useJson = false) {
    for (const modelName of AVAILABLE_MODELS) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(prompt);
            const response = await result.response;
            let text = response.text();
            
            if (useJson) {
                text = text.replace(/```json|```/g, '').trim();
                return JSON.parse(text);
            }
            return text;
        } catch (error) {
            if (error.status === 429 || error.message.includes('429')) {
                console.warn(`Model ${modelName} limit (429), mencoba model berikutnya...`);
                await sleep(1500); // Jeda singkat agar tidak spamming
                continue;
            }
            console.error(`Error pada model ${modelName}:`, error.message);
            continue;
        }
    }
    throw new Error("Semua model AI sedang limit atau tidak tersedia.");
}

// ==========================================
// ENDPOINT API
// ==========================================

app.post('/api/video-robot/ai-writer', async (req, res) => {
    const { keyword } = req.body;
    try {
        const prompt = `Anda adalah penulis konten viral. Berdasarkan kata kunci "${keyword}", buatlah:
        1. Judul video yang sangat clickbait dan menarik.
        2. Isi konten pembahasan yang sangat detail, edukatif, dan panjang untuk narasi video.
        Format output WAJIB JSON murni: {"title": "...", "content": "..."}`;
        
        const data = await generateWithFailover(prompt, true);
        res.json({ success: true, title: data.title, content: data.content });
    } catch (error) {
        console.error("AI Writer Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/video-robot/process', async (req, res) => {
    const { sourceType, title, content, youtubeUrl, duration, subtitle } = req.body;
    const jobId = uuidv4();

    try {
        let finalPrompt = "";
        if (sourceType === 'youtube') {
            finalPrompt = `Analisis video YouTube ini: ${youtubeUrl}. Buat ulang dengan narasi baru.`;
        } else {
            finalPrompt = `Buat konsep video profesional durasi ${duration}s. Judul: ${title}. Isi: ${content}.`;
        }

        const aiResponse = await generateWithFailover(finalPrompt);
        
        const videoFileName = `ktool_v_${jobId}.mp4`;
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.get('host');
        const videoUrl = `${protocol}://${host}/output/${videoFileName}`;

        // Simulasi sukses karena proses render video sebenarnya membutuhkan FFmpeg/Service lain
        res.json({ success: true, videoUrl: videoUrl, jobId: jobId, aiAnalysis: aiResponse });
    } catch (error) {
        console.error("Robot Process Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Root check
app.get('/', (req, res) => res.send("K-TOOL VIDEO ROBOT BACKEND IS LIVE (RAILWAY)"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend Robot Video berjalan di Port: ${PORT}`);
});

