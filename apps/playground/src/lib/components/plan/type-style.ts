import type { BlockType } from '@vfir/cartographer';

const ACCENT: Record<BlockType, string> = {
	phase: 'hsl(212 80% 55%)',
	task: 'hsl(150 60% 45%)',
	rationale: 'hsl(220 10% 55%)',
	risk: 'hsl(28 90% 55%)',
	'open-question': 'hsl(280 70% 60%)',
	dependency: 'hsl(190 65% 50%)',
	'success-criterion': 'hsl(95 60% 50%)',
	constraint: 'hsl(0 75% 55%)',
	reference: 'hsl(220 8% 55%)',
};

export function typeAccent(type: BlockType): string {
	return ACCENT[type] ?? 'hsl(220 10% 55%)';
}

const LABEL: Record<BlockType, string> = {
	phase: 'Phase',
	task: 'Task',
	rationale: 'Rationale',
	risk: 'Risk',
	'open-question': 'Open question',
	dependency: 'Dependency',
	'success-criterion': 'Success criterion',
	constraint: 'Constraint',
	reference: 'Reference',
};

export function typeLabel(type: BlockType): string {
	return LABEL[type] ?? type.replace(/[-_]+/g, ' ');
}
