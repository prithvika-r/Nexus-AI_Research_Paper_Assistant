import express from "express";
import Groq from "groq-sdk";
import axios from "axios";
import { db } from "../index.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

router.post("/", async (req, res) => {
  const { limit = 5 } = req.body;

  try {
    // Get all papers user has read
    const readPapersResult = await db.query(
      "SELECT id, title, abstract, full_text, year FROM papers WHERE is_read = true ORDER BY created_at DESC LIMIT 20"
    );

    if (readPapersResult.rows.length === 0)
      return res.json({
        recommendations: [],
        message: "Read some papers first to get recommendations!",
      });

    const readPapers = readPapersResult.rows;

    // Extract key topics from read papers
    const readPapersText = readPapers
      .map(
        (p) =>
          `Title: ${p.title}\nYear: ${p.year}\nAbstract: ${p.abstract || p.full_text?.slice(0, 500) || "N/A"}`
      )
      .join("\n\n---\n\n");

    // Use Groq to extract research topics/keywords from read papers
    const topicPrompt = `Analyze these research papers and extract the 3-5 most important research topics, keywords, and research areas they cover.

Papers:
${readPapersText}

Return ONLY a JSON object with this format, no other text:
{
  "topics": ["topic1", "topic2", "topic3"],
  "keywords": ["keyword1", "keyword2", "keyword3"]
}`;

    const topicResponse = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: topicPrompt }],
      max_tokens: 500,
    });

    const topicText = topicResponse.choices[0].message.content;
    const topicClean = topicText.replace(/```json|```/g, "").trim();
    const topicData = JSON.parse(topicClean);
    const searchTopics = topicData.topics || topicData.keywords || [];

    if (searchTopics.length === 0)
      return res.json({
        recommendations: [],
        message: "Could not extract topics from your papers",
      });

    // Search Semantic Scholar for papers on these topics
    let candidatePapers = [];
    
    for (const topic of searchTopics.slice(0, 3)) {
      try {
        await new Promise(resolve => setTimeout(resolve, 800)); // Delay to avoid rate limit
        
        const response = await axios.get(
          "https://api.semanticscholar.org/graph/v1/paper/search",
          {
            params: {
              query: topic,
              fields: "title,authors,abstract,year,citationCount,openAccessPdf",
              limit: 8,
              sort: "relevance",
            },
            headers: {
              "User-Agent": "Nexus-Research-App/1.0",
            },
            timeout: 10000,
          }
        );

        const papers = (response.data.data || []).map((p) => ({
          id: "ss_" + p.paperId,
          title: p.title,
          abstract: p.abstract || "",
          year: p.year,
          authors: p.authors?.map((a) => a.name) || [],
          citationCount: p.citationCount || 0,
          source: "semantic_scholar",
        }));

        candidatePapers = [...candidatePapers, ...papers];
      } catch (e) {
        console.error(`Error searching for "${topic}":`, e.message);
        // Continue with next topic
      }
    }

    // Remove duplicates
    const uniquePapers = Array.from(
      new Map(candidatePapers.map(p => [p.id, p])).values()
    );

    if (uniquePapers.length === 0)
      return res.json({
        recommendations: [],
        message: "Could not find papers on Semantic Scholar",
      });

    // Use Groq to rank candidates by relevance to user's interests
    const candidatesText = uniquePapers
      .slice(0, 20)
      .map(
        (p) =>
          `ID: ${p.id} | Title: ${p.title} | Year: ${p.year} | Citations: ${p.citationCount} | Abstract: ${p.abstract?.slice(0, 300) || "N/A"}`
      )
      .join("\n\n");

    const rankingPrompt = `You are a research recommendation engine. Based on the researcher's reading history, rank these candidate papers.

RESEARCHER'S INTERESTS (papers they've read):
${readPapersText}

---

CANDIDATE PAPERS TO RANK:
${candidatesText}

---

Identify the top ${Math.min(limit, uniquePapers.length)} most relevant papers for this researcher to read next.

Consider:
- Thematic alignment with their research interests
- Building on methodologies they've studied
- Citation impact and relevance
- Natural progression in their research journey
- Filling knowledge gaps

Return ONLY a valid JSON array, no other text:
[
  { "paperId": "ss_xxxxx", "relevanceScore": 92, "reason": "brief explanation why relevant" },
  { "paperId": "ss_xxxxx", "relevanceScore": 85, "reason": "brief explanation" }
]

relevanceScore is 0-100.
Sort by relevanceScore descending.`;

    const rankingResponse = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: rankingPrompt }],
      max_tokens: 2048,
    });

    const rankingText = rankingResponse.choices[0].message.content;
    const rankingClean = rankingText.replace(/```json|```/g, "").trim();
    const rankings = JSON.parse(rankingClean);

    // Enrich with full paper data
    const enrichedRecommendations = rankings.map((rec) => {
      const paper = uniquePapers.find((p) => p.id === rec.paperId);
      return {
        ...paper,
        relevanceScore: rec.relevanceScore,
        reason: rec.reason,
      };
    });

    res.json({
      recommendations: enrichedRecommendations,
      totalRecommended: enrichedRecommendations.length,
      readPapersAnalyzed: readPapers.length,
      topicsExtracted: searchTopics,
    });
  } catch (err) {
    console.error("Recommendations error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;