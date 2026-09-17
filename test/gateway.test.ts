import { describe, expect, it } from "vitest";

import { readSse } from "../src/gateway";

function stream(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		},
	});
}

async function collect(chunks: string[]): Promise<string[]> {
	const out: string[] = [];
	for await (const data of readSse(
		stream(chunks),
		new AbortController().signal,
	)) {
		out.push(data);
	}
	return out;
}

describe("readSse", () => {
	it("splits events across chunk boundaries", async () => {
		const out = await collect([
			'data: {"a":1}\n\nda',
			'ta: {"b":2}\n\ndata: [DONE]\n\n',
		]);
		expect(out).toEqual(['{"a":1}', '{"b":2}', "[DONE]"]);
	});

	it("ignores comments and non-data fields and handles CRLF", async () => {
		const out = await collect([
			": keepalive\r\n\r\nevent: x\r\ndata: 1\r\n\r\n",
		]);
		expect(out).toEqual(["1"]);
	});

	it("splits multiple CRLF-delimited events", async () => {
		const out = await collect(['data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n']);
		expect(out).toEqual(['{"a":1}', '{"b":2}']);
	});

	it("yields a trailing event without a terminating blank line", async () => {
		expect(await collect(["data: tail"])).toEqual(["tail"]);
	});
});

import { afterEach, vi } from "vitest";

import { GatewayClient, GatewayError } from "../src/gateway";

function sseResponse(events: string[], status = 200): Response {
	return new Response(events.map((e) => `data: ${e}\n\n`).join(""), {
		status,
		headers: { "content-type": "text/event-stream" },
	});
}

describe("GatewayClient", () => {
	afterEach(() => vi.unstubAllGlobals());

	const client = new GatewayClient("https://gw.test/v1", "llmgtwy_k", {
		extensionVersion: "1.2.3",
		vscodeVersion: "1.134.0",
	});

	it("sends auth, source, and stream options and yields parsed chunks", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				sseResponse([
					'{"choices":[{"delta":{"content":"hi"}}]}',
					'{"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}',
					"[DONE]",
				]),
			);
		vi.stubGlobal("fetch", fetchMock);

		const chunks = [];
		for await (const chunk of client.streamChat(
			{ model: "m", messages: [{ role: "user", content: "x" }] },
			new AbortController().signal,
		)) {
			chunks.push(chunk);
		}
		expect(chunks).toHaveLength(2);
		expect(chunks[1]?.usage?.total_tokens).toBe(3);

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://gw.test/v1/chat/completions");
		const headers = init.headers as Record<string, string>;
		expect(headers.authorization).toBe("Bearer llmgtwy_k");
		expect(headers["x-source"]).toBe("llmgateway-vscode");
		expect(headers["user-agent"]).toBe(
			"llmgateway-vscode/1.2.3 vscode/1.134.0",
		);
		expect(JSON.parse(init.body as string)).toMatchObject({
			model: "m",
			stream: true,
			stream_options: { include_usage: true },
		});
	});

	it("turns HTTP errors into GatewayError with the gateway message", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ error: { message: "bad key" } }), {
					status: 401,
				}),
			),
		);
		const iterator = client.streamChat(
			{ model: "m", messages: [] },
			new AbortController().signal,
		);
		await expect(iterator.next()).rejects.toMatchObject({
			name: "GatewayError",
			status: 401,
			message: "bad key",
		});
	});

	it("lists models with the same headers", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "a" }] })));
		vi.stubGlobal("fetch", fetchMock);
		const models = await client.listModels(new AbortController().signal);
		expect(models.map((m) => m.id)).toEqual(["a"]);
		expect(fetchMock.mock.calls[0]?.[0]).toBe("https://gw.test/v1/models");
		expect(GatewayError.name).toBe("GatewayError");
	});
});
