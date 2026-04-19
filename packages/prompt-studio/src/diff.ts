import type { DiffOp, Token, TokenDiff, Tokenizer, ModelID } from './types.js';
import { getModelPricing } from './pricing.js';

/**
 * Myers diff algorithm on token ID arrays.
 * Returns edit script as a sequence of equal/insert/delete ops.
 */
function myersDiff(a: number[], b: number[]): { type: 'equal' | 'insert' | 'delete'; index: number }[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;

  if (max === 0) return [];

  // For very large inputs, fall back to a simpler LCS approach
  if (max > 20_000) {
    return simpleDiff(a, b);
  }

  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    const vCopy = new Int32Array(v);
    trace.push(vCopy);

    for (let k = -d; k <= d; k += 2) {
      const kIdx = k + max;
      let x: number;

      if (k === -d || (k !== d && v[kIdx - 1] < v[kIdx + 1])) {
        x = v[kIdx + 1];
      } else {
        x = v[kIdx - 1] + 1;
      }

      let y = x - k;

      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }

      v[kIdx] = x;

      if (x >= n && y >= m) {
        return backtrack(trace, a, b, max);
      }
    }
  }

  return simpleDiff(a, b);
}

function backtrack(
  trace: Int32Array[],
  a: number[],
  b: number[],
  max: number,
): { type: 'equal' | 'insert' | 'delete'; index: number }[] {
  const ops: { type: 'equal' | 'insert' | 'delete'; index: number }[] = [];
  let x = a.length;
  let y = b.length;

  for (let d = trace.length - 1; d > 0; d--) {
    const v = trace[d - 1];
    const k = x - y;
    const kIdx = k + max;

    let prevK: number;
    if (k === -d || (k !== d && v[kIdx - 1] < v[kIdx + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    let prevX = v[prevK + max];
    let prevY = prevX - prevK;

    // Diagonal (equal)
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ type: 'equal', index: x });
    }

    if (x === prevX && y > prevY) {
      // Vertical: insertion
      y--;
      ops.push({ type: 'insert', index: y });
    } else if (y === prevY && x > prevX) {
      // Horizontal: deletion
      x--;
      ops.push({ type: 'delete', index: x });
    }
  }

  // Handle remaining diagonal at d=0
  while (x > 0 && y > 0) {
    x--;
    y--;
    ops.push({ type: 'equal', index: x });
  }

  return ops.reverse();
}

/** Simple fallback diff for very large inputs */
function simpleDiff(a: number[], b: number[]): { type: 'equal' | 'insert' | 'delete'; index: number }[] {
  const ops: { type: 'equal' | 'insert' | 'delete'; index: number }[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', index: i });
      i++;
      j++;
    } else {
      ops.push({ type: 'delete', index: i });
      i++;
    }
  }

  while (i < a.length) {
    ops.push({ type: 'delete', index: i++ });
  }
  while (j < b.length) {
    ops.push({ type: 'insert', index: j++ });
  }

  return ops;
}

/** Compute token-level diff between two texts */
export function tokenDiff(
  before: string,
  after: string,
  tokenizer: Tokenizer,
  model?: ModelID,
): TokenDiff {
  const encBefore = tokenizer.encodeWithOffsets(before);
  const encAfter = tokenizer.encodeWithOffsets(after);

  const rawOps = myersDiff(encBefore.tokens, encAfter.tokens);

  // Build Token objects and group consecutive same-type ops
  const ops: DiffOp[] = [];
  let currentType: DiffOp['type'] | null = null;
  let currentTokens: Token[] = [];

  let beforeCharPos = 0;
  let afterCharPos = 0;

  // Rebuild char positions for before/after
  const beforePositions: { charStart: number; charEnd: number }[] = [];
  let pos = 0;
  for (const text of encBefore.texts) {
    beforePositions.push({ charStart: pos, charEnd: pos + text.length });
    pos += text.length;
  }

  const afterPositions: { charStart: number; charEnd: number }[] = [];
  pos = 0;
  for (const text of encAfter.texts) {
    afterPositions.push({ charStart: pos, charEnd: pos + text.length });
    pos += text.length;
  }

  let bIdx = 0;
  let aIdx = 0;

  for (const op of rawOps) {
    if (op.type !== currentType && currentTokens.length > 0) {
      ops.push({ type: currentType!, tokens: currentTokens });
      currentTokens = [];
    }
    currentType = op.type;

    if (op.type === 'equal') {
      const bp = beforePositions[bIdx];
      currentTokens.push({
        id: encBefore.tokens[bIdx],
        text: encBefore.texts[bIdx],
        charStart: bp?.charStart ?? 0,
        charEnd: bp?.charEnd ?? 0,
      });
      bIdx++;
      aIdx++;
    } else if (op.type === 'delete') {
      const bp = beforePositions[bIdx];
      currentTokens.push({
        id: encBefore.tokens[bIdx],
        text: encBefore.texts[bIdx],
        charStart: bp?.charStart ?? 0,
        charEnd: bp?.charEnd ?? 0,
      });
      bIdx++;
    } else {
      const ap = afterPositions[aIdx];
      currentTokens.push({
        id: encAfter.tokens[aIdx],
        text: encAfter.texts[aIdx],
        charStart: ap?.charStart ?? 0,
        charEnd: ap?.charEnd ?? 0,
      });
      aIdx++;
    }
  }

  if (currentTokens.length > 0 && currentType) {
    ops.push({ type: currentType, tokens: currentTokens });
  }

  const tokenDelta = encAfter.tokens.length - encBefore.tokens.length;
  const pricing = model ? getModelPricing(model) : undefined;
  const costDelta = pricing
    ? (tokenDelta / 1_000_000) * pricing.inputPer1M
    : undefined;

  return { ops, tokenDelta, costDelta };
}
