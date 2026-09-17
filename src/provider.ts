import * as vscode from "vscode";

import type { ApiKeyStore } from "./auth";
import { API_KEYS_URL, DASHBOARD_URL, settings } from "./config";
import { parseToolArguments, toChatMessages, toChatTools } from "./convert";
import {
	GatewayClient,
	GatewayError,
	type ChatRequest,
	type ClientInfo,
} from "./gateway";
import {
	selectModels,
	toChatInformation,
	type LlmGatewayModel,
} from "./models";

const USAGE_MIME = "usage";
const CHARS_PER_TOKEN = 4;

interface ToolCallBuilder {
	id: string;
	name: string;
	arguments: string;
}

type ThinkingPartCtor = new (value: string) => vscode.LanguageModelResponsePart;

export class LlmGatewayChatProvider
	implements
		vscode.LanguageModelChatProvider<LlmGatewayModel>,
		vscode.Disposable
{
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;

	constructor(
		private readonly keys: ApiKeyStore,
		private readonly info: ClientInfo,
		private readonly output: vscode.OutputChannel,
	) {}

	refresh(): void {
		this.changeEmitter.fire();
	}

	dispose(): void {
		this.changeEmitter.dispose();
	}

	async provideLanguageModelChatInformation(
		options: vscode.PrepareLanguageModelChatModelOptions,
		token: vscode.CancellationToken,
	): Promise<LlmGatewayModel[]> {
		const config = settings();
		const baseUrl = config.baseUrl;
		let apiKey = await this.keys.get();
		if (!apiKey && !options.silent) {
			apiKey = await this.keys.prompt();
		}
		if (!apiKey) {
			return [];
		}

		const controller = new AbortController();
		const cancel = token.onCancellationRequested(() => controller.abort());
		try {
			const client = new GatewayClient(baseUrl, apiKey, this.info);
			const models = selectModels(
				await client.listModels(controller.signal),
				config.models,
			);
			this.output.appendLine(
				`Listed ${models.length} model(s) from ${baseUrl}.`,
			);
			return models.map((m) => toChatInformation(m, { baseUrl, apiKey }));
		} catch (error) {
			throw await this.userFacingError(error, baseUrl);
		} finally {
			cancel.dispose();
		}
	}

	async provideLanguageModelChatResponse(
		model: LlmGatewayModel,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const controller = new AbortController();
		const cancel = token.onCancellationRequested(() => controller.abort());
		const client = new GatewayClient(model.baseUrl, model.apiKey, this.info);
		const request = this.buildRequest(model, messages, options);
		this.output.appendLine(
			`Chat request to ${model.id} (${messages.length} messages).`,
		);

		const toolCalls = new Map<number, ToolCallBuilder>();
		const Thinking = thinkingPart();
		try {
			for await (const chunk of client.streamChat(request, controller.signal)) {
				for (const choice of chunk.choices ?? []) {
					const delta = choice.delta;
					const reasoning = delta?.reasoning ?? delta?.reasoning_content;
					if (reasoning && Thinking) {
						progress.report(new Thinking(reasoning));
					}
					if (delta?.content) {
						progress.report(new vscode.LanguageModelTextPart(delta.content));
					}
					for (const call of delta?.tool_calls ?? []) {
						const builder = toolCalls.get(call.index) ?? {
							id: "",
							name: "",
							arguments: "",
						};
						if (call.id) {
							builder.id = call.id;
						}
						if (call.function?.name) {
							builder.name = call.function.name;
						}
						if (call.function?.arguments) {
							builder.arguments += call.function.arguments;
						}
						toolCalls.set(call.index, builder);
					}
					if (choice.finish_reason) {
						flushToolCalls(toolCalls, progress);
					}
				}
				if (chunk.usage) {
					progress.report(
						new vscode.LanguageModelDataPart(
							new TextEncoder().encode(JSON.stringify(chunk.usage)),
							USAGE_MIME,
						),
					);
				}
			}
			flushToolCalls(toolCalls, progress);
		} catch (error) {
			if (token.isCancellationRequested) {
				throw new vscode.CancellationError();
			}
			throw await this.userFacingError(error, model.baseUrl);
		} finally {
			cancel.dispose();
		}
	}

	async provideTokenCount(
		_model: LlmGatewayModel,
		text: string | vscode.LanguageModelChatRequestMessage,
	): Promise<number> {
		const value =
			typeof text === "string"
				? text
				: text.content
						.map((part) =>
							part instanceof vscode.LanguageModelTextPart ? part.value : "",
						)
						.join("");
		return Math.ceil(value.length / CHARS_PER_TOKEN);
	}

	private buildRequest(
		model: LlmGatewayModel,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
	): ChatRequest {
		const modelOptions = options.modelOptions ?? {};
		const request: ChatRequest = {
			model: model.id,
			messages: toChatMessages(messages),
		};
		const tools = toChatTools(options.tools);
		if (tools) {
			request.tools = tools;
			if (options.toolMode === vscode.LanguageModelChatToolMode.Required) {
				request.tool_choice = "required";
			}
		}
		for (const key of ["temperature", "top_p", "max_tokens"] as const) {
			const value = modelOptions[key];
			if (typeof value === "number") {
				request[key] = value;
			}
		}
		const effort = settings().reasoningEffort;
		if (effort && model.supportsReasoning) {
			request.reasoning_effort = effort;
		}
		return request;
	}

	private async userFacingError(
		error: unknown,
		baseUrl: string,
	): Promise<Error> {
		const message = error instanceof Error ? error.message : String(error);
		this.output.appendLine(`Request to ${baseUrl} failed: ${message}`);
		if (!(error instanceof GatewayError)) {
			return error instanceof Error ? error : new Error(message);
		}
		switch (error.status) {
			case 401:
				await this.keys.delete();
				this.refresh();
				return new Error(
					`LLM Gateway rejected the API key. Run "LLM Gateway: Set API Key" or create a key at ${API_KEYS_URL}.`,
				);
			case 402:
				return new Error(`LLM Gateway: ${message} (${DASHBOARD_URL})`);
			case 429:
				return new Error(`LLM Gateway rate limit reached. ${message}`);
			default:
				return new Error(`LLM Gateway error (${error.status}): ${message}`);
		}
	}
}

function flushToolCalls(
	builders: Map<number, ToolCallBuilder>,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
): void {
	for (const builder of builders.values()) {
		if (builder.id && builder.name) {
			progress.report(
				new vscode.LanguageModelToolCallPart(
					builder.id,
					builder.name,
					parseToolArguments(builder.arguments),
				),
			);
		}
	}
	builders.clear();
}

/** Thinking parts are still a proposed API; use them when the host exposes them. */
function thinkingPart(): ThinkingPartCtor | undefined {
	return (vscode as unknown as { LanguageModelThinkingPart?: ThinkingPartCtor })
		.LanguageModelThinkingPart;
}
