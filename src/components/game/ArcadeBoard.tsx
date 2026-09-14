"use client";
import type { ArcadeSpec } from "@/domain/arcade";
import { isPixelGame } from "@/domain/pixel-arcade";
import { PixelArcadeBoard } from "./PixelArcadeBoard";
import { LegacyArcadeBoard } from "./LegacyArcadeBoard";
export type ArcadeBoardProps = {
  spec: ArcadeSpec;
  challengeId: string;
  onFinish: (moves: number[]) => void;
  disabled: boolean;
  practice?: boolean;
};
export function ArcadeBoard(props: ArcadeBoardProps) {
  return isPixelGame(props.spec.game) ? (
    <PixelArcadeBoard {...props} game={props.spec.game} />
  ) : (
    <LegacyArcadeBoard {...props} />
  );
}
