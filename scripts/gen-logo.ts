import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

async function generateLogo() {
  const prompt = `Generate an image: A minimal, modern logo for "GranClaw" — an AI multi-agent framework.
The design should feature a stylized claw mark (three diagonal slashes) combined with a subtle neural network / circuit pattern.
Use a dark background (#12131a) with glowing accent colors: electric purple (#7c3aed) and teal (#2dd4bf).
The claw marks should look sharp and precise, with a slight glow effect.
Clean, geometric, premium SaaS aesthetic. No text in the image.
Square aspect ratio, suitable for a GitHub repo logo. Minimal and iconic.`;

  console.log("Generating GranClaw logo...");

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
        const outputPath = "packages/frontend/public/granclaw-logo.png";
        fs.writeFileSync(outputPath, Buffer.from(part.inlineData.data!, "base64"));
        console.log(`Saved to ${outputPath}`);
        return;
      }
    }
  }
  console.error("No image in response");
}

generateLogo().catch(console.error);
