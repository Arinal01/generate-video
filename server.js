const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// Inisialisasi Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Media Directories (Railway akan menggunakan ephemeral storage)
const OUTPUT_DIR = path.join(__dirname, 'output');
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
app.use('/output', express.static(OUTPUT_DIR));

// 1. ENDPOINT AI WRITER (Auto-Fill Judul & Isi)
app.post('/api/video-robot/ai-writer', async (req, res) => {
    const { keyword } = req.body;
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const prompt = `Anda adalah penulis konten viral. Berdasarkan kata kunci "${keyword}", buatlah:
        1. Judul video yang sangat clickbait dan menarik.
        2. Isi konten pembahasan yang sangat detail, edukatif, dan panjang untuk narasi video.
        Format output WAJIB JSON murni: {"title": "...", "content": "..."}`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().replace(/```json|```/g, '');
        const data = JSON.parse(text);
        
        res.json({ success: true, title: data.title, content: data.content });
    } catch (error) {
        console.error("AI Writer Error:", error);
        res.status(500).json({ success: false, error: "Gagal membuat konten otomatis." });
    }
});

// 2. ENDPOINT PROSES VIDEO (Robot Core)
app.post('/api/video-robot/process', async (req, res) => {
    const { sourceType, title, content, youtubeUrl, duration, subtitle } = req.body;
    const jobId = uuidv4();

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        // Menyusun Instruksi untuk Robot
        let finalPrompt = "";
        if (sourceType === 'youtube') {
            finalPrompt = `Analisis video YouTube ini: ${youtubeUrl}. 
            Tugas Anda: Buat ulang video ini dengan narasi baru, visual AI baru, dan subtitle: ${subtitle}. 
            Durasi video akhir harus identik dengan video asli.`;
        } else {
            finalPrompt = `Buat video profesional berdurasi ${duration} detik.
            Judul: ${title}.
            Isi Narasi: ${content}.
            Gunakan suara AI, visual AI bertema sinematik, dan sertakan subtitle: ${subtitle}.`;
        }

        const result = await model.generateContent(finalPrompt);
        const videoFileName = `ktool_v_${jobId}.mp4`;
        
        // Memastikan URL video menggunakan domain ktool jika di VPS atau domain Railway
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.get('host');
        const videoUrl = `${protocol}://${host}/output/${videoFileName}`;

        res.json({ 
            success: true, 
            videoUrl: videoUrl,
            jobId: jobId
        });

    } catch (error) {
        console.error("Robot Process Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. DAFTAR SEMUA MODEL GEMINI (Wajib Sesuai Instruksi)
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

// Port menggunakan variabel environment (Penting untuk Railway & VPS)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend Robot Video berjalan di Port: ${PORT}`);
    console.log(`Directory: cd ~/ktool-backend`);
});
