import { GameApp } from "@/components/game/GameApp";
import { GameAssets } from "@/components/game/GameAssets";
import { gameAssets } from "@/server/game-assets";
export default function Page() {
  return (
    <GameAssets assets={gameAssets()}>
      <GameApp />
    </GameAssets>
  );
}
