require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const fetch = require('node-fetch');
const cloudinary = require('cloudinary').v2;
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ADMIN_TOKEN = process.env.ADMIN_SECRET_TOKEN;

const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader === `Bearer ${ADMIN_TOKEN}`) {
    next();
  } else {
    res.status(401).json({ error: 'Accès refusé' });
  }
};

app.get('/api/test', (req, res) => {
  res.json({ message: 'Connecté à PostgreSQL !' });
});

app.get('/api/pdfs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM pdfs ORDER BY published_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur base de données' });
  }
});

app.post('/api/pdfs', authenticateAdmin, async (req, res) => {
  const { title, category, drive_link, maketou_link, youtube_link, tiktok_link, facebook_link, image_url } = req.body;
  const query = `
    INSERT INTO pdfs (title, category, drive_link, maketou_link, youtube_link, tiktok_link, facebook_link, image_url, published_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    RETURNING *
  `;
  const values = [title, category, drive_link || null, maketou_link || null, youtube_link || null, tiktok_link || null, facebook_link || null, image_url];

  try {
    const result = await pool.query(query, values);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/pdfs/:id', authenticateAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM pdfs WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/upload-pdf', authenticateAdmin, upload.single('pdf'), (req, res) => {
  const uploadStream = cloudinary.uploader.upload_stream(
    { resource_type: 'raw', format: 'pdf' },
    (error, result) => {
      if (error) {
        console.error(error);
        res.status(500).json({ error: 'Erreur upload PDF' });
      } else {
        res.json({ url: result.secure_url });
      }
    }
  );
  req.file.stream.pipe(uploadStream);
});

app.post('/api/generate-image', authenticateAdmin, async (req, res) => {
  const { prompt } = req.body;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'image/png' }
        })
      }
    );
    const data = await response.json();
    const base64Image = data.candidates[0].content.parts[0].inlineData.data;
    const uploadResult = await cloudinary.uploader.upload(`data:image/png;base64,${base64Image}`, { folder: 'pdf_covers' });
    res.json({ imageUrl: uploadResult.secure_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur génération image' });
  }
});

app.use(express.static(path.join(__dirname, '..')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
