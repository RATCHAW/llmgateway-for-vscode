export enum LanguageModelChatMessageRole {
	User = 1,
	Assistant = 2,
	System = 3,
}

export enum LanguageModelChatToolMode {
	Auto = 1,
	Required = 2,
}

export class LanguageModelTextPart {
	constructor(public value: string) {}
}

export class LanguageModelDataPart {
	constructor(
		public data: Uint8Array,
		public mimeType: string,
	) {}
	static text(value: string, mime = "text/plain") {
		return new LanguageModelDataPart(new TextEncoder().encode(value), mime);
	}
	static image(data: Uint8Array, mime: string) {
		return new LanguageModelDataPart(data, mime);
	}
}

export class LanguageModelToolCallPart {
	constructor(
		public callId: string,
		public name: string,
		public input: object,
	) {}
}

export class LanguageModelToolResultPart {
	constructor(
		public callId: string,
		public content: unknown[],
	) {}
}

export class EventEmitter<T> {
	private listeners: Array<(value: T) => void> = [];
	event = (listener: (value: T) => void) => {
		this.listeners.push(listener);
		return { dispose: () => undefined };
	};
	fire(value: T) {
		for (const listener of this.listeners) {
			listener(value);
		}
	}
	dispose() {}
}

export class CancellationError extends Error {}

export const workspace = {
	getConfiguration: () => ({
		get: <T>(_key: string, fallback: T) => fallback,
	}),
};
