# AGENTS.md

Shared knowledge base for AI agents working in this repository.
Automatically updated by the `record_lesson` tool. Read this before making any changes.

---

## Working Rules (TRP1 Enforcement)

When `.orchestration/active_intents.yaml` exists in the workspace you are working in:

1. **Always call `select_active_intent(intent_id)` first.** You cannot call `write_to_file`,
   `edit_file`, `search_replace`, `apply_diff`, `apply_patch`, `search_and_replace`, `edit`,
   or `execute_command` until you have selected an active intent.
2. **Read the intent file before selecting.** If you do not know valid intent IDs, call
   `read_file('.orchestration/active_intents.yaml')` first.
3. **Respect `owned_scope`.** Every file you modify must match one of the glob patterns in the
   intent's `owned_scope` list. If it does not, request a scope expansion instead of bypassing.
4. **Do not switch modes to escape enforcement.** A hook block is not an error — it is a prompt
   to call `select_active_intent`. Stay in the current mode and retry.

These rules are enforced at the hook level; violations return a tool_result error, not a crash.

---

## Codebase Patterns

### SettingsView — Input Binding

Inputs in `SettingsView` must bind to the local `cachedState`, **not** to the live
`useExtensionState()`. The `cachedState` is a write buffer that is flushed to the
`ContextProxy` source-of-truth only when the user clicks "Save". Binding directly to live
state causes race conditions between keystroke events and state broadcasts.

---

### Adding a New Native Tool — Checklist

If you add a new native tool (like `select_active_intent` or `record_lesson`), you must update
**all** of the following locations or the tool will silently fail or be rejected:

| #   | File                                                 | What to add                                              |
| --- | ---------------------------------------------------- | -------------------------------------------------------- |
| 1   | `src/core/prompts/tools/native-tools/<tool_name>.ts` | Tool schema (OpenAI function format)                     |
| 2   | `src/core/prompts/tools/native-tools/index.ts`       | Export and include in the tools array                    |
| 3   | `src/core/tools/<ToolName>Tool.ts`                   | Handler class extending `BaseTool`                       |
| 4   | `src/shared/tools.ts` — `ALWAYS_AVAILABLE_TOOLS`     | Add tool name so `validateToolUse` passes it through     |
| 5   | `src/shared/tools.ts` — `toolParamNames`             | Add every parameter name the tool accepts                |
| 6   | `src/core/assistant-message/NativeToolCallParser.ts` | Add a `case "<tool_name>":` in the `nativeArgs` switch   |
| 7   | `packages/types/src/tool.ts`                         | Add tool name to the `ToolName` type union               |
| 8   | `src/hooks/types.ts` — `HookableToolName`            | Add if the tool should be intercepted by the hook engine |

Missing **any** of these causes a different silent failure:

- Missing from `ALWAYS_AVAILABLE_TOOLS` → `validateToolUse` throws before the hook runs.
- Missing from `toolParamNames` → parameters are silently dropped; handler receives empty params.
- Missing `nativeArgs` case → `NativeToolCallParser` throws "Invalid arguments"; hook never runs.
- Missing from `packages/types` → TypeScript build errors across packages.

---

### NativeToolCallParser — nativeArgs vs params

`block.params` and `block.nativeArgs` are **different objects**:

- `block.params` — display/logging only; populated by the param name whitelist in `toolParamNames`.
- `block.nativeArgs` — authoritative typed args used by the hook engine and tool handlers;
  populated only when a matching `case` exists in `NativeToolCallParser.ts`.

When calling `hookEngine.runPreHook`, merge both:

```typescript
const hookParams = block.nativeArgs
	? { ...block.params, ...(block.nativeArgs as Record<string, unknown>) }
	: block.params
```

Never rely on `block.params` alone for tool execution logic.

---

### Hook Engine — Opt-In Guard

The hook engine is **transparent by default**. If `.orchestration/active_intents.yaml` does not
exist in the current workspace (`cwd`), both `runPreHook` and `runPostHook` return immediately
without blocking anything. This means:

- Projects without a `.orchestration/` directory are completely unaffected.
- To enable TRP1 enforcement, create `.orchestration/active_intents.yaml` in your project root.

---

### Hook Engine — Gatekeeper Tool List

The gatekeeper in `src/hooks/index.ts` and the `hookableTools` array in
`presentAssistantMessage.ts` must stay in sync. Any tool in one list but not the other either
gets blocked without a hook call or gets a hook call with no enforcement.

Current gatekeeper tools (both lists must contain these):

```
write_to_file, edit_file, search_replace, apply_diff,
execute_command, new_task, edit, search_and_replace, apply_patch
```

---

### consecutiveMistakeCount — Do Not Increment on Hook Blocks

Do **not** call `cline.consecutiveMistakeCount++` when the hook engine blocks a tool. A hook
block is an expected, recoverable event (the model should call `select_active_intent` and
retry). Incrementing the mistake counter causes the model to panic, escalate modes, or create
subtasks — a spiral that is hard to recover from.

---

## Recorded Lessons

<!-- record_lesson entries are appended below this line -->

### [ARCHITECTURE] Hook engine is opt-in per workspace

The pre/post hooks check for `.orchestration/active_intents.yaml` at the top of every call.
If the file is absent the hook passes everything through. This prevents the engine from
blocking unrelated workspaces that happen to be open in the same VS Code window.

### [DEBUGGING] toolParamNames whitelist drops unknown params silently

If a tool parameter (e.g. `intent_id`) is not listed in `toolParamNames` in `src/shared/tools.ts`,
the NativeToolCallParser silently skips it with `continue`. The resulting `block.params` has no
trace of that parameter. Always add every parameter name to `toolParamNames` when registering a
new tool.

### [DEBUGGING] NativeToolCallParser throws for tools without a nativeArgs case

Any tool name not handled by a `case` in the `nativeArgs` switch of `NativeToolCallParser.ts`
causes "Invalid arguments for tool" and the tool call is dropped. Add a case that maps the
parsed args to a typed `nativeArgs` object; only then does `block.nativeArgs` get populated.

### [DEBUGGING] ALWAYS_AVAILABLE_TOOLS required for custom tools in all modes

`validateToolUse` in `presentAssistantMessage.ts` runs before the hook. If a custom tool is
not in `ALWAYS_AVAILABLE_TOOLS` (`src/shared/tools.ts`), `validateToolUse` rejects it with
"Tool not available in current mode" and the hook never has a chance to handle it.
