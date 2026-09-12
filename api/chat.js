import { getCachedGeminiModel, setCachedGeminiModel } from "./_lib/store.js";

// Powers the customer-facing chat assistant using Google's Gemini API,
// which has a genuinely free tier (get a key at aistudio.google.com — no
// credit card needed to start). Free tiers come with rate limits (requests
// per minute/day) that can change over time, so if this widget goes quiet
// during a traffic spike, that's almost certainly why — check your quota
// in Google AI Studio.
//
// Web search here is DuckDuckGo's free, keyless "Instant Answer" API — it
// costs nothing and needs no signup, but it's meaningfully weaker than a
// real search engine (mostly returns encyclopedia-style summary snippets,
// not full web results). Good enough for general facts, not guaranteed to
// find something obscure or very current. If that turns out to matter,
// Brave Search's API has historically had a small free-query tier as a
// stronger (but signup-required) upgrade path — worth checking their
// current terms if you get there.
const DUCKDUCKGO_URL = "https://api.duckduckgo.com/";

// Google occasionally renames/retires model IDs, which is exactly what
// broke this once already (gemini-2.0-flash returned a 404). Rather than
// commit to a single guessed name, this returns an ORDERED SHORTLIST of
// candidates — the actual call site below tries each one for real and
// uses whichever one genuinely works, which also self-corrects for a case
// we hit in testing: a model can appear in the list-models catalog yet
// still 404 on the actual generation call (likely a free-tier access
// restriction on newer model generations, not a naming issue at all).
// Cached at module scope so a warm function instance only re-resolves
// once it needs to, not on every single chat message.
let cachedModel = null;

async function candidateModels(forceRefresh = false) {
  if (process.env.GEMINI_MODEL) return [process.env.GEMINI_MODEL]; // explicit override always wins, no fallback list
  if (!forceRefresh) {
    if (cachedModel) return [cachedModel];

    // Check persistent storage before making ANY live API call — this is
    // what actually fixes repeated rate-limiting: once any request, from any
    // server instance, ever discovers a working model, every future request
    // (even after a cold start) can skip discovery entirely and go straight
    // to a single real call, instead of re-running list-models + trying
    // several candidates every time the function cold-starts.
    const persisted = await getCachedGeminiModel();
    if (persisted) {
      cachedModel = persisted;
      return [persisted];
    }
  }

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
    if (!res.ok) throw new Error(`list models failed: ${res.status}`);
    const data = await res.json();
    const models = (data.models || []).filter((m) => m.supportedGenerationMethods?.includes("generateContent"));

    const names = models.map((m) => (m.name || "").replace("models/", "")).filter(Boolean);

    // Order matters: older, longer-established "flash" generations tend to
    // stay free-tier-accessible the longest, so try those before newer
    // ones that may require billing. Exclude narrow specialist variants
    // (vision-only, embedding, tts, image-gen) and raw experimental/
    // preview snapshots, which tend to be unstable or short-lived.
    const usable = names.filter((n) => !/vision|embedding|tts|image|thinking|exp|preview/.test(n));
    const flashOld = usable.filter((n) => n.includes("flash") && /1\.5/.test(n));
    const flashOther = usable.filter((n) => n.includes("flash") && !flashOld.includes(n));
    const rest = usable.filter((n) => !flashOld.includes(n) && !flashOther.includes(n));

    const ordered = [...flashOld, ...flashOther, ...rest];
    if (ordered.length === 0) throw new Error("no usable model found in catalog");
    return ordered.slice(0, 3); // try at most 3 before giving up — each attempt burns real quota, and a free-tier limit is often only a handful of requests per minute
  } catch (err) {
    console.error("Model auto-discovery failed, falling back to guesses:", err);
    return ["gemini-1.5-flash", "gemini-flash-latest", "gemini-2.0-flash"]; // last-resort guesses if even listing models fails
  }
}



async function duckDuckGoSearch(query) {
  try {
    const url = `${DUCKDUCKGO_URL}?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url);
    if (!res.ok) return "Search failed — no results available.";
    const data = await res.json();
    const parts = [];
    if (data.AbstractText) parts.push(data.AbstractText);
    if (Array.isArray(data.RelatedTopics)) {
      for (const t of data.RelatedTopics.slice(0, 5)) {
        if (t.Text) parts.push(t.Text);
      }
    }
    return parts.length > 0 ? parts.join("\n") : "No summary found for this query — answer from general knowledge instead, and say you weren't able to confirm it with a live search.";
  } catch (err) {
    console.error("DuckDuckGo search error:", err);
    return "Search failed — answer from general knowledge instead, and say you weren't able to confirm it with a live search.";
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "Chat assistant is not configured yet. Set GEMINI_API_KEY in environment variables." });
  }

  const { messages, reportType, formSnapshot } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Missing messages." });
  }

  // Keep the conversation bounded — this is a form-filling helper, not an
  // open-ended chat product. Also keeps free-tier usage in check.
  const trimmedMessages = messages.slice(-20);

  const reportLabel = reportType === "cma" ? "CMA / Working Capital" : "Project Report (DPR / PMEGP / MUDRA / MSME)";

  const systemPrompt = `You are a friendly, patient assistant embedded in Oshin Capital's report-generation portal (compliance.oshin-capital.com). The person you're helping is filling in a ${reportLabel} — many of them are first-time entrepreneurs with no finance background, so avoid jargon unless you explain it plainly.

Your job:
- Explain what any field means and why the bank wants it, in simple language.
- Help them figure out realistic numbers for their specific business (use web_search for current facts — don't guess or make up numbers. Note: your search tool is limited, and may not find an answer — if so, say so honestly rather than presenting a guess as fact).
- Before proposing any numbers, get at least a rough sense of expected sales/revenue AND the main cost drivers (staff count and rough wages, main materials) — a couple of quick questions, not a long interview. Don't jump straight from "I want to start a bakery" to filling in specific rupee figures with no revenue or cost context at all.
- Before calling propose_form_updates with cost/revenue numbers, sanity-check them yourself: rough total costs (wages + materials + overheads + admin) should leave a plausible margin against revenue, not exceed it. If the numbers you're about to propose would show the business losing money every year, that's a sign you're guessing rather than reasoning from what the person told you — ask a clarifying question instead of proposing numbers that don't work. It's fine for a real business to be tight on margin, but don't hand someone a report that's mathematically guaranteed to show a loss because of a rushed guess.
- When you have enough information to fill in specific fields, use the propose_form_updates tool to suggest exact values — the person will see and approve each one before anything is actually filled in, so it's fine to propose partial or tentative values as a starting point they can adjust.
- Keep replies short — a few sentences, not a long structured breakdown with many headers and bullet points. If you're listing multiple issues or fields, pick the 2-3 most important ones rather than being exhaustive; the person can always ask for more detail.
- Never fabricate PMEGP/MUDRA/MSME scheme rules — if you're not certain, search for it rather than guessing, since this affects a real loan application. If your search doesn't turn up a clear answer, say you're not certain rather than stating it as fact.
- You cannot see what's currently in their form beyond what's given to you below. If something seems already filled in, don't ask about it again.

Current form snapshot (may be partial or empty):
${JSON.stringify(formSnapshot || {}, null, 2)}`;

  const tools = [
    {
      functionDeclarations: [
        {
          name: "web_search",
          description: "Search the web for a current fact. Limited quality — may not find an answer, especially for obscure or very current queries.",
          parameters: { type: "OBJECT", properties: { query: { type: "STRING" } }, required: ["query"] },
        },
        {
          name: "propose_form_updates",
          description: "Suggest values to fill into the report form. Only include fields you have a genuine, reasoned value for — omit anything you're not ready to suggest yet.",
          parameters: {
            type: "OBJECT",
            properties: {
              entrepreneur: {
                type: "OBJECT",
                properties: {
                  name: { type: "STRING" }, business: { type: "STRING" }, address: { type: "STRING" },
                  mobile: { type: "STRING" }, email: { type: "STRING" }, pan: { type: "STRING" }, udyamNo: { type: "STRING" },
                },
              },
              capex: {
                type: "OBJECT",
                description: "One-time setup costs in rupees (NOT machinery — that's addMachinery)",
                properties: { land: { type: "NUMBER" }, workshed: { type: "NUMBER" }, furniture: { type: "NUMBER" }, preliminary: { type: "NUMBER" }, contingency: { type: "NUMBER" } },
              },
              addMachinery: {
                type: "ARRAY", description: "New machinery/equipment line items to add",
                items: { type: "OBJECT", properties: { name: { type: "STRING" }, qty: { type: "NUMBER" }, rate: { type: "NUMBER" } }, required: ["name"] },
              },
              finance: {
                type: "OBJECT",
                properties: { ownPct: { type: "NUMBER" }, interestRate: { type: "NUMBER" }, tenureYears: { type: "NUMBER" } },
              },
              addProducts: {
                type: "ARRAY", description: "New products/services to sell, at 100% capacity",
                items: { type: "OBJECT", properties: { name: { type: "STRING" }, qty: { type: "NUMBER" }, rate: { type: "NUMBER" } }, required: ["name"] },
              },
              capacityUtil: { type: "ARRAY", description: "Exactly 5 numbers — % capacity utilization for years 1-5", items: { type: "NUMBER" } },
              addRawMaterials: {
                type: "ARRAY", items: { type: "OBJECT", properties: { name: { type: "STRING" }, qty: { type: "NUMBER" }, rate: { type: "NUMBER" } }, required: ["name"] },
              },
              addWages: {
                type: "ARRAY", description: "New wage roles",
                items: { type: "OBJECT", properties: { name: { type: "STRING" }, workers: { type: "NUMBER" }, perMonth: { type: "NUMBER" } }, required: ["name"] },
              },
              opex: {
                type: "OBJECT", description: "Other manufacturing expenses per year",
                properties: { repairs: { type: "NUMBER" }, power: { type: "NUMBER" }, otherOverhead: { type: "NUMBER" } },
              },
              admin: {
                type: "OBJECT", description: "Administrative expenses per year",
                properties: { salary: { type: "NUMBER" }, telephone: { type: "NUMBER" }, stationery: { type: "NUMBER" }, advertisement: { type: "NUMBER" }, workshedRent: { type: "NUMBER" }, misc: { type: "NUMBER" } },
              },
              depRate: { type: "NUMBER", description: "Depreciation rate % (WDV method)" },
              details: {
                type: "OBJECT",
                properties: { employment: { type: "NUMBER" }, powerRequirement: { type: "STRING" }, implementationMonths: { type: "NUMBER" }, payBackYears: { type: "NUMBER" }, place: { type: "STRING" } },
              },
              narrative: {
                type: "OBJECT", description: "Free-text sections — leave blank to use the auto-drafted default",
                properties: { introduction: { type: "STRING" }, aboutPromoter: { type: "STRING" } },
              },
            },
          },
        },
      ],
    },
  ];

  // Gemini uses "model" for the assistant role, not "assistant", and wraps
  // text in a parts array.
  let contents = trimmedMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  let candidates = await candidateModels();

  const callGemini = (modelName) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        tools,
        generationConfig: { maxOutputTokens: 2048 },
      }),
    });

  try {
    let finalText = "";
    let proposedUpdates = null;
    let model = null; // locked in once a candidate actually succeeds

    // Bounded tool loop: the model can call web_search, get a result, and
    // respond again — up to a few rounds, so a confused loop can't run away
    // and burn through free-tier quota unbounded.
    for (let round = 0; round < 4; round++) {
      let response;

      if (model) {
        // Already know which model works for this key — use it directly.
        response = await callGemini(model);
      } else {
        // First call of the conversation: actually try each candidate for
        // real (not just trust the list-models catalog) until one returns
        // something other than 404. This is what catches a model that's
        // *listed* as available but still isn't reachable on this key's
        // access tier — the exact situation that kept breaking this before.
        let lastErrText = "";
        for (const candidate of candidates) {
          response = await callGemini(candidate);
          if (response.status !== 404) {
            model = candidate;
            cachedModel = candidate; // in-memory for this instance...
            setCachedGeminiModel(candidate).catch(() => {}); // ...and persisted so future cold starts skip discovery entirely
            break;
          }
          lastErrText = await response.text().catch(() => "");
          console.error("Gemini candidate model rejected (404):", candidate, lastErrText);
        }

        // The cached/persisted model has stopped working (likely retired) —
        // clear it and do one real discovery pass instead of failing
        // outright. Only worth doing when the failed attempt came from a
        // 1-item cached/persisted list, not from an already-exhaustive
        // fresh discovery (which would just fail the same way again).
        if (!model && candidates.length === 1 && !process.env.GEMINI_MODEL) {
          console.error("Cached model no longer works, forcing fresh discovery:", candidates[0]);
          cachedModel = null;
          candidates = await candidateModels(true);
          for (const candidate of candidates) {
            response = await callGemini(candidate);
            if (response.status !== 404) {
              model = candidate;
              cachedModel = candidate;
              setCachedGeminiModel(candidate).catch(() => {});
              break;
            }
            lastErrText = await response.text().catch(() => "");
          }
        }

        if (!model) {
          console.error("All candidate models failed:", candidates.join(", "), lastErrText);
          return res.status(502).json({ error: "The assistant couldn't find a working model on your Gemini account. Check that your API key has access to at least one Gemini model in Google AI Studio." });
        }
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        console.error("Gemini API error:", "model=" + model, response.status, errText);
        if (response.status === 429) {
          return res.status(429).json({ error: "The assistant hit its free-tier usage limit for a moment. Please wait about a minute and try again." });
        }
        if (response.status === 500 || response.status === 503) {
          return res.status(503).json({ error: "Google's assistant service is temporarily overloaded. Please try again in a few seconds." });
        }
        return res.status(502).json({ error: "The assistant is having trouble responding right now. Please try again." });
      }

      const data = await response.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      const textPart = parts.find((p) => p.text)?.text;
      const functionCall = parts.find((p) => p.functionCall)?.functionCall;

      if (textPart) finalText += (finalText ? "\n\n" : "") + textPart;

      if (!functionCall) break; // model gave a plain answer — done

      if (functionCall.name === "propose_form_updates") {
        proposedUpdates = functionCall.args || null;
        break; // proposing updates ends the turn — no need to continue the loop
      }

      if (functionCall.name === "web_search") {
        const result = await duckDuckGoSearch(functionCall.args?.query || "");
        // Feed the model's own call and our function's result back in, so
        // it can incorporate the search result into its next reply.
        contents = [
          ...contents,
          { role: "model", parts: [{ functionCall }] },
          { role: "user", parts: [{ functionResponse: { name: "web_search", response: { result } } }] },
        ];
        continue;
      }

      break; // unknown function — stop rather than loop forever
    }

    res.status(200).json({ reply: finalText.trim(), proposedUpdates });
  } catch (err) {
    console.error("Chat handler error:", err);
    res.status(500).json({ error: "Something went wrong reaching the assistant. Please try again." });
  }
}
