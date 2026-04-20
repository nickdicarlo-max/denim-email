import type { EntityGroupInput } from "@denim/types";

const KEYS = {
  category: "denim_onboarding_category",
  names: "denim_onboarding_names",
  schemaId: "denim_onboarding_schemaId",
} as const;

export interface OnboardingCategory {
  role: string;
  domain: string;
  customDescription?: string;
}

export interface OnboardingNames {
  whats: string[];
  whos: string[];
  /** #111: optional user-provided topic name. Empty string = not provided. */
  name?: string;
  /**
   * #117: optional WHO→WHATs pairings collected on the names page. Older
   * saved sessions that predate this field load as undefined and the API
   * call falls back to an empty array in the POST body.
   */
  groups?: EntityGroupInput[];
}

function get<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

function set(key: string, value: unknown): void {
  sessionStorage.setItem(key, JSON.stringify(value));
}

export const onboardingStorage = {
  getCategory: () => get<OnboardingCategory>(KEYS.category),
  setCategory: (data: OnboardingCategory) => set(KEYS.category, data),

  getNames: () => get<OnboardingNames>(KEYS.names),
  setNames: (data: OnboardingNames) => set(KEYS.names, data),

  getSchemaId: () => get<string>(KEYS.schemaId),
  setSchemaId: (id: string) => set(KEYS.schemaId, id),
  clearSchemaId: () => sessionStorage.removeItem(KEYS.schemaId),

  clearAll: () => {
    sessionStorage.removeItem(KEYS.category);
    sessionStorage.removeItem(KEYS.names);
    sessionStorage.removeItem(KEYS.schemaId);
  },
};
