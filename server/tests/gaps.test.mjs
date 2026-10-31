import "dotenv/config";

async function inspectAllGaps() {
  const API_URL = process.env.API_URL || "http://localhost:5000/api/gaps";
  console.log(`Connecting to ${API_URL}...`);

  try {
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "Software testing and automation",
        paperIds: [
          "487f9384-bf86-47a5-b1c5-2f6cee995224",
          "699b0695-e2f6-4889-954b-f7a30fa0a8cf"
        ]
      })
    });

    const data = await resp.json();
    console.log("Status:", resp.status);
    console.log("Papers analyzed:", data.papersAnalyzed, "Mode:", data.mode);
    console.log(`Gaps count: ${data.gaps?.length}`);
    for (let i = 0; i < (data.gaps || []).length; i++) {
      const g = data.gaps[i];
      console.log(`\n[Gap ${i + 1}]`);
      console.log(`  Area: "${g.area}"`);
      console.log(`  Priority score: ${g.gap_score}`);
      console.log(`  Confidence: ${g.confidence}`);
      console.log(`  isHypothesis: ${g.isHypothesis}, isGrounded: ${g.isGrounded}`);
      console.log(`  distinctPaperCount: ${g.distinctPaperCount}`);
      console.log(`  Evidence titles:`, g.evidence);
      console.log(`  Reason:`, g.reason);
    }

    // Also test Exploration Mode (no paperIds)
    console.log("\n===========================================");
    console.log("--- TEST 2: Exploration mode (no paperIds) ---");
    const resp2 = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "Quantum Computing Algorithms",
        paperIds: []
      })
    });
    const data2 = await resp2.json();
    console.log("Exploration status:", resp2.status);
    console.log(`Exploration gaps count: ${data2.gaps?.length}`);
    for (let i = 0; i < (data2.gaps || []).length; i++) {
      const g = data2.gaps[i];
      console.log(`  [Gap ${i + 1}] "${g.area}" (isHypothesis: ${g.isHypothesis}, distinctPaperCount: ${g.distinctPaperCount})`);
    }
  } catch (err) {
    console.log("Note: Server not reachable or mock error:", err.message);
  }
}

inspectAllGaps().catch(console.error);
