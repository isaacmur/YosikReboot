// Input checks for API query parameters. Epic IDs are word characters only.

export const isEpicId = (v: string | null): v is string => !!v && /^[\w-]{1,120}$/.test(v);
export const isAccountId = (v: string | null): v is string => !!v && /^[0-9a-f]{32}$/.test(v);
/** Epic display names are 3-16 characters; allow some slack, but no control characters. */
export const isDisplayName = (v: string | null): v is string =>
  !!v && v.length <= 32 && [...v].every((c) => c.charCodeAt(0) >= 0x20);
