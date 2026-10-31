import fs from "node:fs/promises";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_TITLE_LENGTH = 300;
const MAX_ABSTRACT_LENGTH = 16000;
const MAX_HEADING_LENGTH = 160;
const ROW_Y_TOLERANCE = 3.2;
const PARAGRAPH_GAP_MULTIPLIER = 1.65;

const ABSTRACT_START = /^(?:abstract|summary)\s*[:.]?\s*/i;
const ABSTRACT_END = /^(?:keywords?|key\s*words|index terms|1[.)]?\s+introduction|introduction|background)\s*[:.]?\s*$/i;
const REFERENCE_HEADING = /^(?:references|bibliography|works cited|literature cited)\s*$/i;
const TABLE_CAPTION_PATTERN = /^(?:table|TABLE)\s+([0-9IVXLCDM]+|[A-Z])[:.-]?\s*(.*)/i;
const FIGURE_CAPTION_PATTERN = /^(?:figure|fig\.|FIGURE|FIG\.)\s+([0-9IVXLCDM]+|[A-Z])[:.-]?\s*(.*)/i;
const NUMBERED_HEADING = /^\s*((?:\d+|[IVXLCDM]+)(?:\.\d+){0,5})[.)]?\s+(.+?)\s*$/i;

const EDITORIAL_SIDEBAR_PATTERN = /^(?:open\s*access|edited\s*by|reviewed\s*by|\*?correspondence|received\s*[:\d]|accepted\s*[:\d]|published\s*[:\d]|citation\s*:|copyright\s*©|specialty\s*section|type\s*original\s*research|frontiersin\.org)/i;

export function normalizeText(value = "") {
    return String(value)
        .normalize("NFC")
        .replace(/\u00a0/g, " ")
        .replace(/[\u200b-\u200d\uFEFF]/g, "")
        .replace(/\u00ad/g, "")
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getTextItem(item, viewport) {
    const transform = item.transform || [];
    const matrix = pdfjsLib.Util.transform(viewport.transform, transform);

    const x = Number(matrix[4]) || 0;
    const baseline = Number(matrix[5]) || 0;
    const fontSize = Math.hypot(Number(matrix[2]) || 0, Number(matrix[3]) || 0);
    const width = Math.max(0, Number(item.width) || 0) * viewport.scale;
    const height = Math.max(0, Number(item.height) || fontSize || 0) * viewport.scale;
    const text = normalizeText(item.str || "");

    return {
        text,
        x,
        right: x + width,
        width,
        baseline,
        top: baseline - height,
        bottom: baseline,
        height,
        fontSize: fontSize || height,
        fontName: item.fontName || "",
        hasEOL: Boolean(item.hasEOL),
    };
}

function itemIsBold(item) {
    return /bold|black|heavy|demi|semibold/i.test(item.fontName || "");
}

function lineFromItems(items) {
    const sorted = [...items].sort((a, b) => a.x - b.x);
    let text = "";
    let previous = null;

    for (const item of sorted) {
        if (!item.text) continue;
        if (previous) {
            const gap = item.x - previous.right;
            const charWidth = median([
                previous.width / Math.max(previous.text.length, 1),
                item.width / Math.max(item.text.length, 1),
            ]);
            if (gap > Math.max(1.2, charWidth * 0.35)) {
                text += " ";
            }
        }
        text += item.text;
        previous = item;
    }
    return normalizeText(text);
}

function groupItemsByY(items) {
    const sorted = items
        .filter(item => item.text)
        .sort((a, b) => a.baseline - b.baseline || a.x - b.x);

    const rows = [];

    for (const item of sorted) {
        let best = null;
        let bestDistance = Infinity;

        for (const row of rows) {
            const distance = Math.abs(row.baseline - item.baseline);
            const typicalHeight = median([row.height, item.height].filter(Boolean));
            const tolerance = Math.max(1, Math.min(ROW_Y_TOLERANCE, typicalHeight * 0.30));

            if (distance <= tolerance && distance < bestDistance) {
                best = row;
                bestDistance = distance;
            }
        }

        if (!best) {
            rows.push({
                baseline: item.baseline,
                height: item.height,
                items: [item],
            });
        } else {
            best.items.push(item);
            best.baseline = median(best.items.map(entry => entry.baseline));
            best.height = median(best.items.map(entry => entry.height));
        }
    }

    for (const row of rows) {
        row.items.sort((a, b) => a.x - b.x);
        row.left = Math.min(...row.items.map(item => item.x));
        row.right = Math.max(...row.items.map(item => item.right));
        row.width = row.right - row.left;
        row.top = Math.min(...row.items.map(item => item.top));
        row.bottom = Math.max(...row.items.map(item => item.bottom));
        row.text = lineFromItems(row.items);
        row.fontSize = median(row.items.map(item => item.fontSize));
        row.boldRatio = row.items.length
            ? row.items.filter(itemIsBold).length / row.items.length
            : 0;
    }

    return rows
        .filter(row => row.text)
        .sort((a, b) => a.baseline - b.baseline);
}

function isHeaderOrFooterRow(row, pageHeight) {
    if (!pageHeight) return false;
    const topMargin = Math.max(45, pageHeight * 0.07);
    const bottomMargin = Math.min(pageHeight - 40, pageHeight * 0.935);

    const isTop = row.baseline <= topMargin;
    const isBottom = row.baseline >= bottomMargin;

    if (!isTop && !isBottom) return false;

    const text = row.text.trim();
    if (/^\d{1,4}$/.test(text)) return true;
    if (/\b(?:doi\.org|frontiersin\.org|ieee|arxiv|springer|elsevier)\b/i.test(text)) return true;
    if (/^(?:page\s+\d+|\d+\s+frontiers|\d+\s+ieee)/i.test(text)) return true;
    if (text.length < 90 && /\b(?:\d{4}|vol\.|no\.|pp\.)\b/i.test(text)) return true;
    if (text.length < 80 && (isTop || isBottom)) return true;

    return false;
}

function findColumnGutter(rows, pageWidth) {
    if (!pageWidth || rows.length < 6) return null;

    const itemHeights = rows
        .map(row => row.height)
        .filter(Number.isFinite)
        .filter(value => value > 0);

    const medianLineHeight = median(itemHeights) || 10;
    const binWidth = Math.max(1, medianLineHeight * 0.25);
    const binCount = Math.ceil(pageWidth / binWidth);
    const occupancy = new Array(binCount).fill(0);

    for (const row of rows) {
        for (const item of row.items) {
            const startBin = clamp(Math.floor(item.x / binWidth), 0, binCount - 1);
            const endBin = clamp(Math.ceil(item.right / binWidth) - 1, 0, binCount - 1);
            for (let i = startBin; i <= endBin; i++) {
                occupancy[i]++;
            }
        }
    }

    const emptyTolerance = Math.max(0, Math.floor(rows.length * 0.02));
    const valleys = [];
    let start = -1;

    for (let i = 0; i < binCount; i++) {
        const empty = occupancy[i] <= emptyTolerance;
        if (empty && start === -1) {
            start = i;
        }
        const isLastBin = i === binCount - 1;
        if ((!empty || isLastBin) && start !== -1) {
            const end = empty ? i : i - 1;
            valleys.push({
                startBin: start,
                endBin: end,
                center: ((start + end + 1) / 2) * binWidth,
                width: (end - start + 1) * binWidth,
            });
            start = -1;
        }
    }

    const minGutterWidth = medianLineHeight * 0.75;
    const candidates = valleys.filter(valley => valley.width >= minGutterWidth);
    if (!candidates.length) return null;

    let best = null;

    for (const valley of candidates) {
        // Gutter should sit near the middle 30% to 70% of the page
        const ratio = valley.center / pageWidth;
        if (ratio < 0.32 || ratio > 0.68) continue;

        let cleanRows = 0;
        let leftRows = 0;
        let rightRows = 0;
        let crossingRows = 0;

        for (const row of rows) {
            const hasCrossingItem = row.items.some(
                it => it.x < (valley.center - 3) && it.right > (valley.center + 3)
            );

            if (hasCrossingItem) {
                crossingRows++;
            } else {
                const rowLeft = row.items.some(it => it.right <= valley.center);
                const rowRight = row.items.some(it => it.x >= valley.center);
                if (rowLeft) leftRows++;
                if (rowRight) rightRows++;
                if (rowLeft || rowRight) cleanRows++;
            }
        }

        const minSideRows = Math.max(3, Math.floor(rows.length * 0.15));
        if (leftRows < minSideRows || rightRows < minSideRows) continue;

        const crossingRatio = crossingRows / rows.length;
        if (crossingRatio > 0.25) continue;

        const score = cleanRows * Math.log1p(valley.width / medianLineHeight) * (1 - crossingRatio);
        if (!best || score > best.score) {
            best = { x: valley.center, score };
        }
    }

    return best?.x ?? null;
}

function makeBlock(text, items, pageNumber, column, pageWidth) {
    text = normalizeText(text);
    if (!text || !items.length) return null;

    return {
        text,
        pageNumber,
        pageEnd: pageNumber,
        readingOrder: -1,
        column,
        x: Math.min(...items.map(item => item.x)),
        y: median(items.map(item => item.baseline)),
        width: Math.max(...items.map(item => item.right)) - Math.min(...items.map(item => item.x)),
        pageWidth,
        fontSize: median(items.map(item => item.fontSize)),
        boldRatio: items.filter(itemIsBold).length / items.length,
        sectionTitle: null,
        sectionPath: [],
        headingLevel: null,
        isHeading: false,
        isReference: false,
        isTableLike: false,
        contentType: "paragraph",
        table: null,
        figure: null,
    };
}

function isSidebarItem(item, pageWidth) {
    if (item.x > pageWidth * 0.35) return false;
    return EDITORIAL_SIDEBAR_PATTERN.test(item.text.trim());
}

function orderPageRows(rows, gutter, pageNumber, pageWidth) {
    if (gutter == null || !pageWidth) {
        return rows
            .map(row => makeBlock(row.text, row.items, pageNumber, "single", pageWidth))
            .filter(Boolean);
    }

    // Partition rows into:
    // 1. Sidebar rows (editorial metadata on far left of page 1)
    // 2. Full-width spanning rows (width > 68% of page)
    // 3. Two-column rows (divided by gutter)
    const sidebarItems = [];
    const mainRows = [];

    // Check if page has an editorial sidebar column (e.g. Frontiers layout)
    const hasSidebar = pageNumber === 1 && rows.some(r =>
        r.items.some(it => isSidebarItem(it, pageWidth))
    );

    for (const row of rows) {
        if (hasSidebar) {
            const side = [];
            const normal = [];
            for (const item of row.items) {
                if (item.right <= pageWidth * 0.34) {
                    side.push(item);
                } else {
                    normal.push(item);
                }
            }
            if (side.length) sidebarItems.push(...side);
            if (normal.length) {
                mainRows.push({
                    ...row,
                    items: normal,
                    text: lineFromItems(normal),
                    left: Math.min(...normal.map(it => it.x)),
                    right: Math.max(...normal.map(it => it.right)),
                });
            }
        } else {
            mainRows.push(row);
        }
    }

    const output = [];

    if (hasSidebar) {
        // Front matter on page 1 is a single main column
        mainRows.sort((a, b) => a.baseline - b.baseline);
        for (const row of mainRows) {
            const blk = makeBlock(lineFromItems(row.items), row.items, pageNumber, "main", pageWidth);
            if (blk) output.push(blk);
        }
        if (sidebarItems.length) {
            const sideRows = groupItemsByY(sidebarItems);
            for (const r of sideRows) {
                const blk = makeBlock(r.text, r.items, pageNumber, "sidebar", pageWidth);
                if (blk) {
                    blk.contentType = "sidebar";
                    output.push(blk);
                }
            }
        }
        return output;
    }

    // Process main rows with vertical banding

    // Find bands: split when a row spans across the gutter
    let currentBandLeft = [];
    let currentBandRight = [];

    const flushBand = () => {
        currentBandLeft.sort((a, b) => a.baseline - b.baseline);
        currentBandRight.sort((a, b) => a.baseline - b.baseline);

        for (const row of currentBandLeft) {
            const blk = makeBlock(lineFromItems(row.items), row.items, pageNumber, "left", pageWidth);
            if (blk) output.push(blk);
        }
        for (const row of currentBandRight) {
            const blk = makeBlock(lineFromItems(row.items), row.items, pageNumber, "right", pageWidth);
            if (blk) output.push(blk);
        }
        currentBandLeft = [];
        currentBandRight = [];
    };

    for (const row of mainRows) {
        // Individual item physically crossing the gutter
        const hasCrossingItem = row.items.some(
            it => it.x < (gutter - 3) && it.right > (gutter + 3) && it.width > 15
        );

        // A true full-width spanning block (e.g. title, wide figure, or wide heading)
        const isTrueSpanningRow = hasCrossingItem || (
            (row.right - row.left) > pageWidth * 0.72 &&
            row.left < gutter * 0.5 &&
            row.right > gutter * 1.5 &&
            (row.isHeading || row.isTableLike || row.items.length === 1 || row.fontSize > 13)
        );

        if (isTrueSpanningRow) {
            flushBand();
            const blk = makeBlock(lineFromItems(row.items), row.items, pageNumber, "full-width", pageWidth);
            if (blk) output.push(blk);
        } else {
            const leftItems = row.items.filter(it => it.right <= gutter + 4);
            const rightItems = row.items.filter(it => it.x >= gutter - 4);

            if (leftItems.length) currentBandLeft.push({ ...row, items: leftItems });
            if (rightItems.length) currentBandRight.push({ ...row, items: rightItems });
        }
    }

    flushBand();

    // If sidebar items were collected, append them at the end of front matter as sidebar blocks
    if (sidebarItems.length) {
        const sideRows = groupItemsByY(sidebarItems);
        for (const r of sideRows) {
            const blk = makeBlock(r.text, r.items, pageNumber, "sidebar", pageWidth);
            if (blk) {
                blk.contentType = "sidebar";
                output.push(blk);
            }
        }
    }

    return output;
}

export function dehyphenateText(text1, text2) {
    if (!text1 || !text2) return `${text1 || ""} ${text2 || ""}`.trim();

    const match = /([A-Za-z]+)-$/.exec(text1);
    if (match) {
        const prefix = match[1];
        const nextWordMatch = /^([A-Za-z]+)/.exec(text2);
        if (nextWordMatch) {
            const suffix = nextWordMatch[1];
            // Check if it's a hyphenated compound word or word split
            const compoundCommon = /^(?:multi|speed|real|pre|post|self|non|semi|cross|deep|high|low|well|fine)$/i.test(prefix);
            const joined = compoundCommon ? `${prefix}-${text2}` : `${prefix}${text2}`;
            return `${text1.slice(0, match.index)}${joined}`.trim();
        }
    }
    return `${text1} ${text2}`.trim();
}

function classifyBlock(block, pageMedianFont) {
    const text = normalizeText(block.text);

    if (block.contentType === "sidebar") return;

    if (REFERENCE_HEADING.test(text) || /^\[\d+\]\s/.test(text) || /^\d+\.\s+[A-Z]/.test(text) && block.column !== "single") {
        if (REFERENCE_HEADING.test(text)) {
            block.isHeading = true;
            block.headingTitle = "References";
            block.headingLevel = 1;
            block.contentType = "heading";
            block.isReference = true;
            return;
        }
    }

    if (TABLE_CAPTION_PATTERN.test(text)) {
        block.contentType = "table-caption";
        block.isTableLike = true;
        const match = TABLE_CAPTION_PATTERN.exec(text);
        block.table = {
            tableNumber: match ? match[1] : "",
            caption: text,
            headers: [],
            rows: [],
            markdown: "",
        };
        return;
    }

    if (FIGURE_CAPTION_PATTERN.test(text)) {
        block.contentType = "figure-caption";
        const match = FIGURE_CAPTION_PATTERN.exec(text);
        block.figure = {
            figureNumber: match ? match[1] : "",
            caption: text,
        };
        return;
    }

    const numbered = NUMBERED_HEADING.exec(text);
    const words = text.split(/\s+/);
    const relativeSize = pageMedianFont ? block.fontSize / pageMedianFont : 1;
    const shortEnough = text.length <= MAX_HEADING_LENGTH && words.length <= 14;
    const sentenceLike = /[.!?;]$/.test(text);
    const prominent = relativeSize >= 1.15;
    const bold = block.boldRatio >= 0.65;

    const knownHeading = /^(?:abstract|summary|introduction|background|related work|literature review|methodology|methods|materials and methods|experimental setup|experiments?|results?|discussion|results and discussion|conclusions?|limitations|threats to validity|future work|acknowledgements?|acknowledgments?|references|bibliography|appendix)\s*:?\s*$/i.test(text);

    const numberedHeading = numbered && words.length <= 12 && !/[.;,]$/.test(text) && (prominent || bold || /^[A-Z]/.test(numbered[2]));

    // An unnumbered heading must be a known heading name, or significantly prominent font (> 1.25x) in title case without common narrative verbs
    const hasNarrativeVerbs = /\b(?:is|are|was|were|has|have|been|necessitates|demonstrated|showed|achieved|developed|integrating|enables?|proposed?|observed)\b/i.test(text);
    const startsWithLowercase = /^[a-z]/.test(text);
    const unnumberedHeading = !numbered && knownHeading;
    const prominentHeading = !numbered && prominent && relativeSize >= 1.25 && words.length <= 7 && !sentenceLike && !hasNarrativeVerbs && !startsWithLowercase;

    const looksLikeHeading = shortEnough && !sentenceLike && (numberedHeading || unnumberedHeading || prominentHeading);

    if (looksLikeHeading) {
        block.isHeading = true;
        block.headingTitle = text;
        block.contentType = "heading";
        block.headingLevel = numbered ? numbered[1].split(".").length : 1;
        if (/references|bibliography/i.test(text)) {
            block.isReference = true;
        }
    }
}

function mergeParagraphLines(blocks) {
    const output = [];
    let current = null;

    function flush() {
        if (current) output.push(current);
        current = null;
    }

    for (const block of blocks) {
        if (!current) {
            current = { ...block };
            continue;
        }

        const samePage = current.pageNumber === block.pageNumber;
        const sameColumn = current.column === block.column;

        const special =
            current.contentType !== "paragraph" ||
            block.contentType !== "paragraph" ||
            current.isHeading ||
            block.isHeading ||
            current.isReference ||
            block.isReference ||
            current.isTableLike ||
            block.isTableLike;

        const endsSentence = /[.!?]["')\]]?$/.test(current.text);
        const startsNewParagraph = /^(?:[-•▪◦]\s+|\d+(?:\.\d+)*[.)]?\s+)/.test(block.text);

        const columnCompatible =
            sameColumn ||
            (current.column === "left" && block.column === "right") ||
            (!samePage && (current.column === "right" || current.column === "single" || current.column === "full-width"));

        if (columnCompatible && !special && !endsSentence && !startsNewParagraph) {
            current.text = dehyphenateText(current.text, block.text);
            current.pageEnd = block.pageNumber;
            current.width = Math.max(current.width, block.width);
            current.y = block.y;
        } else {
            flush();
            current = { ...block };
        }
    }

    flush();
    return output;
}

export function extractTablesFromPage(page, rawRows) {
    const tables = [];
    const blocks = page.blocks;

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (!TABLE_CAPTION_PATTERN.test(block.text)) continue;

        const match = TABLE_CAPTION_PATTERN.exec(block.text);
        const tableNumber = match ? match[1] : String(tables.length + 1);
        const caption = block.text;

        // Find candidate tabular rows on this page:
        // Rows located vertically near this caption (either right below it or right above it)
        const captionY = block.y;
        const candidateRows = rawRows.filter(row => {
            const dist = row.baseline - captionY;
            // Usually table data is below caption (dist between 5 and 260)
            return dist > 5 && dist < 260;
        });

        // Determine if candidate rows have aligned columns (multiple items with consistent x positions)
        const tableLines = [];
        for (const r of candidateRows) {
            // If row has 2+ items separated by horizontal whitespace or aligned coordinates
            if (r.items.length >= 2 || (r.text.split(/\s{2,}|\t/).length >= 2)) {
                // If the line is another heading or caption, stop table
                if (TABLE_CAPTION_PATTERN.test(r.text) || FIGURE_CAPTION_PATTERN.test(r.text) || NUMBERED_HEADING.test(r.text)) {
                    break;
                }
                tableLines.push(r);
            } else if (tableLines.length > 0) {
                // Single line might be notes or end of table
                if (/^note|source|\*/i.test(r.text)) {
                    tableLines.push(r);
                }
                break;
            }
        }

        if (tableLines.length >= 2) {
            // Reconstruct table columns
            const parsedRows = tableLines.map(line => {
                if (line.items.length >= 2) {
                    return line.items.map(it => it.text.trim()).filter(Boolean);
                }
                return line.text.split(/\s{2,}|\t/).map(s => s.trim()).filter(Boolean);
            });

            // Find maximum number of columns
            const maxCols = Math.max(...parsedRows.map(r => r.length));
            if (maxCols >= 2) {
                const normalizedRows = parsedRows.map(r => {
                    while (r.length < maxCols) r.push("");
                    return r.slice(0, maxCols);
                });

                const headers = normalizedRows[0];
                const dataRows = normalizedRows.slice(1);

                // Build Markdown Table
                const mdHeader = `| ${headers.join(" | ")} |`;
                const mdSep = `| ${headers.map(() => "---").join(" | ")} |`;
                const mdBody = dataRows.map(r => `| ${r.join(" | ")} |`).join("\n");
                const markdown = `${caption}\n\n${mdHeader}\n${mdSep}\n${mdBody}`;

                const tableObj = {
                    tableNumber,
                    caption,
                    pageNumber: page.pageNumber,
                    sectionTitle: block.sectionTitle,
                    sectionPath: block.sectionPath || [],
                    headers,
                    rows: dataRows,
                    markdown,
                };

                tables.push(tableObj);
                block.table = tableObj;
                block.contentType = "table";
                block.text = markdown;
            }
        } else {
            // Fallback table entry
            tables.push({
                tableNumber,
                caption,
                pageNumber: page.pageNumber,
                sectionTitle: block.sectionTitle,
                sectionPath: block.sectionPath || [],
                headers: [],
                rows: [],
                markdown: caption,
            });
        }
    }

    return tables;
}

export function extractFiguresFromPage(page) {
    const figures = [];
    for (const block of page.blocks) {
        if (FIGURE_CAPTION_PATTERN.test(block.text)) {
            const match = FIGURE_CAPTION_PATTERN.exec(block.text);
            const figureObj = {
                figureNumber: match ? match[1] : String(figures.length + 1),
                caption: block.text,
                pageNumber: page.pageNumber,
                sectionTitle: block.sectionTitle,
                sectionPath: block.sectionPath || [],
            };
            figures.push(figureObj);
            block.figure = figureObj;
            block.contentType = "figure";
        }
    }
    return figures;
}

export function parseReferences(pages) {
    const references = [];
    let insideReferences = false;
    let currentEntry = null;

    for (const page of pages) {
        for (const block of page.blocks) {
            const text = block.text.trim();

            if (block.isHeading && REFERENCE_HEADING.test(text) || REFERENCE_HEADING.test(block.headingTitle || "")) {
                insideReferences = true;
                block.isReference = true;
                continue;
            }

            if (!insideReferences) continue;

            block.isReference = true;
            block.contentType = "reference";

            // If another major top-level heading appears (like Appendix), exit reference section
            if (block.isHeading && !REFERENCE_HEADING.test(text) && /^(?:appendix|author\s*contributions|acknowledg)/i.test(text)) {
                insideReferences = false;
                continue;
            }

            // Split into individual citations
            // Matches: [1] Author..., 1. Author..., [Smith2020]...
            const entryStart = /^(\[\d+\]|\d+\.|\([0-9]+\))\s*(.*)/.exec(text);

            if (entryStart) {
                if (currentEntry) references.push(currentEntry);
                const key = entryStart[1].replace(/[.[\]()]/g, "").trim();
                currentEntry = {
                    key: `[${key}]`,
                    number: key,
                    pageNumber: page.pageNumber,
                    raw: entryStart[2] || "",
                };
            } else if (currentEntry) {
                currentEntry.raw += ` ${text}`;
            }
        }
    }

    if (currentEntry) references.push(currentEntry);

    // Extract authors, year, title, doi from raw text
    for (const ref of references) {
        ref.raw = normalizeText(ref.raw);
        const yearMatch = ref.raw.match(/\b(19\d{2}|20\d{2})\b/);
        ref.year = yearMatch ? Number(yearMatch[1]) : null;

        const doiMatch = ref.raw.match(/doi:?\s*([^\s;,]+)/i);
        ref.doi = doiMatch ? doiMatch[1] : null;

        // Try extracting authors (before first period or year)
        const parts = ref.raw.split(/\.\s+|\.\s*\(/);
        if (parts.length >= 2) {
            ref.authors = parts[0].trim();
            ref.title = parts[1].replace(/\.\s*$/, "").trim();
        } else {
            ref.authors = null;
            ref.title = ref.raw;
        }
    }

    return references;
}

function buildPageLayout(items, viewport, pageNumber) {
    const pageWidth = Number(viewport?.width) || 0;
    const pageHeight = Number(viewport?.height) || 0;

    const allRows = groupItemsByY(items);

    // Filter out top running headers and bottom footers
    const headers = [];
    const footers = [];
    const bodyRows = [];

    for (const row of allRows) {
        if (isHeaderOrFooterRow(row, pageHeight)) {
            if (row.baseline < pageHeight * 0.10) {
                headers.push(row.text);
            } else {
                footers.push(row.text);
            }
        } else {
            bodyRows.push(row);
        }
    }

    const gutter = findColumnGutter(bodyRows, pageWidth);
    const rawBlocks = orderPageRows(bodyRows, gutter, pageNumber, pageWidth);
    const pageMedianFont = median(rawBlocks.map(block => block.fontSize));

    for (const block of rawBlocks) {
        classifyBlock(block, pageMedianFont);
    }

    const blocks = mergeParagraphLines(rawBlocks);

    blocks.forEach((block, index) => {
        block.readingOrder = index;
    });

    const pageObj = {
        pageNumber,
        width: pageWidth,
        height: pageHeight,
        layout: gutter === null ? "single-column" : "two-column",
        blocks,
        headers,
        footers,
        tables: [],
        figures: [],
        text: blocks.map(block => block.text).join("\n"),
        diagnostics: {
            rowCount: bodyRows.length,
            blockCount: blocks.length,
            gutterDetected: gutter !== null,
            gutterX: gutter,
            headerCount: headers.length,
            footerCount: footers.length,
        },
    };

    // Extract structured tables & figures
    pageObj.tables = extractTablesFromPage(pageObj, bodyRows);
    pageObj.figures = extractFiguresFromPage(pageObj);

    return pageObj;
}

function cleanMetadataValue(value) {
    if (typeof value !== "string") return null;
    const result = normalizeText(value);
    if (!result || /^(?:untitled|unknown|document|anonymous|none)$/i.test(result)) {
        return null;
    }
    return result;
}

function isAffiliation(text) {
    return (
        /\b(?:university|faculty|department|institute|school|laboratory|college|academy|research centre|research center|collaborative|engineering|ministry)\b/i.test(text) ||
        /@|https?:\/\/|orcid\.org|\b(?:china|usa|uk|germany|france|india|japan|spain)\b/i.test(text)
    );
}

function isAuthorCandidate(text) {
    if (text.length < 4 || text.length > 200 || isAffiliation(text)) return false;
    if (/^(?:abstract|keywords?|index terms|introduction|background|context|aim|method|results|conclusion)\b/i.test(text)) return false;
    if (/\b(?:received|accepted|published|copyright|open access|edited by|reviewed by)\b/i.test(text)) return false;
    if (/[.!?]$/.test(text)) return false;

    const words = text.split(/\s+/);
    if (words.length < 2 || words.length > 20) return false;
    if (/\b(?:software testing|this paper|this study|the results|we propose|we present)\b/i.test(text)) return false;

    return /[A-ZÀ-Ý]/.test(text);
}

function inferTitle(pages, metadataTitle) {
    const metadata = cleanMetadataValue(metadataTitle);
    if (metadata && metadata.length >= 8 && !/^(?:microsoft|untitled|latex)/i.test(metadata)) {
        return metadata.slice(0, MAX_TITLE_LENGTH);
    }

    const firstPageBlocks = (pages[0]?.blocks || []).filter(b => b.contentType !== "sidebar");
    const candidates = firstPageBlocks.filter(block => {
        const text = block.text;
        return (
            text.length >= 8 &&
            text.length <= MAX_TITLE_LENGTH &&
            block.contentType !== "caption" &&
            block.contentType !== "table" &&
            block.contentType !== "figure" &&
            !isAffiliation(text) &&
            !isAuthorCandidate(text) &&
            !/^(?:arxiv|doi|received|accepted|published|open access)\b/i.test(text) &&
            !/^(?:abstract|keywords?|index terms)\b/i.test(text)
        );
    });

    if (!candidates.length) return null;

    const medianFont = median(candidates.map(block => block.fontSize)) || 1;

    candidates.sort((a, b) => {
        const scoreA = (a.fontSize / medianFont) * 1.5 + (a.boldRatio * 0.8) - (a.y * 0.002);
        const scoreB = (b.fontSize / medianFont) * 1.5 + (b.boldRatio * 0.8) - (b.y * 0.002);
        return scoreB - scoreA;
    });

    return candidates[0].text;
}

function inferAuthors(pages, metadataAuthor, title) {
    const metadata = cleanMetadataValue(metadataAuthor);
    if (metadata && metadata.length < 300 && !/^(?:author|admin|user|anonymous)$/i.test(metadata)) {
        return metadata;
    }

    const firstPageBlocks = (pages[0]?.blocks || []).filter(b => b.contentType !== "sidebar");
    const titleTokens = new Set(
        normalizeText(title || "").toLowerCase().split(/\s+/).filter(Boolean)
    );

    const candidates = firstPageBlocks.filter(block => {
        if (!isAuthorCandidate(block.text)) return false;
        const words = block.text.toLowerCase().split(/\s+/);
        const overlap = words.filter(word => titleTokens.has(word)).length;
        return overlap < Math.max(2, words.length * 0.5);
    });

    const authorLine = candidates.find(block => {
        const text = block.text;
        return (
            /\b(?:Dr\.?|Prof\.?|Ph\.?D\.?)\b/i.test(text) ||
            /\b[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+\b/.test(text) ||
            /,\s*[A-Z][a-z]+/.test(text) ||
            /\band\s+[A-Z][a-z]+/i.test(text)
        );
    });

    return authorLine?.text || null;
}

function extractYear(info, pages) {
    const metadataDate = String(info?.CreationDate || "");
    const metadataMatch = metadataDate.match(/(?:D:)?((?:19|20)\d{2})/);

    const firstPage = (pages[0]?.text || "").slice(0, 5000);
    const explicit = firstPage.match(/\b(?:published|accepted|received|copyright|©)\D{0,30}((?:19|20)\d{2})\b/i);

    if (explicit) return Number(explicit[1]);

    const anyYear = firstPage.match(/\b(19\d{2}|20\d{2})\b/);
    return anyYear ? Number(anyYear[1]) : (metadataMatch ? Number(metadataMatch[1]) : null);
}

function inferAbstract(pages) {
    const blocks = (pages[0]?.blocks || []).filter(b => b.contentType !== "sidebar");
    const start = blocks.findIndex(block => ABSTRACT_START.test(block.text));

    if (start < 0) {
        // Fallback 1: check if page has a KEYWORDS block
        const kwIndex = blocks.findIndex(b => /^keywords?\b|^index terms\b/i.test(b.text));
        if (kwIndex > 0) {
            // Find start of body text (skip title, authors, affiliations)
            const bodyCandidates = [];
            for (let i = 0; i < kwIndex; i++) {
                const b = blocks[i];
                if (b.contentType === "sidebar" || b.isHeading) continue;
                if (isAffiliation(b.text) || isAuthorCandidate(b.text)) continue;
                if (b.text.length > 50) {
                    bodyCandidates.push(b.text);
                }
            }
            if (bodyCandidates.length) {
                const combined = normalizeText(bodyCandidates.join(" "));
                if (combined.length >= 60) {
                    return combined.slice(0, MAX_ABSTRACT_LENGTH);
                }
            }
        }

        // Fallback 2: check page 1 text for abstract block
        const p1Text = pages[0]?.text || "";
        const m = p1Text.match(/(?:abstract|summary)\s*[:.]?\s*([\s\S]+?)(?=(?:keywords?|index terms|1[.)]?\s+introduction|introduction)\b)/i);
        if (m && m[1].length >= 40) {
            return normalizeText(m[1]).slice(0, MAX_ABSTRACT_LENGTH);
        }
        return null;
    }

    const abstractParts = [];

    for (let i = start; i < blocks.length; i++) {
        const block = blocks[i];
        let text = block.text;

        if (i > start && (block.isHeading || block.contentType === "heading") && ABSTRACT_END.test(text)) {
            break;
        }

        if (i === start) {
            text = text.replace(ABSTRACT_START, "");
        }

        if (text) abstractParts.push(text);

        if (i > start && (/^keywords?\s*[:.]?/i.test(block.text) || /^index terms\s*[:.]?/i.test(block.text))) {
            abstractParts.pop();
            break;
        }
    }

    const result = normalizeText(abstractParts.join(" "));
    return result.length >= 40 ? result.slice(0, MAX_ABSTRACT_LENGTH) : null;
}

function assignSections(pages) {
    const sectionStack = [];

    for (const page of pages) {
        for (const block of page.blocks) {
            if (block.isHeading) {
                const level = Math.max(1, block.headingLevel || 1);
                sectionStack.length = level - 1;
                sectionStack[level - 1] = block.headingTitle || block.text;
            }

            block.sectionPath = sectionStack.filter(Boolean);
            block.sectionTitle = block.sectionPath.length ? block.sectionPath.at(-1) : null;
            block.sectionLevel = block.sectionPath.length || null;
        }
    }
}

export async function extractPdfPages(filePath) {
    if (typeof filePath !== "string" || !filePath.trim()) {
        throw new Error("A valid PDF file path is required.");
    }

    const fileBuffer = await fs.readFile(filePath);

    const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(fileBuffer),
        useSystemFonts: true,
        isEvalSupported: false,
    });

    const pdf = await loadingTask.promise;

    try {
        const pages = [];

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber);

            try {
                const viewport = page.getViewport({ scale: 1 });
                const textContent = await page.getTextContent({ includeMarkedContent: false });

                const items = textContent.items
                    .filter(item => typeof item.str === "string" && item.str.trim())
                    .map(item => getTextItem(item, viewport))
                    .filter(item => item.text);

                const result = buildPageLayout(items, viewport, pageNumber);
                pages.push(result);
            } finally {
                page.cleanup();
            }
        }

        assignSections(pages);
        const references = parseReferences(pages);

        const metadataResult = await pdf.getMetadata();
        const info = metadataResult?.info || {};

        const title = inferTitle(pages, info.Title);
        const authors = inferAuthors(pages, info.Author, title);
        const year = extractYear(info, pages);
        const abstract = inferAbstract(pages);

        return {
            pageCount: pdf.numPages,
            pages,
            references,
            metadata: {
                title,
                authors,
                year,
                abstract,
                references,
            },
        };
    } finally {
        if (typeof loadingTask.destroy === "function") {
            await loadingTask.destroy();
        }
    }
}

export function buildRagChunks(extracted, maxChars = 1800) {
    const chunks = [];
    let chunkId = 0;

    for (const page of extracted.pages) {
        for (const block of page.blocks) {
            if (!block.text?.trim() || block.contentType === "heading" || block.contentType === "sidebar") {
                continue;
            }

            const section = block.sectionTitle || "Preamble";
            const embeddingText = [
                `Paper: ${extracted.metadata.title ?? "Unknown"}`,
                `Authors: ${extracted.metadata.authors ?? "Unknown"}`,
                `Year: ${extracted.metadata.year ?? "Unknown"}`,
                `Section: ${section}`,
                "",
                block.text,
            ].join("\n");

            for (let i = 0; i < embeddingText.length; i += maxChars) {
                chunks.push({
                    id: `chunk_${chunkId++}`,
                    paperTitle: extracted.metadata.title,
                    authors: extracted.metadata.authors,
                    year: extracted.metadata.year,
                    section,
                    pageStart: block.pageNumber,
                    pageEnd: block.pageEnd ?? block.pageNumber,
                    contentType: block.contentType || "body",
                    isReference: Boolean(block.isReference),
                    text: embeddingText.slice(i, i + maxChars),
                });
            }
        }
    }

    return chunks;
}