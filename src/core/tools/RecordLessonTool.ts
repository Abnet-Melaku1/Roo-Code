import * as fs from "fs/promises"
import * as path from "path"

type RecordLessonArgs = {
	category: "LINT_FAILURE" | "TEST_FAILURE" | "BUILD_FAILURE" | "ARCHITECTURAL_DECISION" | "SCOPE_VIOLATION"
	lesson: string
	file_context?: string
}

/**
 * Appends a Lesson Learned to AGENTS.md (the Shared Brain).
 * Called by the agent when a verification step fails or an architectural decision needs to be persisted.
 */
export async function recordLesson(params: RecordLessonArgs, cwd: string): Promise<string> {
	const { category, lesson, file_context } = params

	const agentsMdPath = path.join(cwd, "AGENTS.md")
	const timestamp = new Date().toISOString()

	const entry = [
		`\n## [${category}] — ${timestamp}`,
		file_context ? `**File:** \`${file_context}\`` : "",
		`**Lesson:** ${lesson}`,
		``,
	]
		.filter((line) => line !== null)
		.join("\n")

	try {
		// Try to append to existing AGENTS.md; if it doesn't exist, create with a header
		let existing = ""
		try {
			existing = await fs.readFile(agentsMdPath, "utf-8")
		} catch {
			existing =
				`# Shared Agent Brain — Lessons Learned\n\nThis file is maintained by the AI agent. ` +
				`Lessons are automatically appended when verification steps fail or architectural decisions are made.\n`
		}

		await fs.writeFile(agentsMdPath, existing + entry, "utf-8")

		return `Lesson recorded in AGENTS.md under category [${category}].`
	} catch (err: any) {
		return `Failed to record lesson: ${err.message}`
	}
}
