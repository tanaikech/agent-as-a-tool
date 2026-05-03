/**
 * @fileoverview Registry of Specialized Sub-Agents.
 *
 * This file contains the definitions of specific tools and the factory functions
 * to generate fresh LlmAgent instances on demand.
 * Exports AGENT_REGISTRY using a split export statement for Node.js compatibility.
 */

import { LlmAgent, FunctionTool } from "@google/adk";
import { z } from "zod";
import { autonomousGoogleWorkspaceAgent as agw } from "./autonomous-google-workspace-agent.ts";

const DEFAULT_MODEL = "gemini-3-flash-preview";

/**
 * Helper function to deeply clone an existing LlmAgent.
 * This avoids the "already has a parent agent" error by generating fresh instances
 * recursively for the main agent and all its subAgents.
 */
function cloneAgent(agent: any): LlmAgent {
  return new LlmAgent({
    name: agent.name,
    model: agent.model,
    description: agent.description,
    instruction: agent.instruction,
    tools: agent.tools,
    generateContentConfig: agent.generateContentConfig,
    subAgents: agent.subAgents
      ? agent.subAgents.map((sub: any) => cloneAgent(sub))
      : undefined,
  });
}

// ==========================================
// 1. Concrete Tools Definition
// ==========================================

/**
 * [NEW] Current Date & Time Tool
 * Used by agents to resolve relative time expressions like "today", "tomorrow", "next Monday".
 */
const getCurrentDatetimeTool = new FunctionTool({
  name: "get_current_datetime",
  description:
    "Get the current date, time, and day of the week. Essential for resolving relative time expressions like 'today', 'tomorrow', or 'yesterday'.",
  parameters: z.object({
    timezone: z
      .string()
      .optional()
      .describe(
        "Optional timezone (e.g., 'Asia/Tokyo'). If not provided, system local time is used.",
      ),
  }),
  execute: async ({ timezone }) => {
    const now = new Date();
    // Use Intl.DateTimeFormat to provide human-readable detailed time info for the LLM
    const options: Intl.DateTimeFormatOptions = {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
      timeZone: timezone,
    };
    try {
      const formatter = new Intl.DateTimeFormat("en-US", options);
      return `Current date and time is: ${formatter.format(now)}`;
    } catch (error) {
      // Fallback in case of an invalid timezone string
      return `Current date and time (fallback to UTC): ${now.toUTCString()}`;
    }
  },
});

const getCurrentWeatherTool = new FunctionTool({
  name: "get_current_weather",
  description: "Fetches weather information using latitude and longitude.",
  parameters: z.object({
    latitude: z.number().describe("The latitude of the location."),
    longitude: z.number().describe("The longitude of the location."),
    date: z
      .string()
      .describe("Target date and time in 'yyyy-MM-dd HH:mm' format."),
    timezone: z.string().describe("The timezone (e.g., 'Asia/Tokyo')."),
  }),
  execute: async ({ latitude, longitude, date, timezone }) => {
    const weatherCodes: Record<number, string> = {
      0: "Clear sky",
      1: "Mainly clear",
      2: "Partly cloudy",
      3: "Overcast",
      45: "Fog",
      48: "Depositing rime fog",
      51: "Drizzle: Light",
      53: "Drizzle: Moderate",
      61: "Rain: Slight",
      63: "Rain: Moderate",
      65: "Rain: Heavy",
    };
    try {
      const endpoint = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=weather_code&timezone=${encodeURIComponent(timezone)}`;
      const response = await fetch(endpoint);
      if (!response.ok)
        throw new Error(`Weather API error: ${response.status}`);

      const data: any = await response.json();
      const targetTime = date.replace(" ", "T");
      const timeIndex = data.hourly.time.indexOf(targetTime);

      if (timeIndex !== -1) {
        const code = data.hourly.weather_code[timeIndex];
        return `Weather at ${date}: ${weatherCodes[code] || "Unknown condition"}`;
      }
      return "No weather data found for the specified time.";
    } catch (error: any) {
      return `Error retrieving weather: ${error.message}`;
    }
  },
});

const getExchangeRateTool = new FunctionTool({
  name: "get_exchange_rate",
  description: "Use this to get current exchange rate between currencies.",
  parameters: z.object({
    currency_from: z
      .string()
      .default("USD")
      .describe("Source currency (major currency)."),
    currency_to: z
      .string()
      .default("EUR")
      .describe("Destination currency (major currency)."),
    currency_date: z
      .string()
      .default("latest")
      .describe("Date of the currency in ISO format (YYYY-MM-DD) or 'latest'."),
  }),
  execute: async ({ currency_from, currency_to, currency_date }) => {
    try {
      const response = await fetch(
        `https://api.frankfurter.app/${currency_date}?from=${currency_from}&to=${currency_to}`,
      );
      if (!response.ok) throw new Error(`API status: ${response.status}`);
      const data: any = await response.json();
      return `The currency rate at ${currency_date} from "${currency_from}" to "${currency_to}" is ${data.rates[currency_to]}.`;
    } catch (error: any) {
      return `Error retrieving exchange rate: ${error.message}`;
    }
  },
});

// ==========================================
// 2. Factory Functions for Specialized Agents
// ==========================================

const createExchangeAgent = () =>
  new LlmAgent({
    name: "exchange_agent",
    model: DEFAULT_MODEL,
    description:
      "A highly specialized agent for global currency exchange rates.",
    instruction:
      "You are a financial expert. Use the 'get_exchange_rate' tool to provide accurate currency rates when requested by the coordinator. " +
      "If the user asks for rates using relative dates like 'today', 'yesterday', or 'last Friday', ALWAYS use the 'get_current_datetime' tool first to determine the exact date before calling the exchange rate API.",
    tools: [getExchangeRateTool, getCurrentDatetimeTool],
  });

const createWeatherAgent = () =>
  new LlmAgent({
    name: "weather_agent",
    model: DEFAULT_MODEL,
    description:
      "A specialized agent for providing accurate weather forecasts.",
    instruction:
      "You are a professional meteorologist. Use the 'get_current_weather' tool to provide weather data when requested by the coordinator. " +
      "If the user's request involves relative times like 'today', 'tomorrow', or 'in 3 hours', ALWAYS use the 'get_current_datetime' tool first to compute the correct target date and time.",
    tools: [getCurrentWeatherTool, getCurrentDatetimeTool],
  });

/**
 *
 * ref: https://github.com/tanaikech/autonomous-google-workspace-agent
 */
const autonomousGoogleWorkspaceAgent = () => cloneAgent(agw);

/**
 * For remote agent
 * If you use this, please import RemoteA2AAgent. And use type AgentFactory = () => LlmAgent | RemoteA2AAgent;
 */
// const sampleAgent = () =>
//   new RemoteA2AAgent({
//     name: "sample_a2a_server",
//     description: "{description of this agent}", // In this case, please manually set this description.
//     agentCard: `{agent card URL}`,
//   });

// ==========================================
// 3. Export Registry of Factories
// ==========================================
type AgentFactory = () => LlmAgent;

/**
 * Registry array defining available agents.
 */
const agents: AgentFactory[] = [
  createExchangeAgent,
  createWeatherAgent,
  autonomousGoogleWorkspaceAgent,
];

const AGENT_REGISTRY: Record<string, AgentFactory> = Object.fromEntries(
  agents.map((factory) => [factory().name, factory]),
);

export { AGENT_REGISTRY };
