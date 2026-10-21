// Epic's public tournament-info CMS document: titles, descriptions, posters and
// colors, keyed by each event's `displayDataId` (verified 45/45 in Phase 0).

import { asObj, str } from './json.js';

export interface CmsEntry {
  title?: string;
  subtitle?: string;
  description?: string;
  posterUrl?: string;
  tileUrl?: string;
  color?: string;
}

export type CmsIndex = Map<string, CmsEntry>;

const httpsUrl = (v: unknown): string | undefined => {
  const s = str(v);
  return s && s.startsWith('https://') ? s : undefined;
};

const hexColor = (v: unknown): string | undefined => {
  const s = str(v);
  return s && /^[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : undefined;
};

export function indexCms(raw: unknown): CmsIndex {
  const out: CmsIndex = new Map();
  for (const v of Object.values(asObj(raw) ?? {})) {
    const info = asObj(asObj(v)?.tournament_info);
    const id = str(info?.tournament_display_id);
    if (!info || !id) continue;
    out.set(id, {
      title: str(info.long_format_title) ?? str(info.title_line_1),
      subtitle: str(info.title_line_2),
      description: str(info.details_description) ?? str(info.flavor_description),
      posterUrl: httpsUrl(info.square_poster_image) ?? httpsUrl(info.poster_front_image),
      tileUrl: httpsUrl(info.playlist_tile_image),
      color: hexColor(info.primary_color),
    });
  }
  return out;
}
