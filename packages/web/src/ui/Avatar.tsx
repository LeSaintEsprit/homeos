export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function Avatar({ name, color, size = 36 }: { name: string; color?: string; size?: number }) {
  return (
    <span className="avatar" style={{ ['--size' as string]: `${size}px`, background: color ?? '#7a827c' }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function HouseholdAvatar({ avatar, size = 40 }: { avatar: string | null | undefined; size?: number }) {
  return (
    <span className="hh-avatar" style={{ ['--size' as string]: `${size}px` }} aria-hidden="true">
      {avatar && !avatar.startsWith('photo:') ? avatar : '🏡'}
    </span>
  );
}
