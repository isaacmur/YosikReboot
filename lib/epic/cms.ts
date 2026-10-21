// Epic's public tournament-info CMS document: titles, descriptions, posters and
// colors, keyed by each event's `displayDataId` (verified 45/45 in Phase 0).

import { asObj, str } from './json.js';

export interface CmsEntry {
  title?: string;
  subtitle?: string;
  description?: string;
  /** Square poster, 800×800. */
  square?: string;
  /** 16:9 playlist tile, 1920×1080. */
  tile?: string;
  /** Wide tournament background, about 1560×1024. */
  background?: string;
  /** Hex colors without '#'. */
  primary?: string;
  left?: string;
  right?: string;
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
      square: httpsUrl(info.square_poster_image) ?? httpsUrl(info.poster_front_image),
      tile: httpsUrl(info.playlist_tile_image),
      background: httpsUrl(info.tournament_view_background_image) ?? httpsUrl(info.loading_screen_image),
      primary: hexColor(info.primary_color),
      left: hexColor(info.background_left_color),
      right: hexColor(info.background_right_color),
    });
  }
  return out;
}
