export function parseCommaSeparatedTerms(value: string, uppercase = false): string[] {
  return value
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean)
    .map((term) => (uppercase ? term.toUpperCase() : term));
}
