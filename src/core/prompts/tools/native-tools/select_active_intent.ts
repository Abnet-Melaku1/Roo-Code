import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "select_active_intent",
		description:
			"Selects an active intent for the current turn. You MUST call this before taking any actions (e.g. write_to_file, execute_command). It returns intent constraints and scope that you must follow. The valid intent IDs are listed in .orchestration/active_intents.yaml — use read_file to read that file first if you do not already know the correct intent_id.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				intent_id: {
					type: "string",
					description: "The ID of the business intent to check out (e.g., INT-001).",
				},
			},
			required: ["intent_id"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
