/** Everything that can be earned through play. */
export interface UnlockDef {
  id: string;
  name: string;
  kind: 'pot' | 'background' | 'stone' | 'sapling' | 'tool' | 'variant';
  description: string;
}

export const UNLOCKS: UnlockDef[] = [
  { id: 'pot:crescent', name: 'Crescent pot', kind: 'pot', description: 'A shallow, sweeping pot for windswept trees.' },
  { id: 'pot:drum', name: 'Drum pot', kind: 'pot', description: 'A studded drum for powerful trunks.' },
  { id: 'pot:cobalt', name: 'Cobalt glaze', kind: 'pot', description: 'Deep blue glaze – stunning with autumn maple.' },
  { id: 'pot:vermilion', name: 'Vermilion glaze', kind: 'pot', description: 'A bold red glaze for confident compositions.' },
  { id: 'pot:nanban', name: 'Nanban stoneware', kind: 'pot', description: 'Rough, ancient-looking stoneware.' },
  { id: 'stone:quartz', name: 'White quartz', kind: 'stone', description: 'Bright accent stones.' },
  { id: 'bg:ink', name: 'Ink backdrop', kind: 'background', description: 'A dark, dramatic backdrop for portraits.' },
  { id: 'bg:moss', name: 'Moss garden backdrop', kind: 'background', description: 'A soft green backdrop for portraits.' },
  { id: 'sapling:literati', name: 'Slender literati stock', kind: 'sapling', description: 'Tall, sparse material for elegant literati.' },
  { id: 'sapling:collected', name: 'Collected yamadori', kind: 'sapling', description: 'Old, thick-trunked material collected from the mountains.' },
  { id: 'tool:copper', name: 'Copper wire', kind: 'tool', description: 'Holds harder – wired branches set 50% faster.' },
  { id: 'variant:windswept-gale', name: 'Windswept: Gale', kind: 'variant', description: 'A pine in a gale – stricter judging.' },
  { id: 'variant:less-haiku', name: 'Less is More: Haiku', kind: 'variant', description: 'Even fewer moves allowed.' },
  { id: 'variant:exhibition-autumn', name: 'Exhibition: Autumn Maple', kind: 'variant', description: 'Show a maple at its autumn peak.' },
];

export const unlockDef = (id: string): UnlockDef | undefined => UNLOCKS.find((u) => u.id === id);
