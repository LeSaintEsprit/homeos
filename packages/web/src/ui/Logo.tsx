export function Logo({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="hg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2A8A68" />
          <stop offset="1" stopColor="#14533D" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#hg)" />
      <path d="M15 31.5 32 17.5l17 14" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20.5 29v14.5a3.5 3.5 0 0 0 3.5 3.5h16a3.5 3.5 0 0 0 3.5-3.5V29" stroke="#fff" strokeWidth="5" fill="none" strokeLinejoin="round" />
      <path d="m26.5 37.5 4.2 4.2 7.8-8.7" stroke="#F4C86F" strokeWidth="4.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
