import { describe, it, expect } from "vitest";
import {
  newArticle,
  splitParagraphs,
  validateArticle,
  type CreateArticleInput,
} from "./index";

function input(over: Partial<CreateArticleInput> = {}): CreateArticleInput {
  return {
    title: "标题",
    plainText: "段落一\n\n段落二",
    paragraphs: ["段落一", "段落二"],
    ...over,
  };
}

describe("validateArticle", () => {
  it("accepts valid input", () => {
    expect(validateArticle(input())).toEqual([]);
  });

  it("rejects whitespace-only title", () => {
    const e = validateArticle(input({ title: "   " }));
    expect(e.some((x) => x.field === "title")).toBe(true);
  });

  it("rejects empty plainText", () => {
    const e = validateArticle(input({ plainText: "   " }));
    expect(e.some((x) => x.field === "plainText")).toBe(true);
  });
});

describe("splitParagraphs", () => {
  it("splits on blank lines and trims", () => {
    expect(splitParagraphs("a\n\nb\n\nc")).toEqual(["a", "b", "c"]);
  });

  it("collapses multiple blank lines", () => {
    expect(splitParagraphs("a\n\n\n\nb")).toEqual(["a", "b"]);
  });

  it("drops leading/trailing whitespace-only paragraphs", () => {
    expect(splitParagraphs("\n\na\n\n")).toEqual(["a"]);
  });

  it("returns [] for whitespace-only input", () => {
    expect(splitParagraphs("   \n\n  ")).toEqual([]);
  });
});

describe("newArticle", () => {
  it("builds a SourceArticle with derived paragraphs and trimmed fields", () => {
    const a = newArticle("id-1", "  Title  ", "para-a\n\npara-b", 12345);
    expect(a).toEqual({
      id: "id-1",
      title: "Title",
      plainText: "para-a\n\npara-b",
      paragraphs: ["para-a", "para-b"],
      importedAt: 12345,
    });
  });
});
