import { type ToolUse } from "../../shared/tools"
import { Task } from "../task/Task"
import { BaseTool } from "./BaseTool"

export interface SelectActiveIntentArgs {
	intent_id: string
}

export class SelectActiveIntentTool extends BaseTool<"select_active_intent"> {
	get name(): "select_active_intent" {
		return "select_active_intent"
	}

	async execute(params: SelectActiveIntentArgs, task: Task): Promise<void> {
		if (!params.intent_id) {
			throw new Error("intent_id is required")
		}

		// Because the hook intercepts and returns the tool result directly,
		// this execute method acts mostly as a fallback if the hook doesn't properly intercept it.
		// We'll return an empty string or error here because the Pre-Hook should have handled it.
	}
}

export const selectActiveIntentTool = new SelectActiveIntentTool()
