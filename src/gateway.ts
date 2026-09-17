import { SOURCE } from "./constants";

export interface GatewayModel {
	id: string;
	name: string;
	display_name?: string;
	description?: string;
	family: string;
	architecture: {
		input_modalities: string[];
		output_modalities: string[];
	};
	providers: Array<{
		providerId: string;
		tools: boolean;
		vision: boolean;
		reasoning: boolean;
		streaming: boolean | "only";
		max_output?: number;
	}>;
	pricing: { prompt: string; completion: string };
	context_length?: number;
	max_output?: number;
	free?: boolean;
	deactivated_at?: string;
	deprecated_at?: string;
	stability?: string;
}

export type ChatContentPart =
	| { type: "text"; text: string }
	| { type: "image_url"; image_url: { url: string } };

export interface ChatToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

export type ChatMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: string | ChatContentPart[] }
	| { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
	| { role: "tool"; tool_call_id: string; content: string };

export interface ChatTool {
	type: "function";
	function: { name: string; description?: string; parameters: object };
}

export interface ChatRequest {
	model: string;
	messages: ChatMessage[];
	tools?: ChatTool[];
	tool_choice?: "auto" | "required" | "none";
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	reasoning_effort?: string;
}

export interface ChatChunk {
	choices?: Array<{
		delta?: {
			content?: string | null;
			reasoning?: string | null;
			reasoning_content?: string | null;
			tool_calls?: Array<{
				index: number;
				id?: string;
				function?: { name?: string; arguments?: string };
			}>;
		};
		finish_reason?: string | null;
	}>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	} | null;
	error?: { message?: string };
}

export class GatewayError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "GatewayError";
	}
}

export interface ClientInfo {
	extensionVersion: string;
	vscodeVersion: string;
}

export class GatewayClient {
	constructor(
		private readonly baseUrl: string,
		private readonly apiKey: string | undefined,
		private readonly info: ClientInfo,
	) {}

	private headers(): Record<string, string> {
		const headers: Record<string, string> = {
			"content-type": "application/json",
			"x-source": SOURCE,
			"user-agent": `${SOURCE}/${this.info.extensionVersion} vscode/${this.info.vscodeVersion}`,
		};
		if (this.apiKey) {
			headers.authorization = `Bearer ${this.apiKey}`;
		}
		return headers;
	}

	async listModels(signal: AbortSignal): Promise<GatewayModel[]> {
		const response = await fetch(`${this.baseUrl}/models`, {
			headers: this.headers(),
			signal,
		});
		await throwIfNotOk(response);
		const body = (await response.json()) as { data?: GatewayModel[] };
		return body.data ?? [];
	}

	async *streamChat(
		request: ChatRequest,
		signal: AbortSignal,
	): AsyncGenerator<ChatChunk> {
		const response = await fetch(`${this.baseUrl}/chat/completions`, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({
				...request,
				stream: true,
				stream_options: { include_usage: true },
			}),
			signal,
		});
		await throwIfNotOk(response);
		if (!response.body) {
			throw new GatewayError("Empty response body", response.status);
		}
		for await (const data of readSse(response.body, signal)) {
			if (data === "[DONE]") {
				return;
			}
			const chunk = JSON.parse(data) as ChatChunk;
			if (chunk.error) {
				throw new GatewayError(
					chunk.error.message ?? "Unknown gateway error",
					response.status,
				);
			}
			yield chunk;
		}
	}
}

async function throwIfNotOk(response: Response): Promise<void> {
	if (response.ok) {
		return;
	}
	const text = await response.text().catch(() => "");
	throw new GatewayError(errorMessage(text, response.status), response.status);
}

function errorMessage(body: string, status: number): string {
	try {
		const parsed = JSON.parse(body) as {
			error?: { message?: string } | string;
			message?: string;
		};
		const fromError =
			typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
		const message = fromError ?? parsed.message;
		if (message) {
			return message;
		}
	} catch {
		// not JSON
	}
	return body.trim() || `HTTP ${status}`;
}

const EVENT_BOUNDARY = /\r?\n\r?\n/;

/** Yields the `data:` payload of each server-sent event. */
export async function* readSse(
	body: ReadableStream<Uint8Array>,
	signal: AbortSignal,
): AsyncGenerator<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (!signal.aborted) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			let boundary = EVENT_BOUNDARY.exec(buffer);
			while (boundary) {
				const event = buffer.slice(0, boundary.index);
				buffer = buffer.slice(boundary.index + boundary[0].length);
				const data = parseEventData(event);
				if (data !== undefined) {
					yield data;
				}
				boundary = EVENT_BOUNDARY.exec(buffer);
			}
		}
		const tail = parseEventData(buffer);
		if (tail !== undefined) {
			yield tail;
		}
	} finally {
		reader.releaseLock();
	}
}

function parseEventData(event: string): string | undefined {
	const lines = event
		.split("\n")
		.map((line) => line.replace(/\r$/, ""))
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).replace(/^ /, ""));
	if (lines.length === 0) {
		return undefined;
	}
	const data = lines.join("\n");
	return data.length > 0 ? data : undefined;
}
