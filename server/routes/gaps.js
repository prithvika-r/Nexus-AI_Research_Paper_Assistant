import express from "express";
import Groq from "groq-sdk";
import { db } from "../index.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

router.post("/", async (req, res) => {
  const { topic, paperIds } = req.body;

  try {
    let abstracts = "";

    if (paperIds && paperIds.length > 0) {
      const result = await db.query(
        "SELECT title, abstract FROM papers WHERE id = ANY($1)",
        [paperIds]
      );
      abstracts = result.rows
        .map(p => `Title: ${p.title}\nAbstract: ${p.abstract}`)
        .join("\n\n");
    }

    const prompt = `You are a research strategist analyzing gaps in academic literature.

Topic: ${topic || "General Research"}
${abstracts ? `\nPapers being analyzed:\n${abstracts}` : ""}

Identify 5 significant research gaps in this field. Return ONLY a valid JSON array, no other text:
[
  { "area": "gap name", "gap_score": 85, "reason": "brief explanation why this is underexplored" },
  { "area": "gap name", "gap_score": 72, "reason": "brief explanation" }
]

gap_score is 0-100 where 100 means completely unexplored.`;

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
    });

    const text = response.choices[0].message.content;
    const clean = text.replace(/```json|```/g, "").trim();
    const gaps = JSON.parse(clean);

    res.json({ gaps, topic });
  } catch (err) {
    console.error("Gaps error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;