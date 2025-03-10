import { OpenAI } from "openai";
import { getGlobalConfig } from "../utils/config";
import { ProxyAgent, fetch } from "undici";

export async function getCompletion(
	type: "large" | "small",
	opts: OpenAI.ChatCompletionCreateParams,
): Promise<OpenAI.ChatCompletion | AsyncIterable<OpenAI.ChatCompletionChunk>> {
	const config = getGlobalConfig();
	const apiKey =
		type === "large" ? config.largeModelApiKey : config.smallModelApiKey;
	const baseURL =
		type === "large" ? config.largeModelBaseURL : config.smallModelBaseURL;
	const proxy = config.proxy ? new ProxyAgent(config.proxy) : undefined;

	if (opts.stream) {
		const response = await fetch(`${baseURL}/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ ...opts, stream: true }),
			dispatcher: proxy,
		});

		if (!response.ok) {
			const error = (await response.json()) as { error?: { message: string } };
			throw new Error(
				`API request failed: ${error.error?.message || JSON.stringify(error)}`,
			);
		}

		return createStreamProcessor(response.body as any);
	}

	const response = await fetch(`${baseURL}/chat/completions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(opts),
		dispatcher: proxy,
	});
	return response.json() as Promise<OpenAI.ChatCompletion>;
}

export function createStreamProcessor(
	stream: any,
): AsyncGenerator<OpenAI.ChatCompletionChunk, void, unknown> {
	if (!stream) {
		throw new Error("Stream is null or undefined");
	}

	return (async function* () {
		const reader = stream.getReader();
		const decoder = new TextDecoder("utf-8");
		let buffer = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				const chunk = decoder.decode(value, { stream: true });
				buffer += chunk;

				let lineEnd = buffer.indexOf("\n");
				while (lineEnd !== -1) {
					const line = buffer.substring(0, lineEnd).trim();
					buffer = buffer.substring(lineEnd + 1);

					if (line === "data: [DONE]") {
						continue;
					}

					if (line.startsWith("data: ")) {
						const data = line.slice(6).trim();
						if (!data) continue;

						try {
							const parsed = JSON.parse(data) as OpenAI.ChatCompletionChunk;
							yield parsed;
						} catch (e) {
							console.error("Error parsing JSON:", data);
						}
					}

					lineEnd = buffer.indexOf("\n");
				}
			}

			// Process any remaining data in the buffer
			if (buffer.trim()) {
				const lines = buffer.trim().split("\n");
				for (const line of lines) {
					if (line.startsWith("data: ") && line !== "data: [DONE]") {
						const data = line.slice(6).trim();
						if (!data) continue;

						try {
							const parsed = JSON.parse(data) as OpenAI.ChatCompletionChunk;
							yield parsed;
						} catch (e) {
							console.error("Error parsing final JSON:", data);
						}
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	})();
}

export function streamCompletion(
	stream: any,
): AsyncGenerator<OpenAI.ChatCompletionChunk, void, unknown> {
	return createStreamProcessor(stream);
}
