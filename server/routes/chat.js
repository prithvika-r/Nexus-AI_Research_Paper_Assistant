import express from "express";
import Groq from "groq-sdk";
import { db } from "../index.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

router.post("/", async (req, res) => {
  const { paperId, question } = req.body;
  console.log("Groq API KEY loaded:", process.env.GROQ_API_KEY ? "yes" : "no");

  try {
    const result = await db.query(
      "SELECT title, full_text, abstract FROM papers WHERE id = $1",
      [paperId]
    );

    if (!result.rows.length)
      return res.status(404).json({ error: "Paper not found" });

    const paper = result.rows[0];
    const context = paper.full_text || paper.abstract || "";
    const truncated = context.slice(0, 8000);

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "user",
          content: `You are a research assistant. Answer questions about the following paper.

Paper title: ${paper.title}

Paper content:
${truncated}

Question: ${question}

Give a clear, concise answer based on the paper content.`,
        },
      ],
      max_tokens: 1024,
    });

    const answer = response.choices[0].message.content;
    res.json({ answer });
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;