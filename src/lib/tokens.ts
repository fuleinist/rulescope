/** Estimated token count for a character count: ceil(chars / 4). */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}