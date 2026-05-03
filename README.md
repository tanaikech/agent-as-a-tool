<a name="top"></a>

# Agent-as-a-Tool: Infinite-Scale AI Orchestration

This repository provides a robust framework for the **Agent-as-a-Tool** paradigm. As Large Language Model (LLM) agents increasingly integrate numerous external systems, they suffer from **Tool Space Interference (TSI)**, a phenomenon causing context bloat, attention dilution, and degraded reasoning accuracy.

This system completely overcomes TSI by dynamically discovering, assembling, and executing stateful, autonomous sub-agents on the fly. Built with **Node.js**, **TypeScript**, and **@google/adk**, it acts as a practical implementation of the Self-Optimizing Tool Caching Network (SOTCN) and Federated Context-Aware Routing Architecture (Federated CARA).

## Overview

This project implements a highly scalable multi-agent orchestration system that utilizes a Retrieval-Augmented Generation (RAG) database, called an **Agent Bank**, to manage toolsets. Instead of loading massive verbose JSON schemas into the active context, the primary orchestrator dynamically searches the Agent Bank, extracts only the necessary experts, and forms an ephemeral task force.

The framework includes pre-built expert agents:

1.  **Currency Exchange Agent:** Handles global currency exchange rates, processing relative dates (e.g., "last Friday") accurately.
2.  **Weather Agent:** A meteorologist agent computing precise locations and future dates before fetching weather forecasts.
3.  **Autonomous Google Workspace Agent:** A complex sub-agent managing the full lifecycle of Google Apps Script (GAS) development via a local sandbox and MCP integration.

---

## Features

- **Infinite Scalability (SOTCN):** By utilizing Google Gen AI File Search Store as an Agent Bank, capabilities scale infinitely without exhausting the main orchestrator's token limits.
- **Dynamic Assembly & Routing (Federated CARA):** Automatically formulates an execution strategy—Single, Parallel, or Sequential—based on task dependencies.
- **Ephemeral State Isolation:** Leverages `InMemoryRunner` to spawn temporal teams that are instantly garbage-collected after execution, preventing state contamination across sessions.
- **Zero-Trust & Human-in-the-Loop (HITL):** Enforces strict boundaries; non-destructive tasks run autonomously, while critical file operations pause to mandate explicit user approval.
- **A2A & Gemini CLI Ready:** Natively supports Agent-to-Agent communication, allowing deployment as a standalone Web Server or a remote Gemini CLI sub-agent.

---

## Setup Instructions

### 1. Prerequisites

- Node.js (v18 or later)
- Gemini CLI (For A2A server integration)
- Gemini API Key (Set as `GEMINI_API_KEY` in your environment)
- _(Optional)_ Global CLI Tools for the Autonomous Workspace Agent: `@mcpher/gas-fakes` and `@google/clasp`

```bash
export GEMINI_API_KEY="<YOUR_API_KEY_HERE>"
```

### 2. Installation

```bash
git clone https://github.com/tanaikech/agent-as-a-tool
cd agent-as-a-tool
npm install
```

### 3. Store Agents to RAG (Agent Bank)

Securely index the initial agents into the File Search Store. This script dynamically prevents duplicate ingestions.

```bash
npm run regAgents
```

Once the store is created successfully, map the generated store name to your environment session:

```bash
export AGENT_BANK="{your store name}"
```

_(Note: You can list your stores via `npm run regAgentList` or clear them using `npm run deleteStores`.)_

### 4. Running the Agent as a Web server

Launch the interactive web interface to test the orchestrator locally.

```bash
npm run web
```

```bash
$ npm run web

> adk-full-samples@1.0.0 web
> npx adk web src/agent.ts

+-----------------------------------------------------------------------------+
| ADK API Server started                                                      |
|                                                                             |
| For local testing, access at http://localhost:8000.                         |
+-----------------------------------------------------------------------------+
```

### 5. Running the Agent as an A2A server

Launch the A2A server to use this architecture as an enterprise sub-agent for the Gemini CLI.

```bash
npm run a2a
```

To integrate with Gemini CLI, create or update `.gemini/agents/agent-as-a-tool.md` with the following configuration:

```text
---
kind: remote
name: agent-as-a-tool
agent_card_url: http://localhost:8000/.well-known/agent-card.json
---
```

---

## Usage Examples

Once running via the Web UI or Gemini CLI (using `@agent-as-a-tool`), you can test the dynamic orchestration capabilities.

### 1. Single Agent Execution

**Prompt:** _"What is the latest exchange rate from USD to JPY?"_

- **Logic:** Natively queries the Agent Bank, extracts the `exchange_agent`, and executes the task flawlessly.

### 2. Temporal Logic Resolution

**Prompt:** _"Please tell me the weather in Tokyo at noon tomorrow."_

- **Logic:** The `weather_agent` dynamically calculates the exact date and time for "tomorrow at noon" before pinging the weather API.

### 3. Parallel Execution Strategy

**Prompt:** _"I am traveling to Paris. Please check the weather in Paris on 2026-05-01 12:00. Also, I need to plan my budget, so please provide the latest exchange rate from JPY to EUR simultaneously."_

- **Logic:** The orchestrator retrieves two sub-agents, determines they are independent, and coordinates them concurrently using a **Parallel** strategy.

### 4. Security & Graceful Limitations

**Prompt:** _"Please tell me the weather in Tokyo tomorrow, and also book a flight from New York to Tokyo for next Monday."_

- **Logic:** Secures operational boundaries by returning the weather while cleanly refusing the flight booking since no applicable flight agent exists in the Agent Bank.

### 5. Human-in-the-Loop File Automation

**Prompt:** _"Create a new Google Spreadsheet by putting a formula `=GOOGLEFINANCE("CURRENCY:USDJPY")` in cell 'A1'. Then, get and show the value..."_

- **Logic:** Retrieves the `autonomous-google-workspace-agent`. Recognizing a file creation workflow, the orchestrator triggers HITL, asking for explicit user permission. Once approved, the temporal team tests and generates the GAS code via local sandboxing.

---

<a name="license"></a>

## License

[MIT](https://tanaikech.github.io/license/)

<a name="author"></a>

## Author

[Tanaike](https://tanaikech.github.io/about/)

---

## Update History

- v1.0.0 (May 3, 2026)
  - Initial release introducing the Agent-as-a-Tool paradigm with RAG-based dynamic injection and A2A integration.

[TOP](#top)
