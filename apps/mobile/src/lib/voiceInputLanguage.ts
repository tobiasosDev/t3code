export function normalizeLanguages(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((tag): tag is string => typeof tag === "string" && tag.length > 0)),
  ];
}

/** An explicit choice wins; otherwise the device's first language, then the app locale. */
export function resolveVoiceInputLanguage(
  preference: string | null | undefined,
  languages: ReadonlyArray<string>,
  fallback: string,
): string {
  return preference ?? languages[0] ?? fallback;
}

/** The choices the setting offers: the device's languages plus a stored choice no longer in it. */
export function voiceInputLanguageChoices(
  preference: string | null | undefined,
  languages: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return preference && !languages.includes(preference) ? [...languages, preference] : languages;
}

/** The language's own name, such as "Deutsch (Schweiz)", or the tag when unknown. */
export function voiceInputLanguageLabel(tag: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}
