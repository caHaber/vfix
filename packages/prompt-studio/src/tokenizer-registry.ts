import type { Tokenizer, TokenizerID, TokenizerLoader, EncodedResult } from './types.js';

/** Wraps js-tiktoken into our Tokenizer interface */
class TiktokenTokenizer implements Tokenizer {
  constructor(
    readonly id: TokenizerID,
    private encoder: { encode: (text: string) => number[]; decode: (tokens: number[]) => string },
  ) {}

  encode(text: string): number[] {
    return this.encoder.encode(text);
  }

  decode(tokens: number[]): string {
    return this.encoder.decode(tokens);
  }

  encodeWithOffsets(text: string): EncodedResult {
    const tokens = this.encoder.encode(text);
    const texts: string[] = [];

    // Decode each token individually to get its text
    for (const token of tokens) {
      texts.push(this.encoder.decode([token]));
    }

    return { tokens, texts };
  }
}

/** Registry for pluggable tokenizers with lazy loading */
export class TokenizerRegistry {
  private loaders = new Map<TokenizerID, TokenizerLoader>();
  private instances = new Map<TokenizerID, Tokenizer>();
  private loading = new Map<TokenizerID, Promise<Tokenizer>>();

  constructor() {
    // Register built-in tokenizers (js-tiktoken based)
    this.register('cl100k_base', async () => {
      const { getEncoding } = await import('js-tiktoken');
      const enc = getEncoding('cl100k_base');
      return new TiktokenTokenizer('cl100k_base', enc);
    });

    this.register('o200k_base', async () => {
      const { getEncoding } = await import('js-tiktoken');
      const enc = getEncoding('o200k_base');
      return new TiktokenTokenizer('o200k_base', enc);
    });
  }

  /** Register a tokenizer loader */
  register(id: TokenizerID, loader: TokenizerLoader): void {
    this.loaders.set(id, loader);
  }

  /** Load a tokenizer (lazy, cached) */
  async load(id: TokenizerID): Promise<Tokenizer> {
    const existing = this.instances.get(id);
    if (existing) return existing;

    const inflight = this.loading.get(id);
    if (inflight) return inflight;

    const loader = this.loaders.get(id);
    if (!loader) throw new Error(`Unknown tokenizer: ${id}`);

    const promise = loader().then((tokenizer) => {
      this.instances.set(id, tokenizer);
      this.loading.delete(id);
      return tokenizer;
    });

    this.loading.set(id, promise);
    return promise;
  }

  /** Check if a tokenizer is loaded */
  isLoaded(id: TokenizerID): boolean {
    return this.instances.has(id);
  }

  /** Get a loaded tokenizer (throws if not loaded) */
  get(id: TokenizerID): Tokenizer {
    const tokenizer = this.instances.get(id);
    if (!tokenizer) throw new Error(`Tokenizer not loaded: ${id}. Call load() first.`);
    return tokenizer;
  }

  /** List all registered tokenizer IDs */
  listAvailable(): TokenizerID[] {
    return Array.from(this.loaders.keys());
  }
}

/** Shared singleton registry */
export const registry = new TokenizerRegistry();
