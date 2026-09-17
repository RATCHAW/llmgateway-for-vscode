import * as vscode from "vscode";

import { DEFAULT_BASE_URL } from "./constants";

export * from "./constants";

export type ReasoningEffort =
	"none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export function normalizeBaseUrl(raw: string | undefined): string {
	const value = raw?.trim().replace(/\/+$/, "");
	if (!value) {
		return DEFAULT_BASE_URL;
	}
	return value.endsWith("/v1") ? value : `${value}/v1`;
}

export function settings() {
	const config = vscode.workspace.getConfiguration("llmgateway");
	const effort = config.get<string>("reasoningEffort", "default");
	return {
		baseUrl: normalizeBaseUrl(config.get<string>("baseUrl")),
		models: config
			.get<string[]>("models", [])
			.map((id) => id.trim())
			.filter((id) => id.length > 0),
		reasoningEffort:
			effort === "default" ? undefined : (effort as ReasoningEffort),
	};
}
