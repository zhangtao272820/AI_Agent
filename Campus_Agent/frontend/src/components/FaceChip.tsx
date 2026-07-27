interface Props {
  src: string | null | undefined;
  name: string;
  className?: string;
}

export function FaceChip({ src, name, className }: Props) {
  if (src) {
    return <img className={`face-chip ${className ?? ""}`} src={src} alt={name} />;
  }
  return (
    <div className={`face-chip face-fallback ${className ?? ""}`} aria-hidden>
      {name.slice(0, 1)}
    </div>
  );
}
