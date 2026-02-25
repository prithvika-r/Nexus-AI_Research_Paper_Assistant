import express from "express";
import Groq from "groq-sdk";
import { db } from "../index.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const STYLE_PROMPTS = {
  academic: "Create a formal academic presentation outline with technical depth, methodology details, and citations.",
  pitch: "Create a concise executive pitch presentation. Focus on impact, key findings, and practical applications.",
  eli5: "Create a simple, easy-to-understand presentation. Use simple language, analogies, and avoid jargon.",
  thread: "Create a Twitter/X thread format. Each slide is a tweet. Use engaging language, emojis, and key insights.",
};

router.post("/", async (req, res) => {
  const { paperId, style } = req.body;

  if (!STYLE_PROMPTS[style]) {
    return res.status(400).json({ error: "Invalid style. Use: academic, pitch, eli5, thread" });
  }

  try {
    const result = await db.query(
      "SELECT title, abstract, full_text FROM papers WHERE id = $1",
      [paperId]
    );

    if (!result.rows.length)
      return res.status(404).json({ error: "Paper not found" });

    const paper = result.rows[0];
    const context = paper.abstract || paper.full_text?.slice(0, 4000) || "";

    const prompt = `${STYLE_PROMPTS[style]}

Paper title: ${paper.title}
Paper content: ${context}

Generate a presentation with 6-8 slides. For each slide provide:
- Slide number and title
- 3-4 bullet points of content
- A speaker note

Format it clearly with slide headers like "## Slide 1: Title"`;

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2048,
    });

    const slides = response.choices[0].message.content;
    res.json({ slides, style, title: paper.title });
  } catch (err) {
    console.error("Slides error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;