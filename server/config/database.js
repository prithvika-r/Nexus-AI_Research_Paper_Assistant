import "dotenv/config";
import pkg from "pg";

const { Pool } = pkg;

export const db = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT || 5432),

    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

db.on("error", (error) => {
    console.error(
        "Unexpected PostgreSQL pool error:",
        error
    );
});