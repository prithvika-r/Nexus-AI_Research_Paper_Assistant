import express from "express";
import axios from "axios";

const router = express.Router();

router.get("/", async (req, res) => {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: "Query required" });

    try {
        const response = await axios.get(
            "https://api.semanticscholar.org/graph/v1/paper/search",
            {
                params: {
                    query: q,
                    fields: "title,authors,abstract,year,citationCount,openAccessPdf",
                    limit: 10,
                },
                headers: {
                    "User-Agent": "Nexus-Research-App/1.0"

                }
            }
        );
        res.json(response.data);
    } catch (err) {
        if (err.response?.status === 429) {
            res.status(429).json({ error: "Rate limited — wait a few seconds and try again" });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

export default router;