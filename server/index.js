import express from "express";
import cors from "cors";
import "dotenv/config";

import { db } from "./config/database.js";

import searchRouter from "./routes/search.js";
import papersRouter from "./routes/papers.js";
import uploadRouter from "./routes/upload.js";
import chatRouter from "./routes/chat.js";
import debateRouter from "./routes/debate.js";
import gapsRouter from "./routes/gaps.js";
import slidesRouter from "./routes/slides.js";
import similarityRouter from "./routes/similarity.js";
import recommendationsRouter from "./routes/recommendations.js";

const app = express();

const PORT = Number(
    process.env.PORT || 5000
);

app.use(
    cors({
        origin:
            process.env.CLIENT_URL ||
            "http://localhost:5173",
        credentials: true,
    })
);

app.use(
    express.json({
        limit: "2mb",
    })
);

app.get("/", (req, res) => {
    res.json({
        message: "Nexus API running",
        version: "2.0",
        architecture:
            "Express + PostgreSQL + pgvector + RAG",
    });
});

app.get(
    "/api/health",
    async (req, res) => {
        try {
            const result =
                await db.query(
                    "SELECT NOW() AS time"
                );

            res.json({
                status: "ok",
                database: "connected",
                time:
                    result.rows[0].time,
            });
        } catch (error) {
            res.status(500).json({
                status: "error",
                database: "unavailable",
                error:
                    error.message,
            });
        }
    }
);

app.get(
    "/api/test-db",
    async (req, res) => {
        try {
            const result =
                await db.query(
                    "SELECT COUNT(*) FROM papers"
                );

            res.json({
                papers:
                    result.rows[0].count,
            });
        } catch (error) {
            res.status(500).json({
                error:
                    error.message,
            });
        }
    }
);

// Existing Nexus routes
app.use(
    "/api/search",
    searchRouter
);

app.use(
    "/api/papers",
    papersRouter
);

app.use(
    "/api/upload",
    uploadRouter
);

app.use(
    "/api/chat",
    chatRouter
);

app.use(
    "/api/debate",
    debateRouter
);

app.use(
    "/api/gaps",
    gapsRouter
);

app.use(
    "/api/slides",
    slidesRouter
);

app.use(
    "/api/similarity",
    similarityRouter
);

app.use(
    "/api/recommendations",
    recommendationsRouter
);

// 404 handler
app.use(
    (req, res) => {
        res.status(404).json({
            error:
                "API endpoint not found",
        });
    }
);

// Global error handler
app.use(
    (error, req, res, next) => {
        console.error(
            "Unhandled server error:",
            error
        );

        res.status(
            error.status || 500
        ).json({
            error:
                error.message ||
                "Internal server error",
        });
    }
);

const server = app.listen(
    PORT,
    () => {
        console.log(
            `Nexus API running on http://localhost:${PORT}`
        );
    }
);

async function shutdown(signal) {
    console.log(
        `${signal} received. Shutting down...`
    );

    server.close(async () => {
        await db.end();

        console.log(
            "Nexus API stopped."
        );

        process.exit(0);
    });
}

process.on(
    "SIGINT",
    () => shutdown("SIGINT")
);

process.on(
    "SIGTERM",
    () => shutdown("SIGTERM")
);

export { db };