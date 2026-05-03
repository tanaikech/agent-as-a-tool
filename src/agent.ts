/**
 * @fileoverview Dynamic Orchestrator consuming external Sub-Agents via Semantic Search.
 *
 * This module dynamically searches for available agents in a File Search Store,
 * and attaches selected agents to a Temporal Coordinator Agent.
 */

import { LlmAgent, FunctionTool, InMemoryRunner } from "@google/adk";
import { GoogleGenAI, createUserContent } from "@google/genai";
import { z } from "zod";

import { AGENT_REGISTRY } from "./agentbank.ts";

const DEFAULT_MODEL = "gemini-3-flash-preview";
const LOW_LATENCY_MODEL = "gemini-3.1-flash-lite-preview";

// ==========================================
// 0. Environment Variable Check
// ==========================================
if (!process.env.AGENT_BANK) {
  console.error(`
[ERROR] The AGENT_BANK environment variable is not set.

Before running the agent manager, you must set the AGENT_BANK environment variable.

- If you have already saved agents to a Store:
  Run 'npm run regAgentList' to check your available store names, 
  and then set it using:
  export AGENT_BANK="{store name}"

- If you haven't saved agents yet:
  Run 'npm run regAgents' to save the agents to a new Store, 
  and then set it using:
  export AGENT_BANK="{store name}"
`);
  process.exit(1);
}

// ==========================================
// 1. Semantic Search Tool
// ==========================================

/**
 * Searches the File Search Store to find relevant agents based on the user's task.
 */
const searchExpertAgentsTool = new FunctionTool({
  name: "search_expert_agents",
  description:
    "Searches the agent database using semantic search to find available expert sub-agents suitable for the given task.",
  parameters: z.object({
    taskDescription: z
      .string()
      .describe(
        "A detailed description of the user's task to find relevant expert agents.",
      ),
  }),
  execute: async ({ taskDescription }) => {
    try {
      const storeName = process.env.AGENT_BANK;
      if (!storeName) {
        return "FAILED: AGENT_BANK environment variable is not set. Cannot search for agents.";
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `Based on the following task, search the provided file store to find the most relevant expert agents.
Task: ${taskDescription}

Extract and return the "AgentKey" for each matching agent, along with their Name and a brief explanation of why they are suitable. If no suitable agents are found, please state that none are available.`;

      const result = await ai.models.generateContent({
        model: DEFAULT_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          tools: [{ fileSearch: { fileSearchStoreNames: [storeName] } }],
        },
      });

      return result?.text || "No relevant agents found.";
    } catch (error: any) {
      return `Failed to search agents: ${error.message}`;
    }
  },
});

// ==========================================
// 2. Dynamic Temporal Assembly Tool
// ==========================================

/**
 * Creates a "Temporal Coordinator Agent" on the fly, dynamically attaches the
 * selected LlmAgent instances as its `subAgents`, delegates the complex task,
 * and returns the combined result.
 */
const executeWithDynamicSubAgentsTool = new FunctionTool({
  name: "execute_with_dynamic_subagents",
  description:
    "Creates a temporary coordinator agent, dynamically attaches multiple selected expert agents as its subAgents, and delegates a complex task to them.",
  parameters: z.object({
    agentKeys: z
      .array(z.string())
      .describe(
        "List of agent keys to form the team. Determine these keys by using the 'search_expert_agents' tool first.",
      ),
    executionStrategy: z
      .enum(["parallel", "sequential", "single"])
      .describe(
        "Determine whether multiple agents can run in parallel, require sequential execution, or if only a single agent is used.",
      ),
    executionOrder: z
      .array(z.string())
      .optional()
      .describe(
        "If sequential execution is required, specify the exact order of agent keys to be executed. Can be omitted if parallel or single.",
      ),
    taskPrompt: z
      .string()
      .describe(
        "The complex task to assign to the temporal coordinator. Include specific execution instructions.",
      ),
  }),
  execute: async ({
    agentKeys,
    executionStrategy,
    executionOrder,
    taskPrompt,
  }) => {
    try {
      const selectedSubAgents = agentKeys
        .map((key) => {
          const agentFactory = AGENT_REGISTRY[key];
          return agentFactory ? agentFactory() : null;
        })
        .filter(Boolean) as LlmAgent[];

      if (selectedSubAgents.length === 0) {
        return `FAILED: No valid agents could be loaded from the registry for keys: ${agentKeys.join(", ")}`;
      }

      let strategyInstructions = "";
      if (executionStrategy === "parallel") {
        strategyInstructions =
          "You MUST execute the attached sub-agents in PARALLEL to maximize efficiency, as the sub-tasks are independent.";
      } else if (executionStrategy === "sequential") {
        const orderStr =
          executionOrder && executionOrder.length > 0
            ? executionOrder.join(" -> ")
            : agentKeys.join(" -> ");
        strategyInstructions = `You MUST execute the attached sub-agents SEQUENTIALLY in the following strict order: ${orderStr}. Wait for each to finish before calling the next, passing relevant context if necessary.`;
      } else {
        strategyInstructions =
          "Execute the assigned single sub-agent to complete the task.";
      }

      const temporalCoordinator = new LlmAgent({
        name: "temporal_coordinator_agent",
        model: DEFAULT_MODEL,
        description:
          "A temporary leader created dynamically to coordinate sub-agents.",
        instruction:
          "You are a temporary coordinator.\n\n" +
          "CRITICAL INSTRUCTIONS FOR EXECUTION:\n" +
          "1. Accurately process the task given in the prompt using yourself and the provided sub-agents, and return the result.\n" +
          "2. If it is difficult or impossible to execute the task with the sub-agents provided to you, you must explicitly return a message stating so.\n" +
          "3. Instead of returning intermediate results after each sub-agent execution, you must process the task by determining and executing the optimal sequential or parallel order among the given sub-agents, complete the entire task, and return ONLY the final comprehensive result.\n\n" +
          "Manager's Suggested Execution Strategy:\n" +
          strategyInstructions +
          "\n\n" +
          "Combine all results from the sub-agents and provide a clear, comprehensive final answer.",
        subAgents: selectedSubAgents,
      });

      const appName = `temporal_team_${Date.now()}`;
      const runner = new InMemoryRunner({
        agent: temporalCoordinator,
        appName: appName,
      });

      const internalUserId = "orchestrator_internal";
      const session = await runner.sessionService.createSession({
        appName: appName,
        userId: internalUserId,
      });

      let fullText = "";
      const runStream = runner.runAsync({
        userId: internalUserId,
        sessionId: session.id,
        newMessage: createUserContent(taskPrompt),
      });

      for await (const event of runStream) {
        const textPart = event.content?.parts?.find((p) => "text" in p);
        if (textPart) {
          fullText += (textPart as any).text || "";
        }
      }

      const resultText = fullText || "I couldn't generate a response.";

      const teamDetails = selectedSubAgents
        .map(
          (agent) =>
            `  - Name: ${(agent as any).name}\n    Role: ${(agent as any).description}\n    Model: ${(agent as any).model}`,
        )
        .join("\n\n");

      const strategyLog =
        executionStrategy === "sequential"
          ? `Sequential (Order: ${executionOrder?.join(" -> ") || agentKeys.join(" -> ")})`
          : executionStrategy === "parallel"
            ? "Parallel"
            : "Single Agent";

      return `--- Task Executed by Temporal Multi-Agent Team ---
Coordinator: temporal_coordinator_agent
Sub-Agents Attached:
${teamDetails}

Execution Strategy Dictated by Agent Manager: ${strategyLog}
Result:
${resultText}
--- Execution completed and temporal team released from memory ---`;
    } catch (error: any) {
      return `Failed to execute temporal team: ${error.message}`;
    }
  },
});

// ==========================================
// 3. Orchestrator Agent Definition
// ==========================================

const AGENT_INSTRUCTIONS = {
  ORCHESTRATOR: `You are a Senior Multi-Agent Orchestrator named 'agent-manager'. 
Your capability relies on dynamically forming teams of expert agents for each given task.

### Capability Matrix & Delegation Rules (CRITICAL)
- You MUST NOT solve domain-specific tasks directly. Analyze the task and determine which experts are needed.
- FIRST, you MUST use the 'search_expert_agents' tool to perform a semantic search to find available expert sub-agents for the user's task.
- THEN, based on the search results, use the 'execute_with_dynamic_subagents' tool to form a team using the discovered AgentKeys.
- IF MULTIPLE AGENTS ARE SELECTED: You MUST deeply analyze if the sub-tasks have dependencies. 
  - If independent (e.g., fetching weather and exchange rates simultaneously), set 'executionStrategy' to 'parallel'.
  - If dependent (e.g., the output of one agent is required as input for another), set 'executionStrategy' to 'sequential' and explicitly define the execution order using the 'executionOrder' parameter.
- IF NO APPROPRIATE AGENT EXISTS according to the search tool, DO NOT call the execution tool. Instead, directly explain to the user that there is no suitable agent available to process their specific request.

### File Operation Rules (CRITICAL SAFEGUARD)
- Regardless of whether it's locally or in the cloud, if the user's request involves creating a new file, deleting an existing file, or updating/modifying an existing file, you MUST NOT execute the action immediately.
- Instead, you MUST first ask the user for explicit permission to perform the file operation.
- Proceed with the execution ONLY AFTER the user has explicitly confirmed and granted permission in their reply.

### Mandatory Output Format
When generating your final response after executing a delegated task, you MUST follow this exact format:

---
## Execution Log
- **Execution Strategy**: Dynamic Temporal Team Assembly

## Task Execution Details[Output the meta-data exactly as returned by the tool (Coordinator, Sub-Agents Attached, Execution Strategy Dictated by Agent Manager)]

## Result[Provide the comprehensive final answer based on the temporal team's output]`,
};

// ==========================================
// 4. Dynamic Description Generation
// ==========================================

const agentData = Object.entries(AGENT_REGISTRY).map(([k, v]) => ({
  name: k,
  description: v().description || "No description",
}));

const keywordPrompt = `Based on the following agent names and descriptions, extract relevant keywords representing tasks these agents can handle.
Format the output EXACTLY as a comma-separated list, like 'keyword1,keyword2,keyword3'. Do not include any other text or explanation.

Agents:
${JSON.stringify(agentData, null, 2)}`;

let extractedKeywords = "{various complex tasks}";

try {
  const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const result = await genAI.models.generateContent({
    model: LOW_LATENCY_MODEL, // or DEFAULT_MODEL
    contents: [{ role: "user", parts: [{ text: keywordPrompt }] }],
  });
  if (result?.text) {
    extractedKeywords = result.text.trim();
  }
} catch (error: any) {
  console.warn(
    `Failed to extract keywords for agent-manager description: ${error.message}`,
  );
}

/**
 * Main Coordinator Agent
 */
export const agentManager = new LlmAgent({
  name: "agent-manager",
  model: DEFAULT_MODEL,
  description: `Senior Orchestrator that manages user interactions, searches for capabilities, analyzes task dependencies, and dynamically forms and delegates tasks to a temporary team of sub-agents. Supported task capabilities include: [${extractedKeywords}]\n\n`,
  instruction: AGENT_INSTRUCTIONS.ORCHESTRATOR,
  tools: [searchExpertAgentsTool, executeWithDynamicSubAgentsTool],
});
