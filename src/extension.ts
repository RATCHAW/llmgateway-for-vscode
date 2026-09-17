import * as vscode from "vscode";

import { ApiKeyStore } from "./auth";
import { DASHBOARD_URL, VENDOR } from "./config";
import { LlmGatewayChatProvider } from "./provider";

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel("LLM Gateway");
	const keys = new ApiKeyStore(context.secrets);
	const provider = new LlmGatewayChatProvider(
		keys,
		{
			extensionVersion: String(
				context.extension.packageJSON.version ?? "0.0.0",
			),
			vscodeVersion: vscode.version,
		},
		output,
	);

	context.subscriptions.push(
		output,
		provider,
		vscode.lm.registerLanguageModelChatProvider(VENDOR, provider),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("llmgateway")) {
				provider.refresh();
			}
		}),
		vscode.commands.registerCommand("llmgateway.setApiKey", async () => {
			if (await keys.prompt()) {
				provider.refresh();
				void vscode.window.showInformationMessage("LLM Gateway API key saved.");
			}
		}),
		vscode.commands.registerCommand("llmgateway.clearApiKey", async () => {
			await keys.delete();
			provider.refresh();
			void vscode.window.showInformationMessage("LLM Gateway API key cleared.");
		}),
		vscode.commands.registerCommand("llmgateway.refreshModels", () =>
			provider.refresh(),
		),
		vscode.commands.registerCommand("llmgateway.openDashboard", () =>
			vscode.env.openExternal(vscode.Uri.parse(DASHBOARD_URL)),
		),
	);
	output.appendLine("LLM Gateway chat provider activated.");
}

export function deactivate(): void {}
