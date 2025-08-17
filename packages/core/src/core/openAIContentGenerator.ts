/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Content,
  CountTokensResponse,
  EmbedContentResponse,
  EmbedContentParameters,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  Part,
} from '@google/genai';
import { ContentGenerator } from './contentGenerator.js';

// Define local types to avoid dependency on the 'openai' package.
type OpenAIRole = 'user' | 'assistant' | 'system' | 'tool';

interface OpenAIChatCompletionContentPart {
  type: 'text';
  text: string;
}

interface OpenAIChatCompletionMessageParam {
  role: OpenAIRole;
  content: string | OpenAIChatCompletionContentPart[];
}

function toOpenAIChatCompletionMessage(
  content: Content,
): OpenAIChatCompletionMessageParam {
  const role = toOpenAIRole(content.role);
  const parts = content.parts?.map(toOpenAIPart) || [];
  // TODO: How to handle multiple parts?
  const messagePart = parts[0];
  if (messagePart.type == 'text') {
    return {
      role: role,
      content: messagePart.text,
    };
  }
  // TODO: How to handle function calls?
  throw new Error('Unsupported part type');
}

function toOpenAIRole(role: Content['role']): OpenAIRole {
  switch (role) {
    case 'user':
      return 'user';
    case 'model':
      return 'assistant';
    // TODO: How to handle tool role?
    default:
      throw new Error(`Unsupported role: ${role}`);
  }
}

function toOpenAIPart(part: Part): OpenAIChatCompletionContentPart {
  if ('text' in part) {
    return {
      type: 'text',
      text: part.text as string,
    };
  }
  // TODO: How to handle other part types?
  throw new Error('Unsupported part type');
}

export class OpenAIContentGenerator implements ContentGenerator {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
    this.baseUrl =
      baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    if (!this.apiKey) {
      throw new Error(
        'OpenAI API key is not provided. Please set the OPENAI_API_KEY environment variable.',
      );
    }
  }

  private async fetchAPI(
    body: Record<string, any>,
  ): Promise<Response> {
    return fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  }

  async generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {
    const messages = (request.contents as Content[]).map(
      toOpenAIChatCompletionMessage,
    );
    const body = {
      model: process.env.OPENAI_MODEL || '',
      messages: messages,
      stream: false,
    };

    const response = await this.fetchAPI(body);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const responseData = await response.json();
    const choice = responseData.choices[0];
    const message = choice.message;

    return {
      promptFeedback: {
        blockReason: undefined,
        safetyRatings: [],
      },
      candidates: [
        {
          index: choice.index,
          content: {
            role: 'model',
            parts: [{ text: message.content || '' }],
          },
          finishReason: choice.finish_reason as any,
          safetyRatings: [],
          citationMetadata: undefined,
        },
      ],
    } as any;
  }

  async generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const messages = (request.contents as Content[]).map(
      toOpenAIChatCompletionMessage,
    );
    const body = {
      model: process.env.OPENAI_MODEL || '',
      messages: messages,
      stream: true,
    };

    const response = await this.fetchAPI(body);

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const generator = async function* () {
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last partial line for the next chunk

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.substring(6);
            if (data.trim() === '[DONE]') {
              return;
            }
            try {
              const part = JSON.parse(data);
              const choice = part.choices[0];
              const delta = choice.delta;
              yield {
                promptFeedback: {
                  blockReason: undefined,
                  safetyRatings: [],
                },
                candidates: [
                  {
                    index: choice.index,
                    content: {
                      role: 'model',
                      parts: [{ text: delta.content || '' }],
                    },
                    finishReason: choice.finish_reason as any,
                    safetyRatings: [],
                    citationMetadata: undefined,
                  },
                ],
              } as any;
            } catch (e) {
              console.error('Error parsing OpenAI stream data:', e);
            }
          }
        }
      }
    };

    return generator();
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    // TODO: Implement token counting for OpenAI
    console.warn('Token counting is not yet implemented for OpenAI.');
    return {
      totalTokens: 0,
    };
  }

  async embedContent(
    request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    // TODO: Implement content embedding for OpenAI
    console.warn('Content embedding is not yet implemented for OpenAI.');
    return {
      embeddings: [],
    };
  }
}
