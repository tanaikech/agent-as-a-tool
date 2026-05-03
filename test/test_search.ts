/**
 * @fileoverview File Search Store Test Script
 *
 * Tests semantic search against the uploaded agent data in the File Search Store.
 */

import { GoogleGenAI } from "@google/genai";

async function testSearchStore() {
  // 1. Check environment variables
  const storeName = process.env.AGENT_BANK;
  if (!storeName) {
    console.error("Error: AGENT_BANK environment variable is not set.");
    console.error(
      "Please run the store_manager.ts to create a store and set the environment variable.",
    );
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Test task (search prompt)
  // This is a prompt assuming weather and exchange rate agents are registered.
  const prompt = `Based on the attached file store, search for the most relevant expert agents for the following task:
  "I want to know the current exchange rate from USD to JPY, and also need to check the weather in Tokyo."
  
  Please extract and return the "AgentKey" and Name for the matching agents, and a brief explanation of why they are suitable.`;

  //   const prompt = `Based on the attached file store, search for the most relevant expert agents for the following task:
  // "I want to run Google Apps Script directly in the local."

  // Please extract and return the "AgentKey" and Name for the matching agents, and a brief explanation of why they are suitable.

  // If the export agents cannot be found in the attached file store, return "no agents".`;

  console.log(`Target Store Name: ${storeName}`);
  console.log(`Prompt:\n${prompt}\n`);
  console.log("Searching... Please wait.");

  try {
    // 2. Call generateContent using the File Search tool
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", // or gemini-2.5-flash
      contents: prompt,
      config: {
        tools: [{ fileSearch: { fileSearchStoreNames: [storeName] } }],
      },
    });

    // 3. Output the generated response
    console.log("================ Response ================");
    console.log(response.text);
    console.log("==========================================");

    // 4. Check and output Grounding Metadata (sources)
    // Display which text files were hit during the search
    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
    if (groundingMetadata && groundingMetadata.groundingChunks) {
      console.log("\n[Sources Retrieved from Store]");
      const sources = new Set<string>();

      groundingMetadata.groundingChunks.forEach((chunk) => {
        const title = chunk.retrievedContext?.title;
        if (title) sources.add(title);
      });

      sources.forEach((source) => console.log(`- ${source}`));
    } else {
      console.log("\n[Note] No grounding metadata/sources returned.");
    }
  } catch (error) {
    console.error("Test execution failed:", error);
  }
}

testSearchStore();
