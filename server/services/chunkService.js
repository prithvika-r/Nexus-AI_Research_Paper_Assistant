
const DEFAULT_CHUNK_SIZE = 1800;
const DEFAULT_OVERLAP = 220;
const MIN_CHUNK_SIZE = 300;

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeOptions(options = {}) {
  const chunkSize = Math.max(
    MIN_CHUNK_SIZE,
    Number(options.chunkSize) || DEFAULT_CHUNK_SIZE
  );

  const overlap = Math.max(
    0,
    Math.min(
      Math.floor(chunkSize / 4),
      Number(options.overlap) || DEFAULT_OVERLAP
    )
  );

  return { chunkSize, overlap };
}

function resolvePageNumber(page, index) {
  const value = Number(page?.pageNumber ?? page?.page_number ?? page?.page ?? index + 1);
  return Number.isInteger(value) && value > 0 ? value : index + 1;
}

function blockText(block) {
  if (typeof block === "string") return normalizeText(block);

  return normalizeText(
    block?.text ??
    block?.content ??
    block?.str ??
    ""
  );
}

function blockOrder(block, fallback) {
  const value = Number(block?.readingOrder ?? block?.reading_order ?? block?.order);
  return Number.isFinite(value) ? value : fallback;
}

function getBlocks(page) {
  if (Array.isArray(page?.blocks) && page.blocks.length > 0) {
    return page.blocks
      .map((block, index) => ({
        text: blockText(block),
        order: blockOrder(block, index),
        type: block?.contentType ?? block?.content_type ?? block?.type ?? "body",
        contentType: block?.contentType ?? block?.content_type ?? block?.type ?? "body",
        sectionTitle: block?.sectionTitle ?? block?.section_title ?? null,
        sectionPath: Array.isArray(block?.sectionPath ?? block?.section_path)
          ? (block?.sectionPath ?? block?.section_path)
          : [],
        sectionLevel: block?.sectionLevel ?? block?.section_level ?? null,
        isHeading: Boolean(block?.isHeading || block?.is_heading || block?.contentType === "heading"),
        headingTitle: block?.headingTitle ?? block?.heading_title ?? null,
        isReference: Boolean(block?.isReference || block?.is_reference || block?.contentType === "reference"),
        isTable: Boolean(block?.isTableLike || block?.table || block?.contentType === "table"),
        isFigure: Boolean(block?.figure || block?.contentType === "figure"),
        table: block?.table ?? null,
        figure: block?.figure ?? null,
      }))
      .filter((block) => block.text)
      .sort((a, b) => a.order - b.order);
  }

  const text = normalizeText(page?.text ?? page?.content ?? "");

  if (!text) return [];

  return text
    .split(/\n+/)
    .map((line, index) => ({
      text: normalizeText(line),
      order: index,
      type: "body",
    }))
    .filter((block) => block.text);
}

function isReferenceHeading(text) {
  return /^(?:\d+(?:\.\d+)*[.)]?\s+)?(?:references|bibliography|works cited|literature cited|reference list)(?:\s*[:.]?\s*)$/i.test(
    normalizeText(text)
  );
}

function isLikelyHeading(text) {
  const value = normalizeText(text);

  if (!value || value.length > 140) return false;
  if (/[.!?]$/.test(value)) return false;

  const patterns = [
    /^(?:\d+(?:\.\d+)*\.?\s+)?abstract$/i,
    /^(?:\d+(?:\.\d+)*\.?\s+)?introduction$/i,
    /^(?:\d+(?:\.\d+)*\.?\s+)?background$/i,
    /^(?:\d+(?:\.\d+)*\.?\s+)?related work$/i,
    /^(?:\d+(?:\.\d+)*\.?\s+)?literature review$/i,
    /^(?:\d+(?:\.\d+)*\.?\s+)?methodology$/i,
    /^(?:\d+(?:\.\d+)*\.?\s+)?methods?(?: and materials)?$/i,
    /^(?:\d+(?:\.\d+)*\.?\s+)?materials and methods$/i,
    /^(?:\d+(?:\.\d+)*\.?\s+)?experiments?$/i,
    /^(?:\d+(?:\.\d+)*\.?\s+)?results?$/i,
    /^(?:\d+(?:\.\d+)*\.?\s+)?discussion$/i,
    /^(?:\d+(?:\.\d+)*\.?\s+)?conclusion(?:s)?$/i,
    /^(?:\d+(?:\.\d+)*\.?\s+)?limitations$/i,
    /^(?:\d+(?:\.\d+)*\.?\s+)?future work$/i,
    /^(?:\d+(?:\.\d+)*\.?\s+)?acknowledgements?$/i,
    /^(?:\d+(?:\.\d+)*\.?\s+)?appendix(?:\s+[A-Z])?$/i,
    /^(?:\d+(?:\.\d+)*\.?\s+)?references$/i,
  ];

  if (patterns.some((pattern) => pattern.test(value))) return true;

  // Recognize numbered section headings, but avoid treating every numbered
  // sentence or numbered list entry as a heading.
  if (/^\d+(?:\.\d+){0,3}\s+[A-Z][\w\s,:()/-]{2,90}$/.test(value)) {
    return value.split(/\s+/).length <= 12;
  }

  return false;
}

function headingLevel(text) {
  const match = normalizeText(text).match(/^(\d+(?:\.\d+)*)/);
  return match ? match[1].split(".").length : 1;
}

function splitIntoSentences(text) {
  // Retain punctuation and avoid splitting common abbreviations where possible.
  const protectedText = text
    .replace(/\b(e\.g|i\.e|et al|Fig|Eq|Dr|Prof|vs|No)\./gi, "$1<DOT>")
    .replace(/(\d)\.(\d)/g, "$1<DOT>$2");

  const sentences = protectedText
    .split(/(?<=[.!?])\s+(?=[A-Z0-9([“"'`])/)
    .map((sentence) => sentence.replace(/<DOT>/g, ".").trim())
    .filter(Boolean);

  return sentences.length ? sentences : [text];
}

function splitLongText(text, maxLength) {
  const value = normalizeText(text);
  if (value.length <= maxLength) return [value];

  const sentences = splitIntoSentences(value);
  const pieces = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      if (current) {
        pieces.push(current);
        current = "";
      }

      let remainder = sentence;

      while (remainder.length > maxLength) {
        let cut = remainder.lastIndexOf(" ", maxLength);

        if (cut < Math.floor(maxLength * 0.5)) {
          cut = maxLength;
        }

        pieces.push(remainder.slice(0, cut).trim());
        remainder = remainder.slice(cut).trim();
      }

      current = remainder;
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;

    if (candidate.length > maxLength) {
      if (current) pieces.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current) pieces.push(current);

  return pieces.filter(Boolean);
}

function splitParagraphs(text) {
  return normalizeText(text)
    .split(/\n\s*\n/)
    .map(normalizeText)
    .filter(Boolean);
}

function createPieces(text, maxLength) {
  const paragraphs = splitParagraphs(text);
  const pieces = [];
  let buffer = "";

  for (const paragraph of paragraphs) {
    const segments = splitLongText(paragraph, maxLength);

    for (const segment of segments) {
      const candidate = buffer ? `${buffer}\n\n${segment}` : segment;

      if (candidate.length <= maxLength) {
        buffer = candidate;
      } else {
        if (buffer) pieces.push(buffer);
        buffer = segment;
      }
    }
  }

  if (buffer) pieces.push(buffer);

  return pieces;
}

function getOverlapPrefix(previousText, overlapLength) {
  if (!overlapLength || !previousText) return "";

  const start = Math.max(0, previousText.length - overlapLength);
  let prefix = previousText.slice(start);

  // Prefer a sentence or paragraph boundary when one is nearby.
  const sentenceBoundary = prefix.search(/[.!?]\s+/);

  if (sentenceBoundary >= 0 && sentenceBoundary < prefix.length * 0.6) {
    prefix = prefix.slice(sentenceBoundary).trim();
  } else {
    // Do not begin the overlap in the middle of a word.
    const firstSpace = prefix.indexOf(" ");

    if (firstSpace >= 0 && firstSpace < 40) {
      prefix = prefix.slice(firstSpace + 1).trim();
    }
  }

  return prefix;
}

function addOverlap(pieces, overlapLength) {
  if (overlapLength <= 0 || pieces.length < 2) return pieces;

  return pieces.map((piece, index) => {
    if (index === 0) return piece;

    const prefix = getOverlapPrefix(pieces[index - 1], overlapLength);
    if (!prefix) return piece;

    // Avoid exceeding the chunk budget solely because of overlap.
    const maxPrefix = Math.max(0, DEFAULT_CHUNK_SIZE - piece.length - 2);
    const safePrefix = prefix.slice(-maxPrefix).trim();

    return safePrefix ? `${safePrefix}\n\n${piece}` : piece;
  });
}

function appendSection(sectionPath, title, level) {
  const next = sectionPath.slice(0, Math.max(0, level - 1));
  next[level - 1] = title;
  return next.filter(Boolean);
}

function makeChunk({
  chunkIndex,
  pageNumber,
  content,
  contentType,
  sectionTitle,
  sectionPath,
  sectionLevel,
  readingOrder,
  isReference,
}) {
  return {
    chunkIndex,
    pageNumber,
    content: normalizeText(content),
    contentType,
    sectionTitle: sectionTitle || null,
    sectionPath: [...sectionPath],
    sectionLevel: sectionLevel ?? null,
    readingOrder,
    isReference: Boolean(isReference),
  };
}

export function createPageAwareChunks(pages, options = {}) {
  if (!Array.isArray(pages)) {
    throw new TypeError("pages must be an array.");
  }

  const { chunkSize, overlap } = normalizeOptions(options);
  const chunks = [];

  let sectionPath = [];
  let currentSectionTitle = null;
  let referenceMode = false;
  let chunkIndex = 0;

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    const pageNumber = resolvePageNumber(page, pageIndex);
    const blocks = getBlocks(page);

    let buffer = [];
    let bufferLength = 0;
    let firstReadingOrder = 0;

    const flush = () => {
      if (!buffer.length) return;

      const text = buffer.map((item) => item.text).join("\n\n");
      const pieces = createPieces(text, chunkSize);
      const overlappedPieces = addOverlap(pieces, overlap, chunkSize);

      for (const piece of overlappedPieces) {
        if (!piece) continue;

        chunks.push(
          makeChunk({
            chunkIndex: chunkIndex++,
            pageNumber,
            content: piece,
            contentType: referenceMode ? "reference" : "body",
            sectionTitle: currentSectionTitle,
            sectionPath,
            sectionLevel: sectionPath.length || null,
            readingOrder: firstReadingOrder,
            isReference: referenceMode,
          })
        );
      }

      buffer = [];
      bufferLength = 0;
    };

    for (const block of blocks) {
      const text = block.text;

      // Inherit section metadata if present on block
      if (block.sectionTitle) {
        currentSectionTitle = block.sectionTitle;
      }
      if (Array.isArray(block.sectionPath) && block.sectionPath.length > 0) {
        sectionPath = block.sectionPath;
      }

      // Handle table or figure as dedicated chunk
      if (block.contentType === "table" || block.contentType === "figure") {
        flush();
        chunks.push(
          makeChunk({
            chunkIndex: chunkIndex++,
            pageNumber,
            content: block.text,
            contentType: block.contentType,
            sectionTitle: block.sectionTitle || currentSectionTitle,
            sectionPath: block.sectionPath?.length ? block.sectionPath : sectionPath,
            sectionLevel: block.sectionLevel ?? sectionPath.length ?? null,
            readingOrder: block.order,
            isReference: false,
          })
        );
        continue;
      }

      if (block.isReference || isReferenceHeading(text)) {
        flush();
        referenceMode = true;
        currentSectionTitle = block.headingTitle || text;
        sectionPath = appendSection(sectionPath, currentSectionTitle, 1);
        if (block.isHeading) continue;
      }

      if (block.isHeading || isLikelyHeading(text)) {
        flush();

        const title = block.headingTitle || text;
        const level = block.sectionLevel || headingLevel(title);
        sectionPath = appendSection(sectionPath, title, level);
        currentSectionTitle = title;

        if (/^(?:abstract|introduction)$/i.test(title)) {
          referenceMode = false;
        }

        continue;
      }

      if (!buffer.length) {
        firstReadingOrder = block.order;
      }

      const additionalLength = buffer.length ? text.length + 2 : text.length;

      if (
        buffer.length > 0 &&
        bufferLength + additionalLength > chunkSize
      ) {
        flush();
        firstReadingOrder = block.order;
      }

      buffer.push({ text, order: block.order });
      bufferLength += additionalLength;
    }

    flush();
  }

  return chunks.filter((chunk) => chunk.content.length > 0);
}

export function createChunks(text, options = {}) {
  const normalized = normalizeText(text);

  if (!normalized) return [];

  return createPageAwareChunks(
    [
      {
        pageNumber: 1,
        text: normalized,
      },
    ],
    options
  );
}

export {
  isReferenceHeading,
  isLikelyHeading,
  normalizeText,
};
