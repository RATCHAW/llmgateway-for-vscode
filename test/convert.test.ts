import { describe, expect, it } from "vitest";
import * as vscode from "vscode";

import {
	parseToolArguments,
	toChatMessages,
	toChatTools,
} from "../src/convert";

const SYSTEM = 3 as vscode.LanguageModelChatMessageRole;

function msg(role: vscode.LanguageModelChatMessageRole, content: unknown[]) {
	return {
		role,
		content,
		name: undefined,
	} as vscode.LanguageModelChatRequestMessage;
}

describe("toChatMessages", () => {
	it("maps roles and joins text parts", () => {
		const out = toChatMessages([
			msg(SYSTEM, [new vscode.LanguageModelTextPart("be brief")]),
			msg(vscode.LanguageModelChatMessageRole.User, [
				new vscode.LanguageModelTextPart("hello "),
				new vscode.LanguageModelTextPart("world"),
			]),
			msg(vscode.LanguageModelChatMessageRole.Assistant, [
				new vscode.LanguageModelTextPart("hi"),
			]),
		]);
		expect(out).toEqual([
			{ role: "system", content: "be brief" },
			{ role: "user", content: "hello world" },
			{ role: "assistant", content: "hi" },
		]);
	});

	it("emits tool calls on the assistant turn and tool results as tool messages", () => {
		const out = toChatMessages([
			msg(vscode.LanguageModelChatMessageRole.Assistant, [
				new vscode.LanguageModelToolCallPart("call_1", "read_file", {
					path: "a.ts",
				}),
			]),
			msg(vscode.LanguageModelChatMessageRole.User, [
				new vscode.LanguageModelToolResultPart("call_1", [
					new vscode.LanguageModelTextPart("contents"),
				]),
			]),
		]);
		expect(out).toEqual([
			{
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "call_1",
						type: "function",
						function: { name: "read_file", arguments: '{"path":"a.ts"}' },
					},
				],
			},
			{ role: "tool", tool_call_id: "call_1", content: "contents" },
		]);
	});

	it("keeps tool results ahead of user text in the same message", () => {
		const out = toChatMessages([
			msg(vscode.LanguageModelChatMessageRole.Assistant, [
				new vscode.LanguageModelToolCallPart("call_1", "t", {}),
			]),
			msg(vscode.LanguageModelChatMessageRole.User, [
				new vscode.LanguageModelToolResultPart("call_1", [
					new vscode.LanguageModelTextPart("result"),
				]),
				new vscode.LanguageModelTextPart("now continue"),
			]),
		]);
		expect(out.map((m) => m.role)).toEqual(["assistant", "tool", "user"]);
	});

	it("forwards images returned by tools as a user message", () => {
		const out = toChatMessages([
			msg(vscode.LanguageModelChatMessageRole.User, [
				new vscode.LanguageModelToolResultPart("call_1", [
					new vscode.LanguageModelTextPart("screenshot"),
					vscode.LanguageModelDataPart.image(new Uint8Array([1]), "image/png"),
				]),
			]),
		]);
		expect(out).toEqual([
			{ role: "tool", tool_call_id: "call_1", content: "screenshot" },
			{
				role: "user",
				content: [
					{
						type: "image_url",
						image_url: { url: "data:image/png;base64,AQ==" },
					},
				],
			},
		]);
	});

	it("holds tool images until every tool result of the round is emitted", () => {
		const out = toChatMessages([
			msg(vscode.LanguageModelChatMessageRole.Assistant, [
				new vscode.LanguageModelToolCallPart("call_1", "a", {}),
				new vscode.LanguageModelToolCallPart("call_2", "b", {}),
			]),
			msg(vscode.LanguageModelChatMessageRole.User, [
				new vscode.LanguageModelToolResultPart("call_1", [
					vscode.LanguageModelDataPart.image(new Uint8Array([1]), "image/png"),
				]),
			]),
			msg(vscode.LanguageModelChatMessageRole.User, [
				new vscode.LanguageModelToolResultPart("call_2", [
					new vscode.LanguageModelTextPart("ok"),
				]),
			]),
			msg(vscode.LanguageModelChatMessageRole.User, [
				new vscode.LanguageModelTextPart("next"),
			]),
		]);
		expect(out.map((m) => m.role)).toEqual([
			"assistant",
			"tool",
			"tool",
			"user",
			"user",
		]);
		expect(out[3]).toMatchObject({ content: [{ type: "image_url" }] });
		expect(out[4]).toEqual({ role: "user", content: "next" });
	});

	it("inlines images as data URLs", () => {
		const out = toChatMessages([
			msg(vscode.LanguageModelChatMessageRole.User, [
				new vscode.LanguageModelTextPart("what is this"),
				vscode.LanguageModelDataPart.image(
					new Uint8Array([1, 2, 3]),
					"image/png",
				),
			]),
		]);
		expect(out).toEqual([
			{
				role: "user",
				content: [
					{ type: "text", text: "what is this" },
					{
						type: "image_url",
						image_url: { url: "data:image/png;base64,AQID" },
					},
				],
			},
		]);
	});

	it("drops empty user turns", () => {
		expect(
			toChatMessages([msg(vscode.LanguageModelChatMessageRole.User, [])]),
		).toEqual([]);
	});
});

describe("toChatTools", () => {
	it("returns undefined without tools and fills a default schema", () => {
		expect(toChatTools(undefined)).toBeUndefined();
		expect(toChatTools([{ name: "t", description: "d" }])).toEqual([
			{
				type: "function",
				function: {
					name: "t",
					description: "d",
					parameters: { type: "object", properties: {} },
				},
			},
		]);
	});
});

describe("parseToolArguments", () => {
	it("tolerates empty and malformed input", () => {
		expect(parseToolArguments("")).toEqual({});
		expect(parseToolArguments("{bad")).toEqual({});
		expect(parseToolArguments("[1]")).toEqual({});
		expect(parseToolArguments('{"a":1}')).toEqual({ a: 1 });
	});
});
