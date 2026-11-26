export function searchQueryValidationError(query: string | undefined): string | null {
  const normalized = query?.trim();
  if (!normalized || normalized.length < 2) return 'Enter at least two characters to search';
  if (normalized.length > 100) return 'Search text must be 100 characters or fewer';
  return null;
}
