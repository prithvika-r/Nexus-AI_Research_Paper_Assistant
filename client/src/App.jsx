import { useState, useEffect, useRef, createContext, useContext } from "react";
import * as d3 from "d3";
import { SignedIn, SignedOut, SignInButton, UserButton, useUser } from "@clerk/clerk-react";

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
  { id: "library", icon: "⊞", label: "Library" },
  { id: "search", icon: "⌕", label: "Search Papers" },
  { id: "similarity", icon: "🔗", label: "Similar Papers" },
  { id: "recommendations", icon: "🎯", label: "Recommendations" },
  { id: "debate", icon: "⚖", label: "AI Debate" },
  { id: "gaps", icon: "◎", label: "Research Gaps" },
  { id: "slides", icon: "▣", label: "Presentations" },
];

// ---- Reusable Components ----
function Tag({ label, color }) {
  return (
    <span style={{
      padding: "3px 10px", borderRadius: 20, fontSize: 11,
      background: color + "22", border: `1px solid ${color}44`, color,
    }}>{label}</span>
  );
}

function StatCard({ label, value, color }) {
  const C = useTheme();
  return (
    <div style={{ background: C.glass, backdropFilter: "blur(12px)", border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px", flex: 1, minWidth: 140 }}>
      <div style={{ color: C.textDim, fontSize: 12, marginBottom: 6 }}>{label}</div>
      <div style={{ color: color || C.accent, fontSize: 28, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function PaperCard({ title, authors, year, tags, cited, abstract }) {
  const C = useTheme();
  const [hovered, setHov] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    try {
      await fetch("http://localhost:5000/api/papers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, authors, year, abstract, source: "search" }),
      });
      setSaved(true);
    } catch (e) { console.error(e); }
  };

  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} style={{
      background: C.glass, backdropFilter: "blur(12px)", border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "18px 20px", transition: "all 0.2s", cursor: "pointer",
      boxShadow: hovered ? `0 0 0 1px ${C.accent}55, 0 8px 32px rgba(79,110,247,0.12)` : "none",
      transform: hovered ? "translateY(-2px)" : "none",
    }}>
      <div style={{ color: C.text, fontWeight: 600, fontSize: 14, marginBottom: 6, lineHeight: 1.4 }}>{title}</div>
      <div style={{ color: C.textDim, fontSize: 12, marginBottom: 10 }}>{authors} · {year}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {tags.map(t => <Tag key={t.l} label={t.l} color={t.c} />)}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ color: C.textDim, fontSize: 11 }}>📎 {cited} citations</div>
        <button onClick={handleSave} style={{
          padding: "4px 12px", borderRadius: 20, fontSize: 11,
          background: saved ? "rgba(5,150,105,0.2)" : `${C.accent}20`,
          border: `1px solid ${saved ? "#059669" : C.accent}`,
          color: saved ? "#059669" : C.accent, cursor: "pointer",
        }}>{saved ? "✓ Saved" : "+ Save"}</button>
      </div>
    </div>
  );
}

function ChatPanel({ paper, onClose }) {
  const C = useTheme();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async () => {
    if (!input.trim()) return;
    const question = input;
    setInput("");
    setMessages(m => [...m, { role: "user", text: question }]);
    setLoading(true);
    try {
      const res = await fetch("http://localhost:5000/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperId: paper.id, question }),
      });
      const data = await res.json();
      setMessages(m => [...m, { role: "ai", text: data.answer || data.error }]);
    } catch (e) {
      setMessages(m => [...m, { role: "ai", text: "Error contacting server." }]);
    }
    setLoading(false);
  };

  return (
    <div style={{
      position: "fixed", right: 0, top: 0, bottom: 0, width: 380,
      background: C.surface, borderLeft: `1px solid ${C.border}`,
      display: "flex", flexDirection: "column", zIndex: 200,
    }}>
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>Chat with Paper</div>
          <div style={{ color: C.textDim, fontSize: 11, marginTop: 2 }}>{paper.title?.slice(0, 40)}...</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.textDim, fontSize: 20, cursor: "pointer" }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.length === 0 && <div style={{ color: C.textDim, fontSize: 13, textAlign: "center", marginTop: 40 }}>Ask anything about this paper</div>}
        {messages.map((m, i) => (
          <div key={i} style={{
            padding: "10px 14px", borderRadius: 10, fontSize: 13, lineHeight: 1.5,
            background: m.role === "user" ? `${C.accent}20` : C.card,
            color: C.text, alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "85%", border: `1px solid ${m.role === "user" ? C.accent + "44" : C.border}`,
          }}>{m.text}</div>
        ))}
        {loading && <div style={{ color: C.textDim, fontSize: 12 }}>Thinking...</div>}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: 16, borderTop: `1px solid ${C.border}`, display: "flex", gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Ask a question..."
          style={{ flex: 1, padding: "10px 14px", borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, color: C.text, fontSize: 13, outline: "none" }} />
        <button onClick={send} style={{
          padding: "10px 16px", borderRadius: 8,
          background: `linear-gradient(90deg, ${C.accent}, ${C.accent2})`,
          border: "none", color: "#fff", fontWeight: 600, cursor: "pointer",
        }}>→</button>
      </div>
    </div>
  );
}

// ---- Modals ----
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
      const res = await fetch("http://localhost:5000/api/upload", { method: "POST", body: formData });
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
    fetch("http://localhost:5000/api/papers")
      .then((r) => r.json())
      .then(setPapers)
      .catch((e) => console.error(e));
  }, []);

  // Analyze similarity
  const analyzeSimilarity = async () => {
    if (!selectedPaper) return;
    setLoading(true);
    try {
      const res = await fetch("http://localhost:5000/api/similarity", {
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
    fetch("http://localhost:5000/api/papers").then(r => r.json()).then(setPapers);
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
      const res = await fetch("http://localhost:5000/api/recommendations", {
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
      await fetch("http://localhost:5000/api/papers", {
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
      await fetch(`http://localhost:5000/api/papers/${paperId}/read`, {
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
  const fileRef = useRef(null);

  const loadPapers = () => {
    fetch("http://localhost:5000/api/papers")
      .then(r => r.json()).then(d => { setPapers(d); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(() => { loadPapers(); }, []);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("pdf", file);
    try {
      const res = await fetch("http://localhost:5000/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.success) loadPapers(); else alert("Upload failed: " + data.error);
    } catch (e) { alert("Upload error: " + e.message); }
    setUploading(false);
  };

  const toggleRead = async (p) => {
    await fetch(`http://localhost:5000/api/papers/${p.id}/read`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_read: !p.is_read }),
    });
    loadPapers();
  };

  const deletePaper = async (id) => {
    if (!confirm("Delete this paper?")) return;
    await fetch(`http://localhost:5000/api/papers/${id}`, { method: "DELETE" });
    loadPapers();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <StatCard label="Saved" value={papers.length} />
          <StatCard label="Read" value={papers.filter(p => p.is_read).length} color="#059669" />
          <StatCard label="Unread" value={papers.filter(p => !p.is_read).length} color="#d97706" />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={handleUpload} />
          <button onClick={() => fileRef.current.click()} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 12, background: `linear-gradient(90deg, ${C.accent}, ${C.accent2})`, border: "none", color: "#fff", fontWeight: 600, cursor: "pointer" }}>{uploading ? "Uploading..." : "⬆ Upload PDF"}</button>
          {["grid", "list"].map(v => (
            <button key={v} onClick={() => setView(v)} style={{ padding: "6px 14px", borderRadius: 8, fontSize: 12, background: view === v ? `${C.accent}20` : C.card, border: `1px solid ${view === v ? C.accent : C.border}`, color: view === v ? C.accent : C.textDim, cursor: "pointer" }}>{v === "grid" ? "⊞ Grid" : "☰ List"}</button>
          ))}
        </div>
      </div>
      {loading && <div style={{ color: C.textDim }}>Loading...</div>}
      <div style={{ display: "grid", gridTemplateColumns: view === "grid" ? "repeat(auto-fill, minmax(280px, 1fr))" : "1fr", gap: 14 }}>
        {papers.map((p, i) => (
          <div key={i} style={{ background: C.glass, backdropFilter: "blur(12px)", border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px", opacity: p.is_read ? 0.75 : 1 }}>
            <div style={{ color: C.text, fontWeight: 600, fontSize: 14, marginBottom: 6, lineHeight: 1.4 }}>{p.title}</div>
            <div style={{ color: C.textDim, fontSize: 12, marginBottom: 10 }}>{Array.isArray(p.authors) ? p.authors.join(", ") : p.authors || "Unknown"} · {p.year}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              <Tag label={p.source || "saved"} color={C.accent} />
              {p.is_read && <Tag label="✓ Read" color="#059669" />}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {p.full_text && (
                <button onClick={() => setChatPaper(p)} style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, background: `${C.accent2}20`, border: `1px solid ${C.accent2}44`, color: C.accent2, cursor: "pointer" }}>💬 Chat</button>
              )}
              <button onClick={() => toggleRead(p)} style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, background: p.is_read ? "rgba(5,150,105,0.2)" : `${C.accent}20`, border: `1px solid ${p.is_read ? "#05966944" : C.accent + "44"}`, color: p.is_read ? "#059669" : C.accent, cursor: "pointer" }}>{p.is_read ? "✓ Read" : "Mark Read"}</button>
              <button onClick={() => deletePaper(p.id)} style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, background: "rgba(225,29,72,0.12)", border: "1px solid #e11d4844", color: "#e11d48", cursor: "pointer" }}>🗑 Delete</button>
            </div>
          </div>
        ))}
      </div>
      {!loading && papers.length === 0 && <div style={{ color: C.textDim, textAlign: "center", marginTop: 60 }}>No papers saved yet. Search for papers or upload a PDF.</div>}
      {chatPaper && <ChatPanel paper={chatPaper} onClose={() => setChatPaper(null)} />}
    </div>
  );
}

function SearchPage() {
  const C = useTheme();
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const search = async () => {
    if (!q) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("http://localhost:5000/api/search?q=" + encodeURIComponent(q));
      const data = await res.json();
      if (data.error) setError(data.error); else setResults(data.data || []);
    } catch (e) { setError("Something went wrong"); }
    setLoading(false);
  };

  return (
    <div>
      <div style={{ position: "relative", marginBottom: 28 }}>
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && search()}
          placeholder="Search across 200M+ papers via Semantic Scholar..."
          style={{ width: "100%", padding: "14px 20px 14px 46px", borderRadius: 12, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box" }} />
        <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: C.textDim, fontSize: 18 }}>⌕</span>
        <button onClick={search} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", padding: "7px 18px", borderRadius: 8, background: `linear-gradient(90deg, ${C.accent}, ${C.accent2})`, border: "none", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Search</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 28 }}>
        {["Large Language Models", "Diffusion Models", "Graph Neural Networks", "RLHF"].map(t => (
          <button key={t} onClick={() => setQ(t)} style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, background: C.card, border: `1px solid ${C.border}`, color: C.textDim, cursor: "pointer" }}>{t}</button>
        ))}
      </div>
      {loading && <div style={{ color: C.textDim }}>Searching...</div>}
      {error && <div style={{ color: "#e11d48", marginBottom: 16 }}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
        {results.map((p, i) => (
          <PaperCard key={i} title={p.title} authors={p.authors?.map(a => a.name).join(", ")} year={p.year} tags={[{ l: "Research", c: C.accent }]} cited={p.citationCount || 0} abstract={p.abstract} />
        ))}
      </div>
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

  useEffect(() => { fetch("http://localhost:5000/api/papers").then(r => r.json()).then(setPapers); }, []);

  const modes = [
    { id: "defend", icon: "🛡", label: "Defend", desc: "Steelman the paper's claims" },
    { id: "challenge", icon: "⚔", label: "Challenge", desc: "Critique methodology & assumptions" },
    { id: "devils_advocate", icon: "😈", label: "Devil's Advocate", desc: "Find the strongest counter-arguments" },
  ];

  const startDebate = async () => {
    if (!selectedPaper || !mode) return;
    setLoading(true); setResult("");
    try {
      const res = await fetch("http://localhost:5000/api/debate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paperId: selectedPaper.id, mode }) });
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
  const [gaps, setGaps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const topics = ["NLP", "Computer Vision", "Reinforcement Learning", "Interpretability", "Multimodal AI", "Large Language Models"];

  const generateGaps = async () => {
    setLoading(true); setError(""); setGaps([]);
    try {
      const res = await fetch("http://localhost:5000/api/gaps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic }) });
      const data = await res.json();
      if (data.error) setError(data.error); else setGaps(data.gaps || []);
    } catch (e) { setError("Error: " + e.message); }
    setLoading(false);
  };

  const gapColors = [C.accent, C.accent2, "#e11d48", "#059669", "#d97706"];

  return (
    <div>
      <div style={{ color: C.textDim, fontSize: 13, marginBottom: 20 }}>Select a research area and AI will identify underexplored questions and gaps.</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {topics.map(t => (
          <button key={t} onClick={() => setTopic(t)} style={{ padding: "8px 16px", borderRadius: 20, fontSize: 13, background: topic === t ? `${C.accent}20` : C.card, border: `1px solid ${topic === t ? C.accent : C.border}`, color: topic === t ? C.accent : C.textDim, cursor: "pointer" }}>{t}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
        <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="Or type a custom topic..." style={{ flex: 1, padding: "10px 16px", borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, color: C.text, fontSize: 13, outline: "none" }} />
        <button onClick={generateGaps} disabled={loading} style={{ padding: "10px 24px", borderRadius: 10, background: `linear-gradient(90deg, ${C.accent}, ${C.accent2})`, border: "none", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>{loading ? "Analyzing..." : "◎ Generate Gaps"}</button>
      </div>
      {error && <div style={{ color: "#e11d48", marginBottom: 16 }}>{error}</div>}
      {gaps.length > 0 && (
        <div style={{ background: C.glass, backdropFilter: "blur(12px)", border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, marginBottom: 20 }}>
          <div style={{ color: C.text, fontWeight: 600, marginBottom: 20 }}>Research Gap Radar — {topic}</div>
          {gaps.map((g, i) => (
            <div key={i} style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ color: C.text, fontSize: 13, fontWeight: 500 }}>{g.area}</span>
                <span style={{ color: gapColors[i % gapColors.length], fontSize: 12, fontWeight: 600 }}>{g.gap_score}% gap</span>
              </div>
              <div style={{ height: 6, borderRadius: 4, background: C.muted, overflow: "hidden", marginBottom: 4 }}>
                <div style={{ height: "100%", width: g.gap_score + "%", borderRadius: 4, background: `linear-gradient(90deg, ${gapColors[i % gapColors.length]}, ${gapColors[i % gapColors.length]}88)`, transition: "width 1s ease" }} />
              </div>
              <div style={{ color: C.textDim, fontSize: 12 }}>{g.reason}</div>
            </div>
          ))}
        </div>
      )}
      {loading && <div style={{ background: C.glass, backdropFilter: "blur(12px)", border: `1px solid ${C.border}`, borderRadius: 16, padding: 40, textAlign: "center" }}><div style={{ color: C.textDim, fontSize: 14 }}>Analyzing research landscape...</div></div>}
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

  useEffect(() => { fetch("http://localhost:5000/api/papers").then(r => r.json()).then(setPapers); }, []);

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
      const res = await fetch("http://localhost:5000/api/slides", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paperId: selectedPaper.id, style }) });
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