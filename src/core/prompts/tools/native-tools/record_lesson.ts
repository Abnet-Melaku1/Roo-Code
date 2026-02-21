import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "record_lesson",
		description: [
			"Records a lesson learned to AGENTS.md when a verification step (linter, test, build) fails or ",
			"when an important architectural decision is made. This creates a persistent shared brain ",
			"that prevents future agents from repeating the same mistake.",
		].join(""),
		strict: true,
		parameters: {
			type: "object",
			properties: {
				category: {
					type: "string",
					enum: [
						"LINT_FAILURE",
						"TEST_FAILURE",
						"BUILD_FAILURE",
						"ARCHITECTURAL_DECISION",
						"SCOPE_VIOLATION",
					],
					description: "Category of the lesson being recorded.",
				},
				lesson: {
					type: "string",
					description: "The lesson learned in 1-3 sentences. Be specific and actionable.",
				},
				file_context: {
					type: "string",
					description: "Optional file or component that the lesson relates to.",
				},
			},
			required: ["category", "lesson"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
