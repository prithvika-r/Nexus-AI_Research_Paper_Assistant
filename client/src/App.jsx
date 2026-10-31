import { useState, useEffect, useRef, createContext, useContext } from "react";
import * as d3 from "d3";
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/clerk-react";
import { apiFetch, apiUrl } from "./api";
import Tag from "./components/common/Tag";

// ---- Theme System ----
const THEMES = {
  Dark: {
    bg: "#0a0d14", surface: "#111520", card: "#151a28",
    border: "#1e2535", accent: "#4f6ef7", accent2: "#7c3aed",
    muted: "#3a4560", text: "#e2e8f0", textDim: "#6b7fa3",
    glass: "rgba(21,26,40,0.7)",
  },
  Darker: {
    bg: "#050508", surface: "#0a0a0f", card: "#0f0f18",
    border: "#16162a", accent: "#4f6ef7", accent2: "#7c3aed",
    muted: "#1a1a2e", text: "#e2e8f0", textDim: "#5566aa",
    glass: "rgba(10,10,15,0.8)",
  },
  Midnight: {
    bg: "#000510", surface: "#000d1a", card: "#001022",
    border: "#001f3f", accent: "#00aaff", accent2: "#0055ff",
    muted: "#002244", text: "#cce7ff", textDim: "#5599bb",
    glass: "rgba(0,10,30,0.8)",
  },
  Light: {
    bg: "#f0f4ff", surface: "#ffffff", card: "#f8faff",
    border: "#dde3f5", accent: "#4f6ef7", accent2: "#7c3aed",
    muted: "#e0e5f5", text: "#1a1f36", textDim: "#6b7fa3",
    glass: "rgba(255,255,255,0.85)",
  },
};

const ThemeCtx = createContext(THEMES.Dark);
const useTheme = () => useContext(ThemeCtx);

const NAV = [
  { id: "graph", icon: "✦", label: "Knowledge Graph" },
  { id: "library", icon: "▦", label: "Library" },
  { id: "search", icon: "⌕", label: "Search Papers" },
  { id: "similarity", icon: "🔗", label: "Similar Papers" },
  { id: "recommendations", icon: "🎯", label: "Recommendations" },
  { id: "debate", icon: "⚖", label: "AI Debate" },
  { id: "gaps", icon: "◉", label: "Research Gaps" },
  { id: "slides", icon: "▣", label: "Presentations" },
];

// ---- Reusable Components ----
function StatCard({ label, value, color }) {
  const C = useTheme();
  return (
    <div style={{ background: C.glass, backdropFilter: "blur(12px)", border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px", flex: 1, minWidth: 140 }}>
      <div style={{ color: C.textDim, fontSize: 12, marginBottom: 6 }}>{label}</div>
      <div style={{ color: color || C.accent, fontSize: 28, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function PaperCard({ title, authors, year, tags, cited, abstract, paper, onSave, onView, isSaved, onOpenPdf, onDownload }) {
  const C = useTheme();
  const [hovered, setHov] = useState(false);
  const [saved, setSaved] = useState(isSaved || false);

  useEffect(() => {
    if (isSaved != null) setSaved(isSaved);
  }, [isSaved]);

  const pObj = paper || { title, authors, year, abstract, cited, tags };
  const cardTitle = pObj.title || title;
  const cardAuthors = Array.isArray(pObj.authors)
    ? pObj.authors.map(a => (typeof a === "object" ? a.name : a)).join(", ")
    : pObj.authors || authors || "Unknown authors";
  const cardYear = pObj.year || year;
  const cardCited = pObj.citationCount ?? pObj.cited ?? cited ?? 0;
  const cardAbstract = pObj.abstract || abstract;

  const pdfUrl =
    pObj.pdf_url ||
    pObj.openAccessPdf?.url ||
    (typeof pObj.openAccessPdf === "string" ? pObj.openAccessPdf : null) ||
    (pObj.file_path && /^https?:\/\//i.test(pObj.file_path) ? pObj.file_path : null);

  const hasOpenAccess = Boolean(pdfUrl || pObj.file_path || pObj.isOpenAccess || pObj.has_full_pdf);

  const handleSave = async (e) => {
    e.stopPropagation();
    if (saved) return;
    try {
      if (onSave) {
        await onSave(pObj);
      } else {
        await apiFetch("/api/papers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: cardTitle,
            authors: cardAuthors,
            year: cardYear,
            abstract: cardAbstract,
            source: "search",
            file_path: pdfUrl || pObj.url || null,
            pdf_url: pdfUrl || null,
            openAccessPdf: pObj.openAccessPdf || null,
            externalIds: pObj.externalIds || null,
            notes: pObj.venue || (cardCited ? `${cardCited} citations` : null),
          }),
        });
      }
      setSaved(true);
    } catch (e) {
      console.error("Save paper error:", e);
    }
  };

  const handleDownloadClick = (e) => {
    e.stopPropagation();
    if (onDownload) {
      onDownload(pObj);
      return;
    }
    const dlUrl = pObj.id
      ? apiUrl(`/api/papers/${pObj.id}/download`)
      : apiUrl(`/api/papers/proxy-download?url=${encodeURIComponent(pdfUrl || pObj.url)}&title=${encodeURIComponent(cardTitle)}`);
    window.open(dlUrl, "_blank");
  };

  return (
    <div
      onClick={() => onView && onView(pObj)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: C.glass,
        backdropFilter: "blur(12px)",
        border: `1px solid ${hovered ? C.accent + "77" : C.border}`,
        borderRadius: 12,
        padding: "18px 20px",
        transition: "all 0.2s",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        boxShadow: hovered
          ? `0 0 0 1px ${C.accent}55, 0 8px 32px rgba(79,110,247,0.14)`
          : "none",
        transform: hovered ? "translateY(-2px)" : "none",
      }}
    >
      <div>
        <div style={{ color: C.text, fontWeight: 600, fontSize: 14, marginBottom: 6, lineHeight: 1.4 }}>
          {cardTitle}
        </div>
        <div style={{ color: C.textDim, fontSize: 12, marginBottom: 10 }}>
          {cardAuthors} {cardYear ? `· ${cardYear}` : ""}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <Tag label="Research" color={C.accent} />
          {hasOpenAccess && <Tag label="📄 Full PDF Available" color="#10b981" />}
          {pObj.venue && <Tag label={pObj.venue} color={C.accent2} />}
        </div>
        {cardAbstract && (
          <div
            style={{
              color: C.textDim,
              fontSize: 12,
              lineHeight: 1.5,
              marginBottom: 12,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {cardAbstract}
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTop: `1px solid ${C.border}44`, gap: 6, flexWrap: "wrap" }}>
        <div style={{ color: C.textDim, fontSize: 11 }}>📎 {cardCited} citations</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {hasOpenAccess && onOpenPdf && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenPdf(pObj);
              }}
              title="Open full paper in built-in PDF Reader"
              style={{
                padding: "4px 9px",
                borderRadius: 20,
                fontSize: 11,
                background: "rgba(16,185,129,0.15)",
                border: "1px solid rgba(16,185,129,0.4)",
                color: "#10b981",
                cursor: "pointer",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              📄 Read PDF
            </button>
          )}

          {hasOpenAccess && (
            <button
              onClick={handleDownloadClick}
              title="Download PDF to device"
              style={{
                padding: "4px 9px",
                borderRadius: 20,
                fontSize: 11,
                background: `${C.accent2}18`,
                border: `1px solid ${C.accent2}44`,
                color: C.accent2,
                cursor: "pointer",
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              ⬇ PDF
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onView && onView(pObj);
            }}
            style={{
              padding: "4px 10px",
              borderRadius: 20,
              fontSize: 11,
              background: `${C.accent}15`,
              border: `1px solid ${C.accent}44`,
              color: C.accent,
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            👁 Details
          </button>

          <button
            onClick={handleSave}
            style={{
              padding: "4px 10px",
              borderRadius: 20,
              fontSize: 11,
              background: saved ? "rgba(5,150,105,0.2)" : `${C.accent}20`,
              border: `1px solid ${saved ? "#059669" : C.accent}`,
              color: saved ? "#059669" : C.accent,
              cursor: saved ? "default" : "pointer",
              fontWeight: 500,
            }}
          >
            {saved ? "✓ Saved" : "+ Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InteractiveMessageText({ text, activeCitationId, onCitationClick }) {
  const C = useTheme();
  if (!text) return null;

  // Regex to match [C1], [C2], etc. or bracketed numeric citations like [1]
  const pattern = /\[(C[1-9]\d*|[1-9]\d?)\]/g;
  const elements = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push(text.slice(lastIndex, match.index));
    }

    const rawTag = match[1];
    const citationId = rawTag.startsWith("C") ? rawTag : `C${rawTag}`;
    const isTagActive = activeCitationId === citationId;

    elements.push(
      <button
        key={`cite-${match.index}-${citationId}`}
        type="button"
        onClick={() => onCitationClick(citationId)}
        title={`Click to inspect supporting evidence [${citationId}]`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1px 6px",
          margin: "0 2px",
          borderRadius: 4,
          background: isTagActive ? C.accent : `${C.accent}24`,
          color: isTagActive ? "#ffffff" : C.accent,
          border: `1px solid ${isTagActive ? C.accent : C.accent + "66"}`,
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          verticalAlign: "baseline",
          transition: "all 0.15s ease",
          boxShadow: isTagActive ? `0 0 10px ${C.accent}88` : "none",
        }}
      >
        {citationId}
      </button>
    );

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }

  return (
    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
      {elements}
    </div>
  );
}

function CitationCard({ citation, index, isActive = false, onSelect }) {
  const C = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [showFullChunk, setShowFullChunk] = useState(false);

  const citationLabel = citation.citationId || citation.id || `C${index !== undefined ? index : 1}`;
  const pageLabel = citation.pageNumber ? `Page ${citation.pageNumber}` : "Page unavailable";
  const paperTitle = citation.paperTitle || citation.title || "";
  const sectionTitle = citation.sectionTitle || "";
  const score = Number.isFinite(Number(citation.retrievalScore))
    ? Number(citation.retrievalScore).toFixed(2)
    : null;
  const contentType = citation.contentType || citation.content_type || "body";
  const snippet = citation.preview || citation.snippet || "";
  const fullContent = citation.content || snippet;
  const hasMoreContent = Boolean(fullContent && snippet && fullContent.length > snippet.length + 20);

  useEffect(() => {
    if (isActive) {
      setExpanded(true);
    }
  }, [isActive]);

  return (
    <div
      id={`citation-card-${citationLabel}`}
      style={{
        border: isActive ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
        borderRadius: 10,
        background: isActive ? `${C.accent}0a` : C.card,
        boxShadow: isActive ? `0 0 16px ${C.accent}44` : "none",
        overflow: "hidden",
        transition: "all 0.2s ease",
      }}
    >
      <button
        onClick={() => {
          setExpanded(v => !v);
          if (onSelect) onSelect(citationLabel);
        }}
        style={{
          width: "100%",
          border: "none",
          background: "transparent",
          color: C.text,
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3, flexWrap: "wrap" }}>
            <span style={{
              color: isActive ? "#fff" : C.accent,
              background: isActive ? C.accent : `${C.accent}20`,
              padding: "1px 6px",
              borderRadius: 4,
              fontWeight: 800,
              fontSize: 11
            }}>
              [{citationLabel}]
            </span>
            <span style={{ color: C.textDim, fontSize: 11 }}>{pageLabel}</span>
            {contentType !== "body" && (
              <span style={{
                fontSize: 10,
                textTransform: "uppercase",
                padding: "1px 6px",
                borderRadius: 4,
                background: contentType === "table" ? "rgba(16,185,129,0.15)" : contentType === "figure" ? "rgba(59,130,246,0.15)" : "rgba(245,158,11,0.15)",
                color: contentType === "table" ? "#10b981" : contentType === "figure" ? "#3b82f6" : "#f59e0b",
                fontWeight: 600,
              }}>
                {contentType}
              </span>
            )}
          </div>
          {paperTitle && (
            <div style={{ fontSize: 11, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {paperTitle}
            </div>
          )}
          {sectionTitle && (
            <div style={{ fontSize: 10, color: C.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
              § {sectionTitle}
            </div>
          )}
          {!expanded && snippet && (
            <div style={{
              fontSize: 11,
              color: C.textDim,
              marginTop: 5,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontStyle: "italic",
            }}>
              &ldquo;{snippet.slice(0, 160)}...&rdquo;
            </div>
          )}
        </div>
        <span style={{ color: C.textDim, fontSize: 12, paddingLeft: 4 }}>{expanded ? "⌃" : "⌄"}</span>
      </button>

      {expanded && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 12px", background: C.card }}>
          <div style={{
            color: C.text,
            fontSize: 11,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            background: C.muted,
            padding: "8px 10px",
            borderRadius: 6,
            border: `1px solid ${C.border}`,
            borderLeft: `3px solid ${C.accent}`,
          }}>
            {showFullChunk ? fullContent : (snippet || fullContent || "No evidence preview available.")}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 9, alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {score && <Tag label={`retrieval ${score}`} color={C.accent2} />}
              {citation.isReference && <Tag label="reference section" color="#d97706" />}
              {citation.pageNumber && <Tag label={`p. ${citation.pageNumber}`} color={C.accent} />}
              <span style={{ color: C.textDim, fontSize: 10 }}>
                {showFullChunk ? `${fullContent.length} chars (full chunk)` : `${(snippet || fullContent).length} chars snippet`}
              </span>
            </div>

            {hasMoreContent && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowFullChunk(v => !v);
                }}
                style={{
                  background: showFullChunk ? `${C.accent}20` : "transparent",
                  border: `1px solid ${C.accent}66`,
                  borderRadius: 4,
                  color: C.accent,
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "2px 8px",
                  cursor: "pointer"
                }}
              >
                {showFullChunk ? "Show Focused Snippet" : "Inspect Full Chunk"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ChatPanel({ paper, papers = [], isLibrary = false, onClose }) {
  const C = useTheme();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeCitationId, setActiveCitationId] = useState(null);
  const bottomRef = useRef(null);

  const activePapers = Array.isArray(papers) && papers.length > 0 ? papers : (paper ? [paper] : []);
  const isMulti = activePapers.length > 1;

  const handleCitationClick = (citationId) => {
    setActiveCitationId(citationId);
    const element = document.getElementById(`citation-card-${citationId}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async () => {
    const question = input.trim();
    if (!question || loading) return;

    setInput("");
    setError("");
    setMessages(m => [...m, { role: "user", text: question }]);
    setLoading(true);

    try {
      let body;
      const endpoint = "/api/chat";

      if (isMulti) {
        body = { paperIds: activePapers.map(p => p.id), question, compare: true };
      } else if (isLibrary) {
        body = { library: true, question };
      } else {
        body = { paperId: activePapers[0]?.id, question };
      }

      const res = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `Request failed with status ${res.status}`);
      }

      setMessages(m => [...m, {
        role: "ai",
        text: data.answer || "No answer was returned.",
        citations: data.citations || [],
        retrieval: data.retrieval || null,
        model: data.model || null,
      }]);
    } catch (e) {
      setError(e.message || "Error contacting server.");
      setMessages(m => [...m, {
        role: "ai",
        text: "I couldn't answer that question from the paper evidence.",
        citations: [],
        retrieval: null,
      }]);
    } finally {
      setLoading(false);
    }
  };

  const headerTitle = isMulti
    ? `Cross-Paper Comparison (${activePapers.length} papers)`
    : isLibrary
    ? "Library-Wide Research"
    : "Research Chat";

  const headerSubtitle = isMulti
    ? activePapers.map(p => p.title).join(" vs ")
    : isLibrary
    ? "Searching across all indexed library papers"
    : (activePapers[0]?.title || "Selected paper");

  return (
    <div style={{
      position: "fixed", right: 0, top: 0, bottom: 0, width: 480,
      maxWidth: "100vw", background: C.surface, borderLeft: `1px solid ${C.border}`,
      display: "flex", flexDirection: "column", zIndex: 200,
      boxShadow: "-20px 0 50px rgba(0,0,0,0.18)",
    }}>
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ minWidth: 0, flex: 1, paddingRight: 10 }}>
          <div style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>{headerTitle}</div>
          <div style={{ color: C.textDim, fontSize: 11, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {headerSubtitle}
          </div>
          <div style={{ color: C.accent, fontSize: 10, marginTop: 4 }}>
            {isMulti ? "Multi-paper hybrid vector & evidence retrieval" : "Evidence-grounded RAG"}
          </div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.textDim, fontSize: 20, cursor: "pointer" }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {messages.length === 0 && (
          <div style={{ color: C.textDim, fontSize: 13, textAlign: "center", marginTop: 40, lineHeight: 1.6 }}>
            {isMulti
              ? "Ask a question to compare findings, methodologies, or metrics across the selected papers."
              : isLibrary
              ? "Ask any question across your entire research paper library."
              : "Ask a question about this paper.\nAnswers are generated from retrieved paper chunks with exact page citations."}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "stretch", maxWidth: m.role === "user" ? "85%" : "100%" }}>
            <div style={{
              padding: "10px 14px", borderRadius: 10, fontSize: 13, lineHeight: 1.6,
              background: m.role === "user" ? `${C.accent}20` : C.card,
              color: C.text,
              border: `1px solid ${m.role === "user" ? C.accent + "44" : C.border}`,
            }}>
              {m.role === "user" ? (
                <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
              ) : (
                <InteractiveMessageText
                  text={m.text}
                  activeCitationId={activeCitationId}
                  onCitationClick={handleCitationClick}
                />
              )}
            </div>

            {m.role === "ai" && m.citations?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{
                  color: C.textDim, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8,
                  display: "flex", justifyContent: "space-between", alignItems: "center"
                }}>
                  <span>Verified Evidence · {m.citations.length} cited source{m.citations.length === 1 ? "" : "s"}</span>
                  {activeCitationId && (
                    <button
                      type="button"
                      onClick={() => setActiveCitationId(null)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: C.accent,
                        fontSize: 10,
                        cursor: "pointer",
                        fontWeight: 600
                      }}
                    >
                      Clear active [{activeCitationId}]
                    </button>
                  )}
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {m.citations.map((citation, idx) => {
                    const cId = citation.citationId || (Number.isInteger(idx) ? `C${idx + 1}` : "C1");
                    return (
                      <CitationCard
                        key={`${citation.chunkId || idx}-${idx}`}
                        citation={citation}
                        index={idx + 1}
                        isActive={activeCitationId === cId}
                        onSelect={handleCitationClick}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}

        {loading && <div style={{ color: C.textDim, fontSize: 12 }}>Retrieving vector evidence and synthesizing answer…</div>}
        {error && <div style={{ color: "#e11d48", fontSize: 11 }}>{error}</div>}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: 16, borderTop: `1px solid ${C.border}`, display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder={isMulti ? "Ask to compare or contrast the papers…" : "Ask a question about the paper…"}
          disabled={loading}
          style={{ flex: 1, padding: "10px 14px", borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, color: C.text, fontSize: 13, outline: "none" }}
        />
        <button onClick={send} disabled={loading || !input.trim()} style={{
          padding: "10px 16px", borderRadius: 8,
          background: loading || !input.trim() ? C.muted : `linear-gradient(90deg, ${C.accent}, ${C.accent2})`,
          border: "none", color: "#fff", fontWeight: 600, cursor: loading || !input.trim() ? "not-allowed" : "pointer",
        }}>→</button>
      </div>
    </div>
  );
}

// ---- Modals ----
function PdfViewerModal({ paper, onClose }) {
  const C = useTheme();
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    if (!paper) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [paper, onClose]);

  if (!paper) return null;

  const pdfUrl =
    paper.pdf_url ||
    paper.openAccessPdf?.url ||
    (typeof paper.openAccessPdf === "string" ? paper.openAccessPdf : null) ||
    (paper.file_path && /^https?:\/\//i.test(paper.file_path) ? paper.file_path : null);

  const iframeSrc = paper.id
    ? apiUrl(`/api/papers/${paper.id}/pdf#toolbar=1&navpanes=0&zoom=${zoom}`)
    : apiUrl(`/api/papers/proxy-pdf?url=${encodeURIComponent(pdfUrl || paper.url)}&title=${encodeURIComponent(paper.title || "paper")}#toolbar=1&navpanes=0&zoom=${zoom}`);

  const downloadUrl = paper.id
    ? apiUrl(`/api/papers/${paper.id}/download`)
    : apiUrl(`/api/papers/proxy-download?url=${encodeURIComponent(pdfUrl || paper.url)}&title=${encodeURIComponent(paper.title || "paper")}`);

  const btnStyle = (disabled = false) => ({
    padding: "7px 12px",
    borderRadius: 8,
    background: C.surface,
    border: `1px solid ${C.border}`,
    color: disabled ? C.textDim : C.text,
    fontSize: 12,
    fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
  });

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.85)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 1400,
          height: "95vh",
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
        }}
      >
        {/* Toolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 18px",
            background: C.card,
            borderBottom: `1px solid ${C.border}`,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                color: C.text,
                fontSize: 14,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              📄 {paper.title}
            </div>
            <div style={{ color: C.textDim, fontSize: 11, marginTop: 2 }}>
              {paper.id ? "Library Paper" : "Search Discovery"} · PDF Document Reader
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setZoom((z) => Math.max(50, z - 25))} disabled={zoom <= 50} style={btnStyle(zoom <= 50)}>
              −
            </button>
            <span style={{ color: C.text, fontSize: 12, minWidth: 42, textAlign: "center" }}>
              {zoom}%
            </span>
            <button onClick={() => setZoom((z) => Math.min(200, z + 25))} disabled={zoom >= 200} style={btnStyle(zoom >= 200)}>
              +
            </button>
            <button onClick={() => setZoom(100)} style={btnStyle(false)}>
              Reset
            </button>

            <button
              onClick={() => window.open(downloadUrl, "_blank")}
              style={{
                ...btnStyle(false),
                background: "rgba(16,185,129,0.18)",
                color: "#10b981",
                borderColor: "rgba(16,185,129,0.4)",
                fontWeight: 600,
              }}
            >
              ⬇ Download PDF
            </button>

            <button
              onClick={() => window.open(iframeSrc.split("#")[0], "_blank", "noopener,noreferrer")}
              style={btnStyle(false)}
            >
              ↗ Open in Tab
            </button>

            <button
              onClick={onClose}
              style={{
                ...btnStyle(false),
                background: "rgba(225,29,72,0.15)",
                color: "#fb7185",
                borderColor: "#e11d4844",
              }}
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* PDF iframe */}
        <iframe
          key={`${paper.id || paper.title}-${zoom}`}
          title={`PDF: ${paper.title}`}
          src={iframeSrc}
          style={{
            flex: 1,
            width: "100%",
            border: "none",
            background: "#1e1e1e",
          }}
        />
      </div>
    </div>
  );
}

function PaperDetailModal({
  paper,
  onClose,
  onSave,
  isSaved,
  onOpenPdf,
  onToggleRead,
  onChat,
  onPaperUpdated,
}) {
  const C = useTheme();
  const [saved, setSaved] = useState(isSaved || false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("overview"); // "overview" | "fulltext" | "pdf"
  const [currentPaper, setCurrentPaper] = useState(paper);
  const [fullText, setFullText] = useState(paper.full_text || null);
  const [fetchingFull, setFetchingFull] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [textSearch, setTextSearch] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCurrentPaper(paper);
    setFullText(paper.full_text || null);
    if (isSaved != null) setSaved(isSaved);
  }, [paper, isSaved]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!currentPaper) return null;

  const authors = Array.isArray(currentPaper.authors)
    ? currentPaper.authors.map((a) => (typeof a === "object" ? a.name : a)).join(", ")
    : currentPaper.authors || "Unknown authors";

  const pdfUrl =
    currentPaper.pdf_url ||
    currentPaper.openAccessPdf?.url ||
    (typeof currentPaper.openAccessPdf === "string" ? currentPaper.openAccessPdf : null) ||
    (currentPaper.file_path && /^https?:\/\//i.test(currentPaper.file_path) ? currentPaper.file_path : null);

  const hasAnyPdf = Boolean(
    pdfUrl ||
    currentPaper.file_path ||
    currentPaper.isOpenAccess ||
    currentPaper.has_full_pdf
  );

  const isSearchPaper = currentPaper.source === "search" || !currentPaper.id;

  const handleSaveClick = async () => {
    if (saved || saving) return;
    setSaving(true);
    try {
      if (onSave) {
        await onSave(currentPaper);
      } else {
        const res = await apiFetch("/api/papers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: currentPaper.title,
            authors: Array.isArray(currentPaper.authors)
              ? currentPaper.authors.map((a) => (typeof a === "object" ? a.name : a))
              : currentPaper.authors,
            year: currentPaper.year,
            abstract: currentPaper.abstract,
            source: "search",
            file_path: pdfUrl || currentPaper.url || null,
            pdf_url: pdfUrl || null,
            openAccessPdf: currentPaper.openAccessPdf || null,
            externalIds: currentPaper.externalIds || null,
            notes:
              currentPaper.venue ||
              (currentPaper.citationCount
                ? `${currentPaper.citationCount} citations`
                : null),
          }),
        });
        const savedData = await res.json();
        if (savedData?.id) {
          setCurrentPaper(savedData);
        }
      }
      setSaved(true);
    } catch (e) {
      console.error("Save paper error:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadClick = () => {
    const dlUrl = currentPaper.id
      ? apiUrl(`/api/papers/${currentPaper.id}/download`)
      : apiUrl(`/api/papers/proxy-download?url=${encodeURIComponent(pdfUrl || currentPaper.url)}&title=${encodeURIComponent(currentPaper.title)}`);
    window.open(dlUrl, "_blank");
  };

  const handleFetchFullPaper = async () => {
    setFetchingFull(true);
    setFetchError("");
    try {
      if (currentPaper.id) {
        // Saved paper: fetch full content & index
        const res = await apiFetch(`/api/papers/${currentPaper.id}/fetch-full`, {
          method: "POST",
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (data.paper) {
          setCurrentPaper(data.paper);
          setFullText(data.paper.full_text);
          if (onPaperUpdated) onPaperUpdated(data.paper);
        }
      } else {
        // Search paper: fetch text directly
        const res = await apiFetch("/api/papers/fetch-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: pdfUrl || currentPaper.url,
            title: currentPaper.title,
            authors: currentPaper.authors,
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setFullText(data.full_text);
      }
      setActiveTab("fulltext");
    } catch (err) {
      console.error("Fetch full paper error:", err);
      setFetchError(err.message || "Could not retrieve full paper.");
    } finally {
      setFetchingFull(false);
    }
  };

  const handleCopyText = () => {
    const textToCopy = fullText || currentPaper.abstract || "";
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredFullText = fullText
    ? (textSearch.trim()
        ? fullText
            .split("\n\n")
            .filter((p) => p.toLowerCase().includes(textSearch.toLowerCase()))
            .join("\n\n")
        : fullText)
    : "";

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 16,
      }}
    >
      <div
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          width: "100%",
          maxWidth: 960,
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
          overflow: "hidden",
        }}
      >
        {/* Modal Top Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 24px",
            borderBottom: `1px solid ${C.border}`,
            background: C.card,
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Tag
              label={isSearchPaper ? "⌕ Semantic Scholar Search" : "📄 Library Paper"}
              color={C.accent}
            />
            {hasAnyPdf && <Tag label="📄 Full PDF Ready" color="#10b981" />}
            {currentPaper.year && <Tag label={String(currentPaper.year)} color={C.accent2} />}
            {(currentPaper.citationCount != null || currentPaper.cited != null) && (
              <Tag
                label={`📎 ${currentPaper.citationCount ?? currentPaper.cited} citations`}
                color="#059669"
              />
            )}
            {currentPaper.venue && <Tag label={currentPaper.venue} color="#d97706" />}
            {currentPaper.processing_status === "completed" && (
              <Tag label={`✓ Indexed (${currentPaper.chunk_count || 0} chunks)`} color="#059669" />
            )}
            {currentPaper.is_read && <Tag label="✓ Read" color="#059669" />}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: C.textDim,
              fontSize: 22,
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: 6,
            }}
          >
            ✕
          </button>
        </div>

        {/* Paper Header Info */}
        <div style={{ padding: "20px 24px 14px", borderBottom: `1px solid ${C.border}33`, background: C.card + "88" }}>
          <h2
            style={{
              color: C.text,
              fontSize: 20,
              fontWeight: 700,
              lineHeight: 1.4,
              marginBottom: 8,
            }}
          >
            {currentPaper.title}
          </h2>

          <div
            style={{
              color: C.textDim,
              fontSize: 13,
              marginBottom: 16,
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span>👤 {authors}</span>
            {currentPaper.year && <span>• {currentPaper.year}</span>}
            {currentPaper.venue && <span>• {currentPaper.venue}</span>}
          </div>

          {/* Action Row */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {!isSaved && (
              <button
                onClick={handleSaveClick}
                disabled={saved || saving}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  background: saved
                    ? "rgba(5,150,105,0.2)"
                    : `linear-gradient(90deg, ${C.accent}, ${C.accent2})`,
                  border: `1px solid ${saved ? "#059669" : "transparent"}`,
                  color: saved ? "#10b981" : "#fff",
                  cursor: saved || saving ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {saved ? "✓ Saved to Library" : saving ? "Saving..." : "+ Save to Library"}
              </button>
            )}

            {onOpenPdf && (
              <button
                onClick={() => {
                  onClose();
                  onOpenPdf(currentPaper);
                }}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  background: "rgba(16,185,129,0.18)",
                  border: "1px solid rgba(16,185,129,0.5)",
                  color: "#10b981",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                📄 Open Full PDF Reader
              </button>
            )}

            {hasAnyPdf && (
              <button
                onClick={handleDownloadClick}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  background: `${C.accent2}20`,
                  border: `1px solid ${C.accent2}66`,
                  color: C.accent2,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                ⬇ Download PDF
              </button>
            )}

            {(!fullText || fullText.length <= (currentPaper.abstract?.length || 0)) && (
              <button
                onClick={handleFetchFullPaper}
                disabled={fetchingFull}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  background: "rgba(245,158,11,0.15)",
                  border: "1px solid rgba(245,158,11,0.5)",
                  color: "#f59e0b",
                  cursor: fetchingFull ? "wait" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {fetchingFull ? "⚡ Fetching Full Text..." : "⚡ Fetch Full Paper & Index"}
              </button>
            )}

            {onChat && (
              <button
                onClick={() => {
                  onClose();
                  onChat(currentPaper);
                }}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  fontSize: 13,
                  background: `${C.accent}20`,
                  border: `1px solid ${C.accent}66`,
                  color: C.accent,
                  cursor: "pointer",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                💬 Chat with Paper
              </button>
            )}

            {onToggleRead && (
              <button
                onClick={() => onToggleRead(currentPaper)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  fontSize: 13,
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  color: currentPaper.is_read ? "#059669" : C.textDim,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {currentPaper.is_read ? "✓ Mark as Unread" : "Mark as Read"}
              </button>
            )}
          </div>

          {fetchError && (
            <div style={{ color: "#ef4444", fontSize: 12, marginTop: 10 }}>
              ⚠ {fetchError}
            </div>
          )}
        </div>

        {/* View Navigation Tabs */}
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "8px 24px",
            borderBottom: `1px solid ${C.border}`,
            background: C.surface,
          }}
        >
          {[
            { id: "overview", label: "📑 Abstract & Overview" },
            {
              id: "fulltext",
              label: fullText
                ? `📖 Full Paper Text (${Math.round((fullText.length) / 1000)}k chars)`
                : "📖 Full Paper Text",
            },
            { id: "pdf", label: "📄 Embedded PDF Preview" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "8px 18px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: activeTab === tab.id ? 600 : 500,
                background: activeTab === tab.id ? `${C.accent}22` : "transparent",
                border: `1px solid ${activeTab === tab.id ? C.accent : "transparent"}`,
                color: activeTab === tab.id ? C.accent : C.textDim,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Scrollable Modal Content */}
        <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1 }}>
          {/* TAB 1: OVERVIEW */}
          {activeTab === "overview" && (
            <div>
              {/* AI TLDR Summary */}
              {currentPaper.tldr?.text && (
                <div
                  style={{
                    background: `${C.accent}12`,
                    border: `1px solid ${C.accent}44`,
                    borderRadius: 10,
                    padding: "14px 16px",
                    marginBottom: 20,
                  }}
                >
                  <div
                    style={{
                      color: C.accent,
                      fontSize: 12,
                      fontWeight: 700,
                      marginBottom: 4,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    ✨ Quick TL;DR
                  </div>
                  <div style={{ color: C.text, fontSize: 13, lineHeight: 1.5 }}>
                    {currentPaper.tldr.text}
                  </div>
                </div>
              )}

              {/* Abstract */}
              <div style={{ marginBottom: 20 }}>
                <div
                  style={{
                    color: C.text,
                    fontSize: 14,
                    fontWeight: 700,
                    marginBottom: 8,
                    letterSpacing: 0.2,
                  }}
                >
                  Abstract
                </div>
                <div
                  style={{
                    color: C.text,
                    fontSize: 14,
                    lineHeight: 1.75,
                    background: C.card,
                    padding: "18px 20px",
                    borderRadius: 10,
                    border: `1px solid ${C.border}`,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {currentPaper.abstract || "No abstract available for this paper."}
                </div>
              </div>

              {/* Status / Full text banner */}
              <div
                style={{
                  background: fullText && fullText.length > 2000 ? "rgba(16,185,129,0.1)" : "rgba(79,110,247,0.1)",
                  border: `1px solid ${fullText && fullText.length > 2000 ? "#10b98144" : C.accent + "44"}`,
                  borderRadius: 10,
                  padding: "14px 18px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>
                    {fullText && fullText.length > 2000
                      ? "✓ Full Paper Text Extracted & Available"
                      : "📖 Want to read the full publication?"}
                  </div>
                  <div style={{ color: C.textDim, fontSize: 12, marginTop: 2 }}>
                    {fullText && fullText.length > 2000
                      ? `Extracted ${fullText.length.toLocaleString()} characters across complete paper.`
                      : "You can view the full paper text or open the full PDF right in the app."}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => setActiveTab("fulltext")}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      background: C.accent,
                      border: "none",
                      color: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    Read Full Text →
                  </button>
                  <button
                    onClick={() => setActiveTab("pdf")}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      color: C.text,
                      cursor: "pointer",
                    }}
                  >
                    View PDF →
                  </button>
                </div>
              </div>

              {/* Notes or Metadata */}
              {currentPaper.notes && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ color: C.textDim, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                    Notes & Citations
                  </div>
                  <div
                    style={{
                      color: C.textDim,
                      fontSize: 12,
                      background: C.card,
                      padding: "10px 14px",
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                    }}
                  >
                    {currentPaper.notes}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: FULL PAPER TEXT */}
          {activeTab === "fulltext" && (
            <div>
              {fullText && fullText.length > (currentPaper.abstract?.length || 0) + 100 ? (
                <div>
                  {/* Controls */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      marginBottom: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ color: C.textDim, fontSize: 12 }}>
                      📊 {fullText.length.toLocaleString()} characters · ~{Math.round(fullText.split(/\s+/).length)} words
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="text"
                        placeholder="Filter text..."
                        value={textSearch}
                        onChange={(e) => setTextSearch(e.target.value)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 6,
                          background: C.card,
                          border: `1px solid ${C.border}`,
                          color: C.text,
                          fontSize: 12,
                          outline: "none",
                          width: 180,
                        }}
                      />
                      <button
                        onClick={handleCopyText}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 6,
                          background: C.card,
                          border: `1px solid ${C.border}`,
                          color: copied ? "#10b981" : C.text,
                          fontSize: 12,
                          cursor: "pointer",
                          fontWeight: 500,
                        }}
                      >
                        {copied ? "✓ Copied!" : "📋 Copy All"}
                      </button>
                      <button
                        onClick={handleDownloadClick}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 6,
                          background: "rgba(16,185,129,0.15)",
                          border: "1px solid rgba(16,185,129,0.4)",
                          color: "#10b981",
                          fontSize: 12,
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        ⬇ Download PDF
                      </button>
                    </div>
                  </div>

                  {/* Full Text Content Container */}
                  <div
                    style={{
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: 12,
                      padding: "24px 28px",
                      color: C.text,
                      fontSize: 14,
                      lineHeight: 1.8,
                      whiteSpace: "pre-wrap",
                      fontFamily: "inherit",
                    }}
                  >
                    {filteredFullText || (
                      <span style={{ color: C.textDim }}>No paragraphs match your search filter "{textSearch}".</span>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    textAlign: "center",
                    padding: "48px 24px",
                    background: C.card,
                    borderRadius: 12,
                    border: `1px solid ${C.border}`,
                  }}
                >
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📖</div>
                  <div style={{ color: C.text, fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
                    Full Paper Text Not Yet Downloaded
                  </div>
                  <div style={{ color: C.textDim, fontSize: 13, maxWidth: 460, margin: "0 auto 20px", lineHeight: 1.5 }}>
                    This paper currently only has the abstract stored. Click below to automatically retrieve the full open-access publication text, extract its pages, and index it for AI exploration.
                  </div>
                  <button
                    onClick={handleFetchFullPaper}
                    disabled={fetchingFull}
                    style={{
                      padding: "10px 24px",
                      borderRadius: 8,
                      background: `linear-gradient(90deg, ${C.accent}, ${C.accent2})`,
                      border: "none",
                      color: "#fff",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: fetchingFull ? "wait" : "pointer",
                      opacity: fetchingFull ? 0.7 : 1,
                    }}
                  >
                    {fetchingFull ? "⚡ Retrieving & Indexing Full Paper..." : "⚡ Fetch & Read Full Paper"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: EMBEDDED PDF PREVIEW */}
          {activeTab === "pdf" && (
            <div style={{ height: "60vh", display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  background: C.card,
                  borderRadius: "8px 8px 0 0",
                  border: `1px solid ${C.border}`,
                  borderBottom: "none",
                }}
              >
                <span style={{ color: C.textDim, fontSize: 12 }}>
                  PDF Document Preview
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={handleDownloadClick}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      background: "rgba(16,185,129,0.15)",
                      border: "1px solid rgba(16,185,129,0.4)",
                      color: "#10b981",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    ⬇ Download
                  </button>
                  {onOpenPdf && (
                    <button
                      onClick={() => {
                        onClose();
                        onOpenPdf(currentPaper);
                      }}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 6,
                        background: `${C.accent}20`,
                        border: `1px solid ${C.accent}55`,
                        color: C.accent,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      ↗ Fullscreen Reader
                    </button>
                  )}
                </div>
              </div>

              <iframe
                title={`PDF: ${currentPaper.title}`}
                src={
                  currentPaper.id
                    ? apiUrl(`/api/papers/${currentPaper.id}/pdf#toolbar=1`)
                    : apiUrl(`/api/papers/proxy-pdf?url=${encodeURIComponent(pdfUrl || currentPaper.url)}&title=${encodeURIComponent(currentPaper.title)}#toolbar=1`)
                }
                style={{
                  flex: 1,
                  width: "100%",
                  border: `1px solid ${C.border}`,
                  borderRadius: "0 0 8px 8px",
                  background: "#1e1e1e",
                }}
              />
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: "12px 24px",
            borderTop: `1px solid ${C.border}`,
            background: C.card,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ color: C.textDim, fontSize: 12 }}>
            {hasAnyPdf ? "✓ Full PDF Document Ready" : "Notice: Limited to Open Access repositories"}
          </div>
          <button
            onClick={onClose}
            style={{
              padding: "7px 18px",
              borderRadius: 8,
              fontSize: 13,
              background: C.surface,
              border: `1px solid ${C.border}`,
              color: C.text,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function AddPaperModal({ onClose, onAdded }) {
  const C = useTheme();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("pdf", file);
    try {
      const res = await apiFetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) { onAdded(); onClose(); }
      else alert("Upload failed: " + data.error);
    } catch (e) { alert("Upload error: " + e.message); }
    setUploading(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }}>
      <div style={{ background: C.glass, backdropFilter: "blur(12px)", border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, width: 420, textAlign: "center" }}>
        <div style={{ color: C.text, fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Upload a Paper</div>
        <div style={{ color: C.textDim, fontSize: 13, marginBottom: 24 }}>Upload a PDF to your library and chat with it using AI</div>
        <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={handleUpload} />
        <div onClick={() => !uploading && fileRef.current.click()} style={{
          border: `2px dashed ${C.accent}44`, borderRadius: 12, padding: "40px 20px",
          cursor: "pointer", marginBottom: 20,
        }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📄</div>
          <div style={{ color: C.accent, fontWeight: 600, marginBottom: 4 }}>{uploading ? "Uploading..." : "Click to select a PDF"}</div>
          <div style={{ color: C.textDim, fontSize: 12 }}>Supports .pdf files</div>
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: "10px", borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, color: C.textDim, cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );
}

function SettingsModal({ onClose, theme, setTheme }) {
  const C = useTheme();
  const themeNames = Object.keys(THEMES);
  const previews = { Dark: "🌑", Darker: "⚫", Midnight: "🌌", Light: "☀️" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }}>
      <div style={{ background: C.glass, backdropFilter: "blur(12px)", border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, width: 420 }}>
        <div style={{ color: C.text, fontWeight: 700, fontSize: 16, marginBottom: 20 }}>⚙ Settings</div>
        <div style={{ marginBottom: 24 }}>
          <div style={{ color: C.textDim, fontSize: 12, marginBottom: 12 }}>Theme</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {themeNames.map(t => (
              <div key={t} onClick={() => setTheme(t)} style={{
                padding: "14px 16px", borderRadius: 10, cursor: "pointer",
                background: theme === t ? `${C.accent}20` : C.card,
                border: `2px solid ${theme === t ? C.accent : C.border}`,
                display: "flex", alignItems: "center", gap: 10, transition: "all 0.15s",
              }}>
                <span style={{ fontSize: 20 }}>{previews[t]}</span>
                <div>
                  <div style={{ color: theme === t ? C.accent : C.text, fontWeight: 600, fontSize: 13 }}>{t}</div>
                  <div style={{ width: 40, height: 6, borderRadius: 3, marginTop: 4, background: THEMES[t].bg, border: `1px solid ${THEMES[t].border}` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: "10px", borderRadius: 8, background: `linear-gradient(90deg, ${C.accent}, ${C.accent2})`, border: "none", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Done</button>
      </div>
    </div>
  );
}

// ---- Layout ----
function Sidebar({ active, setActive }) {
  const C = useTheme();
  return (
    <div style={{ width: 220, minHeight: "100vh", background: C.surface, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", padding: "24px 0", position: "fixed", top: 0, left: 0, zIndex: 100 }}>
      <div style={{ padding: "0 20px 28px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg, ${C.accent}, ${C.accent2})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#fff" }}>N</div>
          <span style={{ color: C.text, fontWeight: 700, fontSize: 18, letterSpacing: 1 }}>NEXUS</span>
        </div>
        <div style={{ color: C.textDim, fontSize: 11, marginTop: 4, paddingLeft: 42 }}>Research Intelligence</div>
      </div>
      <nav style={{ flex: 1, padding: "16px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
        {NAV.map(({ id, icon, label }) => {
          const on = active === id;
          return (
            <button key={id} onClick={() => setActive(id)} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer",
              background: on ? `linear-gradient(90deg, ${C.accent}30, ${C.accent2}18)` : "transparent",
              color: on ? C.accent : C.textDim,
              borderLeft: on ? `2px solid ${C.accent}` : "2px solid transparent",
              fontSize: 14, fontWeight: on ? 600 : 400, transition: "all 0.18s", textAlign: "left",
            }}>
              <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>{icon}</span>
              {label}
            </button>
          );
        })}
      </nav>
      <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div>
            <div style={{ color: C.text, fontSize: 13, fontWeight: 500 }}>My Account</div>
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Topbar({ page, onAddPaper, onSettings }) {
  const C = useTheme();
  const nav = NAV.find(n => n.id === page);
  return (
    <div style={{ height: 60, background: C.glass, backdropFilter: "blur(12px)", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 28px", position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: C.accent, fontSize: 20 }}>{nav?.icon}</span>
        <span style={{ color: C.text, fontWeight: 600, fontSize: 16 }}>{nav?.label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onAddPaper} style={{ padding: "6px 14px", borderRadius: 20, background: `${C.accent}20`, border: `1px solid ${C.accent}55`, color: C.accent, fontSize: 12, cursor: "pointer" }}>+ Add Paper</button>
        <button onClick={onSettings} style={{ width: 36, height: 36, borderRadius: "50%", background: C.card, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: C.textDim, fontSize: 16, cursor: "pointer" }}>⚙</button>
      </div>
    </div>
  );
}

// ---- Pages ----
// ADD THIS FUNCTION DIRECTLY IN App.jsx
// Place it with the other page functions (GraphPage, LibraryPage, SearchPage, etc.)

function SimilarityPage() {
  const C = useTheme();
  const [papers, setPapers] = useState([]);
  const [selectedPaper, setSelectedPaper] = useState(null);
  const [similarPapers, setSimilarPapers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState("graph"); // "graph" or "list"
  const svgRef = useRef(null);
  const zoomRef = useRef(null);

  // Load all papers
  useEffect(() => {
    apiFetch("/api/papers")
      .then((r) => r.json())
      .then(setPapers)
      .catch((e) => console.error(e));
  }, []);

  // Analyze similarity
  const analyzeSimilarity = async () => {
    if (!selectedPaper) return;
    setLoading(true);
    try {
      const res = await apiFetch("/api/similarity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperId: selectedPaper.id }),
      });
      const data = await res.json();
      setSimilarPapers(data.similarPapers || []);
    } catch (e) {
      console.error("Error:", e);
    }
    setLoading(false);
  };

  // D3 Force Graph for similarity network
  useEffect(() => {
    if (viewMode !== "graph" || !similarPapers.length || !svgRef.current)
      return;

    const width = svgRef.current.clientWidth || 800;
    const height = 500;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const container = svg.append("g");
    const zoom = d3.zoom().scaleExtent([0.5, 3]).on("zoom", (e) =>
      container.attr("transform", e.transform)
    );
    zoomRef.current = zoom;
    svg.call(zoom);

    // Create nodes: selected paper + similar papers
    const nodes = [
      {
        id: selectedPaper.id,
        title: selectedPaper.title.slice(0, 30),
        score: 100,
        isSelected: true,
      },
      ...similarPapers.map((p) => ({
        id: p.id,
        title: p.title.slice(0, 30),
        score: p.similarityScore,
        isSelected: false,
      })),
    ];

    // Create links: selected paper connects to all similar papers
    const links = similarPapers.map((p) => ({
      source: selectedPaper.id,
      target: p.id,
      strength: p.similarityScore / 100,
    }));

    const colors = [C.accent, C.accent2, "#059669", "#d97706", "#e11d48"];

    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d) => d.id).distance(150))
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide(60));

    // Draw links
    const link = container
      .append("g")
      .selectAll("line")
      .data(links)
      .enter()
      .append("line")
      .attr("stroke", (d) => C.muted)
      .attr("stroke-opacity", (d) => 0.3 + d.strength * 0.5)
      .attr("stroke-width", (d) => 1 + d.strength * 3);

    // Draw nodes
    const node = container
      .append("g")
      .selectAll("g")
      .data(nodes)
      .enter()
      .append("g")
      .style("cursor", "pointer")
      .call(
        d3.drag()
          .on("start", (e, d) => {
            if (!e.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (e, d) => {
            d.fx = e.x;
            d.fy = e.y;
          })
          .on("end", (e, d) => {
            if (!e.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Node circles
    node
      .append("circle")
      .attr("r", (d) => (d.isSelected ? 40 : 25))
      .attr("fill", (d) =>
        d.isSelected ? `${C.accent}44` : `${colors[d.score % colors.length]}22`
      )
      .attr("stroke", (d) =>
        d.isSelected ? C.accent : colors[d.score % colors.length]
      )
      .attr("stroke-width", 2);

    // Node labels
    node
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.3em")
      .attr("fill", C.text)
      .attr("font-size", (d) => (d.isSelected ? "11px" : "9px"))
      .attr("font-weight", "600")
      .text((d) => (d.isSelected ? "📄" : d.score + "%"));

    // Tooltips on hover
    node.append("title").text((d) => d.title);

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);
      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    return () => simulation.stop();
  }, [similarPapers, viewMode, C, selectedPaper]);

  const handleZoom = (type) => {
    const svg = d3.select(svgRef.current);
    if (type === "in") svg.transition().call(zoomRef.current.scaleBy, 1.4);
    else if (type === "out") svg.transition().call(zoomRef.current.scaleBy, 0.7);
    else svg.transition().call(zoomRef.current.transform, d3.zoomIdentity);
  };

  return (
    <div>
      <div style={{ color: C.textDim, fontSize: 13, marginBottom: 20 }}>
        Select a paper to find similar papers in your library
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ color: C.textDim, fontSize: 12, marginBottom: 8 }}>
          Select a paper
        </div>
        <select
          onChange={(e) =>
            setSelectedPaper(papers.find((p) => p.id === e.target.value))
          }
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: 10,
            background: C.card,
            border: `1px solid ${C.border}`,
            color: C.text,
            fontSize: 13,
            outline: "none",
            cursor: "pointer",
          }}
        >
          <option value="">-- Choose a paper --</option>
          {papers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={analyzeSimilarity}
        disabled={!selectedPaper || loading}
        style={{
          width: "100%",
          padding: "12px",
          borderRadius: 10,
          marginBottom: 20,
          background:
            selectedPaper && !loading
              ? `linear-gradient(90deg, ${C.accent}, ${C.accent2})`
              : C.muted,
          border: "none",
          color: "#fff",
          fontWeight: 600,
          cursor: selectedPaper && !loading ? "pointer" : "not-allowed",
        }}
      >
        {loading ? "Analyzing..." : "🔍 Find Similar Papers"}
      </button>

      {similarPapers.length > 0 && (
        <>
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 20,
              justifyContent: "center",
            }}
          >
            <button
              onClick={() => setViewMode("graph")}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                fontSize: 12,
                background:
                  viewMode === "graph" ? `${C.accent}20` : C.card,
                border: `1px solid ${viewMode === "graph" ? C.accent : C.border}`,
                color: viewMode === "graph" ? C.accent : C.textDim,
                cursor: "pointer",
              }}
            >
              🌐 Network
            </button>
            <button
              onClick={() => setViewMode("list")}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                fontSize: 12,
                background:
                  viewMode === "list" ? `${C.accent}20` : C.card,
                border: `1px solid ${viewMode === "list" ? C.accent : C.border}`,
                color: viewMode === "list" ? C.accent : C.textDim,
                cursor: "pointer",
              }}
            >
              ☰ List
            </button>
          </div>

          {viewMode === "graph" ? (
            <div
              style={{
                background: C.glass,
                backdropFilter: "blur(12px)",
                border: `1px solid ${C.border}`,
                borderRadius: 16,
                padding: 8,
                marginBottom: 24,
                position: "relative",
              }}
            >
              <svg ref={svgRef} style={{ width: "100%", height: 500 }} />
              <div
                style={{
                  position: "absolute",
                  bottom: 16,
                  right: 16,
                  display: "flex",
                  gap: 8,
                }}
              >
                {[
                  ["in", "Zoom In"],
                  ["out", "Zoom Out"],
                  ["reset", "Reset"],
                ].map(([t, l]) => (
                  <button
                    key={t}
                    onClick={() => handleZoom(t)}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 6,
                      fontSize: 11,
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      color: C.textDim,
                      cursor: "pointer",
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {similarPapers.map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: C.glass,
                    backdropFilter: "blur(12px)",
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: "16px 20px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>
                      {p.title}
                    </div>
                    <div
                      style={{
                        color: C.accent,
                        fontWeight: 700,
                        fontSize: 14,
                      }}
                    >
                      {p.similarityScore}%
                    </div>
                  </div>
                  <div style={{ color: C.textDim, fontSize: 12, marginBottom: 8 }}>
                    {p.authors?.join(", ") || "Unknown"} · {p.year || "N/A"}
                  </div>
                  <div style={{ color: C.text, fontSize: 13, lineHeight: 1.5 }}>
                    {p.reason}
                  </div>
                  <div style={{ marginTop: 12, height: 4, background: C.muted, borderRadius: 2, overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: p.similarityScore + "%",
                        background: `linear-gradient(90deg, ${C.accent}, ${C.accent2})`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!loading && selectedPaper && similarPapers.length === 0 && (
        <div style={{ color: C.textDim, textAlign: "center", padding: "40px" }}>
          No similar papers found. Try another paper or add more to your library.
        </div>
      )}
    </div>
  );
}

function GraphPage() {
  const C = useTheme();
  const svgRef = useRef(null);
  const [papers, setPapers] = useState([]);
  const zoomRef = useRef(null);

  useEffect(() => {
    apiFetch("/api/papers").then(r => r.json()).then(setPapers);
  }, []);

  useEffect(() => {
    if (!papers.length || !svgRef.current) return;
    const width = svgRef.current.clientWidth, height = 480;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);
    const container = svg.append("g");
    const zoom = d3.zoom().scaleExtent([0.3, 3]).on("zoom", e => container.attr("transform", e.transform));
    zoomRef.current = zoom;
    svg.call(zoom);

    const nodes = papers.map((p, i) => ({ id: p.id, label: p.title?.slice(0, 22) + "...", source: p.source, i }));
    const links = [];
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++)
        if (nodes[i].source === nodes[j].source) links.push({ source: nodes[i].id, target: nodes[j].id });

    const colors = [C.accent, C.accent2, "#059669", "#d97706", "#e11d48", "#0891b2"];
    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(120))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide(50));

    const link = container.append("g").selectAll("line").data(links).enter().append("line")
      .attr("stroke", C.muted).attr("stroke-opacity", 0.5).attr("stroke-width", 1);

    const node = container.append("g").selectAll("g").data(nodes).enter().append("g")
      .style("cursor", "pointer")
      .call(d3.drag()
        .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    node.append("circle").attr("r", 28)
      .attr("fill", d => colors[d.i % colors.length] + "22")
      .attr("stroke", d => colors[d.i % colors.length])
      .attr("stroke-width", 1.5);

    node.append("text").attr("text-anchor", "middle").attr("dy", "0.3em")
      .attr("fill", d => colors[d.i % colors.length])
      .attr("font-size", "9px").attr("font-weight", "600")
      .each(function (d) {
        const words = d.label.split(" ").slice(0, 4);
        d3.select(this).selectAll("tspan").data(words).enter().append("tspan")
          .attr("x", 0).attr("dy", (w, i) => i === 0 ? `-${(words.length - 1) * 6}px` : "12px").text(w => w);
      });

    sim.on("tick", () => {
      link.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      node.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    return () => sim.stop();
  }, [papers, C]);

  const handleZoom = t => {
    const svg = d3.select(svgRef.current);
    if (t === "in") svg.transition().call(zoomRef.current.scaleBy, 1.4);
    else if (t === "out") svg.transition().call(zoomRef.current.scaleBy, 0.7);
    else svg.transition().call(zoomRef.current.transform, d3.zoomIdentity);
  };

  return (
    <div>
      <div style={{ color: C.textDim, fontSize: 13, marginBottom: 20 }}>Your research universe — {papers.length} papers · drag nodes to explore</div>
      <div style={{ background: C.glass, backdropFilter: "blur(12px)", border: `1px solid ${C.border}`, borderRadius: 16, padding: 8, marginBottom: 24, position: "relative" }}>
        <svg ref={svgRef} style={{ width: "100%", height: 480 }} />
        <div style={{ position: "absolute", bottom: 16, right: 16, display: "flex", gap: 8 }}>
          {[["in", "Zoom In"], ["out", "Zoom Out"], ["reset", "Reset"]].map(([t, l]) => (
            <button key={t} onClick={() => handleZoom(t)} style={{ padding: "5px 12px", borderRadius: 6, fontSize: 11, background: C.card, border: `1px solid ${C.border}`, color: C.textDim, cursor: "pointer" }}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatCard label="Total Papers" value={papers.length} />
        <StatCard label="Uploaded" value={papers.filter(p => p.source === "upload").length} color="#7c3aed" />
        <StatCard label="From Search" value={papers.filter(p => p.source === "search").length} color="#059669" />
      </div>
    </div>
  );
}

// ADD THIS FUNCTION TO App.jsx

function RecommendationsPage() {
  const C = useTheme();
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  const generateRecommendations = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 5 }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setRecommendations(data.recommendations || []);
        setStats({
          read: data.readPapersAnalyzed,
          unread: data.unreadInLibrary,
          recommended: data.totalRecommended,
        });
      }
    } catch (e) {
      setError("Error: " + e.message);
    }
    setLoading(false);
  };

  const saveRecommendation = async (paper) => {
    try {
      await apiFetch("/api/papers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: paper.title,
          authors: paper.authors || [],
          year: paper.year,
          abstract: paper.abstract,
          source: "recommendation",
        }),
      });
      // Refresh recommendations
      generateRecommendations();
    } catch (e) {
      console.error("Error saving:", e);
    }
  };

  const markAsRead = async (paperId) => {
    try {
      await apiFetch(`/api/papers/${paperId}/read`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_read: true }),
      });
      // Refresh recommendations
      generateRecommendations();
    } catch (e) {
      console.error("Error:", e);
    }
  };

  return (
    <div>
      <div style={{ color: C.textDim, fontSize: 13, marginBottom: 24 }}>
        AI analyzes papers you've read to recommend what you should explore next. Read papers in your library first!
      </div>

      <button
        onClick={generateRecommendations}
        disabled={loading}
        style={{
          width: "100%",
          padding: "14px",
          borderRadius: 12,
          marginBottom: 24,
          background: `linear-gradient(90deg, ${C.accent}, ${C.accent2})`,
          border: "none",
          color: "#fff",
          fontSize: 15,
          fontWeight: 700,
          cursor: loading ? "not-allowed" : "pointer",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? "Analyzing your reading..." : "🎯 Get Recommendations"}
      </button>

      {error && (
        <div
          style={{
            background: "rgba(225,29,72,0.12)",
            border: "1px solid #e11d4844",
            color: "#e11d48",
            padding: 16,
            borderRadius: 12,
            marginBottom: 20,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {stats && (
        <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
          <StatCard label="Papers Read" value={stats.read} color={C.accent} />
          <StatCard label="Unread in Library" value={stats.unread} color={C.accent2} />
          <StatCard label="Recommended" value={stats.recommended} color="#059669" />
        </div>
      )}

      {recommendations.length > 0 && (
        <div>
          <div
            style={{
              color: C.text,
              fontWeight: 700,
              fontSize: 16,
              marginBottom: 16,
            }}
          >
            📚 Recommended for You ({recommendations.length})
          </div>

          <div style={{ display: "grid", gap: 14 }}>
            {recommendations.map((paper, idx) => (
              <div
                key={paper.id || idx}
                style={{
                  background: C.glass,
                  backdropFilter: "blur(12px)",
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  padding: "20px",
                  borderLeft: `4px solid ${C.accent}`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: 12,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        color: C.text,
                        fontWeight: 600,
                        fontSize: 14,
                        lineHeight: 1.5,
                        marginBottom: 6,
                      }}
                    >
                      {paper.title}
                    </div>
                    <div style={{ color: C.textDim, fontSize: 12 }}>
                      {paper.authors?.join(", ") || "Unknown"} · {paper.year || "N/A"}
                    </div>
                  </div>
                  <div
                    style={{
                      background: `${C.accent}20`,
                      border: `1px solid ${C.accent}44`,
                      borderRadius: 8,
                      padding: "8px 12px",
                      textAlign: "center",
                      marginLeft: 12,
                    }}
                  >
                    <div style={{ color: C.accent, fontWeight: 700, fontSize: 16 }}>
                      {paper.relevanceScore}%
                    </div>
                    <div style={{ color: C.textDim, fontSize: 10, marginTop: 2 }}>
                      Match
                    </div>
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ height: 4, background: C.muted, borderRadius: 2, overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: paper.relevanceScore + "%",
                        background: `linear-gradient(90deg, ${C.accent}, ${C.accent2})`,
                        transition: "width 0.6s ease",
                      }}
                    />
                  </div>
                </div>

                <div style={{ color: C.text, fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
                  <span style={{ color: C.textDim, fontWeight: 500 }}>Why relevant: </span>
                  {paper.reason}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => markAsRead(paper.id)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 20,
                      fontSize: 12,
                      background: `${C.accent2}20`,
                      border: `1px solid ${C.accent2}44`,
                      color: C.accent2,
                      cursor: "pointer",
                    }}
                  >
                    👁 Mark as Read
                  </button>
                  <button
                    onClick={() => saveRecommendation(paper)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 20,
                      fontSize: 12,
                      background: `${C.accent}20`,
                      border: `1px solid ${C.accent}44`,
                      color: C.accent,
                      cursor: "pointer",
                    }}
                  >
                    ➕ Save to Library
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && recommendations.length === 0 && stats && (
        <div
          style={{
            background: C.glass,
            backdropFilter: "blur(12px)",
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: 40,
            textAlign: "center",
            color: C.textDim,
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 12 }}>📖</div>
          <div style={{ fontSize: 14 }}>
            {stats.read === 0
              ? "Mark some papers as read to get personalized recommendations!"
              : "No more unread papers to recommend. Add more papers to your library!"}
          </div>
        </div>
      )}
    </div>
  );
}


function LibraryPage() {
  const C = useTheme();
  const [view, setView] = useState("grid");
  const [papers, setPapers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [chatPaper, setChatPaper] = useState(null);
  const [multiChatPapers, setMultiChatPapers] = useState(null);
  const [libraryChatOpen, setLibraryChatOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [pdfPaper, setPdfPaper] = useState(null);
  const [pdfZoom, setPdfZoom] = useState(100);
  const [viewPaper, setViewPaper] = useState(null);
  const fileRef = useRef(null);

  const loadPapers = () => {
    apiFetch("/api/papers")
      .then((r) => r.json())
      .then((d) => {
        setPapers(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadPapers();
  }, []);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    const fd = new FormData();
    fd.append("pdf", file);

    try {
      const res = await apiFetch("/api/upload", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();

      if (data.success) {
        loadPapers();
      } else {
        alert("Upload failed: " + data.error);
      }
    } catch (e) {
      alert("Upload error: " + e.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const toggleRead = async (p) => {
    try {
      await apiFetch(`/api/papers/${p.id}/read`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_read: !p.is_read }),
      });
      loadPapers();
    } catch (e) {
      alert("Could not update read status.");
    }
  };

  const deletePaper = async (id) => {
    if (!confirm("Delete this paper?")) return;

    try {
      await apiFetch(`/api/papers/${id}`, { method: "DELETE" });

      if (pdfPaper?.id === id) {
        setPdfPaper(null);
      }
      if (chatPaper?.id === id) {
        setChatPaper(null);
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });

      loadPapers();
    } catch (e) {
      alert("Could not delete this paper.");
    }
  };

  const downloadAllPapers = () => {
    if (!papers.length) return;
    papers.forEach((p, idx) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = apiUrl(`/api/papers/${p.id}/download`);
        a.download = `${p.title || "paper"}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, idx * 350);
    });
  };

  const downloadSelectedPapers = () => {
    const chosen = papers.filter((p) => selectedIds.has(p.id));
    if (!chosen.length) return;
    chosen.forEach((p, idx) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = apiUrl(`/api/papers/${p.id}/download`);
        a.download = `${p.title || "paper"}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, idx * 350);
    });
  };

  const handleFetchFullPaper = async (paperId) => {
    try {
      await apiFetch(`/api/papers/${paperId}/fetch-full`, { method: "POST" });
      loadPapers();
    } catch (e) {
      alert("Could not fetch full paper: " + e.message);
    }
  };

  const openPdf = (p) => {
    setPdfZoom(100);
    setPdfPaper(p);
  };

  const closePdf = () => setPdfPaper(null);

  useEffect(() => {
    if (!pdfPaper) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        closePdf();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pdfPaper]);

  return (
    <div>
      {/* Library header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <StatCard label="Saved" value={papers.length} />
          <StatCard
            label="Read"
            value={papers.filter((p) => p.is_read).length}
            color="#059669"
          />
          <StatCard
            label="Unread"
            value={papers.filter((p) => !p.is_read).length}
            color="#d97706"
          />
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,application/pdf"
            style={{ display: "none" }}
            onChange={handleUpload}
          />

          {papers.length > 0 && (
            <button
              onClick={selectedIds.size > 0 ? downloadSelectedPapers : downloadAllPapers}
              title={selectedIds.size > 0 ? "Download selected papers as PDFs" : "Download all library papers as PDFs"}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                fontSize: 12,
                background: "rgba(16,185,129,0.18)",
                border: "1px solid rgba(16,185,129,0.45)",
                color: "#10b981",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              ⬇ {selectedIds.size > 0 ? `Download (${selectedIds.size})` : "Download All"}
            </button>
          )}

          {selectedIds.size >= 2 && (
            <button
              onClick={() => {
                const chosen = papers.filter((p) => selectedIds.has(p.id) && p.processing_status === "completed");
                if (chosen.length < 2) {
                  alert("Please ensure at least 2 selected papers have finished indexing.");
                  return;
                }
                setMultiChatPapers(chosen);
              }}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                fontSize: 12,
                background: "linear-gradient(90deg, #6366f1, #8b5cf6)",
                border: "none",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 2px 10px rgba(99,102,241,0.3)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              ⚖️ Compare Selected ({selectedIds.size})
            </button>
          )}

          {selectedIds.size > 0 && (
            <button
              onClick={clearSelection}
              style={{
                padding: "7px 12px",
                borderRadius: 8,
                fontSize: 12,
                background: C.card,
                border: `1px solid ${C.border}`,
                color: C.textDim,
                cursor: "pointer",
              }}
            >
              Clear ({selectedIds.size})
            </button>
          )}

          <button
            onClick={() => setLibraryChatOpen(true)}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              fontSize: 12,
              background: `${C.accent}18`,
              border: `1px solid ${C.accent}55`,
              color: C.accent,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            🌐 Chat Library
          </button>

          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              fontSize: 12,
              background: `linear-gradient(90deg, ${C.accent}, ${C.accent2})`,
              border: "none",
              color: "#fff",
              fontWeight: 600,
              cursor: uploading ? "wait" : "pointer",
              opacity: uploading ? 0.7 : 1,
            }}
          >
            {uploading ? "Uploading..." : "⬆ Upload PDF"}
          </button>

          {["grid", "list"].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                fontSize: 12,
                background: view === v ? `${C.accent}20` : C.card,
                border: `1px solid ${
                  view === v ? C.accent : C.border
                }`,
                color: view === v ? C.accent : C.textDim,
                cursor: "pointer",
              }}
            >
              {v === "grid" ? "▦ Grid" : "☰ List"}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div style={{ color: C.textDim }}>Loading...</div>
      )}

      {/* Paper cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            view === "grid"
              ? "repeat(auto-fill, minmax(280px, 1fr))"
              : "1fr",
          gap: 14,
        }}
      >
        {papers.map((p) => {
          const isSelected = selectedIds.has(p.id);
          const isIndexed = p.processing_status === "completed" && Number(p.chunk_count) > 0;

          return (
            <div
              key={p.id}
              style={{
                background: isSelected ? `${C.accent}12` : C.glass,
                backdropFilter: "blur(12px)",
                border: `1px solid ${isSelected ? C.accent : C.border}`,
                borderRadius: 12,
                padding: "18px 20px",
                opacity: p.is_read ? 0.8 : 1,
                transition: "all 0.15s ease",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div
                  style={{
                    color: C.text,
                    fontWeight: 600,
                    fontSize: 14,
                    marginBottom: 6,
                    lineHeight: 1.4,
                    flex: 1,
                  }}
                >
                  {p.title}
                </div>
                {isIndexed && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(p.id)}
                    title="Select paper for cross-paper comparison"
                    style={{ cursor: "pointer", width: 16, height: 16, accentColor: C.accent, marginTop: 2 }}
                  />
                )}
              </div>

              <div
                style={{
                  color: C.textDim,
                  fontSize: 12,
                  marginBottom: 10,
                }}
              >
                {Array.isArray(p.authors)
                  ? p.authors.join(", ")
                  : p.authors || "Unknown"}{" "}
                · {p.year || "Year unknown"}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                  marginBottom: 10,
                }}
              >
                <Tag label={p.source || "saved"} color={C.accent} />

                {p.processing_status && (
                  <Tag
                    label={
                      p.processing_status === "completed"
                        ? `✓ Indexed · ${p.chunk_count || 0} chunks`
                        : p.processing_status
                    }
                    color={
                      p.processing_status === "completed"
                        ? "#059669"
                        : "#d97706"
                    }
                  />
                )}

                {p.is_read && (
                  <Tag label="✓ Read" color="#059669" />
                )}
              </div>

              {p.abstract && (
                <div
                  style={{
                    color: C.textDim,
                    fontSize: 12,
                    lineHeight: 1.4,
                    marginBottom: 12,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {p.abstract}
                </div>
              )}

              {/* Independent action buttons */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={() => setViewPaper(p)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 20,
                    fontSize: 11,
                    background: `${C.accent}20`,
                    border: `1px solid ${C.accent}55`,
                    color: C.accent,
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  📖 View Paper
                </button>

                {isIndexed && (
                  <button
                    onClick={() => setChatPaper(p)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 20,
                      fontSize: 11,
                      background: `${C.accent2}20`,
                      border: `1px solid ${C.accent2}44`,
                      color: C.accent2,
                      cursor: "pointer",
                    }}
                  >
                    💬 Chat
                  </button>
                )}

                <button
                  onClick={() => openPdf(p)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 20,
                    fontSize: 11,
                    background: "rgba(5,150,105,0.15)",
                    border: "1px solid #05966966",
                    color: "#10b981",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  📄 View PDF
                </button>

                <button
                  onClick={() => {
                    const dlUrl = apiUrl(`/api/papers/${p.id}/download`);
                    window.open(dlUrl, "_blank");
                  }}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 20,
                    fontSize: 11,
                    background: `${C.accent2}18`,
                    border: `1px solid ${C.accent2}44`,
                    color: C.accent2,
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  ⬇ Download
                </button>

                {(!p.full_text || p.chunk_count === 0) && (
                  <button
                    onClick={() => handleFetchFullPaper(p.id)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 20,
                      fontSize: 11,
                      background: "rgba(245,158,11,0.15)",
                      border: "1px solid rgba(245,158,11,0.4)",
                      color: "#f59e0b",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    ⚡ Fetch Full Paper
                  </button>
                )}

                <button
                  onClick={() => toggleRead(p)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 20,
                    fontSize: 11,
                    background: p.is_read
                      ? "rgba(5,150,105,0.2)"
                      : `${C.accent}20`,
                    border: `1px solid ${
                      p.is_read ? "#05966944" : C.accent + "44"
                    }`,
                    color: p.is_read ? "#059669" : C.accent,
                    cursor: "pointer",
                  }}
                >
                  {p.is_read ? "✓ Read" : "Mark Read"}
                </button>

                <button
                  onClick={() => deletePaper(p.id)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 20,
                    fontSize: 11,
                    background: "rgba(225,29,72,0.12)",
                    border: "1px solid #e11d4844",
                    color: "#e11d48",
                    cursor: "pointer",
                  }}
                >
                  🗑 Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {!loading && papers.length === 0 && (
        <div
          style={{
            color: C.textDim,
            textAlign: "center",
            marginTop: 60,
          }}
        >
          No papers saved yet. Search for papers or upload a PDF.
        </div>
      )}

      {/* Single paper chat panel */}
      {chatPaper && (
        <ChatPanel
          paper={chatPaper}
          onClose={() => setChatPaper(null)}
        />
      )}

      {/* Multi-paper cross comparison panel */}
      {multiChatPapers && (
        <ChatPanel
          papers={multiChatPapers}
          onClose={() => setMultiChatPapers(null)}
        />
      )}

      {/* Entire library chat panel */}
      {libraryChatOpen && (
        <ChatPanel
          isLibrary={true}
          onClose={() => setLibraryChatOpen(false)}
        />
      )}

      {/* View paper detail modal for search or uploaded papers */}
      {viewPaper && (
        <PaperDetailModal
          paper={viewPaper}
          isSaved={true}
          onClose={() => setViewPaper(null)}
          onOpenPdf={(p) => openPdf(p)}
          onToggleRead={(p) => toggleRead(p)}
          onPaperUpdated={() => loadPapers()}
          onChat={
            viewPaper.processing_status === "completed" && Number(viewPaper.chunk_count) > 0
              ? (p) => setChatPaper(p)
              : null
          }
        />
      )}

      {/* PDF viewer modal */}
      {pdfPaper && (
        <PdfViewerModal paper={pdfPaper} onClose={closePdf} />
      )}
    </div>
  );
}

function pdfControlStyle(C, disabled) {
  return {
    padding: "7px 10px",
    borderRadius: 7,
    background: C.surface,
    border: `1px solid ${C.border}`,
    color: disabled ? C.textDim : C.text,
    fontSize: 12,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}
function SearchPage() {
  const C = useTheme();
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [viewPaper, setViewPaper] = useState(null);
  const [pdfPaper, setPdfPaper] = useState(null);
  const [savedTitles, setSavedTitles] = useState(new Set());

  useEffect(() => {
    apiFetch("/api/papers")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setSavedTitles(
            new Set(data.map((p) => (p.title || "").toLowerCase().trim()))
          );
        }
      })
      .catch(() => {});
  }, []);

  const search = async () => {
    if (!q) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/search?q=" + encodeURIComponent(q));
      const data = await res.json();
      if (data.error) setError(data.error);
      else setResults(data.data || []);
    } catch (e) {
      setError("Something went wrong");
    }
    setLoading(false);
  };

  const handleDownloadPaper = (paper) => {
    const pdfUrl =
      paper.pdf_url ||
      paper.openAccessPdf?.url ||
      (typeof paper.openAccessPdf === "string" ? paper.openAccessPdf : null) ||
      (paper.file_path && /^https?:\/\//i.test(paper.file_path) ? paper.file_path : null);

    const dlUrl = paper.id
      ? apiUrl(`/api/papers/${paper.id}/download`)
      : apiUrl(`/api/papers/proxy-download?url=${encodeURIComponent(pdfUrl || paper.url)}&title=${encodeURIComponent(paper.title)}`);
    window.open(dlUrl, "_blank");
  };

  const downloadAllSearchPdfs = () => {
    const downloadable = results.filter((p) => p.has_full_pdf || p.pdf_url || p.openAccessPdf?.url);
    if (!downloadable.length) {
      alert("No open access PDFs found in the current search results.");
      return;
    }
    downloadable.forEach((p, idx) => {
      setTimeout(() => {
        handleDownloadPaper(p);
      }, idx * 400);
    });
  };

  const handleSaveFromSearch = async (paper) => {
    const authors = Array.isArray(paper.authors)
      ? paper.authors.map((a) => (typeof a === "object" ? a.name : a))
      : paper.authors;

    const pdfUrl =
      paper.pdf_url ||
      paper.openAccessPdf?.url ||
      (typeof paper.openAccessPdf === "string" ? paper.openAccessPdf : null) ||
      (paper.file_path && /^https?:\/\//i.test(paper.file_path) ? paper.file_path : null);

    const res = await apiFetch("/api/papers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: paper.title,
        authors,
        year: paper.year,
        abstract: paper.abstract,
        source: "search",
        file_path: pdfUrl || paper.url || null,
        pdf_url: pdfUrl || null,
        openAccessPdf: paper.openAccessPdf || null,
        externalIds: paper.externalIds || null,
        notes:
          paper.venue ||
          (paper.citationCount ? `${paper.citationCount} citations` : null),
      }),
    });

    if (res.ok) {
      setSavedTitles((prev) =>
        new Set(prev).add((paper.title || "").toLowerCase().trim())
      );
    }
  };

  return (
    <div>
      <div style={{ position: "relative", marginBottom: 28 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Search across 200M+ papers via Semantic Scholar..."
          style={{
            width: "100%",
            padding: "14px 20px 14px 46px",
            borderRadius: 12,
            border: `1px solid ${C.border}`,
            background: C.card,
            color: C.text,
            fontSize: 15,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        <span
          style={{
            position: "absolute",
            left: 16,
            top: "50%",
            transform: "translateY(-50%)",
            color: C.textDim,
            fontSize: 18,
          }}
        >
          ⌕
        </span>
        <button
          onClick={search}
          style={{
            position: "absolute",
            right: 10,
            top: "50%",
            transform: "translateY(-50%)",
            padding: "7px 18px",
            borderRadius: 8,
            background: `linear-gradient(90deg, ${C.accent}, ${C.accent2})`,
            border: "none",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Search
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 24,
        }}
      >
        {[
          "Large Language Models",
          "Diffusion Models",
          "Graph Neural Networks",
          "RLHF",
        ].map((t) => (
          <button
            key={t}
            onClick={() => {
              setQ(t);
            }}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              fontSize: 12,
              background: C.card,
              border: `1px solid ${C.border}`,
              color: C.textDim,
              cursor: "pointer",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {loading && <div style={{ color: C.textDim }}>Searching...</div>}
      {error && (
        <div style={{ color: "#e11d48", marginBottom: 16 }}>{error}</div>
      )}

      {/* Results Header Toolbar */}
      {results.length > 0 && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
            flexWrap: "wrap",
            gap: 10,
            padding: "10px 16px",
            background: C.glass,
            borderRadius: 10,
            border: `1px solid ${C.border}`,
          }}
        >
          <div style={{ color: C.textDim, fontSize: 13 }}>
            Found <span style={{ color: C.text, fontWeight: 600 }}>{results.length}</span> results ·{" "}
            <span style={{ color: "#10b981", fontWeight: 600 }}>
              {results.filter((p) => p.has_full_pdf || p.pdf_url || p.openAccessPdf?.url).length} with Full PDF
            </span>
          </div>
          <button
            onClick={downloadAllSearchPdfs}
            title="Download all open access PDFs found in this search"
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              background: "rgba(16,185,129,0.18)",
              border: "1px solid rgba(16,185,129,0.45)",
              color: "#10b981",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            ⬇ Download All Available PDFs
          </button>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 14,
        }}
      >
        {results.map((p, i) => (
          <PaperCard
            key={i}
            paper={p}
            onView={(paper) => setViewPaper(paper)}
            onOpenPdf={(paper) => setPdfPaper(paper)}
            onDownload={(paper) => handleDownloadPaper(paper)}
            onSave={handleSaveFromSearch}
            isSaved={savedTitles.has((p.title || "").toLowerCase().trim())}
          />
        ))}
      </div>

      {/* Paper Detail Modal for viewing search papers */}
      {viewPaper && (
        <PaperDetailModal
          paper={viewPaper}
          isSaved={savedTitles.has(
            (viewPaper.title || "").toLowerCase().trim()
          )}
          onClose={() => setViewPaper(null)}
          onOpenPdf={(paper) => setPdfPaper(paper)}
          onSave={handleSaveFromSearch}
        />
      )}

      {/* Dedicated PDF viewer modal for reading full PDF directly */}
      {pdfPaper && (
        <PdfViewerModal paper={pdfPaper} onClose={() => setPdfPaper(null)} />
      )}
    </div>
  );
}

function DebatePage() {
  const C = useTheme();
  const [mode, setMode] = useState(null);
  const [papers, setPapers] = useState([]);
  const [selectedPaper, setSelectedPaper] = useState(null);
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { apiFetch("/api/papers").then(r => r.json()).then(setPapers); }, []);

  const modes = [
    { id: "defend", icon: "🛡️", label: "Defend", desc: "Steelman the paper's claims" },
    { id: "challenge", icon: "⚔", label: "Challenge", desc: "Critique methodology & assumptions" },
    { id: "devils_advocate", icon: "😈", label: "Devil's Advocate", desc: "Find the strongest counter-arguments" },
  ];

  const startDebate = async () => {
    if (!selectedPaper || !mode) return;
    setLoading(true); setResult("");
    try {
      const res = await apiFetch("/api/debate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paperId: selectedPaper.id, mode }) });
      const data = await res.json();
      setResult(data.argument || data.error);
    } catch (e) { setResult("Error: " + e.message); }
    setLoading(false);
  };

  return (
    <div>
      <div style={{ color: C.textDim, fontSize: 13, marginBottom: 24 }}>Select a paper and a debate stance. AI will argue from that position.</div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: C.textDim, fontSize: 12, marginBottom: 8 }}>Select a paper</div>
        <select onChange={e => setSelectedPaper(papers.find(p => p.id === e.target.value))} style={{ width: "100%", padding: "12px 16px", borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, color: C.text, fontSize: 13, outline: "none", cursor: "pointer" }}>
          <option value="">-- Choose a paper --</option>
          {papers.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      </div>
      <div style={{ display: "flex", gap: 14, marginBottom: 24 }}>
        {modes.map(m => (
          <div key={m.id} onClick={() => setMode(m.id)} style={{ background: mode === m.id ? `${C.accent}18` : C.glass, backdropFilter: "blur(12px)", border: `1px solid ${mode === m.id ? C.accent : C.border}`, borderRadius: 12, padding: "20px", flex: 1, cursor: "pointer", transition: "all 0.2s", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>{m.icon}</div>
            <div style={{ color: mode === m.id ? C.accent : C.text, fontWeight: 600, marginBottom: 4 }}>{m.label}</div>
            <div style={{ color: C.textDim, fontSize: 12 }}>{m.desc}</div>
          </div>
        ))}
      </div>
      <button onClick={startDebate} disabled={!selectedPaper || !mode || loading} style={{ width: "100%", padding: "14px", borderRadius: 12, marginBottom: 24, background: selectedPaper && mode ? `linear-gradient(90deg, ${C.accent}, ${C.accent2})` : C.muted, border: "none", color: "#fff", fontSize: 15, fontWeight: 700, cursor: selectedPaper && mode ? "pointer" : "not-allowed" }}>{loading ? "Generating argument..." : "⚖ Start AI Debate"}</button>
      {result && (
        <div style={{ background: C.glass, backdropFilter: "blur(12px)", border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, color: C.text, fontSize: 14, lineHeight: 1.8, borderLeft: `3px solid ${C.accent}` }}>
          <div style={{ color: C.accent, fontWeight: 600, marginBottom: 12, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>{modes.find(m => m.id === mode)?.icon} {modes.find(m => m.id === mode)?.label} Argument</div>
          {result}
        </div>
      )}
    </div>
  );
}



function GapsPage() {
  const C = useTheme();

  const [topic, setTopic] = useState("Large Language Models");
  const [gapCount, setGapCount] = useState(2);
  const [papers, setPapers] = useState([]);
  const [selectedPaperIds, setSelectedPaperIds] = useState([]);
  const [gaps, setGaps] = useState([]);
  const [response, setResponse] = useState(null);

  const [loading, setLoading] = useState(false);
  const [papersLoading, setPapersLoading] = useState(true);
  const [error, setError] = useState("");
  const [papersError, setPapersError] = useState("");

  const topics = [
    "NLP",
    "Computer Vision",
    "Reinforcement Learning",
    "Interpretability",
    "Multimodal AI",
    "Large Language Models",
  ];

  const gapColors = [
    C.accent,
    C.accent2,
    "#e11d48",
    "#059669",
    "#d97706",
  ];

  // Load papers from the Nexus library.
  useEffect(() => {
    let cancelled = false;

    async function loadPapers() {
      setPapersLoading(true);
      setPapersError("");

      try {
        const res = await apiFetch("/api/papers");

        if (!res.ok) {
          throw new Error("Could not load papers from your library.");
        }

        const data = await res.json();

        if (!Array.isArray(data)) {
          throw new Error("The library returned an unexpected response.");
        }

        if (!cancelled) {
          setPapers(data);
        }
      } catch (err) {
        if (!cancelled) {
          setPapersError(
            err.message || "Failed to load library papers."
          );
        }
      } finally {
        if (!cancelled) {
          setPapersLoading(false);
        }
      }
    }

    loadPapers();

    return () => {
      cancelled = true;
    };
  }, []);

  // Select or deselect a paper.
  const togglePaper = (paperId) => {
    setSelectedPaperIds((current) =>
      current.includes(paperId)
        ? current.filter((id) => id !== paperId)
        : [...current, paperId]
    );
  };

  const selectAllPapers = () => {
    setSelectedPaperIds(papers.map((paper) => paper.id));
  };

  const clearSelectedPapers = () => {
    setSelectedPaperIds([]);
  };

  // Generate research gaps using the selected library papers.
  const generateGaps = async () => {
    const selectedTopic = topic.trim();

    if (!selectedTopic) {
      setError("Please enter a research topic.");
      return;
    }

    setLoading(true);
    setError("");
    setGaps([]);
    setResponse(null);

    try {
      const res = await apiFetch("/api/gaps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: selectedTopic,
          paperIds: selectedPaperIds,
          count: gapCount,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.error || "Failed to generate research gaps."
        );
      }

      if (!Array.isArray(data.gaps)) {
        throw new Error(
          "The server returned an invalid research-gap response."
        );
      }

      // Sync clean topic if server stripped generation instructions
      if (data.topic && data.topic !== selectedTopic) {
        setTopic(data.topic);
      }

      setResponse(data);
      setGaps(data.gaps);
    } catch (err) {
      setError(
        err.message || "Something went wrong while generating gaps."
      );
    } finally {
      setLoading(false);
    }
  };

  const confidenceColor = (confidence) => {
    switch ((confidence || "low").toLowerCase()) {
      case "high":
        return "#34d399";
      case "medium":
        return "#fbbf24";
      default:
        return "#fb7185";
    }
  };

  const selectedCount = selectedPaperIds.length;

  return (
    <div>
      {/* Page heading */}
      <div style={{ marginBottom: 28 }}>
        <div
          style={{
            color: C.text,
            fontSize: 24,
            fontWeight: 700,
            marginBottom: 8,
          }}
        >
          Research Gaps
        </div>

        <div
          style={{
            color: C.textDim,
            fontSize: 13,
            lineHeight: 1.7,
            maxWidth: 700,
          }}
        >
          Discover potential research opportunities by analyzing papers
          from your library or exploring a topic. Library-based results
          depend on the available abstracts and evidence.
        </div>
      </div>

      {/* Topic selection */}
      <div
        style={{
          background: C.glass,
          backdropFilter: "blur(12px)",
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          padding: 22,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              color: C.text,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            01 / Research topic
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: C.textDim, fontWeight: 500 }}>
              Gaps count:
            </span>
            {[2, 3, 5].map((cnt) => {
              const active = gapCount === cnt;
              return (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => setGapCount(cnt)}
                  disabled={loading}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 14,
                    background: active ? `${C.accent}25` : C.card,
                    border: `1px solid ${active ? C.accent : C.border}`,
                    color: active ? C.accent : C.textDim,
                    fontSize: 11,
                    fontWeight: active ? 700 : 500,
                    cursor: loading ? "not-allowed" : "pointer",
                  }}
                >
                  {cnt}
                </button>
              );
            })}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 16,
          }}
        >
          {topics.map((item) => {
            const active = topic === item;

            return (
              <button
                key={item}
                type="button"
                onClick={() => setTopic(item)}
                disabled={loading}
                style={{
                  padding: "8px 12px",
                  borderRadius: 20,
                  background: active
                    ? `${C.accent}20`
                    : C.card,
                  border: `1px solid ${
                    active ? C.accent : C.border
                  }`,
                  color: active ? C.accent : C.textDim,
                  fontSize: 11,
                  fontWeight: active ? 700 : 500,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                {item}
              </button>
            );
          })}
        </div>

        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !loading) {
              generateGaps();
            }
          }}
          placeholder="Enter a research topic..."
          disabled={loading}
          style={{
            boxSizing: "border-box",
            width: "100%",
            padding: "12px 14px",
            borderRadius: 10,
            background: C.card,
            border: `1px solid ${C.border}`,
            color: C.text,
            fontSize: 13,
            outline: "none",
          }}
        />
      </div>

      {/* Library paper selection */}
      <div
        style={{
          background: C.glass,
          backdropFilter: "blur(12px)",
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          padding: 22,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 8,
          }}
        >
          <div
            style={{
              color: C.text,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            02 / Analyze library papers
          </div>

          <span
            style={{
              color: selectedCount >= 2 ? "#10b981" : selectedCount === 1 ? "#f59e0b" : C.accent,
              background: selectedCount >= 2 ? "rgba(16, 185, 129, 0.15)" : selectedCount === 1 ? "rgba(245, 158, 11, 0.15)" : `${C.accent}18`,
              border: `1px solid ${selectedCount >= 2 ? "rgba(16, 185, 129, 0.4)" : selectedCount === 1 ? "rgba(245, 158, 11, 0.4)" : C.accent + "40"}`,
              padding: "5px 10px",
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {selectedCount >= 2
              ? `✓ ${selectedCount} selected (Grounded Mode)`
              : selectedCount === 1
              ? `1 selected (Needs 2+ for Grounded)`
              : "0 selected (Exploration Mode)"}
          </span>
        </div>

        <div
          style={{
            color: C.textDim,
            fontSize: 12,
            lineHeight: 1.7,
            marginBottom: 16,
          }}
        >
          {selectedCount >= 2
            ? "Multi-paper grounding is active. Gaps will require verified evidence from at least two distinct papers, ensuring rigorously grounded research directions."
            : selectedCount === 1
            ? "Notice: Evidence from at least two distinct papers is required for grounded gaps. With only 1 paper selected, candidate directions will be classified as unverified hypotheses."
            : "No papers selected. Nexus will generate candidate directions in topic exploration mode, labeled as hypotheses requiring multi-paper literature validation."}
        </div>

        {papersLoading && (
          <div
            style={{
              color: C.textDim,
              fontSize: 12,
              padding: 16,
              textAlign: "center",
            }}
          >
            Loading your library...
          </div>
        )}

        {!papersLoading && papersError && (
          <div
            role="alert"
            style={{
              color: "#fb7185",
              fontSize: 12,
              lineHeight: 1.7,
              padding: 12,
              borderRadius: 10,
              background: "rgba(225,29,72,0.08)",
              border: "1px solid rgba(225,29,72,0.25)",
            }}
          >
            {papersError}
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                display: "block",
                marginTop: 8,
                background: "transparent",
                border: "none",
                color: C.accent,
                cursor: "pointer",
                padding: 0,
                fontSize: 12,
              }}
            >
              Reload page
            </button>
          </div>
        )}

        {!papersLoading && !papersError && papers.length === 0 && (
          <div
            style={{
              color: C.textDim,
              fontSize: 12,
              padding: 18,
              borderRadius: 10,
              border: `1px dashed ${C.border}`,
              textAlign: "center",
            }}
          >
            Your library is empty. Add papers to enable
            library-based research-gap analysis.
          </div>
        )}

        {!papersLoading && !papersError && papers.length > 0 && (
          <>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 14,
                marginBottom: 12,
              }}
            >
              <button
                type="button"
                onClick={selectAllPapers}
                disabled={loading}
                style={{
                  background: "transparent",
                  border: "none",
                  color: C.accent,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: loading ? "not-allowed" : "pointer",
                  padding: 0,
                }}
              >
                Select all
              </button>

              <button
                type="button"
                onClick={clearSelectedPapers}
                disabled={loading}
                style={{
                  background: "transparent",
                  border: "none",
                  color: C.textDim,
                  fontSize: 11,
                  cursor: loading ? "not-allowed" : "pointer",
                  padding: 0,
                }}
              >
                Clear selection
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gap: 8,
                maxHeight: 320,
                overflowY: "auto",
                paddingRight: 4,
              }}
            >
              {papers.map((paper) => {
                const checked = selectedPaperIds.includes(paper.id);
                const hasAbstract = Boolean(
                  paper.abstract && paper.abstract.trim()
                );

                return (
                  <label
                    key={paper.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      padding: 13,
                      borderRadius: 10,
                      background: checked
                        ? `${C.accent}0c`
                        : C.card,
                      border: `1px solid ${
                        checked ? C.accent : C.border
                      }`,
                      cursor: loading ? "not-allowed" : "pointer",
                      opacity: loading ? 0.7 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={loading}
                      onChange={() => togglePaper(paper.id)}
                      style={{
                        marginTop: 3,
                        accentColor: C.accent,
                        flexShrink: 0,
                      }}
                    />

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          color: C.text,
                          fontSize: 12,
                          fontWeight: 600,
                          lineHeight: 1.6,
                          overflowWrap: "anywhere",
                        }}
                      >
                        {paper.title || "Untitled paper"}
                      </div>

                      <div
                        style={{
                          color: C.textDim,
                          fontSize: 10,
                          marginTop: 5,
                        }}
                      >
                        {hasAbstract
                          ? "Abstract available"
                          : "No abstract available"}
                        {paper.year ? ` · ${paper.year}` : ""}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Generate button */}
      <button
        type="button"
        onClick={generateGaps}
        disabled={loading}
        style={{
          width: "100%",
          padding: "14px 20px",
          borderRadius: 12,
          marginBottom: 22,
          background: loading
            ? C.muted
            : `linear-gradient(90deg, ${C.accent}, ${C.accent2})`,
          border: "none",
          color: "#fff",
          fontSize: 14,
          fontWeight: 700,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading
          ? "Analyzing research landscape..."
          : "◉ Generate Research Gaps"}
      </button>

      {/* Error state */}
      {error && (
        <div
          role="alert"
          style={{
            color: "#fb7185",
            background: "rgba(225,29,72,0.08)",
            border: "1px solid rgba(225,29,72,0.25)",
            borderRadius: 10,
            padding: 14,
            fontSize: 13,
            lineHeight: 1.7,
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div
          style={{
            background: C.glass,
            backdropFilter: "blur(12px)",
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: 40,
            textAlign: "center",
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 25, marginBottom: 12 }}>◌</div>

          <div
            style={{
              color: C.text,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Analyzing research landscape...
          </div>

          <div
            style={{
              color: C.textDim,
              fontSize: 12,
              lineHeight: 1.7,
              marginTop: 8,
            }}
          >
            Evaluating the selected papers and identifying
            potential research opportunities.
          </div>
        </div>
      )}

      {/* Results */}
      {!loading && gaps.length > 0 && (
        <div
          style={{
            background: C.glass,
            backdropFilter: "blur(12px)",
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: 24,
            marginBottom: 20,
          }}
        >
          {/* Results header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                color: C.text,
                fontWeight: 600,
                fontSize: 17,
              }}
            >
              Potential research gaps
            </div>

            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "6px 10px",
                borderRadius: 20,
                color:
                  response?.mode === "library"
                    ? "#34d399"
                    : "#fbbf24",
                background:
                  response?.mode === "library"
                    ? "rgba(52,211,153,0.10)"
                    : "rgba(251,191,36,0.10)",
                border: `1px solid ${
                  response?.mode === "library"
                    ? "rgba(52,211,153,0.3)"
                    : "rgba(251,191,36,0.3)"
                }`,
              }}
            >
              {response?.mode === "library"
                ? "LIBRARY ANALYSIS"
                : "TOPIC EXPLORATION"}
            </span>
          </div>

          <div
            style={{
              color: C.textDim,
              fontSize: 12,
              lineHeight: 1.7,
              marginBottom: 18,
            }}
          >
            {response?.mode === "library"
              ? `The analysis used ${
                  response.papersAnalyzed ?? 0
                } selected library paper(s).`
              : "No usable abstract evidence was available from the selected papers. Treat these results as exploratory suggestions, not verified literature gaps."}
          </div>

          {response?.scoreDescription && (
            <div
              style={{
                color: C.textDim,
                fontSize: 12,
                lineHeight: 1.6,
                padding: 12,
                borderRadius: 9,
                background: `${C.accent}0c`,
                marginBottom: 22,
              }}
            >
              <strong style={{ color: C.text }}>Scoring: </strong>
              {response.scoreDescription}
            </div>
          )}

          {/* Individual gap cards */}
          <div style={{ display: "grid", gap: 14 }}>
            {gaps.map((g, i) => {
              const score = Math.max(
                0,
                Math.min(100, Number(g.gap_score) || 0)
              );

              const confidence = (
                g.confidence || "low"
              ).toLowerCase();

              const color = gapColors[i % gapColors.length];

              return (
                <div
                  key={`${g.area || "gap"}-${i}`}
                  style={{
                    padding: 18,
                    borderRadius: 12,
                    background: C.card,
                    border: `1px solid ${C.border}`,
                  }}
                >
                  {/* Title and score */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 12,
                      flexWrap: "wrap",
                      marginBottom: 12,
                    }}
                  >
                    <div
                      style={{
                        color: C.text,
                        fontSize: 14,
                        fontWeight: 600,
                        flex: "1 1 200px",
                        lineHeight: 1.6,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                        <span
                          style={{
                            color: C.textDim,
                            fontSize: 11,
                          }}
                        >
                          {String(i + 1).padStart(2, "0")}
                        </span>

                        {g.isHypothesis ? (
                          <span
                            style={{
                              background: "rgba(245, 158, 11, 0.15)",
                              color: "#f59e0b",
                              border: "1px solid rgba(245, 158, 11, 0.35)",
                              borderRadius: 6,
                              padding: "2px 8px",
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: 0.5,
                              textTransform: "uppercase",
                            }}
                          >
                            🧪 Hypothesis {g.distinctPaperCount ? `(${g.distinctPaperCount} source)` : "(Unverified)"}
                          </span>
                        ) : (
                          <span
                            style={{
                              background: "rgba(16, 185, 129, 0.15)",
                              color: "#10b981",
                              border: "1px solid rgba(16, 185, 129, 0.35)",
                              borderRadius: 6,
                              padding: "2px 8px",
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: 0.5,
                              textTransform: "uppercase",
                            }}
                          >
                            ✓ Grounded ({g.distinctPaperCount || 2}+ distinct papers)
                          </span>
                        )}
                      </div>

                      <div>{g.area || "Potential research gap"}</div>
                    </div>

                    <div
                      style={{
                        color,
                        fontSize: 12,
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {score}/100 priority
                    </div>
                  </div>

                  {/* Priority bar */}
                  <div
                    style={{
                      height: 5,
                      borderRadius: 5,
                      background: C.muted,
                      overflow: "hidden",
                      marginBottom: 14,
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${score}%`,
                        borderRadius: 5,
                        background: `linear-gradient(90deg, ${color}, ${color}88)`,
                        transition: "width 0.7s ease",
                      }}
                    />
                  </div>

                  {/* Reason */}
                  <div
                    style={{
                      color: C.textDim,
                      fontSize: 12,
                      lineHeight: 1.8,
                      marginBottom: 14,
                    }}
                  >
                    {g.reason || "No additional explanation was returned."}
                  </div>

                  {/* Confidence */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                      marginBottom: 14,
                    }}
                  >
                    <span
                      style={{
                        color: C.textDim,
                        fontSize: 11,
                      }}
                    >
                      Confidence
                    </span>

                    <span
                      style={{
                        color: confidenceColor(confidence),
                        background: `${confidenceColor(confidence)}18`,
                        border: `1px solid ${confidenceColor(confidence)}40`,
                        borderRadius: 6,
                        padding: "4px 8px",
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: "uppercase",
                      }}
                    >
                      {confidence}
                    </span>
                  </div>

                  {/* Grounded Evidence Details or Supporting papers */}
                  {Array.isArray(g.evidenceDetails) && g.evidenceDetails.length > 0 ? (
                    <div
                      style={{
                        borderTop: `1px solid ${C.border}`,
                        paddingTop: 12,
                      }}
                    >
                      <div
                        style={{
                          color: C.text,
                          fontSize: 11,
                          fontWeight: 600,
                          marginBottom: 8,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: 6,
                        }}
                      >
                        <span>Cross-Paper Grounding Evidence ({g.evidenceDetails.length} citation{g.evidenceDetails.length === 1 ? "" : "s"})</span>
                        <span style={{ fontSize: 10, color: C.textDim, fontWeight: 400 }}>
                          {g.distinctPaperCount || new Set(g.evidenceDetails.map((d) => d.paperId)).size} distinct papers cited
                        </span>
                      </div>

                      <div style={{ display: "grid", gap: 8 }}>
                        {g.evidenceDetails.map((detail, dIdx) => (
                          <div
                            key={`${detail.paperId || dIdx}-${detail.page}-${dIdx}`}
                            style={{
                              background: C.muted,
                              border: `1px solid ${C.border}`,
                              borderRadius: 8,
                              padding: "8px 10px",
                              fontSize: 11,
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 8 }}>
                              <span style={{ fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {detail.title || "Paper"}
                              </span>
                              <span style={{
                                background: `${C.accent}20`,
                                color: C.accent,
                                borderRadius: 4,
                                padding: "1px 6px",
                                fontSize: 10,
                                fontWeight: 700,
                                flexShrink: 0,
                              }}>
                                {Number.isInteger(Number(detail.page)) && Number(detail.page) > 0
                                  ? `Page ${detail.page}`
                                  : "Abstract"}
                              </span>
                            </div>
                            {detail.claim && (
                              <div style={{ color: C.textDim, fontStyle: "italic", lineHeight: 1.5 }}>
                                &ldquo;{detail.claim}&rdquo;
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : Array.isArray(g.evidence) && g.evidence.length > 0 ? (
                    <div
                      style={{
                        borderTop: `1px solid ${C.border}`,
                        paddingTop: 12,
                      }}
                    >
                      <div
                        style={{
                          color: C.text,
                          fontSize: 11,
                          fontWeight: 600,
                          marginBottom: 8,
                        }}
                      >
                        Supporting papers
                      </div>

                      {g.evidence.map((paper, index) => (
                        <div
                          key={`${paper}-${index}`}
                          style={{
                            color: C.textDim,
                            fontSize: 11,
                            lineHeight: 1.7,
                            marginBottom: 5,
                            overflowWrap: "anywhere",
                          }}
                        >
                          <span style={{ color: C.accent }}>↳</span>{" "}
                          {paper}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      style={{
                        color: C.textDim,
                        fontSize: 11,
                        fontStyle: "italic",
                      }}
                    >
                      No supporting paper evidence was returned for this gap.
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div
            style={{
              color: C.textDim,
              fontSize: 11,
              lineHeight: 1.7,
              marginTop: 18,
            }}
          >
            Priority scores and confidence are AI-generated estimates.
            Paper titles provide context; they do not independently prove
            that a research gap is unexplored.
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && gaps.length === 0 && (
        <div
          style={{
            background: C.glass,
            border: `1px dashed ${C.border}`,
            borderRadius: 16,
            padding: 30,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 10 }}>⌕</div>

          <div
            style={{
              color: C.text,
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            Explore a research landscape
          </div>

          <div
            style={{
              color: C.textDim,
              fontSize: 12,
              lineHeight: 1.7,
            }}
          >
            Choose a topic, optionally select library papers, and
            generate your first set of potential research gaps.
          </div>
        </div>
      )}
    </div>
  );
}


function SlidesPage() {
  const C = useTheme();
  const [papers, setPapers] = useState([]);
  const [selectedPaper, setSelectedPaper] = useState(null);
  const [style, setStyle] = useState(null);
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { apiFetch("/api/papers").then(r => r.json()).then(setPapers); }, []);

  const styles = [
    { id: "academic", icon: "🎓", label: "Academic", desc: "Formal conference-ready slides" },
    { id: "pitch", icon: "🚀", label: "Pitch", desc: "Concise, executive summary" },
    { id: "eli5", icon: "🧒", label: "ELI5", desc: "Explain like I'm 5" },
    { id: "thread", icon: "🐦", label: "Twitter Thread", desc: "Tweetable key insights" },
  ];

  const generate = async () => {
    if (!selectedPaper || !style) return;
    setLoading(true); setResult("");
    try {
      const res = await apiFetch("/api/slides", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paperId: selectedPaper.id, style }) });
      const data = await res.json();
      setResult(data.slides || data.error);
    } catch (e) { setResult("Error: " + e.message); }
    setLoading(false);
  };

  return (
    <div>
      <div style={{ color: C.textDim, fontSize: 13, marginBottom: 20 }}>Select a paper and a presentation style to auto-generate slides.</div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: C.textDim, fontSize: 12, marginBottom: 8 }}>Select a paper</div>
        <select onChange={e => setSelectedPaper(papers.find(p => p.id === e.target.value))} style={{ width: "100%", padding: "12px 16px", borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, color: C.text, fontSize: 13, outline: "none", cursor: "pointer" }}>
          <option value="">-- Choose a paper --</option>
          {papers.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 24 }}>
        {styles.map(s => (
          <div key={s.id} onClick={() => setStyle(s.id)} style={{ background: style === s.id ? `${C.accent}18` : C.glass, backdropFilter: "blur(12px)", border: `2px solid ${style === s.id ? C.accent : C.border}`, borderRadius: 12, padding: "18px 20px", cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontSize: 28 }}>{s.icon}</span>
            <div>
              <div style={{ color: style === s.id ? C.accent : C.text, fontWeight: 600, marginBottom: 2 }}>{s.label}</div>
              <div style={{ color: C.textDim, fontSize: 12 }}>{s.desc}</div>
            </div>
          </div>
        ))}
      </div>
      <button onClick={generate} disabled={!selectedPaper || !style || loading} style={{ width: "100%", padding: "13px", borderRadius: 12, marginBottom: 24, background: selectedPaper && style ? `linear-gradient(90deg, ${C.accent}, ${C.accent2})` : C.muted, border: "none", color: "#fff", fontSize: 14, fontWeight: 700, cursor: selectedPaper && style ? "pointer" : "not-allowed" }}>{loading ? "Generating presentation..." : "▣ Generate Presentation"}</button>
      {result && (
        <div style={{ background: C.glass, backdropFilter: "blur(12px)", border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ color: C.accent, fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>{styles.find(s => s.id === style)?.icon} {styles.find(s => s.id === style)?.label} Presentation</div>
            <button onClick={() => navigator.clipboard.writeText(result)} style={{ padding: "5px 14px", borderRadius: 8, fontSize: 12, background: `${C.accent}20`, border: `1px solid ${C.accent}44`, color: C.accent, cursor: "pointer" }}>📋 Copy</button>
          </div>
          <pre style={{ color: C.text, fontSize: 13, lineHeight: 1.8, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>{result}</pre>
        </div>
      )}
      {loading && <div style={{ background: C.glass, backdropFilter: "blur(12px)", border: `1px solid ${C.border}`, borderRadius: 16, padding: 40, textAlign: "center" }}><div style={{ color: C.textDim, fontSize: 14 }}>Generating your presentation...</div></div>}
    </div>
  );
}

const PAGES = { graph: GraphPage, library: LibraryPage, search: SearchPage,
  similarity: SimilarityPage,recommendations: RecommendationsPage, debate: DebatePage, gaps: GapsPage, slides: SlidesPage };

export default function App() {
  const [page, setPage] = useState("graph");
  const [showAddPaper, setShowAddPaper] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [themeName, setThemeName] = useState("Dark");
  const theme = THEMES[themeName];
  const Page = PAGES[page];

  return (
    <ThemeCtx.Provider value={theme}>
      <SignedOut>
        <div style={{
          background: theme.bg, minHeight: "100vh", display: "flex",
          alignItems: "center", justifyContent: "center",
          fontFamily: "'Inter', 'Segoe UI', sans-serif",
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14, margin: "0 auto 16px",
              background: `linear-gradient(135deg, ${theme.accent}, ${theme.accent2})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28, fontWeight: 700, color: "#fff",
            }}>N</div>
            <div style={{ color: theme.text, fontWeight: 700, fontSize: 28, marginBottom: 8 }}>NEXUS</div>
            <div style={{ color: theme.textDim, fontSize: 15, marginBottom: 32 }}>Research Intelligence Platform</div>
            <SignInButton mode="modal">
              <button style={{
                padding: "12px 32px", borderRadius: 12,
                background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent2})`,
                border: "none", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer",
              }}>Sign in to Nexus</button>
            </SignInButton>
          </div>
        </div>
      </SignedOut>
      <SignedIn>
        <div style={{ background: theme.bg, minHeight: "100vh", fontFamily: "'Inter', 'Segoe UI', sans-serif", color: theme.text }}>
          <Sidebar active={page} setActive={setPage} />
          <div style={{ marginLeft: 220 }}>
            <Topbar page={page} onAddPaper={() => setShowAddPaper(true)} onSettings={() => setShowSettings(true)} />
            <main style={{ padding: "28px 32px", maxWidth: 1100 }}>
              <Page />
            </main>
          </div>
          {showAddPaper && <AddPaperModal onClose={() => setShowAddPaper(false)} onAdded={() => { }} />}
          {showSettings && <SettingsModal onClose={() => setShowSettings(false)} theme={themeName} setTheme={t => { setThemeName(t); setShowSettings(false); }} />}
        </div>
      </SignedIn>
    </ThemeCtx.Provider>
  );
}
