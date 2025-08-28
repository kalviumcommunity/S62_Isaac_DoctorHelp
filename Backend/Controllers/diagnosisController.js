// controllers/diagnosisController.js
/**
 * DoctorHelp — Clinical suggestion generator (NOT a medical device)
 * - Inputs: symptoms/caseNotes + optional demographics
 * - Output: strictly structured JSON (differential + tests + citations)
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// You can switch to a higher-quality model for critical use:
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

/** ---- (Optional) plug in your RAG layer here ----
 * Replace this stub with a real PubMed / vector search.
 * Return: [{ id, title, snippet, url }]
 */
async function fetchEvidence(query) {
  // TODO: call your vector DB or PubMed API here.
  return [
    // Example stub (keep short; prompt budget matters)
    // { id: "PMID:12345", title: "Acute cough in adults", snippet: "Red flags: dyspnea, hypoxia...", url: "https://..." }
  ];
}

// Basic schema guard (lightweight; swap for AJV if you prefer)
function validateDiagnosisJson(obj) {
  const ok =
    obj &&
    Array.isArray(obj.diagnoses) &&
    obj.diagnoses.every(
      (d) =>
        d &&
        typeof d.name === "string" &&
        typeof d.probability === "number" &&
        d.probability >= 0 &&
        d.probability <= 1
    ) &&
    (!obj.recommendations || Array.isArray(obj.recommendations));
  return { ok, errors: ok ? null : "Invalid schema" };
}

const generateClinicalSuggestions = async (req, res) => {
  try {
    const {
      caseNotes,         // free-text HPI/ROS/Exam/etc.
      symptoms,          // optional short list/string
      age,
      sex,
      allergies,
      medications,
      duration,
      // sampling controls (optional; forwarded to model)
      temperature,
      topP,
      topK,
      stopSequences,
      // dynamic options
      maxContextChars = 8000,
      useRag = true
    } = req.body;

    if (!(caseNotes || symptoms)) {
      return res.status(400).json({
        success: false,
        message: "Provide caseNotes or symptoms",
      });
    }
    // ✅ ZERO-SHOT
    
    // const prompt = `
    // Provide decision-support for this clinical description:
    // "${caseNotes || symptoms}"

    // Respond ONLY as JSON:
    // {
    //   "diagnoses": [
    //     { "name": "Dx", "probability": 0.0, "reasoning": "why", "recommended_tests": ["..."], "citations": ["PMID/DOI/URL"] }
    //   ],
    //   "recommendations": ["general next steps"]
    // }`;

    // ✅ ONE-SHOT
    // const prompt = `
    // Input:
    // Age: 45 | Sex: M
    // Case: chest pain on exertion, no fever
    // Output(JSON only):
    // { "diagnoses":[{"name":"Stable angina","probability":0.6,"reasoning":"...", "recommended_tests":["ECG","Troponin"],"citations":[]},{"name":"GERD","probability":0.2,"reasoning":"...","recommended_tests":["PPI trial"],"citations":[]}], "recommendations":["Assess risk factors"] }

    // Now follow the same JSON format for:
    // Age: ${age ?? "?"} | Sex: ${sex ?? "?"}
    // Case: ${caseNotes || symptoms}
    // Output(JSON only):
    // `;

    // ✅ MULTI-SHOT
    const prompt = `
    Example 1
    Input: Age 6 | Sex: F | Case: fever + sore throat
    Output(JSON only): { "diagnoses":[{"name":"Strep pharyngitis","probability":0.5,"reasoning":"...","recommended_tests":["Rapid strep"]},{"name":"Viral URI","probability":0.4,"reasoning":"...","recommended_tests":["Supportive"]}], "recommendations":["Centor score"] }

    Example 2
    Input: Age 70 | Sex: M | Case: acute unilateral leg swelling
    Output(JSON only): { "diagnoses":[{"name":"DVT","probability":0.6,"reasoning":"...","recommended_tests":["D-dimer","Ultrasound"]}], "recommendations":["Wells score"] }

    Now respond for:
    Age: ${age ?? "?"} | Sex: ${sex ?? "?"}
    Case: ${caseNotes || symptoms}
    Output(JSON only):
    `;

    // ✅ SYSTEM + USER (concatenate into one prompt — Gemini doesn’t have roles)
    // const system = `
    // You are DoctorHelp, a clinical decision-support assistant for licensed clinicians.
    // - Provide a prioritized differential (top 3) with brief reasoning.
    // - Recommend next diagnostic tests.
    // - Include citations when possible.
    // - Return ONLY JSON with fields: diagnoses[], recommendations[].
    // - Do NOT provide definitive diagnoses; this is not a medical device.
    // `;
    // const user = `Age: ${age ?? "?"} | Sex: ${sex ?? "?"}
    // Allergies: ${allergies ?? "Unknown"} | Meds: ${medications ?? "Not listed"} | Duration: ${duration ?? "Unstated"}
    // Case: ${caseNotes || symptoms}
    // Output(JSON only):`;
    // const prompt = `${system}\n\n${user}`;
    

    // // ✅ DYNAMIC PROMPTING (+ optional RAG)
    let contextBits = [];
    if (age) contextBits.push(`Age: ${age}`);
    if (sex) contextBits.push(`Sex: ${sex}`);
    if (allergies) contextBits.push(`Allergies: ${allergies}`);
    if (medications) contextBits.push(`Medications: ${medications}`);
    if (duration) contextBits.push(`Duration: ${duration}`);

    const clinicalHeader = contextBits.length ? contextBits.join(" | ") : "No demographics provided";
    const baseCase = (caseNotes || symptoms || "").slice(0, maxContextChars);

    let citationsBlock = "";
    let evidence = [];
    if (useRag) {
      evidence = await fetchEvidence(baseCase);
      if (evidence.length) {
        const items = evidence
          .slice(0, 5)
          .map((d, i) => `-${i + 1}. ${d.id}: ${d.title}\n  ${d.snippet}`)
          .join("\n");
        citationsBlock = `\nRelevant evidence snippets:\n${items}\n`;
      }
    }

//     const prompt = `
// You are DoctorHelp, a clinical decision-support assistant for licensed clinicians.
// Follow these rules:
// - Provide a prioritized differential (top 3) with probabilities (0-1) and short reasoning.
// - Recommend focused next diagnostic tests.
// - Include citations array with identifiers (PMID/DOI/URL) if available.
// - Return ONLY valid JSON (no markdown fences, no extra text).

// Patient/context:
// ${clinicalHeader}

// Case notes:
// ${baseCase}

// ${citationsBlock}

// JSON schema to follow:
// {
//   "diagnoses": [
//     { "name": "string", "probability": 0-1, "reasoning": "string",
//       "recommended_tests": ["string"], "citations": ["string"] }
//   ],
//   "recommendations": ["string"]
// }

// Now respond with JSON only:
// `;

    // ==========================================================
    // SAMPLING CONTROLS (Temperature / Top-P / Top-K / Stop)
    // ==========================================================
    const generationConfig = {
      // Sensible defaults for clinical determinism:
      temperature: typeof temperature === "number" ? temperature : 0.1,
      topP: typeof topP === "number" ? topP : 0.95,
      topK: typeof topK === "number" ? topK : 40,
      stopSequences: Array.isArray(stopSequences) ? stopSequences : undefined,
      // Optionally constrain size:
      // maxOutputTokens: 800,
    };

    // ========= CALL GEMINI =========
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
    });
    const usage = result.response.usageMetadata;
    if (usage) {
      console.log("🔢 Token usage:");
      console.log(`   Input tokens: ${usage.promptTokenCount}`);
      console.log(`   Output tokens: ${usage.candidatesTokenCount}`);
      console.log(`   Total tokens: ${usage.totalTokenCount}`);
    } else {
      console.log("⚠️ No usage metadata available from Gemini response.");
    }
    let text = result.response.text() || "";

    // Strip markdown fences if the model disobeys
    text = text.replace(/```json|```/g, "").trim();

    // Try to extract a JSON block if extra text slipped in
    const match = text.match(/\{[\s\S]*\}$/);
    const candidate = match ? match[0] : text;

    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch (e) {
      console.error("JSON parse error. Raw model output:", text);
      return res.status(500).json({
        success: false,
        message: "Failed to parse model response as JSON",
        rawResponse: text,
      });
    }

    const { ok, errors } = validateDiagnosisJson(parsed);
    if (!ok) {
      return res.status(422).json({
        success: false,
        message: "Model JSON failed schema validation",
        errors,
        raw: parsed,
      });
    }

    // Attach RAG matches we showed to the model (for UI traceability)
    parsed._evidence = evidence;

    return res.status(200).json({ success: true, data: parsed });
  } catch (error) {
    console.error("DoctorHelp API Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { generateClinicalSuggestions };
