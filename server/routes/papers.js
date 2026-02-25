import express from "express";
import { db } from "../index.js";

const router = express.Router();

router.patch("/:id/read", async (req, res) => {
    const { is_read } = req.body;
    try {
        await db.query("UPDATE papers SET is_read = $1 WHERE id = $2", [is_read, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all saved papers
router.get("/", async (req, res) => {
    try {
        const result = await db.query(
            "SELECT * FROM papers ORDER BY created_at DESC"
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Save a paper
router.post("/", async (req, res) => {
    const { title, authors, year, abstract, source } = req.body;
    console.log("Saving paper:", { title, authors, year });
    try {
        // convert authors string to array if needed
        const authorsArray = Array.isArray(authors)
            ? authors
            : authors?.split(",").map(a => a.trim()) || [];

        const result = await db.query(
            `INSERT INTO papers (title, authors, year, abstract, source)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [title, authorsArray, year, abstract, source || "search"]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error("DB error:", err.message);
        res.status(500).json({ error: err.message });
    }
});
// Delete a paper
router.delete("/:id", async (req, res) => {
    try {
        await db.query("DELETE FROM papers WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;