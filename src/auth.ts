import * as vscode from "vscode";

import { API_KEYS_URL } from "./config";

const SECRET_KEY = "llmgateway.apiKey";

export class ApiKeyStore {
	constructor(private readonly secrets: vscode.SecretStorage) {}

	get(): Thenable<string | undefined> {
		return this.secrets.get(SECRET_KEY);
	}

	async delete(): Promise<void> {
		await this.secrets.delete(SECRET_KEY);
	}

	async prompt(): Promise<string | undefined> {
		const input = await vscode.window.showInputBox({
			title: "LLM Gateway API Key",
			prompt: `Paste an API key from ${API_KEYS_URL}`,
			placeHolder: "llmgtwy_...",
			password: true,
			ignoreFocusOut: true,
			validateInput: (value) =>
				value.trim().length === 0 ? "API key cannot be empty" : undefined,
		});
		if (!input) {
			return undefined;
		}
		const key = input.trim();
		await this.secrets.store(SECRET_KEY, key);
		return key;
	}
}
