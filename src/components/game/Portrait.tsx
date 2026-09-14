import { useAssetUrl } from "./GameAssets";
import {
  actors,
  portrait,
  expressions,
  type ActorId,
  type Expression,
} from "./presentation";
export function Portrait({
  actor,
  expression = "neutral",
  className = "",
  label,
}: {
  actor: ActorId;
  expression?: Expression;
  className?: string;
  label?: string;
}) {
  const index = expressions.indexOf(expression);
  const src = useAssetUrl(portrait(actor, expression));
  return (
    <span
      className={`sprite-portrait ${className}`}
      role="img"
      aria-label={label ?? `${actors[actor].name} · ${expression}`}
      data-actor={actor}
      data-expression={expression}
    >
      <img
        key={actor}
        src={src}
        alt=""
        aria-hidden="true"
        style={{
          left: `-${(index % 3) * 100}%`,
          top: `-${Math.floor(index / 3) * 100}%`,
        }}
      />
    </span>
  );
}
