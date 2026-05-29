import { GoogleGenerativeAI } from "@google/generative-ai";
import { GeminiAnalysis } from "./types";

function getClient(apiKey: string) {
  return new GoogleGenerativeAI(apiKey);
}

export async function analyzePreacherImage(
  imageBase64: string,
  mimeType: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg",
  apiKey?: string
): Promise<GeminiAnalysis> {
  const key = apiKey || process.env.GEMINI_API_KEY || "";
  if (!key) throw new Error("No Gemini API key provided");

  const model = getClient(key).getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `Analyze this image of a preacher/speaker.

Determine which direction the person's face/body is primarily oriented:
- "left"   = facing/looking toward the LEFT side of the image
- "right"  = facing/looking toward the RIGHT side of the image
- "center" = facing directly toward the camera

Respond ONLY with this exact JSON (no other text):
{
  "faceDirection": "left" | "right" | "center",
  "confidence": <number 0-100>,
  "description": "<one sentence>"
}`;

  const result = await model.generateContent([
    prompt,
    { inlineData: { mimeType, data: imageBase64 } },
  ]);

  const text = result.response.text().trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Unexpected Gemini response: ${text.slice(0, 120)}`);

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    faceDirection: parsed.faceDirection || "center",
    confidence:    parsed.confidence    || 50,
    description:   parsed.description   || "",
  };
}
