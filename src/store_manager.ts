/**
 * @fileoverview File Search Store Management Script
 *
 * Creates or retrieves a File Search Store, uploads agent capabilities as text data
 * avoiding duplicates, lists all stores/documents, and provides interactive deletion.
 */

import { GoogleGenAI } from "@google/genai";
import { AGENT_REGISTRY } from "./agentbank.ts";
import { Buffer } from "buffer";
import * as readline from "readline";

// Initialize the GoogleGenAI client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Helper function to fetch all File Search Stores.
 * Reused across initialization, listing, and interactive deletion.
 */
async function getAllStores(): Promise<any[]> {
  let allStores: any[] = [];
  let pageToken: string | undefined = undefined;
  const pageSize = 100;

  do {
    const response: any = await (ai.fileSearchStores.list as any)({
      config: { pageSize, pageToken },
    }).catch(async () => {
      return await (ai.fileSearchStores.list as any)({
        page_size: pageSize,
        page_token: pageToken,
      });
    });

    let page = response.page || response.fileSearchStores || response;
    if (Array.isArray(page)) {
      allStores.push(...page);
    }

    while (response.hasNextPage && response.hasNextPage()) {
      const nextRes = await response.nextPage();
      let nextPage = nextRes.page || nextRes.fileSearchStores || nextRes;
      if (Array.isArray(nextPage)) allStores.push(...nextPage);
    }
    pageToken = response.nextPageToken;
  } while (pageToken);

  return allStores;
}

/**
 * 1. [Upload] Creates (or retrieves) a File Search Store and uploads agent information while avoiding duplicates.
 * @param existingStoreName If specified, uses this store. Otherwise, it checks the environment variable or looks for "SubAgentsStore".
 */
export async function initializeAgentStore(existingStoreName?: string) {
  let storeName = existingStoreName || process.env.AGENT_BANK;

  console.log("Fetching all active stores to validate availability...");
  try {
    const allStores = await getAllStores();

    // 1. Validate if the storeName from environment variable actually exists in the active list
    if (storeName) {
      const isValid = allStores.some((s: any) => s.name === storeName);
      if (!isValid) {
        console.warn(
          `\n[Warning] Store '${storeName}' (from env) is not in the active stores list. It may have been deleted.`,
        );
        console.log("Ignoring the invalid store ID...\n");
        storeName = undefined; // Reset to trigger creation or search
      }
    }

    // 2. If no valid store name is provided, search for an existing "SubAgentsStore" by display name
    if (!storeName) {
      console.log("Checking for an existing 'SubAgentsStore' by name...");
      const foundStore = allStores.find(
        (s: any) => s.displayName === "SubAgentsStore",
      );
      if (foundStore && foundStore.name) {
        storeName = foundStore.name;
        console.log(`Found existing store: ${storeName}`);
      }
    }
  } catch (error: any) {
    console.warn(`Failed to validate existing stores: ${error.message}`);
  }

  // 3. If the store still doesn't exist, create a new one
  if (!storeName) {
    console.log("Creating a new File Search Store...");
    const store = await ai.fileSearchStores.create({
      config: { displayName: "SubAgentsStore" },
    });

    if (!store.name) {
      throw new Error(
        "Failed to create File Search Store: store.name is undefined.",
      );
    }
    storeName = store.name;
    console.log(`Store created successfully: ${storeName}`);
  } else {
    console.log(`Using File Search Store: ${storeName}`);
  }

  // Fetch information of already uploaded agents (documents) to prevent duplicates
  const existingAgentNames = new Set<string>();
  console.log("Fetching existing documents to check for duplicates...");

  try {
    let allDocuments: any[] = [];
    let docPageToken: string | undefined = undefined;
    const pageSize = 100;

    do {
      const response: any = await (ai.fileSearchStores.documents.list as any)({
        fileSearchStoreName: storeName,
        config: { pageSize, pageToken: docPageToken },
      }).catch(async () => {
        return await (ai.fileSearchStores.documents.list as any)({
          parent: storeName!,
          page_size: pageSize,
          page_token: docPageToken,
        });
      });

      let page = response.page || response.documents || response;
      if (Array.isArray(page)) {
        allDocuments.push(...page);
      }

      while (response.hasNextPage && response.hasNextPage()) {
        const nextRes = await response.nextPage();
        let nextPage = nextRes.page || nextRes.documents || nextRes;
        if (Array.isArray(nextPage)) allDocuments.push(...nextPage);
      }
      docPageToken = response.nextPageToken;
    } while (docPageToken);

    for (const doc of allDocuments) {
      if (doc.customMetadata) {
        // Extract agent_name from customMetadata
        const agentNameMeta = doc.customMetadata.find(
          (m: any) => m.key === "agent_name",
        );
        if (agentNameMeta && agentNameMeta.stringValue) {
          existingAgentNames.add(agentNameMeta.stringValue);
        }
      }
    }

    if (existingAgentNames.size > 0) {
      console.log(
        `Found ${existingAgentNames.size} existing agent(s):`,
        Array.from(existingAgentNames),
      );
    } else {
      console.log("No existing agents found in this store.");
    }
  } catch (docErr: any) {
    console.warn(
      `Could not fetch documents or no documents found. Proceeding with an empty existing list. Error: ${docErr.message}`,
    );
  }

  let uploadedCount = 0;

  for (const [key, agentFactory] of Object.entries(AGENT_REGISTRY)) {
    // Duplicate check
    if (existingAgentNames.has(key)) {
      console.log(
        `Skipping upload for agent: ${key} (already exists in the store)`,
      );
      continue;
    }

    const agent = agentFactory();

    const textContent = `AgentKey: ${key}
Name: ${(agent as any).name}
Description: ${(agent as any).description}
Instruction: ${(agent as any).instruction}`;

    const buffer = Buffer.from(textContent, "utf8");
    const blob = new Blob([buffer], { type: "text/plain" });

    console.log(`Uploading data for agent: ${key}...`);
    let operation = await ai.fileSearchStores.uploadToFileSearchStore({
      file: blob,
      fileSearchStoreName: storeName,
      config: {
        displayName: `${key}_info.txt`,
        mimeType: "text/plain",
        customMetadata: [{ key: "agent_name", stringValue: key }],
      },
    });

    while (!operation.done) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      operation = await ai.operations.get({ operation });
    }
    console.log(`Upload complete for ${key}. Document name: ${operation.name}`);
    uploadedCount++;
  }

  // Update the environment variable for the current process
  process.env.AGENT_BANK = storeName;

  console.log("-------------------------------------------------");
  if (uploadedCount === 0) {
    console.log(
      "No new agents to upload. All agents are already in the store.",
    );
  } else {
    console.log(
      `Upload process completed successfully. Uploaded ${uploadedCount} new agent(s).`,
    );
  }

  console.log("\n[Environment Variable Setup]");
  console.log("The store name has been registered to process.env.AGENT_BANK.");
  console.log("To apply this to your current terminal session, run:");
  console.log(`  export AGENT_BANK="${storeName}"\n`);
  console.log("To make it permanent across sessions (e.g., in bash), run:");
  console.log(`  echo 'export AGENT_BANK="${storeName}"' >> ~/.bashrc`);
  console.log(`  source ~/.bashrc`);
  console.log("-------------------------------------------------");

  return storeName;
}

/**
 * 2. [List] Displays all File Search Stores and their documents.
 */
export async function listAllStoresAndDocuments() {
  console.log("Fetching all File Search Stores...\n");

  try {
    const allStores = await getAllStores();

    if (allStores.length === 0) {
      console.log("No File Search Stores found.");
      return;
    }

    for (const store of allStores) {
      if (!store.name) continue;

      const storeName = store.name;
      const displayName = store.displayName || "N/A";

      console.log(`📦 Store Name  : ${storeName}`);
      console.log(`   Display Name: ${displayName}`);

      let allDocuments: any[] = [];
      let docPageToken: string | undefined = undefined;
      const pageSize = 100;

      try {
        do {
          const response: any = await (
            ai.fileSearchStores.documents.list as any
          )({
            fileSearchStoreName: storeName,
            config: { pageSize, pageToken: docPageToken },
          }).catch(async () => {
            return await (ai.fileSearchStores.documents.list as any)({
              parent: storeName,
              page_size: pageSize,
              page_token: docPageToken,
            });
          });

          let page = response.page || response.documents || response;
          if (Array.isArray(page)) {
            allDocuments.push(...page);
          }

          while (response.hasNextPage && response.hasNextPage()) {
            const nextRes = await response.nextPage();
            let nextPage = nextRes.page || nextRes.documents || nextRes;
            if (Array.isArray(nextPage)) allDocuments.push(...nextPage);
          }
          docPageToken = response.nextPageToken;
        } while (docPageToken);

        if (allDocuments.length === 0) {
          console.log("  -> No documents found in this store.");
        } else {
          for (const doc of allDocuments) {
            console.log(
              `  📄 Document: ${doc.name} (Display: ${doc.displayName || "N/A"})`,
            );
            console.log(`     CustomMetadata:`, doc.customMetadata || "N/A");
          }
        }
      } catch (docErr: any) {
        console.error(`  -> Failed to fetch documents: ${docErr.message}`);
      }
      console.log("-------------------------------------------------");
    }
  } catch (error: any) {
    console.error("Error listing stores and documents:", error.message);
  }
}

/**
 * 3. [Delete] Deletes a specific document.
 * @param documentName (e.g., "fileSearchStores/.../documents/...")
 */
export async function deleteAgentDocument(documentName: string) {
  console.log(`Deleting document: ${documentName}`);
  await ai.fileSearchStores.documents.delete({
    name: documentName,
    config: { force: true },
  });
  console.log(`Document ${documentName} deleted.`);
}

/**
 * 4. [Delete] Deletes the entire File Search Store.
 * @param storeName (e.g., "fileSearchStores/...")
 */
export async function deleteAgentStore(storeName: string) {
  console.log(`Deleting store: ${storeName}`);
  await ai.fileSearchStores.delete({
    name: storeName,
    config: { force: true },
  });
  console.log(`Store ${storeName} deleted successfully.`);
}

/**
 * 5. [Interactive Delete] Fetches all stores and allows the user to dynamically select multiple stores for deletion.
 */
export async function interactiveDeleteStores() {
  console.log("Fetching existing File Search Stores for deletion...\n");
  const allStores = await getAllStores();

  if (allStores.length === 0) {
    console.log("No File Search Stores found to delete.");
    return;
  }

  console.log("Available Stores:");
  allStores.forEach((store, index) => {
    // Add a marker if the store is currently set in the environment variable
    const isCurrentEnv = store.name === process.env.AGENT_BANK;
    const marker = isCurrentEnv ? " (Current ENV)" : "";

    console.log(
      `${index + 1}. ${store.name} (Display Name: ${store.displayName || "N/A"})${marker}`,
    );
  });
  console.log("0. Cancel");

  // Create a readline interface to get user input from the terminal
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = (query: string): Promise<string> => {
    return new Promise((resolve) => rl.question(query, resolve));
  };

  const answer = await askQuestion(
    "\nSelect the stores to delete by entering their numbers separated by commas (e.g., 1,3), or 0 to cancel: ",
  );
  rl.close();

  const selections = answer
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");

  if (selections.includes("0")) {
    console.log("Deletion canceled.");
    return;
  }

  const storesToDelete: any[] = [];
  for (const sel of selections) {
    const num = parseInt(sel, 10);
    // Validate the input number
    if (!isNaN(num) && num > 0 && num <= allStores.length) {
      storesToDelete.push(allStores[num - 1]);
    } else {
      console.log(`Warning: Invalid selection '${sel}'. Skipping.`);
    }
  }

  if (storesToDelete.length === 0) {
    console.log("No valid stores were selected for deletion.");
    return;
  }

  console.log(
    `\nYou have selected ${storesToDelete.length} store(s) to delete.`,
  );

  for (const store of storesToDelete) {
    try {
      await deleteAgentStore(store.name);

      // Check if the deleted store was the one currently exported in the terminal
      if (store.name === process.env.AGENT_BANK) {
        delete process.env.AGENT_BANK;
        console.log(
          `\n[Notice] You deleted the store currently set in AGENT_BANK.`,
        );
        console.log(`The variable has been cleared in this Node process.`);
        console.log(
          `Please run the following command to clear it from your active terminal session:`,
        );
        console.log(`  unset AGENT_BANK\n`);
      }
    } catch (error: any) {
      console.error(`Failed to delete ${store.name}: ${error.message}`);
    }
  }

  console.log("Deletion process completed.");
}

// ==========================================
// Execution script with CLI Argument Routing
// ==========================================

async function main() {
  // Get the first argument passed after the script name (e.g., 'upload', 'list', 'delete')
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "upload":
      await initializeAgentStore();
      break;

    case "list":
      await listAllStoresAndDocuments();
      break;

    case "delete":
      await interactiveDeleteStores();
      break;

    default:
      console.log("=========================================");
      console.log("Invalid or missing command.");
      console.log("Usage:");
      console.log(
        "  npm run registorAgents      (or 'npx tsx src/store_manager.ts upload')",
      );
      console.log(
        "  npm run registoredAgentList (or 'npx tsx src/store_manager.ts list')",
      );
      console.log(
        "  npm run deleteStores        (or 'npx tsx src/store_manager.ts delete')",
      );
      console.log("=========================================");
      break;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
