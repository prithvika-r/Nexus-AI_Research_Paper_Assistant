import express from "express";
import fs from "fs";
import path from "path";
import axios from "axios";
import { db } from "../config/database.js";
import {
    resolvePaperPdfUrl,
    searchFreePdfUrl,
    downloadPdfBuffer,
    saveAndIndexDownloadedPdf,
    ensurePaperFullContent,
} from "../services/pdfResolverService.js";
import { extractPdfPages } from "../services/pdfService.js";

const router = express.Router();
const uploadsDir = path.resolve(process.cwd(), "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

function sanitizeFilename(title = "paper") {
    return title
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 70);
}

// ----------------------------------------------------
// 1. PROXY PDF VIEW (For Searched Papers before saving)
// ----------------------------------------------------
router.get("/proxy-pdf", async (req, res) => {
    try {
        const { url, title } = req.query;

        if (!url || !/^https?:\/\//i.test(url)) {
            return res.status(400).json({ error: "Valid http/https PDF URL is required." });
        }

        const safeTitle = sanitizeFilename(title || "paper");

        const response = await axios.get(url, {
            responseType: "stream",
            headers: {
                "User-Agent": "Nexus-Research-App/1.0 (Academic Paper Assistant; mailto:research@nexus.ai)",
                Accept: "application/pdf,application/octet-stream,*/*",
            },
            timeout: 25000,
            maxRedirects: 5,
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${safeTitle}.pdf"`);
        // Remove restrictive frame headers so iframe can render smoothly
        res.removeHeader("X-Frame-Options");
        res.setHeader("Access-Control-Allow-Origin", "*");

        response.data.pipe(res);
    } catch (err) {
        console.error("Proxy PDF view error:", err.message);
        if (!res.headersSent) {
            res.status(502).json({ error: "Could not stream the requested PDF." });
        }
    }
});

// ----------------------------------------------------
// 2. PROXY PDF DOWNLOAD (For Searched Papers)
// ----------------------------------------------------
router.get("/proxy-download", async (req, res) => {
    try {
        const { url, title } = req.query;

        if (!url || !/^https?:\/\//i.test(url)) {
            return res.status(400).json({ error: "Valid http/https PDF URL is required." });
        }

        const safeTitle = sanitizeFilename(title || "paper");

        const response = await axios.get(url, {
            responseType: "stream",
            headers: {
                "User-Agent": "Nexus-Research-App/1.0 (Academic Paper Assistant; mailto:research@nexus.ai)",
                Accept: "application/pdf,application/octet-stream,*/*",
            },
            timeout: 25000,
            maxRedirects: 5,
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.pdf"`);
        response.data.pipe(res);
    } catch (err) {
        console.error("Proxy PDF download error:", err.message);
        if (!res.headersSent) {
            res.status(502).json({ error: "Failed to download paper PDF." });
        }
    }
});

// ----------------------------------------------------
// 3. FETCH FULL TEXT IN-MEMORY (For Searched Papers)
// ----------------------------------------------------
router.post("/fetch-text", async (req, res) => {
    try {
        const { url, title, authors } = req.body;
        let pdfUrl = url;

        if (!pdfUrl || !/^https?:\/\//i.test(pdfUrl)) {
            if (title) {
                pdfUrl = await searchFreePdfUrl(title, authors);
            }
        }

        if (!pdfUrl) {
            return res.status(404).json({ error: "No open access PDF found to extract text from." });
        }

        const buffer = await downloadPdfBuffer(pdfUrl);
        const tempPath = path.join(uploadsDir, `temp-${Date.now()}.pdf`);
        await fs.promises.writeFile(tempPath, buffer);

        try {
            const extraction = await extractPdfPages(tempPath);
            const fullText = (extraction.pages || [])
                .map((p) => (typeof p === "string" ? p : p.text || ""))
                .join("\n\n")
                .trim();

            res.json({
                success: true,
                pdfUrl,
                pageCount: extraction.pageCount || extraction.pages?.length || 0,
                full_text: fullText,
                pages: extraction.pages || [],
            });
        } finally {
            await fs.promises.unlink(tempPath).catch(() => {});
        }
    } catch (err) {
        console.error("Fetch text error:", err.message);
        res.status(500).json({ error: err.message || "Failed to extract text from PDF." });
    }
});

// ----------------------------------------------------
// 4. VIEW PDF FOR SAVED PAPER
// ----------------------------------------------------
router.get("/:id/pdf", async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            "SELECT * FROM papers WHERE id = $1",
            [id]
        );

        if (!result.rows.length) {
            return res.status(404).json({ error: "Paper not found." });
        }

        let paper = result.rows[0];
        let filePath = paper.file_path;
        const safeTitle = sanitizeFilename(paper.title || "paper");

        // If local file exists, serve it
        if (filePath && !/^https?:\/\//i.test(filePath)) {
            const resolvedPath = path.resolve(
                path.isAbsolute(filePath)
                    ? filePath
                    : path.resolve(process.cwd(), filePath)
            );

            if (fs.existsSync(resolvedPath)) {
                res.setHeader("Content-Type", "application/pdf");
                res.setHeader("Content-Disposition", `inline; filename="${safeTitle}.pdf"`);
                res.setHeader("X-Content-Type-Options", "nosniff");
                res.setHeader("Cache-Control", "private, no-store");
                res.removeHeader("X-Frame-Options");

                const stream = fs.createReadStream(resolvedPath);
                return stream.pipe(res);
            }
        }

        // If paper doesn't have a local file yet, resolve and fetch it now
        try {
            const updatedPaper = await ensurePaperFullContent(id);
            if (updatedPaper?.file_path && fs.existsSync(updatedPaper.file_path)) {
                res.setHeader("Content-Type", "application/pdf");
                res.setHeader("Content-Disposition", `inline; filename="${safeTitle}.pdf"`);
                res.setHeader("X-Content-Type-Options", "nosniff");
                res.setHeader("Cache-Control", "private, no-store");
                res.removeHeader("X-Frame-Options");

                const stream = fs.createReadStream(updatedPaper.file_path);
                return stream.pipe(res);
            }
        } catch (resolveErr) {
            console.warn(`Could not resolve local PDF for ${id}:`, resolveErr.message);
        }

        // Fallback: If paper has external URL, stream it as proxy
        const targetUrl = resolvePaperPdfUrl(paper) || (filePath && /^https?:\/\//i.test(filePath) ? filePath : null);
        if (targetUrl) {
            const response = await axios.get(targetUrl, {
                responseType: "stream",
                headers: {
                    "User-Agent": "Nexus-Research-App/1.0 (Academic Paper Assistant; mailto:research@nexus.ai)",
                    Accept: "application/pdf,application/octet-stream,*/*",
                },
                timeout: 20000,
            });

            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `inline; filename="${safeTitle}.pdf"`);
            res.removeHeader("X-Frame-Options");
            return response.data.pipe(res);
        }

        return res.status(404).json({
            error: "No PDF file available for this paper. The paper may not have an open-access full version.",
        });
    } catch (error) {
        console.error("PDF view error:", error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: "Unable to open the PDF." });
        }
    }
});

// ----------------------------------------------------
// 5. DOWNLOAD PDF FOR SAVED PAPER
// ----------------------------------------------------
router.get("/:id/download", async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            "SELECT * FROM papers WHERE id = $1",
            [id]
        );

        if (!result.rows.length) {
            return res.status(404).json({ error: "Paper not found." });
        }

        let paper = result.rows[0];
        let filePath = paper.file_path;
        const safeTitle = sanitizeFilename(paper.title || "paper");

        // If local file exists, download it
        if (filePath && !/^https?:\/\//i.test(filePath)) {
            const resolvedPath = path.resolve(
                path.isAbsolute(filePath)
                    ? filePath
                    : path.resolve(process.cwd(), filePath)
            );

            if (fs.existsSync(resolvedPath)) {
                return res.download(resolvedPath, `${safeTitle}.pdf`);
            }
        }

        // Try ensuring paper content locally
        try {
            const updatedPaper = await ensurePaperFullContent(id);
            if (updatedPaper?.file_path && fs.existsSync(updatedPaper.file_path)) {
                return res.download(updatedPaper.file_path, `${safeTitle}.pdf`);
            }
        } catch (resolveErr) {
            console.warn(`Could not resolve local PDF for download ${id}:`, resolveErr.message);
        }

        // If external URL is available, stream as attachment
        const targetUrl = resolvePaperPdfUrl(paper) || (filePath && /^https?:\/\//i.test(filePath) ? filePath : null);
        if (targetUrl) {
            const response = await axios.get(targetUrl, {
                responseType: "stream",
                headers: {
                    "User-Agent": "Nexus-Research-App/1.0 (Academic Paper Assistant; mailto:research@nexus.ai)",
                    Accept: "application/pdf,application/octet-stream,*/*",
                },
                timeout: 25000,
            });

            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.pdf"`);
            return response.data.pipe(res);
        }

        return res.status(404).json({
            error: "No downloadable PDF found for this paper.",
        });
    } catch (err) {
        console.error("PDF download error:", err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: "Failed to download PDF." });
        }
    }
});

// ----------------------------------------------------
// 6. FETCH FULL PAPER & INDEX (On-demand for library paper)
// ----------------------------------------------------
router.post("/:id/fetch-full", async (req, res) => {
    try {
        const { id } = req.params;
        const updated = await ensurePaperFullContent(id);
        res.json({
            success: true,
            paper: updated,
        });
    } catch (err) {
        console.error("Fetch full paper error:", err.message);
        res.status(500).json({
            error: err.message || "Failed to fetch full paper content.",
        });
    }
});

// ----------------------------------------------------
// 7. UPDATE READ STATUS
// ----------------------------------------------------
router.patch("/:id/read", async (req, res) => {
    const { is_read } = req.body;

    try {
        await db.query(
            "UPDATE papers SET is_read = $1 WHERE id = $2",
            [is_read, req.params.id]
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ----------------------------------------------------
// 8. GET ALL SAVED PAPERS
// ----------------------------------------------------
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

// ----------------------------------------------------
// 9. SAVE PAPER DISCOVERED THROUGH SEARCH
// ----------------------------------------------------
router.post("/", async (req, res) => {
    const {
        title,
        authors,
        year,
        abstract,
        source,
        file_path,
        pdf_url,
        url,
        notes,
        openAccessPdf,
        externalIds,
    } = req.body;

    try {
        const authorsArray = Array.isArray(authors)
            ? authors.map((a) => (typeof a === "object" ? a.name || "" : a)).filter(Boolean)
            : typeof authors === "string"
            ? authors.split(",").map((a) => a.trim()).filter(Boolean)
            : [];

        // Check if paper already exists by title
        const existing = await db.query(
            "SELECT * FROM papers WHERE LOWER(TRIM(title)) = LOWER(TRIM($1)) LIMIT 1",
            [title]
        );

        if (existing.rows.length) {
            return res.json(existing.rows[0]);
        }

        const resolvedUrl =
            pdf_url ||
            resolvePaperPdfUrl({ openAccessPdf, externalIds, file_path, url }) ||
            file_path ||
            url ||
            null;

        const result = await db.query(
            `INSERT INTO papers (title, authors, year, abstract, full_text, file_path, source, notes, processing_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [
                title,
                authorsArray,
                year ? Number(year) : null,
                abstract || null,
                abstract || null,
                resolvedUrl,
                source || "search",
                notes || null,
                "pending",
            ]
        );

        const newPaper = result.rows[0];

        // Trigger background full PDF fetch, extraction, and vector indexing
        ensurePaperFullContent(newPaper.id)
            .then((p) => {
                console.log(`Auto-downloaded and indexed search paper: "${p.title}" (${p.chunk_count} chunks)`);
            })
            .catch((err) => {
                console.warn(`Background full paper fetch failed for "${newPaper.title}":`, err.message);
                db.query(
                    "UPDATE papers SET processing_status = 'legacy' WHERE id = $1 AND processing_status = 'pending'",
                    [newPaper.id]
                ).catch(() => {});
            });

        res.json(newPaper);
    } catch (err) {
        console.error("DB error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ----------------------------------------------------
// 10. DELETE A PAPER
// ----------------------------------------------------
router.delete("/:id", async (req, res) => {
    try {
        // Optionally delete local file if in uploads/
        const existing = await db.query(
            "SELECT file_path FROM papers WHERE id = $1",
            [req.params.id]
        );

        if (existing.rows.length && existing.rows[0].file_path) {
            const fp = existing.rows[0].file_path;
            if (!/^https?:\/\//i.test(fp) && fs.existsSync(fp)) {
                fs.promises.unlink(fp).catch(() => {});
            }
        }

        await db.query("DELETE FROM papers WHERE id = $1", [req.params.id]);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
