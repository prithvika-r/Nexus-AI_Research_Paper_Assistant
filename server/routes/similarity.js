import express from "express";
import Groq from "groq-sdk";
import axios from "axios";
import { db } from "../index.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

router.post("/", async (req, res) => {
  const { paperId } = req.body;

  try {
    // Get the selected paper
    const paperResult = await db.query(
      "SELECT id, title, abstract, full_text FROM papers WHERE id = $1",
      [paperId]
    );

    if (!paperResult.rows.length)
      return res.status(404).json({ error: "Paper not found" });

    const selectedPaper = paperResult.rows[0];

    // Get all papers from library
    const libraryResult = await db.query(
      "SELECT id, title, abstract, year FROM papers WHERE id != $1 ORDER BY created_at DESC",
      [paperId]
    );

    const libraryPapers = libraryResult.rows;

    // Search Semantic Scholar for similar papers
    let semanticScholarPapers = [];
    try {
      const searchQuery = selectedPaper.title.split(" ").slice(0, 5).join(" ");
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const response = await axios.get(
        "https://api.semanticscholar.org/graph/v1/paper/search",
        {
          params: {
            query: searchQuery,
            fields:
              "title,authors,abstract,year,citationCount,openAccessPdf",
            limit: 15,
          },
          headers: {
            "User-Agent": "Nexus-Research-App/1.0",
          },
          timeout: 10000,
        }
      );

      semanticScholarPapers = (response.data.data || []).map((p) => ({
        id: "ss_" + p.paperId,
        title: p.title,
        abstract: p.abstract || "",
        year: p.year,
        authors: p.authors?.map((a) => a.name) || [],
        citationCount: p.citationCount || 0,
        source: "semantic_scholar",
      }));
    } catch (e) {
      console.error("Semantic Scholar search error:", e.response?.status, e.message);
      // Continue without online results if search fails
    }

    // Combine library + online papers
    const allPapersToCompare = [...libraryPapers, ...semanticScholarPapers];

    if (allPapersToCompare.length === 0)
      return res.json({
        similarPapers: [],
        selectedPaper,
        message: "No papers to compare against",
      });

    // Create comparison prompt for Groq
    const papersComparison = allPapersToCompare
      .map(
        (p) =>
          `ID: ${p.id} | Title: ${p.title} | Year: ${p.year} | Abstract: ${p.abstract || "N/A"}`
      )
      .join("\n\n");

    const prompt = `You are a research paper similarity analyzer.

Reference Paper:
Title: ${selectedPaper.title}
Abstract: ${selectedPaper.abstract || selectedPaper.full_text?.slice(0, 1000) || "N/A"}

Other papers (from library and online):
${papersComparison}

Analyze the similarity between the reference paper and each other paper. Consider:
- Research topic/domain
- Methodology similarity
- Related research areas
- Citation potential
- Relevance to the reference paper

Return ONLY a valid JSON array, no other text:
[
  { "paperId": "id", "similarityScore": 85, "reason": "brief explanation of similarity" },
  { "paperId": "id", "similarityScore": 72, "reason": "brief explanation" }
]

similarityScore is 0-100 where 100 means highly similar.
Sort by similarityScore descending.
Include top 10-15 papers only.`;

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2048,
    });

    const text = response.choices[0].message.content;
    const clean = text.replace(/```json|```/g, "").trim();
    const similarities = JSON.parse(clean);

    // Enrich with full paper data
    const enrichedSimilarities = similarities.map((sim) => {
      const paper = allPapersToCompare.find((p) => p.id === sim.paperId);
      return {
        ...paper,
        similarityScore: sim.similarityScore,
        reason: sim.reason,
      };
    });

    res.json({
      selectedPaper,
      similarPapers: enrichedSimilarities,
      totalSimilar: enrichedSimilarities.length,
      stats: {
        libraryCount: libraryPapers.length,
        onlineCount: semanticScholarPapers.length,
      },
    });
  } catch (err) {
    console.error("Similarity error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;