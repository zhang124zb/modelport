import type { CodeHighlighterPlugin } from "@streamdown/code";
import type { BundledLanguage } from "shiki";
import { bundledLanguagesInfo, createHighlighter } from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

const aliases = new Map(bundledLanguagesInfo.flatMap(language =>
  [language.id, ...(language.aliases ?? [])].map(alias => [alias, language.id as BundledLanguage] as const)));
const highlighters = new Map<string, ReturnType<typeof createHighlighter>>();

export const code: CodeHighlighterPlugin = {
  name: "shiki",
  type: "code-highlighter",
  getSupportedLanguages: () => [...aliases.keys()] as ReturnType<CodeHighlighterPlugin["getSupportedLanguages"]>,
  getThemes: () => ["github-light", "github-dark"],
  supportsLanguage: language => aliases.has(language.toLowerCase()),
  highlight({ code: source, language, themes }, callback) {
    const lang = aliases.get(language.toLowerCase()) ?? "text";
    const key = JSON.stringify([lang, themes]);
    let highlighter = highlighters.get(key);
    if (!highlighter) {
      highlighter = createHighlighter({ langs: [lang], themes,
        engine: createJavaScriptRegexEngine({ forgiving: true }) });
      highlighters.set(key, highlighter);
      void highlighter.catch(() => { highlighters.delete(key); });
    }
    // Reuse grammars/themes, never partial-source cache keys. Each block is
    // tokenized from its full source, including during concurrent streaming.
    void highlighter.then(instance => callback?.(instance.codeToTokens(source, {
      lang,
      themes: { light: typeof themes[0] === "string" ? themes[0] : themes[0].name ?? "custom",
        dark: typeof themes[1] === "string" ? themes[1] : themes[1].name ?? "custom" },
    }))).catch(() => { /* Streamdown keeps the original plain text on failure. */ });
    return null;
  },
};
