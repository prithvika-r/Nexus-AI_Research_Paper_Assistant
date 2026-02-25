import express from "express";
import Groq from "groq-sdk";
import { db } from "../index.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const PROMPTS = {
  defend: `You are an expert academic defender. Your job is to strongly defend this research paper.
Argue why:
- The methodology is sound and well-designed
- The findings are significant and credible
- The contributions are valuable to the field
- The limitations are minor and acceptable
Be confident and persuasive.`,

  challenge: `You are an expert academic critic. Your job is to challenge this research paper.
Critique:
- Weaknesses in the methodology
- Questionable assumptions
- Limitations that undermine the findings
- What the authors overlooked or got wrong
Be specific and analytical.`,

  devils_advocate: `You are playing devil's advocate against this research paper.
Find the strongest possible counter-arguments:
- What would opponents of this paper say?
- What alternative explanations exist for the findings?
- What published research contradicts this paper?
- Why might the conclusions be wrong?
Be provocative and thought-provoking.`,
};

router.post("/", async (req, res) => {
  const { paperId, mode } = req.body;
  console.log("Debate mode:", mode);

  if (!PROMPTS[mode]) {
    return res.status(400).json({ error: "Invalid mode. Use: defend, challenge, devils_advocate" });
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

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: PROMPTS[mode],
        },
        {
          role: "user",
          content: `Paper title: ${paper.title}\n\nPaper content:\n${context}\n\nPresent your argument now.`,
        },
      ],
      max_tokens: 1024,
    });

    const argument = response.choices[0].message.content;
    res.json({ argument, mode, title: paper.title });
  } catch (err) {
    console.error("Debate error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;