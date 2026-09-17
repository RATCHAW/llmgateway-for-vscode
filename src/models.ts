import type * as vscode from "vscode";

import type { GatewayModel } from "./gateway";

export interface LlmGatewayModel extends vscode.LanguageModelChatInformation {
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly supportsReasoning: boolean;
}

const FALLBACK_CONTEXT = 128_000;
const FALLBACK_MAX_OUTPUT = 4_096;

export function isChatModel(model: GatewayModel, now = new Date()): boolean {
	const input = model.architecture?.input_modalities ?? [];
	const output = model.architecture?.output_modalities ?? [];
	if (!input.includes("text") || !output.includes("text")) {
		return false;
	}
	if (model.deactivated_at && new Date(model.deactivated_at) <= now) {
		return false;
	}
	return (model.providers ?? []).some((p) => p.streaming !== false);
}

export function selectModels(
	models: GatewayModel[],
	allowlist: readonly string[],
): GatewayModel[] {
	const chat = models.filter((m) => isChatModel(m));
	if (allowlist.length === 0) {
		return chat;
	}
	const byId = new Map(chat.map((m) => [m.id, m]));
	return allowlist.flatMap((id) => {
		const model = byId.get(id);
		return model ? [model] : [];
	});
}

export function toChatInformation(
	model: GatewayModel,
	connection: { baseUrl: string; apiKey: string },
): LlmGatewayModel {
	const providers = model.providers ?? [];
	const maxOutput =
		model.max_output ??
		providers
			.map((p) => p.max_output)
			.filter((n): n is number => typeof n === "number" && n > 0)
			.sort((a, b) => b - a)[0] ??
		FALLBACK_MAX_OUTPUT;
	const context =
		model.context_length && model.context_length > 0
			? model.context_length
			: FALLBACK_CONTEXT;
	const maxInputTokens = context > maxOutput ? context - maxOutput : context;

	return {
		id: model.id,
		name: model.display_name ?? model.name ?? model.id,
		family: model.family || model.id,
		version: model.id,
		detail: formatPrice(model.pricing, model.free === true),
		tooltip: model.description,
		maxInputTokens,
		maxOutputTokens: maxOutput,
		capabilities: {
			toolCalling: providers.some((p) => p.tools),
			imageInput: (model.architecture?.input_modalities ?? []).includes(
				"image",
			),
		},
		baseUrl: connection.baseUrl,
		apiKey: connection.apiKey,
		supportsReasoning: providers.some((p) => p.reasoning),
	};
}

export function formatPrice(
	pricing: { prompt: string; completion: string } | undefined,
	free = false,
): string | undefined {
	if (free) {
		return "Free";
	}
	if (!pricing) {
		return undefined;
	}
	const prompt = perMillion(pricing.prompt);
	const completion = perMillion(pricing.completion);
	if (prompt === undefined || completion === undefined) {
		return undefined;
	}
	if (prompt === 0 && completion === 0) {
		return undefined;
	}
	return `$${trim(prompt)} in / $${trim(completion)} out per 1M tokens`;
}

function perMillion(perToken: string): number | undefined {
	const value = Number(perToken);
	return Number.isFinite(value) ? value * 1_000_000 : undefined;
}

function trim(value: number): string {
	return value.toFixed(2).replace(/\.?0+$/, "");
}
