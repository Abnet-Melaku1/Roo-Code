/**
 * Hook Engine — TRP1 Intent-Code Traceability
 *
 * Middleware boundary that intercepts tool execution for:
 * - PreToolUse: intent context injection, HITL authorization, scope enforcement, optimistic locking
 * - PostToolUse: full agent_trace.jsonl updates, intent_map.md spatial map, lesson recording
 */

import * as path from "path"
import * as fs from "fs/promises"
import { HookableToolName, PreHookContext, PreHookResult, PostHookContext } from "./types"
import YAML from "yaml"
import { minimatch } from "minimatch"
import * as crypto from "crypto"
import { execSync } from "child_process"

export * from "./types"
export const HOOK_ENGINE_VERSION = "0.2.0"

// ------- Internal helpers -------

/** Get the current git SHA, or a fallback if not in a git repo */
function getGitSha(cwd: string): string {
	try {
		return execSync("git rev-parse HEAD", { cwd, timeout: 2000 }).toString().trim()
	} catch {
		return "no-git"
	}
}

/** Compute SHA-256 hash of arbitrary string content */
function sha256(content: string): string {
	return crypto.createHash("sha256").update(content).digest("hex")
}

/** Compute SHA-256 of a file currently on disk. Returns null if file does not exist. */
async function hashFileOnDisk(filePath: string): Promise<string | null> {
	try {
		const content = await fs.readFile(filePath, "utf-8")
		return sha256(content)
	} catch {
		return null
	}
}

// ------- Orchestration paths -------

function getOrchestrationDir(cwd: string): string {
	return path.join(cwd, ".orchestration")
}

function getActiveIntentsPath(cwd: string): string {
	return path.join(getOrchestrationDir(cwd), "active_intents.yaml")
}

function getAgentTracePath(cwd: string): string {
	return path.join(getOrchestrationDir(cwd), "agent_trace.jsonl")
}

function getIntentMapPath(cwd: string): string {
	return path.join(getOrchestrationDir(cwd), "intent_map.md")
}

// ------- Intent helpers -------

/** Read and return an intent object from active_intents.yaml by id */
async function getActiveIntent(cwd: string, intentId: string): Promise<any | null> {
	try {
		const content = await fs.readFile(getActiveIntentsPath(cwd), "utf-8")
		const data = YAML.parse(content)
		if (data && Array.isArray(data.active_intents)) {
			return data.active_intents.find((i: any) => i.id === intentId) ?? null
		}
	} catch {
		// file missing or invalid YAML — treat as no intents
	}
	return null
}

// ------- intent_map.md update -------

/**
 * Append or update a file→intent mapping in intent_map.md.
 * Uses a simple append approach; keeps the file human-readable.
 */
async function updateIntentMap(cwd: string, intentId: string, intentName: string, filePath: string): Promise<void> {
	const mapPath = getIntentMapPath(cwd)

	// Read existing content (or empty string)
	let existing = ""
	try {
		existing = await fs.readFile(mapPath, "utf-8")
	} catch {
		// file doesn't exist yet — write header
		existing = `# Intent Map\n\nMaps business intents to physical files modified by the AI agent.\n\n| Intent ID | Intent Name | File Path | Last Modified |\n|-----------|-------------|-----------|---------------|\n`
	}

	const timestamp = new Date().toISOString()
	const row = `| ${intentId} | ${intentName} | \`${filePath}\` | ${timestamp} |\n`

	// Only append if this exact (intent, file) combo isn't already the last row to avoid duplicates
	if (!existing.endsWith(row)) {
		await fs.writeFile(mapPath, existing + row, "utf-8")
	}
}

// ------- Main Hook Engine class -------

class HookEngine {
	// === PRE-HOOK ===
	// Phase 1: enforce select_active_intent handshake
	// Phase 2: scope enforcement via minimatch
	// Phase 4: optimistic locking
	public async runPreHook(context: PreHookContext, cwd: string): Promise<PreHookResult> {
		// Opt-in guard: if .orchestration/active_intents.yaml does not exist in this workspace,
		// the project is not configured for TRP1 intent tracking — pass everything through.
		try {
			await fs.access(getActiveIntentsPath(cwd))
		} catch {
			return { allow: true }
		}

		// ---- Handle select_active_intent (Phase 1) ----
		if (context.toolName === "select_active_intent") {
			const intentId = context.params.intent_id as string

			if (!intentId) {
				return { allow: false, error: "Missing intent_id in select_active_intent parameters." }
			}

			const intentData = await getActiveIntent(cwd, intentId)

			if (!intentData) {
				// Load available IDs so the model can retry with the correct one
				let availableIds = "unknown (could not read file)"
				try {
					const content = await fs.readFile(getActiveIntentsPath(cwd), "utf-8")
					const data = YAML.parse(content)
					if (data && Array.isArray(data.active_intents)) {
						availableIds = data.active_intents.map((i: any) => i.id).join(", ") || "none"
					}
				} catch {
					// silent — best effort
				}
				return {
					allow: false,
					error: `Intent '${intentId}' not found in .orchestration/active_intents.yaml. Available intent IDs: [${availableIds}]. Call select_active_intent again with one of those IDs.`,
				}
			}

			const scopeList = (intentData.owned_scope ?? []).join("\n    ") || "Any"
			const constraintList = (intentData.constraints ?? []).join("\n    ") || "None"
			const criteriaList = (intentData.acceptance_criteria ?? []).join("\n    ") || "None"

			const injectedContext = [
				`<intent_context>`,
				`  <id>${intentData.id}</id>`,
				`  <name>${intentData.name}</name>`,
				`  <status>${intentData.status}</status>`,
				`  <owned_scope>`,
				`    ${scopeList}`,
				`  </owned_scope>`,
				`  <constraints>`,
				`    ${constraintList}`,
				`  </constraints>`,
				`  <acceptance_criteria>`,
				`    ${criteriaList}`,
				`  </acceptance_criteria>`,
				`</intent_context>`,
			].join("\n")

			return { allow: true, injectedContext }
		}

		// ---- Gatekeeper for mutating tools (Phase 2 + Phase 4) ----
		if (
			[
				"write_to_file",
				"edit_file",
				"search_replace",
				"apply_diff",
				"execute_command",
				"new_task",
				"edit",
				"search_and_replace",
				"apply_patch",
			].includes(context.toolName)
		) {
			// Phase 2a: require active intent
			if (!context.activeIntentId) {
				// Surface available IDs so the model can immediately call select_active_intent correctly.
				let availableIds = "could not read — try read_file('.orchestration/active_intents.yaml')"
				try {
					const content = await fs.readFile(getActiveIntentsPath(cwd), "utf-8")
					const data = YAML.parse(content)
					if (data && Array.isArray(data.active_intents)) {
						availableIds = data.active_intents.map((i: any) => i.id).join(", ") || "none"
					}
				} catch (err) {
					console.error(
						"[HookEngine] Phase 2a: failed to read active_intents.yaml at",
						getActiveIntentsPath(cwd),
						err,
					)
				}
				return {
					allow: false,
					error:
						`No active intent is set. You MUST call select_active_intent before modifying any file. ` +
						`Available intent IDs: [${availableIds}]. ` +
						`Do NOT switch modes. Call select_active_intent(intent_id) now, then retry.`,
				}
			}

			// Extract target path
			let targetPath: string | undefined
			if (context.toolName === "write_to_file" || context.toolName === "apply_diff") {
				targetPath = context.params.path as string | undefined
			} else if (["edit_file", "search_replace", "edit", "search_and_replace"].includes(context.toolName)) {
				targetPath = context.params.file_path as string | undefined
			}
			// apply_patch embeds paths inside the patch text — no single path to extract

			if (targetPath) {
				const intentData = await getActiveIntent(cwd, context.activeIntentId)

				// Phase 2b: scope enforcement
				if (intentData?.owned_scope && Array.isArray(intentData.owned_scope)) {
					const normalizedPath = targetPath.replace(/\\/g, "/")
					const inScope = intentData.owned_scope.some((glob: string) =>
						minimatch(normalizedPath, glob, { matchBase: true, dot: true }),
					)
					if (!inScope) {
						return {
							allow: false,
							error:
								`Scope Violation: Intent '${context.activeIntentId}' is not authorized to edit '${targetPath}'. ` +
								`Allowed scope: [${intentData.owned_scope.join(", ")}]. Request scope expansion if needed.`,
						}
					}
				}

				// Phase 4: Optimistic locking — only for write_to_file replacing existing file content
				if (context.toolName === "write_to_file") {
					const knownHash = context.params.known_content_hash as string | undefined
					if (knownHash) {
						const absolutePath = path.isAbsolute(targetPath) ? targetPath : path.join(cwd, targetPath)
						const diskHash = await hashFileOnDisk(absolutePath)
						if (diskHash && diskHash !== knownHash) {
							return {
								allow: false,
								error:
									`Stale File Conflict: The file '${targetPath}' has been modified since you last read it ` +
									`(your hash: ${knownHash.slice(0, 8)}..., disk hash: ${diskHash.slice(0, 8)}...). ` +
									`Re-read the file, incorporate the changes, then retry.`,
							}
						}
					}
				}
			}
		}

		return { allow: true }
	}

	// === POST-HOOK ===
	// Phase 3: full agent_trace.jsonl schema + intent_map.md update
	public async runPostHook(context: PostHookContext, cwd: string): Promise<void> {
		if (!context.activeIntentId) return

		// Opt-in guard: skip post-hook if project has no .orchestration directory
		try {
			await fs.access(getActiveIntentsPath(cwd))
		} catch {
			return
		}

		let targetPath: string | undefined
		let contentModified: string | undefined

		if (context.toolName === "write_to_file") {
			targetPath = context.params.path as string
			contentModified = context.params.content as string
		} else if (["edit_file", "search_replace"].includes(context.toolName)) {
			targetPath = context.params.file_path as string
			contentModified = context.params.new_string as string
		} else if (context.toolName === "apply_diff") {
			targetPath = context.params.path as string
			contentModified = context.params.diff as string
		}

		if (!targetPath || !contentModified) return

		// Determine mutation class from context (agent can set it; default = INTENT_EVOLUTION)
		const mutationClass = context.mutationClass ?? "INTENT_EVOLUTION"

		// Count approximate lines changed
		const lines = contentModified.split("\n")
		const startLine = 1
		const endLine = lines.length

		// Spatial hash
		const contentHash = sha256(contentModified)

		// Fetch model info and session info from context params if available
		const modelIdentifier = (context.params as any)._modelIdentifier ?? "unknown-model"
		const sessionLogId = (context.params as any)._sessionId ?? crypto.randomUUID()

		// Get git SHA
		const revisionId = getGitSha(cwd)

		// Look up intent name for intent_map.md
		const intentData = await getActiveIntent(cwd, context.activeIntentId)
		const intentName = intentData?.name ?? context.activeIntentId

		// Build full trace entry per spec
		const traceEntry = {
			id: crypto.randomUUID(),
			timestamp: new Date().toISOString(),
			vcs: { revision_id: revisionId },
			intent_id: context.activeIntentId,
			mutation_class: mutationClass,
			files: [
				{
					relative_path: targetPath,
					conversations: [
						{
							url: sessionLogId,
							contributor: {
								entity_type: "AI",
								model_identifier: modelIdentifier,
							},
							ranges: [
								{
									start_line: startLine,
									end_line: endLine,
									content_hash: `sha256:${contentHash}`,
								},
							],
							related: [
								{
									type: "specification",
									value: context.activeIntentId,
								},
							],
						},
					],
				},
			],
		}

		// Append to agent_trace.jsonl
		try {
			const tracePath = getAgentTracePath(cwd)
			await fs.appendFile(tracePath, JSON.stringify(traceEntry) + "\n", "utf-8")
		} catch (err) {
			console.error("HookEngine: Failed to append to agent_trace.jsonl", err)
		}

		// Update intent_map.md
		try {
			await updateIntentMap(cwd, context.activeIntentId, intentName, targetPath)
		} catch (err) {
			console.error("HookEngine: Failed to update intent_map.md", err)
		}
	}
}

export const hookEngine = new HookEngine()
