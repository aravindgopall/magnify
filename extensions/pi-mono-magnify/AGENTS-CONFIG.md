# Pi-Mono Integration - Agent Configuration Reference

This document describes the agent configuration for the Magnify + Pi-Mono integration.

## Agent Discovery

The pi-mono extension uses agent files located in:
- **User agents**: `~/.pi/agent/agents/`
- **Project agents**: `.pi/agents/` (if enabled with `agentScope: "both"`)

For Magnify integration, we use **user agents** for security and portability.

## Agent File Structure

```typescript
/**
 * Agent discovery configuration
 */
export interface AgentConfig {
  name: string;
  path: string;
  source: 'user' | 'project';
  description?: string;
}

export type AgentScope = 'user' | 'project' | 'both';

export async function discoverAgents(scope: AgentScope = 'user'): Promise<AgentConfig[]> {
  // Discover agents from specified scope
  // Returns array of agent configurations
}
```

## Magnify Agents

### 1. Rewriter Agent
**File**: `~/.pi/agent/agents/rewriter.md`  
**Purpose**: Transform user queries into optimized versions  
**Input**: Raw user query  
**Output**: JSON with `explorer_query` and `reader_query`

**Example:**
```json
{
  "explorer_query": "SI Authorization Process",
  "reader_query": "Explain the complete SI authorization process with steps and fields"
}
```

### 2. Explorer Agent
**File**: `~/.pi/agent/agents/explorer.md`  
**Purpose**: Find relevant document sections  
**Input**: `explorer_query` + document ID  
**Output**: Ranked list of matching groups

**Example:**
```json
{
  "matchedGroups": [
    {
      "groupId": "grp-1",
      "title": "SI Authorization",
      "pages": "15-22",
      "relevanceScore": 0.95
    }
  ]
}
```

### 3. Reader Agent
**File**: `~/.pi/agent/agents/reader.md`  
**Purpose**: Extract detailed content from matched sections  
**Input**: `reader_query` + group IDs  
**Output**: Comprehensive extraction result

**Example:**
```json
{
  "answer": "The authorization process...",
  "sources": [...],
  "tables": [...],
  "confidence": 0.88
}
```

### 4. Main Agent
**File**: `~/.pi/agent/agents/main-agent.md`  
**Purpose**: Synthesize final answer from all pipeline results  
**Input**: Complete pipeline result  
**Output**: Formatted markdown answer with citations

## Extension Tools

The Magnify extension registers these tools in Pi-Mono:

### magnify_upload_document
```typescript
{
  name: 'magnify_upload_document',
  description: 'Upload a PDF document to the magnify server',
  parameters: {
    pdfPath: string,      // Required: Absolute path to PDF
    fileName?: string,    // Optional: Display name
  }
}
```

### magnify_list_documents
```typescript
{
  name: 'magnify_list_documents',
  description: 'List all documents stored in magnify',
  parameters: {}  // No parameters
}
```

### magnify_query
```typescript
{
  name: 'magnify_query',
  description: 'Query documents using multi-agent pipeline',
  parameters: {
    query: string,         // Required: User's question
    documentId?: string,   // Optional: Specific document to query
  }
}
```

## Agent Execution Flow

```typescript
/**
 * Multi-agent pipeline execution
 */
async function executeMultiAgentQuery(query: string, documentId?: string): Promise<QueryResult> {
  // Step 1: Rewriter
  const rewriterResult = await spawnAgent('rewriter', {
    task: query,
    outputSchema: { explorer_query: "string", reader_query: "string" }
  });

  // Step 2: Explorer
  const explorerResult = await spawnAgent('explorer', {
    task: `Find sections for: ${rewriterResult.explorer_query}`,
    context: { documentId, explorer_query: rewriterResult.explorer_query }
  });

  // Step 3: Reader
  const readerResult = await spawnAgent('reader', {
    task: `Extract content: ${rewriterResult.reader_query}`,
    context: {
      documentId,
      groupIds: explorerResult.matchedGroups.map(g => g.groupId),
      reader_query: rewriterResult.reader_query
    }
  });

  // Step 4: Main Agent (implicit - done by formatting the result)
  return formatQueryResult(rewriterResult, explorerResult, readerResult);
}
```

## Configuration Options

### Extension Configuration
```typescript
interface MagnifyConfig {
  baseUrl: string;           // Magnify API URL (default: http://localhost:3000)
  agentsPath?: string;       // Path to agent files (default: ~/.pi/agent/agents)
}
```

### Agent Spawn Configuration
```typescript
interface AgentSpawnConfig {
  agent: string;             // Agent name (e.g., 'rewriter')
  task: string;              // Task description
  context?: Record<string, any>;      // Additional context
  outputSchema?: Record<string, string>;  // Expected output structure
  confirmProjectAgents?: boolean;     // Require confirmation for project agents
}
```

## Security Considerations

### Agent Scope
- **User agents** (`~/.pi/agent/agents/`) are trusted and loaded automatically
- **Project agents** (`.pi/agents/`) require explicit opt-in via `agentScope: "both"`
- The Magnify extension only uses user agents by default

### API Access
Agents communicate with Magnify API via HTTP requests:
- No direct file system access outside of pi-mono's sandboxed environment
- All document access is mediated through the Magnify API
- Agent prompts are sandboxed per pi-mono's security model

### Recommendations
1. Keep agents in user directory (`~/.pi/agent/agents/`)
2. Review agent `.md` files before using in production
3. Use HTTPS for Magnify API in production deployments
4. Implement authentication on Magnify API for production use

## Customization

### Modify Agent Behavior

Edit the agent markdown files:
```bash
# Customize rewriter strategy
vi ~/.pi/agent/agents/rewriter.md

# Adjust explorer matching logic
vi ~/.pi/agent/agents/explorer.md

# Change reader extraction approach
vi ~/.pi/agent/agents/reader.md
```

### Add Custom Agents

Create new agent files:
```bash
# Create a validator agent
cat > ~/.pi/agent/agents/validator.md << 'EOF'
# Validator Agent

You are a validator that checks query results for accuracy.

## Input
Query results from the reader agent

## Task
Verify accuracy and completeness

## Output
JSON with validation results
EOF
```

Then modify the extension to use it:
```typescript
// In extensions/pi-mono-magnify/index.ts
const validatorResult = await spawnAgent('validator', {
  task: 'Validate reader results',
  context: { readerResult }
});
```

### Change Pipeline Order

Modify the execution flow in `index.ts`:
```typescript
// Original: Rewriter → Explorer → Reader
// Custom: Rewriter → Planner → Explorer → Reader → Validator

const plannerResult = await spawnAgent('planner', {
  task: 'Plan extraction strategy',
  context: { rewriterResult }
});

// ... continue with modified flow
```

## Troubleshooting

### Agent Not Found
```bash
# Check if agent file exists
ls -la ~/.pi/agent/agents/

# Re-run installation
cd /Users/telkar.varasree/my-project/magnify/magnify
./scripts/install-pi-extension.sh
```

### Agent Execution Fails
```bash
# Check Pi-Mono logs
cat ~/.pi/agent/logs/latest.log

# Test agent directly
pi --agent rewriter "Transform this query: What is the auth process?"
```

### Wrong Output Format
- Verify agent `.md` file has correct output schema
- Check if LLM is following JSON output instructions
- Add more explicit formatting instructions in agent prompt

## Performance Tuning

### Parallel Agent Execution
Pi-Mono supports parallel agent execution for independent tasks:
```typescript
const [explorerResult, metadataResult] = await Promise.all([
  spawnAgent('explorer', explorerTask),
  spawnAgent('metadata-analyzer', metadataTask),
]);
```

### Context Window Optimization
- Rewriter: Small context (just the query)
- Explorer: Medium context (query + group list)
- Reader: Large context (query + full content from matched groups)

### Caching
Pi-Mono caches agent results when possible. To bust cache:
```typescript
const result = await spawnAgent('reader', {
  task: 'Extract content',
  context: { ...params, _cacheBust: Date.now() }
});
```

## References

- [Pi-Mono Subagent Documentation](../../../pi-mono/packages/coding-agent/examples/extensions/subagent/README.md)
- [Magnify API Documentation](../../README.md)
- [Agent System Prompt Examples](~/.pi/agent/agents/)
