// The color theme: dark (the default look), light, or the device's. It's applied
// as data-theme on <html>, which index.css reads. A small script in index.html
// sets it before the first paint; this keeps it in step with the setting and,
// for "system", with the device.

import { useEffect } from 'react';
import type { Theme } from './settings';

/** Browser-bar color per theme: the page background. */
const BAR = { dark: '#09090e', light: '#f5f5f8' } as const;

export const resolveTheme = (theme: Theme, prefersLight: boolean): 'dark' | 'light' =>
  theme === 'system' ? (prefersLight ? 'light' : 'dark') : theme;

function apply(theme: 'dark' | 'light'): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[theme]);
}

export function useTheme(theme: Theme): void {
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: light)');
    const update = () => apply(resolveTheme(theme, media.matches));
    update();
    if (theme !== 'system') return;
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [theme]);
}
