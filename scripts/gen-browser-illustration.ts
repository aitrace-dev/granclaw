import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

async function generateIllustration() {
  const prompt = `Generate an image: A minimal, modern illustration showing a stylized browser window with a padlock and a cursor arrow.
The browser has three small colored dots at top-left (window chrome), a clean address bar, and inside there's a subtle glowing "login" concept — maybe a key icon or shield.
Style: flat minimalist vector, dark background #12131a, with glowing accent lines in electric purple (#7c3aed) and teal (#2dd4bf).
Thin outlines, geometric, no text, no realistic shadows.
Clean SaaS product illustration aesthetic, similar to Linear or Vercel empty states.
Square aspect ratio. Centered composition. Lots of negative space.
The mood should feel like "secure, connected, ready to go".`;

  console.log("Generating browser illustration...");

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-image-preview",
    contents: prompt,
    config: {
      responseModalities: ["image", "text"],
    },
  });

  if (response.candidates?.[0]) {
    for (const part of response.candidates[0].content?.parts || []) {
      if (part.inlineData) {
        const outputPath = "packages/frontend/public/browser-onboarding.png";
        fs.writeFileSync(outputPath, Buffer.from(part.inlineData.data!, "base64"));
        console.log(`Saved to ${outputPath}`);
        return;
      }
    }
  }
  console.error("No image in response");
}

generateIllustration().catch(console.error);
