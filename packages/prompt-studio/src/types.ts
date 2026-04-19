/** Supported tokenizer identifiers */
export type TokenizerID =
  | 'cl100k_base'
  | 'o200k_base'
  | (string & {});

/** Model identifier for pricing */
export type ModelID =
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gpt-4-turbo'
  | 'gpt-3.5-turbo'
  | 'claude-sonnet-4-20250514'
  | 'claude-haiku-4-20250414'
  | 'claude-opus-4-20250514'
  | (string & {});

/** A single token with position information */
export interface Token {
  /** Tokenizer-specific token ID */
  id: number;
  /** Text representation */
  text: string;
  /** Character offset start in source */
  charStart: number;
  /** Character offset end in source */
  charEnd: number;
}

/** Full analysis result */
export interface Analysis {
  tokens: Token[];
  tokenCount: number;
  characterCount: number;
  estimatedCost?: { input: number; output: number; currency: 'USD' };
  contextWindow?: { used: number; total: number; percentage: number };
  warnings: Warning[];
  sections: SectionAnalysis[];
  density: number;
}

/** Warning emitted during analysis */
export interface Warning {
  type: 'context_window_exceeded' | 'context_window_near' | 'high_density';
  message: string;
}

/** Per-section token breakdown */
export interface SectionAnalysis {
  label: string;
  charStart: number;
  charEnd: number;
  tokenCount: number;
}

/** Tokenizer interface — pluggable */
export interface Tokenizer {
  id: TokenizerID;
  encode(text: string): number[];
  decode(tokens: number[]): string;
  encodeWithOffsets(text: string): EncodedResult;
  destroy?(): void;
}

/** Result of encoding with offset tracking */
export interface EncodedResult {
  tokens: number[];
  texts: string[];
}

/** Lazy tokenizer loader */
export type TokenizerLoader = () => Promise<Tokenizer>;

/** Unsubscribe function */
export type Unsubscribe = () => void;

/** Subscriber callback */
export type AnalysisSubscriber = (analysis: Analysis) => void;

/** Diff operation types */
export type DiffOp =
  | { type: 'equal'; tokens: Token[] }
  | { type: 'insert'; tokens: Token[] }
  | { type: 'delete'; tokens: Token[] };

/** Token-level diff result */
export interface TokenDiff {
  ops: DiffOp[];
  tokenDelta: number;
  costDelta?: number;
}

/** Model pricing info (per 1M tokens) */
export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  contextWindow: number;
  tokenizer: TokenizerID;
}
