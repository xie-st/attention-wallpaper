export interface SourceArticle {
  id: string;
  title: string;
  plainText: string;
  paragraphs: string[];
  importedAt: number;
}

export interface CreateArticleInput {
  title: string;
  plainText: string;
  paragraphs: string[];
}

export type ValidationError = { field: "title" | "plainText"; message: string };

export function validateArticle(input: CreateArticleInput): ValidationError[] {
  const errors: ValidationError[] = [];
  if (input.title.trim().length === 0) {
    errors.push({ field: "title", message: "title must not be empty" });
  }
  if (input.plainText.trim().length === 0) {
    errors.push({ field: "plainText", message: "plainText must not be empty" });
  }
  return errors;
}

export function splitParagraphs(plainText: string): string[] {
  return plainText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function newArticle(
  id: string,
  title: string,
  plainText: string,
  importedAt: number,
): SourceArticle {
  return {
    id,
    title: title.trim(),
    plainText: plainText.trim(),
    paragraphs: splitParagraphs(plainText),
    importedAt,
  };
}
