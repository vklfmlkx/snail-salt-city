export const GENERATED_SCENARIO_SLOTS = 3;
export type Slot = {
  id: string;
  owner: string;
  status: "reserved" | "ready" | "failed";
  curated: boolean;
};
export function reserveSlot(slots: Slot[], owner: string, id: string): Slot[] {
  const existing = slots.find((s) => s.id === id);
  if (existing) {
    if (existing.owner !== owner) throw Error("slot_owner");
    return slots;
  }
  if (
    slots.filter(
      (s) => s.owner === owner && !s.curated && s.status !== "failed",
    ).length >= GENERATED_SCENARIO_SLOTS
  )
    throw Error("slots_full");
  return [...slots, { id, owner, status: "reserved", curated: false }];
}
// The future transactional repository must compare this version before committing.
export function reserveSlotAtVersion(
  snapshot: { version: number; slots: Slot[] },
  expectedVersion: number,
  owner: string,
  id: string,
) {
  if (snapshot.version !== expectedVersion) throw Error("slot_version");
  const slots = reserveSlot(snapshot.slots, owner, id);
  return {
    version: snapshot.version + (slots === snapshot.slots ? 0 : 1),
    slots,
  };
}
// Future provider interface only; no implementation/imports capable of making Zhihu requests.
export interface ZhihuContentProvider {
  listStories(): Promise<{ id: string; title: string }[]>;
  getStory(
    id: string,
  ): Promise<{ id: string; content: string; author: string }>;
}
