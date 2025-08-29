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
      temperature = 0.1, // Default to low temperature for clinical determinism
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
    
    // ✅ ZERO-SHOT (commented)
    /*
    const prompt = `
    Provide decision-support for this clinical description:
    "${caseNotes || symptoms}"

    Respond ONLY as JSON:
    {
      "diagnoses": [
        { "name": "Dx", "probability": 0.0, "reasoning": "why", "recommended_tests": ["..."], "citations": ["PMID/DOI/URL"] }
      ],
      "recommendations": ["general next steps"]
    }`;
    */

    // ✅ ONE-SHOT (commented)
    /*
    const prompt = `
    Input:
    Age: 45 | Sex: M
    Case: chest pain on exertion, no fever
    Output(JSON only):
    { "diagnoses":[{"name":"Stable angina","probability":0.6,"reasoning":"...", "recommended_tests":["ECG","Troponin"],"citations":[]},{"name":"GERD","probability":0.2,"reasoning":"...","recommended_tests":["PPI trial"],"citations":[]}], "recommendations":["Assess risk factors"] }

    Now follow the same JSON format for:
    Age: ${age ?? "?"} | Sex: ${sex ?? "?"}
    Case: ${caseNotes || symptoms}
    Output(JSON only):
    `;
    */

    // ✅ MULTI-SHOT (commented)
    /*
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
    */

    // ✅ SYSTEM + USER PROMPTING
    // RTFC Framework Implementation:
    // R - Role: Define the AI's role as a clinical decision-support assistant
    // T - Task: Provide prioritized differential diagnosis with probabilities and recommendations
    // F - Format: Strict JSON output with specific schema
    // C - Constraints: Not a medical device, for licensed clinicians only, include citations
    
    const system = `
You are DoctorHelp, a clinical decision-support assistant for licensed clinicians.
- ROLE: You are an AI assistant that provides clinical decision support, not definitive diagnoses
- TASK: Provide a prioritized differential diagnosis (top 3-5 conditions) with:
  * Probability estimates (0-1 scale)
  * Brief clinical reasoning for each condition
  * Recommended diagnostic tests to confirm/rule out each condition
  * Citations from medical literature when available
- FORMAT: Return ONLY valid JSON with this exact structure:
{
  "diagnoses": [
    { 
      "name": "string", 
      "probability": number (0-1), 
      "reasoning": "string",
      "recommended_tests": ["string"], 
      "citations": ["string"] 
    }
  ],
  "recommendations": ["string"]
}
- CONSTRAINTS:
  * This is not a medical device and cannot provide definitive diagnoses
  * For licensed healthcare professionals only
  * Always include probability estimates
  * Prioritize based on clinical likelihood and urgency
  * Include relevant risk factors from patient demographics
`;

    // Build user context with available information
    let contextBits = [];
    if (age) contextBits.push(`Age: ${age}`);
    if (sex) contextBits.push(`Sex: ${sex}`);
    if (allergies) contextBits.push(`Allergies: ${allergies}`);
    if (medications) contextBits.push(`Medications: ${medications}`);
    if (duration) contextBits.push(`Duration: ${duration}`);

    const clinicalHeader = contextBits.length ? contextBits.join(" | ") : "No demographics provided";
    const baseCase = (caseNotes || symptoms || "").slice(0, maxContextChars);

    // Add RAG evidence if enabled
    let citationsBlock = "";
    let evidence = [];
    if (useRag) {
      evidence = await fetchEvidence(baseCase);
      if (evidence.length) {
        citationsBlock = `\nRelevant clinical evidence to consider:\n`;
        evidence.slice(0, 3).forEach((item, index) => {
          citationsBlock += `${index + 1}. ${item.title}: ${item.snippet}\n`;
        });
      }
    }

    const user = `Patient Context:
${clinicalHeader}

Case Presentation:
${baseCase}

${citationsBlock}

Please provide your clinical analysis in the specified JSON format:`;

    // Combine system and user prompts (Gemini doesn't have native role support)
    const prompt = `${system}\n\n${user}`;

    // ✅ DYNAMIC PROMPTING (commented)
    /*
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

    const prompt = `
    You are DoctorHelp, a clinical decision-support assistant for licensed clinicians.
    Follow these rules:
    - Provide a prioritized differential (top 3) with probabilities (0-1) and short reasoning.
    - Recommend focused next diagnostic tests.
    - Include citations array with identifiers (PMID/DOI/URL) if available.
    - Return ONLY valid JSON (no markdown fences, no extra text).

    Patient/context:
    ${clinicalHeader}

    Case notes:
    ${baseCase}

    ${citationsBlock}

    JSON schema to follow:
    {
      "diagnoses": [
        { "name": "string", "probability": 0-1, "reasoning": "string",
          "recommended_tests": ["string"], "citations": ["string"] }
      ],
      "recommendations": ["string"]
    }

    Now respond with JSON only:
    `;
    */
    
    // ✅ CHAIN OF THOUGHT PROMPTING (commented)
    /*
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

    const prompt = `
You are DoctorHelp, a clinical decision-support assistant for licensed clinicians.
Follow these steps to analyze the case:

1. First, identify the key symptoms and findings from the case notes.
2. Consider the patient demographics and how they might affect differential diagnosis.
3. Generate a list of possible conditions that could explain these findings.
4. For each condition, assess its probability based on:
   - How well it explains the symptoms
   - Patient risk factors
   - Epidemiology
   - Any relevant evidence from literature
5. For the most likely conditions, recommend specific diagnostic tests to confirm or rule them out.
6. Finally, provide general recommendations for next steps.

After completing this reasoning process, output ONLY valid JSON with the following structure:
{
  "diagnoses": [
    { 
      "name": "string", 
      "probability": 0-1, 
      "reasoning": "string",
      "recommended_tests": ["string"], 
      "citations": ["string"] 
    }
  ],
  "recommendations": ["string"]
}

Patient/context:
${clinicalHeader}

Case notes:
${baseCase}

${citationsBlock}

Now think through this case step by step, then provide your final answer as JSON only:
`;
*/

    // ==========================================================
    // SAMPLING CONTROLS (Temperature / Top-P / Top-K / Stop)
    // ==========================================================
    const generationConfig = {
      // Clinical applications require low temperature (0.1) for determinism
      // This reduces hallucinations and increases reproducibility
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