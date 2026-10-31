import { db } from "../config/database.js";
import fs from "fs";

const paperId = process.argv[2] || "017c3dcb-2995-4278-bb8f-0ebca80726f6";

try {
    const result = await db.query(
        `SELECT id, title, file_path, chunk_count
         FROM papers
         WHERE id = $1`,
        [paperId]
    );

    if (!result.rows.length) {
        console.log(`Paper not found for ID: ${paperId}`);
    } else {
        const paper = result.rows[0];
        console.log({
            id: paper.id,
            title: paper.title,
            filePath: paper.file_path,
            chunkCount: paper.chunk_count,
            fileExists: paper.file_path ? fs.existsSync(paper.file_path) : false,
        });
    }
} finally {
    await db.end();
}
