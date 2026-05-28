type Props = {
  size?: number;
  className?: string;
};

export function BrandMark({ size = 36, className }: Props) {
  return (
    <img
      src="/brand-icon.png"
      alt="AlarmTalk"
      width={size}
      height={size}
      className={className}
      style={{ display: "block" }}
    />
  );
}
