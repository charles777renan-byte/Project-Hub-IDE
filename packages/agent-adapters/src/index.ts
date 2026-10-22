export { DEMO_SCRIPT } from './simulated/demo-script';
export { createSimulatedAdapter, type SimulatedStep } from './simulated/simulated-adapter';
export {
  CLAUDE_CODE_CAPABILITIES,
  createClaudeCodeAdapter,
  type ClaudeCodeAdapterOptions,
  type ClaudeHooks,
  type ClaudeTerminal,
} from './claude-code/adapter';
export { mapHookEntry, type HookRecord } from './claude-code/settings';
