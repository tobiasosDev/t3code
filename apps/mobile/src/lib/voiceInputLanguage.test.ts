import { describe, expect, it } from "vite-plus/test";

import {
  normalizeLanguages,
  resolveVoiceInputLanguage,
  voiceInputLanguageChoices,
} from "./voiceInputLanguage";

describe("normalizeLanguages", () => {
  it("keeps string tags in order without duplicates", () => {
    expect(normalizeLanguages(["de-CH", "en-CH", 4, "", "de-CH"])).toEqual(["de-CH", "en-CH"]);
  });

  it("returns nothing for a missing value", () => {
    expect(normalizeLanguages(undefined)).toEqual([]);
  });
});

describe("resolveVoiceInputLanguage", () => {
  it("prefers an explicit choice", () => {
    expect(resolveVoiceInputLanguage("fr-CH", ["de-CH"], "en-CH")).toBe("fr-CH");
  });

  it("follows the device's first language rather than the app locale", () => {
    expect(resolveVoiceInputLanguage(null, ["de-CH", "en-CH"], "en-CH")).toBe("de-CH");
    expect(resolveVoiceInputLanguage(undefined, ["de-CH"], "en-CH")).toBe("de-CH");
  });

  it("falls back to the app locale without a language list", () => {
    expect(resolveVoiceInputLanguage(null, [], "en-US")).toBe("en-US");
  });
});

describe("voiceInputLanguageChoices", () => {
  it("keeps a stored choice that left the device's list", () => {
    expect(voiceInputLanguageChoices("it-CH", ["de-CH"])).toEqual(["de-CH", "it-CH"]);
    expect(voiceInputLanguageChoices("de-CH", ["de-CH"])).toEqual(["de-CH"]);
    expect(voiceInputLanguageChoices(null, ["de-CH"])).toEqual(["de-CH"]);
  });
});
