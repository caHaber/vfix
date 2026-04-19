import type {
  Analysis,
  ModelID,
  SectionAnalysis,
  Token,
  Tokenizer,
  Warning,
} from './types.js';
import { getModelPricing } from './pricing.js';

/** Detect sections in text (markdown headers, XML tags, blank-line separated blocks) */
function detectSections(text: string): { label: string; charStart: number; charEnd: number }[] {
  const sections: { label: string; charStart: number; charEnd: number }[] = [];

  // Match markdown headers
  const headerRegex = /^(#{1,6})\s+(.+)$/gm;
  const headers: { level: number; title: string; pos: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = headerRegex.exec(text)) !== null) {
    headers.push({
      level: match[1].length,
      title: match[2].trim(),
      pos: match.index,
    });
  }

  if (headers.length > 0) {
    for (let i = 0; i < headers.length; i++) {
      const start = headers[i].pos;
      const end = i + 1 < headers.length ? headers[i + 1].pos : text.length;
      sections.push({
        label: headers[i].title,
        charStart: start,
        charEnd: end,
      });
    }

    // If there's text before the first header, add it as "Preamble"
    if (headers[0].pos > 0) {
      sections.unshift({
        label: 'Preamble',
        charStart: 0,
        charEnd: headers[0].pos,
      });
    }

    return sections;
  }

  // Fallback: XML-style tags (e.g., <system>, <user>)
  const xmlTagRegex = /<(\w[\w-]*)>/g;
  const xmlTags: { tag: string; pos: number }[] = [];
  while ((match = xmlTagRegex.exec(text)) !== null) {
    xmlTags.push({ tag: match[1], pos: match.index });
  }

  if (xmlTags.length > 0) {
    for (let i = 0; i < xmlTags.length; i++) {
      const start = xmlTags[i].pos;
      const end = i + 1 < xmlTags.length ? xmlTags[i + 1].pos : text.length;
      sections.push({
        label: `<${xmlTags[i].tag}>`,
        charStart: start,
        charEnd: end,
      });
    }
    return sections;
  }

  // No structure detected — single section
  return [{ label: 'Full text', charStart: 0, charEnd: text.length }];
}

/** Analyze text with a given tokenizer */
export function analyze(
  text: string,
  tokenizer: Tokenizer,
  model?: ModelID,
): Analysis {
  if (!text) {
    return {
      tokens: [],
      tokenCount: 0,
      characterCount: 0,
      warnings: [],
      sections: [],
      density: 0,
    };
  }

  // Tokenize with offsets
  const encoded = tokenizer.encodeWithOffsets(text);
  const tokens: Token[] = [];

  let charPos = 0;
  for (let i = 0; i < encoded.tokens.length; i++) {
    const tokenText = encoded.texts[i];
    // Find where this token's text appears starting from current position
    const charStart = charPos;
    const charEnd = charStart + tokenText.length;
    tokens.push({
      id: encoded.tokens[i],
      text: tokenText,
      charStart,
      charEnd,
    });
    charPos = charEnd;
  }

  const tokenCount = tokens.length;
  const characterCount = text.length;
  const density = characterCount > 0 ? tokenCount / characterCount : 0;

  // Warnings
  const warnings: Warning[] = [];
  const pricing = model ? getModelPricing(model) : undefined;

  let estimatedCost: Analysis['estimatedCost'];
  let contextWindow: Analysis['contextWindow'];

  if (pricing) {
    const inputCost = (tokenCount / 1_000_000) * pricing.inputPer1M;
    // Estimate output as ~50% of input tokens for cost projection
    const estimatedOutputTokens = Math.floor(tokenCount * 0.5);
    const outputCost = (estimatedOutputTokens / 1_000_000) * pricing.outputPer1M;
    estimatedCost = { input: inputCost, output: outputCost, currency: 'USD' };

    const percentage = (tokenCount / pricing.contextWindow) * 100;
    contextWindow = {
      used: tokenCount,
      total: pricing.contextWindow,
      percentage,
    };

    if (percentage > 100) {
      warnings.push({
        type: 'context_window_exceeded',
        message: `Token count (${tokenCount.toLocaleString()}) exceeds context window (${pricing.contextWindow.toLocaleString()})`,
      });
    } else if (percentage > 80) {
      warnings.push({
        type: 'context_window_near',
        message: `Token count is ${percentage.toFixed(1)}% of context window`,
      });
    }
  }

  if (density > 0.5) {
    warnings.push({
      type: 'high_density',
      message: `High token density (${density.toFixed(2)} tokens/char) — text may be inefficiently tokenized`,
    });
  }

  // Section analysis
  const rawSections = detectSections(text);
  const sections: SectionAnalysis[] = rawSections.map((section) => {
    const sectionText = text.slice(section.charStart, section.charEnd);
    const sectionTokens = tokenizer.encode(sectionText);
    return {
      label: section.label,
      charStart: section.charStart,
      charEnd: section.charEnd,
      tokenCount: sectionTokens.length,
    };
  });

  return {
    tokens,
    tokenCount,
    characterCount,
    estimatedCost,
    contextWindow,
    warnings,
    sections,
    density,
  };
}
