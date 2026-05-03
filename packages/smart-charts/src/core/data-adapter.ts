import type { ColumnType, Dataset, Row, Schema } from './types.js';

export interface ColumnView {
	name: string;
	type: ColumnType;
	numeric?: Float64Array;
	categories?: string[]; // unique values when type === 'categorical' or 'text'
	groupKeys?: Uint32Array; // index into categories
	text?: string[]; // raw strings when type === 'text'
	temporal?: Float64Array; // ms since epoch
}

export interface AdaptedData {
	dataset: Dataset;
	columns: Record<string, ColumnView>;
}

const TEXT_TOKEN_THRESHOLD = 4;
const TEXT_CARDINALITY_RATIO = 0.5;

export function adapt(rows: Row[]): AdaptedData {
	const schema = inferSchema(rows);
	const columns: Record<string, ColumnView> = {};
	for (const col of schema.columns) {
		columns[col.name] = buildView(rows, col.name, col.type);
	}
	return {
		dataset: { rows, schema, rowCount: rows.length },
		columns,
	};
}

export function inferSchema(rows: Row[]): Schema {
	if (rows.length === 0) {
		return { columns: [] };
	}
	const sample = rows.slice(0, Math.min(50, rows.length));
	const keys = Object.keys(rows[0] ?? {});
	const columns = keys.map((name) => ({ name, type: inferColumnType(name, rows, sample) }));
	return { columns };
}

function inferColumnType(name: string, rows: Row[], sample: Row[]): ColumnType {
	const values = sample.map((r) => r[name]).filter((v) => v !== null && v !== undefined);
	if (values.length === 0) return 'numeric';

	if (values.every((v) => typeof v === 'boolean')) return 'boolean';
	if (values.every((v) => typeof v === 'number' && Number.isFinite(v))) return 'numeric';

	const stringSamples = values.filter((v): v is string => typeof v === 'string');
	if (stringSamples.length === values.length) {
		if (stringSamples.every((v) => isTemporal(v))) return 'temporal';
		const avgTokens = stringSamples.reduce((s, v) => s + countTokens(v), 0) / stringSamples.length;
		const unique = new Set(rows.map((r) => r[name])).size;
		const ratio = unique / Math.max(1, rows.length);
		if (avgTokens > TEXT_TOKEN_THRESHOLD && ratio > TEXT_CARDINALITY_RATIO) return 'text';
		return 'categorical';
	}

	if (values.every((v) => v instanceof Date)) return 'temporal';
	return 'categorical';
}

function countTokens(s: string): number {
	let count = 0;
	let inWord = false;
	for (let i = 0; i < s.length; i++) {
		const ch = s.charCodeAt(i);
		const isWordChar = (ch >= 48 && ch <= 57) || (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122);
		if (isWordChar) {
			if (!inWord) {
				count++;
				inWord = true;
			}
		} else {
			inWord = false;
		}
	}
	return count;
}

function isTemporal(s: string): boolean {
	if (s.length < 6) return false;
	const t = Date.parse(s);
	return Number.isFinite(t);
}

function buildView(rows: Row[], name: string, type: ColumnType): ColumnView {
	const view: ColumnView = { name, type };
	const n = rows.length;

	if (type === 'numeric' || type === 'boolean') {
		const arr = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			const v = rows[i][name];
			arr[i] = typeof v === 'number' ? v : v === true ? 1 : v === false ? 0 : NaN;
		}
		view.numeric = arr;
		return view;
	}

	if (type === 'temporal') {
		const arr = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			const v = rows[i][name];
			if (v instanceof Date) arr[i] = v.getTime();
			else if (typeof v === 'string') arr[i] = Date.parse(v);
			else if (typeof v === 'number') arr[i] = v;
			else arr[i] = NaN;
		}
		view.temporal = arr;
		view.numeric = arr;
		return view;
	}

	if (type === 'categorical') {
		const lookup = new Map<string, number>();
		const categories: string[] = [];
		const keys = new Uint32Array(n);
		for (let i = 0; i < n; i++) {
			const raw = rows[i][name];
			const key = raw === null || raw === undefined ? '∅' : String(raw);
			let id = lookup.get(key);
			if (id === undefined) {
				id = categories.length;
				categories.push(key);
				lookup.set(key, id);
			}
			keys[i] = id;
		}
		view.categories = categories;
		view.groupKeys = keys;
		return view;
	}

	// text
	const text: string[] = new Array(n);
	for (let i = 0; i < n; i++) {
		const v = rows[i][name];
		text[i] = typeof v === 'string' ? v : v == null ? '' : String(v);
	}
	view.text = text;
	return view;
}
