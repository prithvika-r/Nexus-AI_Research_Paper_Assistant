import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { db } from "../index.js";

const router = express.Router();

// Create uploads folder if it doesn't exist
const uploadsDir = "./uploads";
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});

const upload = multer({ storage });

router.post("/", upload.single("pdf"), async (req, res) => {
  try {
    const filePath = req.file.path;
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);
    const fullText = pdfData.text;

    // Extract title from filename
    const title = req.file.originalname.replace(".pdf", "");

    const result = await db.query(
      `INSERT INTO papers (title, full_text, file_path, source)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [title, fullText, filePath, "upload"]
    );

    res.json({ 
      success: true, 
      paper: result.rows[0],
      preview: fullText.slice(0, 500)
    });
  } catch (err) {
    console.error("Upload error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;