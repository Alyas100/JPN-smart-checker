const GEMINI_MODEL = import.meta.env.GEMINI_MODEL ?? "gemini-2.5-flash";

/**
 * Low-level call to the Gemini generateContent endpoint.
 *
 * `parts` is an array of Gemini "part" objects, e.g.:
 *   { text: 'some prompt text' }
 *   { inline_data: { mime_type: 'image/png', data: '<base64>' } }
 *
 * Mirrors the working curl:
 *   curl ".../models/gemini-2.5-flash:generateContent" -H "x-goog-api-key: ..."
 */
export async function callGemini(parts, { jsonOnly = true, signal } = {}) {
  const geminiKey = import.meta.env.GEMINI_API_KEY;

  if (!geminiKey) {
    throw new Error("Missing GEMINI_API_KEY. Set it in your .env file.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: jsonOnly
          ? { temperature: 0.15, responseMimeType: "application/json" }
          : { temperature: 0.15 },
      }),
      signal,
    },
  );

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(
      `Gemini request failed (${response.status}): ${errBody.slice(0, 300)}`,
    );
  }

  const payload = await response.json();
  const rawText =
    payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("") ?? "";

  console.log("[Gemini raw response]", rawText);

  // Strip markdown code-fences in case the model wraps its JSON anyway.
  return rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}
