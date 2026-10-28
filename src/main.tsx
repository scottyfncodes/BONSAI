import { DEFAULT_POT, DEFAULT_SURFACE } from './game/pots';
import { Stage } from './render/stage';
import { generateSapling } from './tree/generate';
import { computeLayout } from './tree/layout';
import type { SpeciesId } from './tree/types';

const params = new URLSearchParams(location.search);
const root = document.getElementById('root')!;
root.style.cssText = 'position:fixed;inset:0;background:radial-gradient(120% 90% at 50% 30%, #fbf7ee 0%, #f1eadb 60%, #e4dac6 100%)';
const stage = Stage.create(root)!;
const tree = generateSapling((params.get('sp') ?? 'juniper') as SpeciesId, Number(params.get('seed') ?? 1), (params.get('preset') ?? 'nursery') as never);
if (params.get('day')) tree.day = Number(params.get('day'));
stage.setScene({ tree, layout: computeLayout(tree), pot: { ...DEFAULT_POT, shape: (params.get('pot') ?? 'oval') as never }, surface: DEFAULT_SURFACE });
stage.frameTree(true);
if (params.get('yaw')) { stage.rig.goal.yaw = Number(params.get('yaw')); stage.rig.pose.yaw = Number(params.get('yaw')); }
if (params.get('zoom')) { stage.rig.pose.distance *= Number(params.get('zoom')); stage.rig.goal.distance = stage.rig.pose.distance; stage.rig.pose.target = [0, Number(params.get('ty') ?? 1), 0]; stage.rig.goal.target = stage.rig.pose.target; stage.rig.apply(); }
if (params.get('sel')) stage.setHighlight({ selected: params.get('sel'), removal: null, tone: 'inspect' });
(window as unknown as { ready: boolean }).ready = true;
(window as unknown as Record<string, unknown>).dbg = { stage, tree, layout: computeLayout(tree) };
