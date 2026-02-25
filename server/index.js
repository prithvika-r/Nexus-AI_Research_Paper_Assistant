import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";
import searchRouter from "./routes/search.js";
import papersRouter from "./routes/papers.js";
import uploadRouter from "./routes/upload.js";
import chatRouter from "./routes/chat.js";
import debateRouter from "./routes/debate.js";
import gapsRouter from "./routes/gaps.js";
import slidesRouter from "./routes/slides.js";
import similarityRouter from "./routes/similarity.js";
import recommendationsRouter from "./routes/recommendations.js";

dotenv.config();

const { Pool } = pkg;
const app = express();

app.use(cors());
app.use(express.json());

export const db = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

app.get("/", (req, res) => {
    res.json({ message: "Nexus API running" });
});

app.get("/api/test-db", async (req, res) => {
    try {
        const result = await db.query("SELECT COUNT(*) FROM papers");
        res.json({ papers: result.rows[0].count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.use("/api/search", searchRouter);
app.use("/api/papers", papersRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/chat", chatRouter);
app.use("/api/debate", debateRouter);
app.use("/api/gaps", gapsRouter);
app.use("/api/slides", slidesRouter);
app.use("/api/similarity", similarityRouter);
app.use("/api/recommendations", recommendationsRouter);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));