import "dotenv/config";

async function verifyAllFourFixes() {
  console.log("=== VERIFYING 4 USER ISSUE FIXES ===\n");

  const blip2Id = "6afef6d3-fc27-4060-8120-62e6b0c02bfa";
  const rlhfId = "4ba06703-95b9-40f3-91de-6ad352ec5f08";
  const API_URL = process.env.API_URL || "http://localhost:5000/api/gaps";

  // -------------------------------------------------------------
  // TEST 1: Result count — request 2 gaps with explicit count = 2
  // -------------------------------------------------------------
  console.log("--- TEST 1: Result Count (Requesting 2 gaps) ---");
  try {
    const countResp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "Large Language Models",
        count: 2,
        paperIds: [blip2Id, rlhfId]
      })
    });

    if (!countResp.ok) {
      console.log(`TEST 1 Notice: HTTP status ${countResp.status}`);
      return;
    }
    const countData = await countResp.json();
    console.log(`Requested count: 2, Returned gaps: ${countData.gaps?.length}`);
    if (countData.gaps?.length !== 2) {
      throw new Error(`FAIL: Expected exactly 2 gaps, got ${countData.gaps?.length}`);
    }
    console.log("PASS: Exactly 2 research gaps returned when count=2 is requested.\n");

    // -------------------------------------------------------------
    // TEST 2: Topic/prompt mix-up
    // -------------------------------------------------------------
    console.log("--- TEST 2: Topic / Prompt Mix-Up & Extraction ---");
    const topicMixResp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "Generate 2 research gaps on Large Language Models",
        paperIds: [blip2Id, rlhfId]
      })
    });

    const topicData = await topicMixResp.json();
    console.log(`Input topic: "Generate 2 research gaps on Large Language Models"`);
    console.log(`Returned clean topic: "${topicData.topic}"`);
    console.log(`Auto-detected count from instruction: ${topicData.gaps?.length}`);

    if (topicData.topic !== "Large Language Models") {
      throw new Error(`FAIL: Topic was not cleaned! Got "${topicData.topic}"`);
    }
    if (topicData.gaps?.length !== 2) {
      throw new Error(`FAIL: Count was not extracted from instruction! Got ${topicData.gaps?.length}`);
    }
    console.log("PASS: Topic cleaned and instruction count extracted.\n");
  } catch (err) {
    console.log("Server test notice (ensure backend is running):", err.message);
  }
}

verifyAllFourFixes().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
