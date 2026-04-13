declare module 'stopword' {
  /**
   * Language code for stop word lists
   */
  export type LanguageCode = 
    | 'af' | 'ar' | 'bg' | 'bn' | 'ca' | 'cs' | 'da' | 'de' 
    | 'el' | 'en' | 'eo' | 'es' | 'et' | 'eu' | 'fa' | 'fi' 
    | 'fr' | 'ga' | 'gl' | 'gu' | 'ha' | 'he' | 'hi' | 'hr' 
    | 'hu' | 'hy' | 'id' | 'it' | 'ja' | 'ko' | 'ku' | 'lt' 
    | 'lv' | 'mk' | 'ml' | 'mr' | 'ms' | 'nl' | 'no' | 'pa' 
    | 'pl' | 'pt' | 'ro' | 'ru' | 'sk' | 'sl' | 'so' | 'st' 
    | 'sv' | 'sw' | 'ta' | 'te' | 'th' | 'tl' | 'tr' | 'uk' 
    | 'ur' | 'vi' | 'yo' | 'zh' | 'zu';

  /**
   * Stop word list (array of strings)
   */
  export type StopWordList = string[];

  /**
   * English stop words
   */
  export const eng: StopWordList;

  /**
   * All available stop word lists keyed by language code
   */
  export const stopword: Record<LanguageCode, StopWordList>;

  /**
   * Remove stop words from an array of tokens
   * @param tokens - Array of word tokens
   * @param stopwordList - Stop word list to use (default: English)
   * @returns Array of tokens with stop words removed
   */
  export function removeStopwords(
    tokens: string[],
    stopwordList?: StopWordList
  ): string[];
}