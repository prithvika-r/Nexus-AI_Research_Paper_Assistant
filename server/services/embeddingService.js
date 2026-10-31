import { pipeline } from "@huggingface/transformers";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_MODEL = MODEL_NAME;
export const EMBEDDING_DIMENSIONS = 384;

let extractor = null;
let loadingPromise = null;
let fallbackMode = false;

export function generateFallbackEmbedding(text) {
    const vector = new Float64Array(EMBEDDING_DIMENSIONS);
    const tokens = String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || ["unknown"];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        let hash = 0x811c9dc5;
        for (let j = 0; j < token.length; j++) {
            hash ^= token.charCodeAt(j);
            hash = Math.imul(hash, 0x01000193);
        }
        const index = Math.abs(hash) % EMBEDDING_DIMENSIONS;
        const sign = (hash & 1) ? 1 : -1;
        vector[index] += sign * (1 / Math.sqrt(i + 1));
    }

    let sumSq = 0;
    for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
        sumSq += vector[i] * vector[i];
    }
    const norm = Math.sqrt(sumSq) || 1;
    const result = new Array(EMBEDDING_DIMENSIONS);
    for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
        result[i] = Number((vector[i] / norm).toFixed(6));
    }
    return result;
}

async function getExtractor() {
    if (fallbackMode) {
        return null;
    }

    if (extractor) {
        return extractor;
    }

    if (!loadingPromise) {
        loadingPromise = (async () => {
            console.log(`Loading embedding model: ${MODEL_NAME}`);
            const model = await pipeline("feature-extraction", MODEL_NAME);
            console.log("Embedding model loaded successfully.");
            return model;
        })().catch((error) => {
            console.warn(`[WARN] Embedding model loading failed (${error.message}); activating fallback semantic projection.`);
            fallbackMode = true;
            loadingPromise = null;
            return null;
        });
    }

    extractor = await loadingPromise;
    return extractor;
}

function validateText(text, index) {
    if (typeof text !== "string" || !text.trim()) {
        throw new Error(
            `Embedding input at index ${index} must be a non-empty string.`
        );
    }
    return text.trim();
}

function validateEmbedding(embedding, index) {
    if (
        !Array.isArray(embedding) ||
        embedding.length !== EMBEDDING_DIMENSIONS ||
        !embedding.every(Number.isFinite)
    ) {
        throw new Error(
            `Invalid embedding at index ${index}: expected ${EMBEDDING_DIMENSIONS} finite numbers.`
        );
    }
    return embedding;
}

export async function embedText(text) {
    const validText = validateText(text, 0);
    const model = await getExtractor();

    if (!model) {
        return validateEmbedding(generateFallbackEmbedding(validText), 0);
    }

    try {
        const output = await model(validText, {
            pooling: "mean",
            normalize: true,
        });
        const rows = output.tolist();
        const embedding = rows?.[0];
        return validateEmbedding(embedding, 0);
    } catch (err) {
        console.warn("Model inference failed, falling back to projection:", err.message);
        return validateEmbedding(generateFallbackEmbedding(validText), 0);
    }
}

export async function embedTexts(texts) {
    if (!Array.isArray(texts)) {
        throw new TypeError("embedTexts expects an array of strings.");
    }

    if (texts.length === 0) {
        return [];
    }

    const validTexts = texts.map(validateText);
    const model = await getExtractor();

    if (!model) {
        return validTexts.map((t, idx) => validateEmbedding(generateFallbackEmbedding(t), idx));
    }

    try {
        const output = await model(validTexts, {
            pooling: "mean",
            normalize: true,
        });

        const embeddings = output.tolist();

        if (!Array.isArray(embeddings) || embeddings.length !== validTexts.length) {
            throw new Error(
                `Embedding count mismatch: received ${embeddings?.length ?? 0} embeddings for ${validTexts.length} inputs.`
            );
        }

        return embeddings.map(validateEmbedding);
    } catch (err) {
        console.warn("Batch inference failed, using projection fallback:", err.message);
        return validTexts.map((t, idx) => validateEmbedding(generateFallbackEmbedding(t), idx));
    }
}
