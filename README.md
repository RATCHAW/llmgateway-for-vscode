# LLM Gateway for VS Code

Use every model on [LLM Gateway](https://llmgateway.io) directly in VS Code chat and agent mode. The extension registers LLM Gateway as a native language model provider, so gateway models show up in the Copilot Chat model picker next to the built-in ones, with tool calling, image input, reasoning, and usage reporting.

## Setup

1. Install the extension.
2. Open the chat view, click the model picker, and choose **Manage Models…**.
3. Pick **LLM Gateway**. You are prompted for an API key from the [dashboard](https://llmgateway.io/dashboard/api-keys) (starts with `llmgtwy_`). DevPass keys work too.
4. Select any LLM Gateway model from the picker.

**LLM Gateway: Set API Key** and **Clear API Key** in the command palette manage the same key. It is stored in VS Code's secret storage and never written to settings files.

## Settings

| Setting                      | Default                        | Description                                                                   |
| ---------------------------- | ------------------------------ | ----------------------------------------------------------------------------- |
| `llmgateway.baseUrl`         | `https://api.llmgateway.io/v1` | Gateway base URL. Change only for self-hosted gateways.                       |
| `llmgateway.models`          | `[]`                           | Model IDs to show in the picker. Empty shows every model your key can access. |
| `llmgateway.reasoningEffort` | `default`                      | Reasoning effort sent to models that support it.                              |

## Commands

- **LLM Gateway: Set API Key**
- **LLM Gateway: Clear API Key**
- **LLM Gateway: Refresh Models**
- **LLM Gateway: Open Dashboard**

## How it works

Models are fetched from `/v1/models` with your key, so the list already reflects your organization's model access and any DevPass plan restrictions. Chat requests stream through `/v1/chat/completions` and show up in your dashboard as the `llmgateway-vscode` source.

## Development

```sh
pnpm install
pnpm watch          # rebuild on change
# press F5 in VS Code to launch the Extension Development Host
pnpm test
pnpm package        # builds llmgateway-vscode-<version>.vsix
```

## License

MIT
