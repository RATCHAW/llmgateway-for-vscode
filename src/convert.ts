import * as vscode from "vscode";

import type {
	ChatContentPart,
	ChatMessage,
	ChatTool,
	ChatToolCall,
} from "./gateway";

type Role = "system" | "user" | "assistant";

export function toChatMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): ChatMessage[] {
	const out: ChatMessage[] = [];
	// Images returned by tools cannot ride in a tool message, so they are held
	// until the run of tool messages ends and then sent as one user message.
	let pendingImages: ChatContentPart[] = [];
	const flushImages = () => {
		if (pendingImages.length > 0) {
			out.push({ role: "user", content: pendingImages });
			pendingImages = [];
		}
	};
	for (const message of messages) {
		const role = toRole(message.role);
		const text: string[] = [];
		const images: ChatContentPart[] = [];
		const toolCalls: ChatToolCall[] = [];
		const toolResults: ChatMessage[] = [];
		const toolImages: ChatContentPart[] = [];

		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				text.push(part.value);
			} else if (part instanceof vscode.LanguageModelDataPart) {
				if (part.mimeType.startsWith("image/")) {
					images.push(imagePart(part));
				} else if (isTextual(part.mimeType)) {
					text.push(new TextDecoder().decode(part.data));
				}
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCalls.push({
					id: part.callId,
					type: "function",
					function: {
						name: part.name,
						arguments: JSON.stringify(part.input ?? {}),
					},
				});
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				const result = toolResultContent(part);
				toolResults.push({
					role: "tool",
					tool_call_id: part.callId,
					content: result.text,
				});
				toolImages.push(...result.images);
			}
		}

		// Tool messages must directly follow the assistant turn that issued the
		// calls, so they go before any other content of this message.
		out.push(...toolResults);
		pendingImages.push(...toolImages);

		const content = text.join("");
		if (
			content ||
			images.length > 0 ||
			toolCalls.length > 0 ||
			role === "assistant"
		) {
			flushImages();
		}
		if (role === "assistant") {
			if (content || toolCalls.length > 0) {
				out.push({
					role,
					content: content || null,
					...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
				});
			}
		} else if (role === "system") {
			if (content) {
				out.push({ role, content });
			}
		} else if (images.length > 0) {
			const parts: ChatContentPart[] = content
				? [{ type: "text", text: content }, ...images]
				: images;
			out.push({ role: "user", content: parts });
		} else if (content) {
			out.push({ role: "user", content });
		}
	}
	flushImages();
	return out;
}

export function toChatTools(
	tools: readonly vscode.LanguageModelChatTool[] | undefined,
): ChatTool[] | undefined {
	if (!tools?.length) {
		return undefined;
	}
	return tools.map((tool) => ({
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema ?? { type: "object", properties: {} },
		},
	}));
}

export function parseToolArguments(raw: string): Record<string, unknown> {
	if (!raw.trim()) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		return typeof parsed === "object" &&
			parsed !== null &&
			!Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function toRole(role: vscode.LanguageModelChatMessageRole): Role {
	if (role === vscode.LanguageModelChatMessageRole.Assistant) {
		return "assistant";
	}
	const system = (
		vscode.LanguageModelChatMessageRole as unknown as { System?: number }
	).System;
	if (system !== undefined && role === system) {
		return "system";
	}
	return "user";
}

function toolResultContent(part: vscode.LanguageModelToolResultPart): {
	text: string;
	images: ChatContentPart[];
} {
	const chunks: string[] = [];
	const images: ChatContentPart[] = [];
	for (const item of part.content) {
		if (item instanceof vscode.LanguageModelTextPart) {
			chunks.push(item.value);
		} else if (item instanceof vscode.LanguageModelDataPart) {
			if (item.mimeType.startsWith("image/")) {
				images.push(imagePart(item));
			} else if (isTextual(item.mimeType)) {
				chunks.push(new TextDecoder().decode(item.data));
			}
		} else {
			chunks.push(JSON.stringify(item));
		}
	}
	return { text: chunks.join("\n"), images };
}

function imagePart(part: vscode.LanguageModelDataPart): ChatContentPart {
	return {
		type: "image_url",
		image_url: {
			url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString("base64")}`,
		},
	};
}

function isTextual(mimeType: string): boolean {
	const type = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
	return (
		type.startsWith("text/") ||
		type === "application/json" ||
		(type.startsWith("application/") && type.endsWith("+json"))
	);
}
