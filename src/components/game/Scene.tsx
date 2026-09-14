import { rooms, type Room } from "./presentation";
import { useAssetUrl } from "./GameAssets";
export function Scene({
  room,
  clean = false,
}: {
  room: Room;
  clean?: boolean;
}) {
  const src = useAssetUrl(`/assets/tabletop/v1/${room}.png`);
  return (
    <div
      className={`tabletop-scene ${clean ? "clean-scene" : ""}`}
      aria-label={rooms[room]}
    >
      <img
        className="room-art"
        src={src}
        alt={rooms[room]}
        fetchPriority="high"
      />
    </div>
  );
}
