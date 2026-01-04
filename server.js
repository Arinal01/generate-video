const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const { exec } = require('child_process');
const axios = require('axios');

dotenv.config();
const app = express();

// ==========================================
// KONFIGURASI & API KEYS (K-TOOL ID)
// ==========================================
const PEXELS_API_KEY = process.env.PEXELS_API_KEY || "YCP7fcbOscx60mAhTbsd1JVdUcX6zpmpQyZoIUFF3F6mFQthLXhq76YS";

app.use(cors({
    origin: ['https://www.ktool.biz.id', 'https://ktool.biz.id', 'http://ktool.biz.id', 'http://www.ktool.biz.id'],
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(express.json());

// Menggunakan path absolut untuk Railway/VPS
const OUTPUT_DIR = path.join(__dirname, 'output');
const TEMP_DIR = path.join(__dirname, 'temp'); 
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Menyajikan file statis dari folder output
app.use('/output', express.static(OUTPUT_DIR));

// ==========================================
// DAFTAR MODEL LENGKAP (K-TOOL ID)
// ==========================================
const AVAILABLE_MODELS = [
    "gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash-exp", 
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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// FUNGSI PENCARI VIDEO FOOTAGE (PEXELS)
// ==========================================
async function getFootageUrl(query) {
    try {
        const res = await axios.get(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=1`, {
            headers: { Authorization: PEXELS_API_KEY }
        });
        if (res.data.videos && res.data.videos.length > 0) {
            // Pilih file dengan resolusi yang masuk akal untuk render cepat
            const videoFile = res.data.videos[0].video_files.find(f => f.width >= 1280 && f.width <= 1920) || res.data.videos[0].video_files[0];
            return videoFile.link;
        }
    } catch (e) { console.error("Pexels Error:", e.message); }
    return null;
}

// ==========================================
// LOGIKA FAILOVER DENGAN JEDA ANTI 429
// ==========================================
async function generateWithFailover(prompt, useJson = false) {
    for (const modelName of AVAILABLE_MODELS) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(prompt);
            const response = await result.response;
            let text = response.text();
            
            if (useJson) {
                // Bersihkan karakter aneh yang sering muncul di response AI
                text = text.replace(/```json|```/g, '').trim();
                return JSON.parse(text);
            }
            return text;
        } catch (error) {
            console.log(`Model ${modelName} gagal: ${error.message}`);
            if (error.status === 429 || error.message.includes('429')) {
                await sleep(5000); // Jeda lebih lama jika kena rate limit
                continue;
            }
            continue;
        }
    }
    throw new Error("Semua model AI sedang limit atau kuota habis.");
}

// ==========================================
// ENDPOINT API
// ==========================================

app.post('/api/video-robot/ai-writer', async (req, res) => {
    const { keyword } = req.body;
    try {
        const prompt = `Anda adalah penulis konten viral. Berdasarkan kata kunci "${keyword}", buatlah:
        1. Judul video clickbait.
        2. Narasi pembahasan panjang untuk durasi video.
        3. Kata kunci pencarian video footage dalam 1 kata bahasa Inggris (contoh: 'tech', 'forest', 'city').
        Format output JSON: {"title": "...", "content": "...", "footage_keyword": "..."}`;
        
        const data = await generateWithFailover(prompt, true);
        res.json({ success: true, ...data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/video-robot/process', async (req, res) => {
    const { title, content, duration, subtitle, footage_keyword } = req.body;
    const jobId = uuidv4();
    const videoFileName = `ktool_v_${jobId}.mp4`;
    const videoPath = path.join(OUTPUT_DIR, videoFileName);
    const audioPath = path.join(TEMP_DIR, `audio_${jobId}.mp3`);
    const imageFallbackPath = path.join(TEMP_DIR, `fallback_${jobId}.jpg`);

    try {
        // 1. GENERATE SUARA (Limit teks agar gTTS tidak error)
        const safeText = content.substring(0, 1000).replace(/["']/g, "");
        const ttsCmd = `gtts-cli "${safeText}" --lang id --output ${audioPath}`;
        
        exec(ttsCmd, async (ttsErr) => {
            if (ttsErr) console.error("TTS Error:", ttsErr);
            
            const finalAudio = fs.existsSync(audioPath) ? audioPath : null;

            // 2. CARI FOOTAGE
            let videoLink = await getFootageUrl(footage_keyword || title);
            let inputSource = "";

            if (videoLink) {
                inputSource = `-re -i "${videoLink}"`; // -re membantu stabilitas streaming URL
            } else {
                const createImgCmd = `ffmpeg -f lavfi -i color=c=0x1e293b:s=1280x720:d=1 -vf "drawtext=text='${title.substring(0,20)}':fontcolor=white:fontsize=50:x=(w-text_w)/2:y=(h-text_h)/2" -frames:v 1 ${imageFallbackPath}`;
                await new Promise(resolve => exec(createImgCmd, resolve));
                inputSource = `-loop 1 -i ${imageFallbackPath}`;
            }

            // 3. LOGIKA OVERLAY & RENDER (Disederhanakan untuk mencegah Render Error)
            const videoDuration = duration || 30;
            const audioInput = finalAudio ? `-i ${finalAudio}` : `-f lavfi -i anullsrc=r=44100:cl=stereo`;
            
            // Filter: Scale, Pad, Overlay Title, dan Subtitle sederhana
            let filters = `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1`;
            if (subtitle) {
                const cleanSub = content.substring(0, 60).replace(/[:']/g, "");
                filters += `,drawtext=text='${cleanSub}...':fontcolor=yellow:fontsize=30:x=(w-text_w)/2:y=h-100:box=1:boxcolor=black@0.5`;
            }

            // Command FFmpeg yang lebih stabil untuk Railway (Encoding libx264)
            const ffmpegCmd = `ffmpeg -t ${videoDuration} ${inputSource} ${audioInput} -vf "${filters}" -c:v libx264 -preset superfast -tune zerolatency -c:a aac -b:a 128k -map 0:v:0 -map 1:a:0 -shortest -pix_fmt yuv420p -y ${videoPath}`;

            console.log("Memulai Render...");
            exec(ffmpegCmd, (err, stdout, stderr) => {
                // Cleanup temp files
                if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
                if (fs.existsSync(imageFallbackPath)) fs.unlinkSync(imageFallbackPath);

                if (err) {
                    console.error("FFmpeg Error:", stderr);
                    return res.status(500).json({ success: false, error: "Render Error: Pastikan FFmpeg & gTTS terinstal." });
                }

                const protocol = req.headers['x-forwarded-proto'] || 'http';
                const host = req.get('host');
                res.json({ 
                    success: true, 
                    videoUrl: `${protocol}://${host}/output/${videoFileName}`,
                    jobId: jobId 
                });
            });
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Auto-delete file lama (> 1 jam) agar storage tidak penuh
setInterval(() => {
    fs.readdir(OUTPUT_DIR, (err, files) => {
        if (err) return;
        files.forEach(file => {
            const filePath = path.join(OUTPUT_DIR, file);
            const stats = fs.statSync(filePath);
            if (Date.now() - stats.mtimeMs > 3600000) fs.unlinkSync(filePath);
        });
    });
}, 600000);

app.get('/', (req, res) => res.send("K-TOOL VIDEO ROBOT PRO ACTIVE"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server K-TOOL Aktif: ${PORT}`);
});

