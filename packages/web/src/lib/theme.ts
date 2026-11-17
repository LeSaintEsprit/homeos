import { Observable } from './store';

export type ThemePref = 'auto' | 'light' | 'dark';
const KEY = 'homeos:theme';

export const themePref = new Observable<ThemePref>((localStorage.getItem(KEY) as ThemePref) || 'auto');
const media = window.matchMedia('(prefers-color-scheme: dark)');

function apply() {
  const p = themePref.get();
  const dark = p === 'dark' || (p === 'auto' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function setTheme(p: ThemePref) {
  localStorage.setItem(KEY, p);
  themePref.set(p);
  apply();
}

media.addEventListener('change', apply);
apply();
