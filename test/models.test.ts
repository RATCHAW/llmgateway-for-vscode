import { describe, expect, it } from "vitest";

import type { GatewayModel } from "../src/gateway";
import {
	formatPrice,
	isChatModel,
	selectModels,
	toChatInformation,
} from "../src/models";

function model(overrides: Partial<GatewayModel> = {}): GatewayModel {
	return {
		id: "claude-sonnet-4-5",
		name: "Claude Sonnet 4.5",
		display_name: "Claude Sonnet 4.5",
		family: "anthropic",
		architecture: {
			input_modalities: ["text", "image"],
			output_modalities: ["text"],
		},
		providers: [
			{
				providerId: "anthropic",
				tools: true,
				vision: true,
				reasoning: true,
				streaming: true,
				max_output: 64000,
			},
			{
				providerId: "aws-bedrock",
				tools: true,
				vision: true,
				reasoning: true,
				streaming: true,
				max_output: 8192,
			},
		],
		pricing: { prompt: "3.0e-6", completion: "15.0e-6" },
		context_length: 200000,
		max_output: 8192,
		...overrides,
	};
}

describe("isChatModel", () => {
	it("keeps text chat models and drops others", () => {
		expect(isChatModel(model())).toBe(true);
		expect(
			isChatModel(
				model({
					architecture: {
						input_modalities: ["text"],
						output_modalities: ["image"],
					},
				}),
			),
		).toBe(false);
		expect(isChatModel(model({ deactivated_at: "2020-01-01" }))).toBe(false);
		expect(isChatModel(model({ deactivated_at: "2999-01-01" }))).toBe(true);
	});
});

describe("selectModels", () => {
	it("honours the allowlist order and ignores unknown ids", () => {
		const a = model({ id: "a" });
		const b = model({ id: "b" });
		expect(selectModels([a, b], ["b", "zzz", "a"]).map((m) => m.id)).toEqual([
			"b",
			"a",
		]);
		expect(selectModels([a, b], []).map((m) => m.id)).toEqual(["a", "b"]);
	});
});

describe("toChatInformation", () => {
	it("derives limits, capabilities, and pricing detail", () => {
		const info = toChatInformation(model(), {
			baseUrl: "https://x/v1",
			apiKey: "k",
		});
		expect(info).toMatchObject({
			id: "claude-sonnet-4-5",
			name: "Claude Sonnet 4.5",
			family: "anthropic",
			maxInputTokens: 200000 - 8192,
			maxOutputTokens: 8192,
			capabilities: { toolCalling: true, imageInput: true },
			detail: "$3 in / $15 out per 1M tokens",
			supportsReasoning: true,
		});
	});

	it("falls back to a default context when the catalogue reports zero", () => {
		const info = toChatInformation(
			model({ context_length: 0, max_output: 4096 }),
			{
				baseUrl: "b",
				apiKey: "k",
			},
		);
		expect(info.maxInputTokens).toBe(128000 - 4096);
	});

	it("falls back to the largest provider max_output", () => {
		const info = toChatInformation(model({ max_output: undefined }), {
			baseUrl: "b",
			apiKey: "k",
		});
		expect(info.maxOutputTokens).toBe(64000);
	});
});

describe("formatPrice", () => {
	it("labels free models and trims zeros", () => {
		expect(formatPrice({ prompt: "0", completion: "0" }, true)).toBe("Free");
		expect(formatPrice({ prompt: "0", completion: "0" })).toBeUndefined();
		expect(formatPrice({ prompt: "0.15e-6", completion: "0.6e-6" })).toBe(
			"$0.15 in / $0.6 out per 1M tokens",
		);
		expect(formatPrice(undefined)).toBeUndefined();
	});
});
