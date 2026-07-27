interface Props {
  src: string | null | undefined;
  name: string;
  className?: string;
  /** talk = dialogue stage; loc = location stack figure */
  size?: "talk" | "loc" | "portrait";
}

/** Full-body stand art — never use FaceChip (circular crop) for this. */
export function SpriteStage({ src, name, className, size = "talk" }: Props) {
  const sizeClass = `sprite-stage-img sprite-stage-img--${size}`;
  if (src) {
    return (
      <img
        className={`${sizeClass}${className ? ` ${className}` : ""}`}
        src={src}
        alt={name}
        draggable={false}
      />
    );
  }
  return (
    <div className={`${sizeClass} sprite-stage-fallback${className ? ` ${className}` : ""}`} aria-hidden>
      <span>{name.slice(0, 1)}</span>
    </div>
  );
}
