type Props = {
  size?: number;
  className?: string;
};

export function BrandMark({ size = 36, className }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="VocaWake"
      className={className}
    >
      <rect width="64" height="64" rx="14" fill="#1A1248" />
      {/* outer accent bars (orange) */}
      <rect x="11" y="22" width="4" height="20" rx="2" fill="#F2934A" />
      <rect x="49" y="22" width="4" height="20" rx="2" fill="#F2934A" />
      {/* sound wave (cream) */}
      <rect x="19" y="26" width="3" height="12" rx="1.5" fill="#FFF8EE" />
      <rect x="24" y="22" width="3" height="20" rx="1.5" fill="#FFF8EE" />
      <rect x="29" y="18" width="3" height="28" rx="1.5" fill="#FFF8EE" />
      <rect x="34" y="22" width="3" height="20" rx="1.5" fill="#FFF8EE" />
      <rect x="39" y="26" width="3" height="12" rx="1.5" fill="#FFF8EE" />
      <rect x="44" y="29" width="3" height="6" rx="1.5" fill="#FFF8EE" />
    </svg>
  );
}
