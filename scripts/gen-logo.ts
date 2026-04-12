import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

async function generateLogo() {
  const prompt = `Generate an image: A minimal, editorial logo for "GranClaw" — an AI multi-agent framework.
The design should feature three bold diagonal claw slash marks arranged as a claw strike, combined with very subtle geometric node/dot connection lines between them (like ink circuit traces on paper).
Color palette: warm cream/paper background (#fef9ef), claw marks in a deep sophisticated violet-blue (#5d39e0), with thin charcoal outlines (#1d1c16) for definition.
The aesthetic is "ink on paper" — sharp, precise, flat — not neon or glowing. Think editorial design, scholarly, premium.
No text in the image. Square aspect ratio. Minimal, iconic, clean negative space.
The claw marks should have clean straight edges — like a stamp pressed into paper — not rounded or brushed.`;

  console.log("Generating GranClaw logo (Scholarly Sanctuary palette)...");

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
        const imageData = Buffer.from(part.inlineData.data!, "base64");

        const destinations = [
          "packages/frontend/public/granclaw-logo.png",
          "assets/granclaw-logo.png",
          "landing/public/images/granclaw-logo.png",
        ];

        for (const dest of destinations) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, imageData);
          console.log(`Saved to ${dest}`);
        }
        return;
      }
    }
  }
  console.error("No image in response");
}

generateLogo().catch(console.error);
