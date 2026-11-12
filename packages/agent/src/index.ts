/**
 * Edi's brain: one run of a question through a model and its tools, with no window, process
 * model or model service built in. A host supplies three things — where model calls go
 * (`ModelProvider`), how tools run (`AgentHost`), and who the assistant is
 * (`AgentInstructions`) — and gets a stream of events back. `@edi/agent/worker` runs the same
 * engine in a worker thread.
 */
export { startRun, type AgentHost, type AgentRun, type AgentRunOptions } from './engine';
export { personaNote, plainInstructions, TURN_BLOCK, type AgentInstructions } from './instructions';
export type { ModelProvider, ProviderOptions } from './provider';
export { openRouterProvider } from './openrouter';
export {
  agentInputSchema,
  workerInputSchema,
  workerMessageSchema,
  type AgentEvent,
  type AgentInput,
  type AgentRequest,
  type HostMessage,
  type WorkerInput,
  type WorkerMessage,
} from './protocol';
export {
  activate,
  findAppTools,
  FOUND_PER_SEARCH,
  MAX_ACTIVE_FOUND,
  type SearchableTool,
} from './tool-search';
