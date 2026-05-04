<script lang="ts">
import Copy from '@lucide/svelte/icons/copy';
import Download from '@lucide/svelte/icons/download';
import FolderOpen from '@lucide/svelte/icons/folder-open';
import KeyRound from '@lucide/svelte/icons/key-round';
import Loader2 from '@lucide/svelte/icons/loader-2';
import Lock from '@lucide/svelte/icons/lock';
import MessageSquare from '@lucide/svelte/icons/message-square';
import PanelRightClose from '@lucide/svelte/icons/panel-right-close';
import Pin from '@lucide/svelte/icons/pin';
import Plus from '@lucide/svelte/icons/plus';
import Sparkles from '@lucide/svelte/icons/sparkles';
import Trash2 from '@lucide/svelte/icons/trash-2';
import Unlock from '@lucide/svelte/icons/unlock';
import Undo2 from '@lucide/svelte/icons/undo-2';
import Upload from '@lucide/svelte/icons/upload';
import { loadWasm } from '@variable-font/core';
import {
	type BlockRect as BlockRectData,
	type BlockType,
	type GroupRectOut,
	Measurer,
	PlanAnnotator,
	RectLayout,
	type RectLayoutSnapshot,
	serializeToPlan,
} from '@vfir/cartographer';
import { typeLabel } from '$lib/components/plan/type-style.js';
import { onDestroy, onMount } from 'svelte';
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';
import { InfoButton, Modal, StatusPill } from '$lib/components/ui/info';
import { Input } from '$lib/components/ui/input';
import { BlockRect, GroupRect } from '$lib/components/plan';
import { Textarea } from '$lib/components/ui/textarea';

const LS_KEY = 'cartographer-api-key';
const LS_SESSIONS = 'plan-refinement:sessions';
const LS_CURRENT = 'plan-refinement:current';
const LS_SESSION_PREFIX = 'plan-refinement:session:';
const SESSION_VERSION = 1;

interface SessionMeta {
	id: string;
	name: string;
	updatedAt: number;
}

interface SessionState {
	version: number;
	id: string;
	name: string;
	updatedAt: number;
	title: string;
	inputText: string;
	blocks: import('@vfir/cartographer').ContentBlock[];
	groups: import('@vfir/cartographer').Group[];
	hiddenIds: string[];
	locked: boolean;
	panX: number;
	panY: number;
	zoom: number;
	drilledGroupId: string | null;
}

function newSessionId(): string {
	return `s-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function loadSessionsIndex(): SessionMeta[] {
	try {
		const raw = localStorage.getItem(LS_SESSIONS);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as SessionMeta[];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function writeSessionsIndex(idx: SessionMeta[]): void {
	localStorage.setItem(LS_SESSIONS, JSON.stringify(idx));
}

function readSessionState(id: string): SessionState | null {
	try {
		const raw = localStorage.getItem(LS_SESSION_PREFIX + id);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as SessionState;
		if (parsed.version !== SESSION_VERSION) return null;
		return parsed;
	} catch {
		return null;
	}
}

function writeSessionState(state: SessionState): void {
	localStorage.setItem(LS_SESSION_PREFIX + state.id, JSON.stringify(state));
}

const SAMPLE = `Goal: ship the GDPR data-deletion endpoint by end of quarter.

Phase 1 — Discovery and contract.
Identify every data store containing user data: Postgres (users, orders), S3 (uploads), Redshift (analytics), Mixpanel (events). Define the API contract: POST /v1/users/:id/erasure returns 202 + a job id; clients poll a status endpoint. Stakeholder sign-off from legal and the privacy officer required before code lands. Risk: third-party processors (Mixpanel, Sentry) have their own deletion APIs with different SLAs — need to enumerate them all.

Phase 2 — Implementation.
Postgres: cascade-delete + scrub PII columns leaving anonymized rows for billing audit. S3: tag-then-delete pattern so a soft-delete window survives accidental requests. Redshift: scheduled scrub job (daily) so we don't block the user-facing request. Mixpanel: queue jobs, fan out to vendor APIs with retry. Build observability: per-store deletion confirmation events flow into a single audit log keyed by user id.

Phase 3 — Verification and launch.
Backfill test: pick 5 anonymized real-shape users, run end-to-end deletion, confirm zero rows in any store. Load test: 1000 concurrent erasures, verify the queue + retry behavior. Open question: do we need a "right to be forgotten" UI in the dashboard for self-service, or is API-only acceptable for v1?`;

type Status = 'idle' | 'streaming' | 'ready' | 'error';

let apiKey = $state('');
let inputText = $state(SAMPLE);
let status = $state<Status>('idle');
let errorMsg = $state('');
let showAbout = $state(false);
let copyFeedback = $state('');

let container: HTMLElement;
let containerWidth = $state(1080);
let containerHeight = $state(640);

let layout: RectLayout | null = null;
let annotator: PlanAnnotator | null = null;
let abortController: AbortController | null = null;
let rafId: number | null = null;
let settleEndTime = 0;

let snapshot = $state<RectLayoutSnapshot>({
	groups: [],
	blocks: [],
	mode: 'overview',
	drilledGroupId: null,
});

let selectedIds = $state<Set<string>>(new Set());
let hiddenIds = $state<Set<string>>(new Set());
let undoStack = $state<Array<Set<string>>>([]);
let editingBlockId = $state<string | null>(null);
let editingGroupId = $state<string | null>(null);
let editingGroupLabel = $state('');
let editingGroupSummary = $state('');
let locked = $state(false);
let railOpen = $state(true);

let title = $state('');
let sessionId = $state<string>('');
let sessionName = $state<string>('Untitled plan');
let sessions = $state<SessionMeta[]>([]);
let lastSavedAt = $state<number | null>(null);
let savedTickerNow = $state(Date.now());
let showSessions = $state(false);
let renameDraft = $state('');
let fileInput: HTMLInputElement | null = $state(null);
let savePending = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const BLOCK_TYPES: BlockType[] = [
	'task',
	'rationale',
	'risk',
	'open-question',
	'dependency',
	'success-criterion',
	'constraint',
	'reference',
	'phase',
];

const selectedBlock = $derived.by<BlockRectData | null>(() => {
	if (selectedIds.size !== 1) return null;
	const id = [...selectedIds][0];
	return snapshot.blocks.find((b) => b.id === id) ?? null;
});

const drilledGroup = $derived.by<GroupRectOut | null>(() => {
	if (!snapshot.drilledGroupId) return null;
	return snapshot.groups.find((g) => g.id === snapshot.drilledGroupId) ?? null;
});

// Camera state
let panX = $state(0);
let panY = $state(0);
let zoom = $state(1);
let cameraAnim: { id: number } | null = null;

// Pan/drag
let isPanning = $state(false);
let panMoved = false;
let panStartX = 0;
let panStartY = 0;
let panOriginX = 0;
let panOriginY = 0;

const visibleGroupCount = $derived(snapshot.groups.length);
const visibleBlockCount = $derived(snapshot.blocks.filter((b) => !hiddenIds.has(b.id)).length);

const statusTone = $derived.by<'ok' | 'warn' | 'err' | 'pending' | 'idle'>(() => {
	if (status === 'streaming') return 'pending';
	if (status === 'ready') return 'ok';
	if (status === 'error') return 'err';
	return 'idle';
});
const statusLabel = $derived.by(() => {
	if (status === 'streaming') return 'Streaming…';
	if (status === 'ready') return 'Mapped';
	if (status === 'error') return 'Error';
	return 'Ready';
});
const statusMeta = $derived.by(() => {
	if (status === 'ready' || status === 'streaming') {
		const phases = `${visibleGroupCount} phase${visibleGroupCount === 1 ? '' : 's'}`;
		const items = `${visibleBlockCount} item${visibleBlockCount === 1 ? '' : 's'}`;
		return `${phases} · ${items}`;
	}
	return undefined;
});

const breadcrumb = $derived.by(() => {
	if (snapshot.mode === 'overview' || !snapshot.drilledGroupId) return null;
	return snapshot.groups.find((g) => g.id === snapshot.drilledGroupId)?.label ?? null;
});

onMount(() => {
	apiKey = localStorage.getItem(LS_KEY) ?? '';
	sessions = loadSessionsIndex();
	const currentId = localStorage.getItem(LS_CURRENT);
	if (currentId && sessions.find((s) => s.id === currentId)) {
		// Defer load until after wasm boots so RectLayout can be created.
		queueMicrotask(() => loadSession(currentId));
	}
	// Ticker for "saved Xs ago" indicator.
	const tickerInterval = setInterval(() => (savedTickerNow = Date.now()), 5000);
	const ro = new ResizeObserver((entries) => {
		const box = entries[0].contentRect;
		containerWidth = Math.max(640, box.width);
		containerHeight = Math.max(480, box.height);
		layout?.setBounds({ width: containerWidth, height: containerHeight });
		wakeSim(800);
	});
	ro.observe(container);

	const onWheel = (e: WheelEvent) => {
		e.preventDefault();
		const rect = container.getBoundingClientRect();
		const cx = e.clientX - rect.left;
		const cy = e.clientY - rect.top;
		const worldX = (cx - panX) / zoom;
		const worldY = (cy - panY) / zoom;
		const factor = Math.exp(-e.deltaY * 0.0015);
		const next = Math.max(0.25, Math.min(3, zoom * factor));
		zoom = next;
		panX = cx - worldX * next;
		panY = cy - worldY * next;
	};
	container.addEventListener('wheel', onWheel, { passive: false });

	return () => {
		ro.disconnect();
		container.removeEventListener('wheel', onWheel);
		clearInterval(tickerInterval);
	};
});

onDestroy(() => {
	abortController?.abort();
	if (rafId !== null) cancelAnimationFrame(rafId);
	if (cameraAnim) cancelAnimationFrame(cameraAnim.id);
});

function saveKey() {
	if (apiKey) localStorage.setItem(LS_KEY, apiKey);
}

function wakeSim(extraMs: number = 1200) {
	settleEndTime = Math.max(settleEndTime, performance.now() + extraMs);
	if (rafId === null) startLoop();
}

function startLoop() {
	function tick() {
		if (!layout) {
			rafId = null;
			return;
		}
		snapshot = layout.step();
		const t = performance.now();
		const active = status === 'streaming' || t < settleEndTime || layout.energy() > 0.5;
		if (active) rafId = requestAnimationFrame(tick);
		else rafId = null;
	}
	rafId = requestAnimationFrame(tick);
}

async function run() {
	if (!apiKey.trim()) {
		errorMsg = 'Paste your Anthropic API key first.';
		status = 'error';
		return;
	}
	abortController?.abort();
	if (rafId !== null) {
		cancelAnimationFrame(rafId);
		rafId = null;
	}

	errorMsg = '';
	copyFeedback = '';
	hiddenIds = new Set();
	selectedIds = new Set();
	undoStack = [];
	snapshot = { groups: [], blocks: [], mode: 'overview', drilledGroupId: null };

	try {
		await loadWasm();
	} catch {
		// Falls back to the playground's wasm-stub via vite alias.
	}

	annotator = new PlanAnnotator({ apiKey: apiKey.trim() });
	const measurer = new Measurer({ fontFamily: 'Recursive', maxBlockWidth: 220 });
	layout = new RectLayout({
		measurer,
		bounds: { width: containerWidth, height: containerHeight },
	});
	resetCamera();
	status = 'streaming';
	wakeSim(2000);

	abortController = new AbortController();
	try {
		await annotator.stream(
			inputText,
			(ev) => {
				if (!layout) return;
				if (ev.kind === 'block') {
					layout.addBlock(ev.block);
					wakeSim(1500);
				} else if (ev.kind === 'group') {
					layout.addGroup(ev.group);
				}
			},
			abortController.signal,
		);
		status = 'ready';
		wakeSim(1500);
		// Wait one tick so the sim emits a snapshot, then auto-fit.
		setTimeout(() => fitOverview(true), 600);
		ensureSession();
		scheduleSave();
	} catch (e) {
		if ((e as Error).name === 'AbortError') return;
		errorMsg = e instanceof Error ? e.message : String(e);
		status = 'error';
	}
}

function snapshotHidden() {
	undoStack = [...undoStack, new Set(hiddenIds)];
	if (undoStack.length > 50) undoStack = undoStack.slice(-50);
}

function hideSelected() {
	if (selectedIds.size === 0) return;
	snapshotHidden();
	const next = new Set(hiddenIds);
	for (const id of selectedIds) next.add(id);
	hiddenIds = next;
	selectedIds = new Set();
}

function undo() {
	if (undoStack.length === 0) return;
	hiddenIds = undoStack[undoStack.length - 1];
	undoStack = undoStack.slice(0, -1);
}

function handleBlockClick(event: MouseEvent, id: string) {
	if (panMoved) return;
	event.stopPropagation();
	if (event.shiftKey) {
		const next = new Set(selectedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedIds = next;
	} else {
		selectedIds = new Set([id]);
	}
}

function handleBlockDblClick(_event: MouseEvent, id: string) {
	if (locked) return;
	selectedIds = new Set([id]);
	editingBlockId = id;
	if (layout) layout.setBlockPinned(id, true);
}

function commitBlockEdit(id: string, text: string) {
	if (!layout) return;
	layout.updateBlockText(id, text);
	layout.setBlockPinned(id, false);
	editingBlockId = null;
	wakeSim(800);
}

function setBlockTextLive(id: string, text: string) {
	if (!layout) return;
	layout.updateBlockText(id, text);
	snapshot = layout.snapshot();
	wakeSim(400);
}

function cancelBlockEdit(id: string) {
	if (!layout) return;
	layout.setBlockPinned(id, false);
	editingBlockId = null;
}

function setBlockImportance(id: string, value: number) {
	if (!layout) return;
	layout.setBlockImportance(id, value);
	// Trigger snapshot update so UI sees the new value immediately.
	snapshot = layout.snapshot();
}

function setBlockType(id: string, type: BlockType) {
	if (!layout) return;
	layout.setBlockType(id, type);
	snapshot = layout.snapshot();
}

function setBlockPinned(id: string, pinned: boolean) {
	if (!layout) return;
	layout.setBlockPinned(id, pinned);
	wakeSim(600);
}

function deleteBlock(id: string) {
	if (!layout) return;
	layout.removeBlock(id);
	selectedIds = new Set();
	editingBlockId = null;
	wakeSim(800);
}

function duplicateBlock(id: string) {
	if (!layout) return;
	const newId = layout.duplicateBlock(id);
	if (newId) selectedIds = new Set([newId]);
	wakeSim(800);
}

function setGroupImportance(id: string, value: number) {
	if (!layout) return;
	layout.setGroupImportance(id, value);
	snapshot = layout.snapshot();
}

function commitGroupEdit() {
	if (!layout || !editingGroupId) return;
	layout.setGroupLabel(editingGroupId, editingGroupLabel);
	layout.setGroupSummary(editingGroupId, editingGroupSummary || undefined);
	editingGroupId = null;
}

function startEditingGroup(group: GroupRectOut) {
	if (locked) return;
	editingGroupId = group.id;
	editingGroupLabel = group.label;
	editingGroupSummary = group.summary ?? '';
}

function deleteGroup(id: string) {
	if (!layout) return;
	layout.removeGroup(id);
	selectedIds = new Set();
	wakeSim(800);
}

function addBlankBlock() {
	if (!layout || !snapshot.drilledGroupId) return;
	const id = layout.addBlankBlock(snapshot.drilledGroupId, 'task');
	if (id) {
		selectedIds = new Set([id]);
		editingBlockId = id;
		layout.setBlockPinned(id, true);
		wakeSim(1200);
	}
}

function addBlankGroup() {
	if (!layout) return;
	const id = layout.addBlankGroup('New phase');
	wakeSim(1500);
	setTimeout(() => fitOverview(true), 400);
	editingGroupId = id;
	editingGroupLabel = 'New phase';
	editingGroupSummary = '';
}

function handleGroupClick(event: MouseEvent, group: GroupRectOut) {
	if (panMoved) return;
	event.stopPropagation();
	if (snapshot.mode === 'drill') return;
	drillInto(group);
}

function handleCanvasClick() {
	if (panMoved) return;
	selectedIds = new Set();
}

function handleCanvasMouseDown(event: MouseEvent) {
	if (event.button !== 0) return;
	const target = event.target as HTMLElement | null;
	if (target?.closest('.block-rect')) return;
	if (snapshot.mode === 'overview' && target?.closest('.group-rect')) return;
	isPanning = true;
	panMoved = false;
	panStartX = event.clientX;
	panStartY = event.clientY;
	panOriginX = panX;
	panOriginY = panY;
}

function handleCanvasMouseMove(event: MouseEvent) {
	if (!isPanning) return;
	const dx = event.clientX - panStartX;
	const dy = event.clientY - panStartY;
	if (!panMoved && Math.abs(dx) + Math.abs(dy) > 3) panMoved = true;
	panX = panOriginX + dx;
	panY = panOriginY + dy;
}

function handleCanvasMouseUp() {
	isPanning = false;
	setTimeout(() => (panMoved = false), 0);
}

function handleKeydown(event: KeyboardEvent) {
	if (status === 'idle') return;
	const target = event.target as HTMLElement | null;
	if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

	if (event.key === 'Escape') {
		if (editingBlockId) {
			event.preventDefault();
			cancelBlockEdit(editingBlockId);
			return;
		}
		if (snapshot.mode === 'drill') {
			event.preventDefault();
			exitDrill();
			return;
		}
	}
	if ((event.metaKey || event.ctrlKey) && event.key === 'z') {
		event.preventDefault();
		undo();
		return;
	}
	if (event.key === 'Enter' && selectedIds.size === 1 && !locked) {
		event.preventDefault();
		editingBlockId = [...selectedIds][0];
		if (layout) layout.setBlockPinned(editingBlockId, true);
		return;
	}
	if (event.key === 'Delete' || event.key === 'Backspace') {
		if (selectedIds.size === 0) return;
		event.preventDefault();
		hideSelected();
	}
}

// ----- Camera -----

function resetCamera() {
	if (cameraAnim) cancelAnimationFrame(cameraAnim.id);
	panX = 0;
	panY = 0;
	zoom = 1;
}

function fitOverview(animate = true) {
	if (snapshot.groups.length === 0) return;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const g of snapshot.groups) {
		minX = Math.min(minX, g.x);
		minY = Math.min(minY, g.y);
		maxX = Math.max(maxX, g.x + g.w);
		maxY = Math.max(maxY, g.y + g.h);
	}
	const margin = 40;
	const bboxW = maxX - minX;
	const bboxH = maxY - minY;
	if (bboxW <= 0 || bboxH <= 0) return;
	const z = Math.min(
		(containerWidth - margin * 2) / bboxW,
		(containerHeight - margin * 2) / bboxH,
		1.2,
	);
	const cx = minX + bboxW / 2;
	const cy = minY + bboxH / 2;
	const target = {
		panX: containerWidth / 2 - cx * z,
		panY: containerHeight / 2 - cy * z,
		zoom: z,
	};
	if (animate) animateCameraTo(target);
	else {
		panX = target.panX;
		panY = target.panY;
		zoom = target.zoom;
	}
}

function drillInto(group: GroupRectOut) {
	if (!layout) return;
	layout.drillInto(group.id);
	snapshot = layout.snapshot();
	wakeSim(1500);
	animateCameraTo(frameForGroup(group));
}

function exitDrill() {
	if (!layout) return;
	layout.exitDrill();
	snapshot = layout.snapshot();
	wakeSim(1500);
	fitOverview(true);
	selectedIds = new Set();
}

function frameForGroup(group: GroupRectOut): { panX: number; panY: number; zoom: number } {
	const margin = 40;
	const targetW = containerWidth - margin * 2;
	const targetH = containerHeight - margin * 2;
	const z = Math.min(targetW / group.w, targetH / group.h, 2.4);
	const cx = group.x + group.w / 2;
	const cy = group.y + group.h / 2;
	return {
		panX: containerWidth / 2 - cx * z,
		panY: containerHeight / 2 - cy * z,
		zoom: z,
	};
}

function animateCameraTo(target: { panX: number; panY: number; zoom: number }, ms = 280) {
	if (cameraAnim) cancelAnimationFrame(cameraAnim.id);
	const startPanX = panX;
	const startPanY = panY;
	const startZoom = zoom;
	const start = performance.now();
	const step = (t: number) => {
		const k = Math.min(1, (t - start) / ms);
		const e = 1 - (1 - k) ** 3; // ease-out cubic
		panX = startPanX + (target.panX - startPanX) * e;
		panY = startPanY + (target.panY - startPanY) * e;
		zoom = startZoom + (target.zoom - startZoom) * e;
		if (k < 1) cameraAnim = { id: requestAnimationFrame(step) };
		else cameraAnim = null;
	};
	cameraAnim = { id: requestAnimationFrame(step) };
}

// ----- Session persistence -----

function scheduleSave() {
	if (!layout) return;
	savePending = true;
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		flushSave();
	}, 500);
}

function flushSave() {
	if (!layout || !sessionId) return;
	const { blocks, groups } = layout.serialize();
	const state: SessionState = {
		version: SESSION_VERSION,
		id: sessionId,
		name: sessionName,
		updatedAt: Date.now(),
		title,
		inputText,
		blocks,
		groups,
		hiddenIds: [...hiddenIds],
		locked,
		panX,
		panY,
		zoom,
		drilledGroupId: snapshot.drilledGroupId,
	};
	writeSessionState(state);
	const meta: SessionMeta = { id: sessionId, name: sessionName, updatedAt: state.updatedAt };
	const idx = sessions.filter((s) => s.id !== sessionId);
	idx.unshift(meta);
	sessions = idx;
	writeSessionsIndex(sessions);
	localStorage.setItem(LS_CURRENT, sessionId);
	lastSavedAt = state.updatedAt;
	savePending = false;
	saveTimer = null;
}

function ensureSession() {
	if (sessionId) return;
	sessionId = newSessionId();
	if (!sessionName || sessionName === 'Untitled plan') {
		sessionName = inputText.trim().slice(0, 40).replace(/\n.*/g, '') || 'Untitled plan';
	}
}

function newSession() {
	if (savePending) flushSave();
	if (layout) layout.restore([], []);
	snapshot = { groups: [], blocks: [], mode: 'overview', drilledGroupId: null };
	selectedIds = new Set();
	hiddenIds = new Set();
	undoStack = [];
	editingBlockId = null;
	locked = false;
	title = '';
	inputText = SAMPLE;
	sessionId = newSessionId();
	sessionName = 'Untitled plan';
	lastSavedAt = null;
	resetCamera();
	status = 'idle';
	showSessions = false;
}

function loadSession(id: string) {
	const state = readSessionState(id);
	if (!state) return;
	if (savePending) flushSave();
	sessionId = state.id;
	sessionName = state.name;
	title = state.title ?? '';
	inputText = state.inputText ?? SAMPLE;
	hiddenIds = new Set(state.hiddenIds ?? []);
	locked = state.locked ?? false;
	selectedIds = new Set();
	editingBlockId = null;
	undoStack = [];
	if (!layout) {
		// Defer wasm boot + layout init.
		runRestore(state);
	} else {
		layout.restore(state.blocks, state.groups);
		layout.setBounds({ width: containerWidth, height: containerHeight });
		snapshot = layout.snapshot();
		applyCameraState(state);
	}
	lastSavedAt = state.updatedAt;
	localStorage.setItem(LS_CURRENT, sessionId);
	showSessions = false;
	wakeSim(1500);
}

async function runRestore(state: SessionState) {
	try {
		await loadWasm();
	} catch {}
	const measurer = new Measurer({ fontFamily: 'Recursive', maxBlockWidth: 220 });
	layout = new RectLayout({
		measurer,
		bounds: { width: containerWidth, height: containerHeight },
	});
	layout.restore(state.blocks, state.groups);
	snapshot = layout.snapshot();
	status = 'ready';
	applyCameraState(state);
	wakeSim(1500);
}

function applyCameraState(state: SessionState) {
	if (state.drilledGroupId && layout) {
		layout.drillInto(state.drilledGroupId);
		snapshot = layout.snapshot();
	}
	if (typeof state.panX === 'number') panX = state.panX;
	if (typeof state.panY === 'number') panY = state.panY;
	if (typeof state.zoom === 'number') zoom = state.zoom;
}

function deleteSession(id: string) {
	localStorage.removeItem(LS_SESSION_PREFIX + id);
	sessions = sessions.filter((s) => s.id !== id);
	writeSessionsIndex(sessions);
	if (sessionId === id) {
		newSession();
	}
}

function commitRename() {
	if (!sessionId) return;
	const next = renameDraft.trim();
	if (!next) return;
	sessionName = next;
	scheduleSave();
}

function exportJson() {
	if (!layout || !sessionId) return;
	flushSave();
	const state = readSessionState(sessionId);
	if (!state) return;
	const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `${(sessionName || 'plan').replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}.json`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

function importJson(file: File) {
	const reader = new FileReader();
	reader.onload = () => {
		try {
			const state = JSON.parse(String(reader.result)) as SessionState;
			if (!Array.isArray(state.blocks) || !Array.isArray(state.groups)) {
				errorMsg = 'Invalid plan file: missing blocks/groups.';
				return;
			}
			// Always import as a NEW session so we don't clobber an existing one.
			state.id = newSessionId();
			state.version = SESSION_VERSION;
			state.updatedAt = Date.now();
			writeSessionState(state);
			sessions.unshift({ id: state.id, name: state.name, updatedAt: state.updatedAt });
			writeSessionsIndex(sessions);
			loadSession(state.id);
		} catch (e) {
			errorMsg = `Import failed: ${e instanceof Error ? e.message : String(e)}`;
		}
	};
	reader.readAsText(file);
}

const savedAgo = $derived.by(() => {
	if (!lastSavedAt) return null;
	const sec = Math.max(0, Math.floor((savedTickerNow - lastSavedAt) / 1000));
	if (sec < 5) return 'just now';
	if (sec < 60) return `${sec}s ago`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	return `${hr}h ago`;
});

// Autosave on every layout / lock / hide / camera change.
$effect(() => {
	// Touch the dependencies so the effect re-runs.
	void snapshot;
	void hiddenIds;
	void locked;
	void title;
	void panX;
	void panY;
	void zoom;
	if (status === 'idle') return;
	ensureSession();
	scheduleSave();
});

function buildPlanMarkdown(): string {
	if (!layout) return '';
	const { blocks, groups } = layout.getStructure();
	const scales: Record<string, number> = {};
	for (const b of snapshot.blocks) scales[b.id] = b.scale;
	return serializeToPlan(blocks, groups, { hiddenIds, scales });
}

async function copyPlan() {
	const text = buildPlanMarkdown();
	try {
		await navigator.clipboard.writeText(text);
		copyFeedback = 'Copied';
		setTimeout(() => (copyFeedback = ''), 1500);
	} catch {
		copyFeedback = 'Copy failed';
	}
}

let showPlanText = $state(false);
const planMarkdown = $derived(showPlanText ? buildPlanMarkdown() : '');
</script>

<svelte:window onkeydown={handleKeydown} />

<main class="page">
	<header class="head">
		<div class="head-text">
			<p class="eyebrow">LLM Plan Refinement</p>
			<h1>Turn a plan into something concrete and actionable. Like Figma for planning.</h1>
			<p class="lede">
				Paste a plan. The annotator breaks it into a map of phases (rounded rectangles you can
				drill into) and items inside each phase. Edit, refine, and serialize back to markdown.
			</p>
		</div>
		<div class="head-aside">
			{#if savedAgo}
				<span class="saved-indicator">Saved {savedAgo}</span>
			{/if}
			<StatusPill tone={statusTone} label={statusLabel} meta={statusMeta} />
			<InfoButton onclick={() => (showAbout = true)} title="How Plan Refinement works" />
		</div>
	</header>

	<div class="config">
		<Card.Root class="key-card">
			<Card.Header>
				<Card.Title class="title-row">
					<KeyRound size={16} />
					Anthropic API key
				</Card.Title>
				<Card.Description>Stored in localStorage. Used for the annotator pass.</Card.Description>
			</Card.Header>
			<Card.Content>
				<Input
					type="password"
					bind:value={apiKey}
					oninput={saveKey}
					placeholder="sk-ant-…"
					autocomplete="off"
				/>
			</Card.Content>
		</Card.Root>

		<Card.Root class="input-card">
			<Card.Header>
				<Card.Title class="title-row">
					<MessageSquare size={16} />
					Plan input
				</Card.Title>
				<Card.Description>Paste a plan. Phases become rounded rectangles you drill into.</Card.Description>
			</Card.Header>
			<Card.Content>
				<Textarea bind:value={inputText} class="input-textarea" />
				<div class="run-row">
					<Button onclick={run} disabled={status === 'streaming' || !apiKey.trim()}>
						{#if status === 'streaming'}
							<Loader2 size={14} class="spin" />
							Streaming…
						{:else}
							<Sparkles size={14} />
							Map plan
						{/if}
					</Button>
					{#if errorMsg}
						<span class="err">{errorMsg}</span>
					{/if}
				</div>
			</Card.Content>
		</Card.Root>
	</div>

	<Card.Root class="result">
		<div class="toolbar">
			<div class="bread">
				{#if breadcrumb}
					<button type="button" class="crumb" onclick={exitDrill}>Overview</button>
					<span class="sep">›</span>
					<span class="crumb-current">{breadcrumb}</span>
				{:else}
					<span class="crumb-current">Overview</span>
				{/if}
			</div>
			<div class="tools">
				{#if snapshot.mode === 'drill'}
					<Button variant="ghost" size="sm" onclick={addBlankBlock} disabled={locked}>
						<Plus size={14} /> Block
					</Button>
				{:else}
					<Button
						variant="ghost"
						size="sm"
						onclick={addBlankGroup}
						disabled={locked || status === 'idle'}
					>
						<Plus size={14} /> Phase
					</Button>
				{/if}
				<Button
					variant="ghost"
					size="sm"
					onclick={() => (snapshot.mode === 'drill' ? exitDrill() : fitOverview())}
					disabled={snapshot.groups.length === 0}
				>
					Fit
				</Button>
				<Button variant="ghost" size="sm" onclick={undo} disabled={undoStack.length === 0}>
					<Undo2 size={14} /> Undo
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onclick={() => (showPlanText = !showPlanText)}
					disabled={snapshot.groups.length === 0}
				>
					{showPlanText ? 'Hide plan' : 'Show plan'}
				</Button>
				<Button variant="outline" size="sm" onclick={copyPlan} disabled={snapshot.groups.length === 0}>
					<Copy size={14} /> {copyFeedback || 'Copy plan'}
				</Button>
				<Button
					variant={locked ? 'default' : 'ghost'}
					size="sm"
					onclick={() => (locked = !locked)}
					title={locked ? 'Unlock to edit' : 'Lock the plan'}
				>
					{#if locked}<Lock size={14} />{:else}<Unlock size={14} />{/if}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onclick={() => {
						renameDraft = sessionName;
						showSessions = true;
					}}
					title="Sessions"
				>
					<FolderOpen size={14} />
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onclick={() => (railOpen = !railOpen)}
					title={railOpen ? 'Close right rail' : 'Open right rail'}
				>
					<PanelRightClose size={14} />
				</Button>
			</div>
		</div>

		<div
			class="workspace"
			class:has-rail={railOpen}
			class:has-preview={showPlanText}
			class:locked
		>
		<div
			class="canvas"
			bind:this={container}
			role="presentation"
			onmousedown={handleCanvasMouseDown}
			onmousemove={handleCanvasMouseMove}
			onmouseup={handleCanvasMouseUp}
			onmouseleave={handleCanvasMouseUp}
			onclick={handleCanvasClick}
			onkeydown={() => {}}
		>
			<div
				class="world"
				style="transform: translate({panX}px, {panY}px) scale({zoom});"
			>
				{#each snapshot.groups as group (group.id)}
					<GroupRect
						{group}
						drilled={snapshot.drilledGroupId === group.id}
						dimmed={snapshot.mode === 'drill' && snapshot.drilledGroupId !== group.id}
						disabled={locked}
						onclick={(e) => handleGroupClick(e, group)}
						onimportanceChange={(v) => setGroupImportance(group.id, v)}
					/>
				{/each}
				{#if snapshot.mode === 'drill' && snapshot.drilledGroupId}
					{#each snapshot.blocks.filter((b: BlockRectData) => b.groupId === snapshot.drilledGroupId) as block (block.id)}
						<BlockRect
							{block}
							selected={selectedIds.has(block.id)}
							hidden={hiddenIds.has(block.id)}
							editing={editingBlockId === block.id}
							disabled={locked}
							onclick={(e) => handleBlockClick(e, block.id)}
							ondblclick={(e) => handleBlockDblClick(e, block.id)}
							onimportanceChange={(v) => setBlockImportance(block.id, v)}
							oneditCommit={(text) => commitBlockEdit(block.id, text)}
							oneditCancel={() => cancelBlockEdit(block.id)}
						/>
					{/each}
				{/if}
			</div>

			{#if status === 'idle'}
				<div class="empty">
					<p>Paste a plan above and click <em>Map plan</em> to begin.</p>
				</div>
			{/if}
		</div>
		{#if railOpen}
			<aside class="rail">
				<header class="rail-header">
					<span>{selectedBlock ? typeLabel(selectedBlock.type) : drilledGroup ? 'Phase' : 'Properties'}</span>
					{#if locked}
						<span class="lock-indicator"><Lock size={12} /> Locked</span>
					{/if}
				</header>
				<div class="rail-body">
					{#if selectedBlock}
						{@const b = selectedBlock}
						<label class="field">
							<span class="field-label">Text</span>
							<Textarea
								class="field-textarea"
								value={b.text}
								disabled={locked}
								oninput={(e) =>
									setBlockTextLive(b.id, (e.target as HTMLTextAreaElement).value)}
							/>
						</label>
						<label class="field">
							<span class="field-label">Type</span>
							<select
								disabled={locked}
								value={b.type}
								onchange={(e) =>
									setBlockType(b.id, (e.target as HTMLSelectElement).value as BlockType)}
							>
								{#each BLOCK_TYPES as t (t)}
									<option value={t}>{typeLabel(t)}</option>
								{/each}
							</select>
						</label>
						<label class="field">
							<span class="field-label">
								Importance
								<span class="num">{b.importance.toFixed(2)}</span>
							</span>
							<input
								type="range"
								min="0"
								max="1"
								step="0.01"
								value={b.importance}
								disabled={locked}
								oninput={(e) =>
									setBlockImportance(b.id, Number((e.target as HTMLInputElement).value))}
							/>
						</label>
						<div class="actions-row">
							<Button
								variant={b.pinned ? 'default' : 'outline'}
								size="sm"
								onclick={() => setBlockPinned(b.id, !b.pinned)}
								disabled={locked}
							>
								<Pin size={14} /> {b.pinned ? 'Unpin' : 'Pin'}
							</Button>
							<Button
								variant="outline"
								size="sm"
								onclick={() => duplicateBlock(b.id)}
								disabled={locked}
							>
								<Copy size={14} /> Duplicate
							</Button>
							<Button
								variant="outline"
								size="sm"
								onclick={() => deleteBlock(b.id)}
								disabled={locked}
							>
								<Trash2 size={14} /> Delete
							</Button>
						</div>
						{#if b.source === 'refined'}
							<p class="muted small"><Sparkles size={11} /> Added by Refiner</p>
						{:else if b.source === 'manual'}
							<p class="muted small">Authored manually</p>
						{/if}
					{:else if drilledGroup}
						{@const g = drilledGroup}
						<label class="field">
							<span class="field-label">Phase label</span>
							<Input
								value={editingGroupId === g.id ? editingGroupLabel : g.label}
								disabled={locked}
								oninput={(e) => {
									editingGroupId = g.id;
									editingGroupLabel = (e.target as HTMLInputElement).value;
								}}
								onblur={commitGroupEdit}
							/>
						</label>
						<label class="field">
							<span class="field-label">Summary</span>
							<Textarea
								class="field-textarea"
								value={editingGroupId === g.id ? editingGroupSummary : (g.summary ?? '')}
								disabled={locked}
								oninput={(e) => {
									editingGroupId = g.id;
									editingGroupSummary = (e.target as HTMLTextAreaElement).value;
								}}
								onblur={commitGroupEdit}
							/>
						</label>
						<label class="field">
							<span class="field-label">
								Importance
								<span class="num">{g.importance.toFixed(2)}</span>
							</span>
							<input
								type="range"
								min="0"
								max="1"
								step="0.01"
								value={g.importance}
								disabled={locked}
								oninput={(e) =>
									setGroupImportance(g.id, Number((e.target as HTMLInputElement).value))}
							/>
						</label>
						<div class="actions-row">
							<Button
								variant="outline"
								size="sm"
								onclick={() => deleteGroup(g.id)}
								disabled={locked}
							>
								<Trash2 size={14} /> Delete phase
							</Button>
						</div>
						<p class="muted small">{g.childCount} item{g.childCount === 1 ? '' : 's'}</p>
					{:else}
						<div class="rail-empty">
							<p>Select a block to edit it.</p>
							<ul>
								<li><kbd>Click</kbd> a phase to drill in</li>
								<li><kbd>Esc</kbd> to leave a phase</li>
								<li><kbd>Enter</kbd> on a selected block to edit text</li>
								<li><kbd>Delete</kbd> to hide selection</li>
								<li>Drag the colored pill to change importance</li>
							</ul>
						</div>
					{/if}
				</div>
			</aside>
		{/if}
		{#if showPlanText}
			<aside class="preview-pane">
				<header class="preview-header">
					<span>Live plan</span>
					<span class="muted">markdown</span>
				</header>
				<pre>{planMarkdown}</pre>
			</aside>
		{/if}
		</div>
	</Card.Root>
</main>

<Modal bind:open={showAbout} title="How Plan Refinement works" wide>
	{#snippet body()}
		<div class="about-body">
			<p>
				Plan Refinement is <em>LLM Figma for plans</em>: paste a goal or rough plan,
				get back a spatial map of phases (rounded rectangles) containing items
				(tasks, rationale, risks, open questions). Drill into a phase to edit its items;
				continuously refine with the LLM until the plan is concrete and actionable.
			</p>
			<ol>
				<li><strong>Paste or generate.</strong> The plan annotator normalizes input into atomic blocks (one task / risk / rationale per block) of a fixed ontology.</li>
				<li><strong>Overview shows phases.</strong> Each rounded rectangle is a phase. Importance pill on the top border encodes the phase's aggregate weight.</li>
				<li><strong>Drill in.</strong> Click a phase → camera zooms; children become full-size editable rectangles. Esc returns to overview.</li>
				<li><strong>Show plan</strong> opens a live markdown preview (importance-weighted ordering, "Why / Risks / Done when" sections, open-questions tail).</li>
				<li><strong>Coming next.</strong> Inline edit, importance drag, the Refiner ("expand", "tighten", free-form), persistence, and a lock toggle.</li>
			</ol>
			<p class="muted">
				Block ontology: phase / task / rationale / risk / open-question / dependency /
				success-criterion / constraint / reference. Layout is a single wasm
				pairwise-AABB rectangle separation kernel — one for the overview, one per
				phase for children inside the parent.
			</p>
		</div>
	{/snippet}
</Modal>

<Modal bind:open={showSessions} title="Sessions" wide>
	{#snippet body()}
		<div class="sessions-body">
			<div class="sessions-current">
				<label class="field">
					<span class="field-label">Current session name</span>
					<Input
						value={renameDraft}
						oninput={(e) => (renameDraft = (e.target as HTMLInputElement).value)}
						onblur={commitRename}
					/>
				</label>
				<div class="actions-row">
					<Button variant="outline" size="sm" onclick={newSession}>
						<Plus size={14} /> New session
					</Button>
					<Button variant="outline" size="sm" onclick={exportJson} disabled={!sessionId}>
						<Download size={14} /> Export JSON
					</Button>
					<Button variant="outline" size="sm" onclick={() => fileInput?.click()}>
						<Upload size={14} /> Import JSON
					</Button>
					<input
						type="file"
						accept="application/json"
						bind:this={fileInput}
						style="display: none"
						onchange={(e) => {
							const f = (e.target as HTMLInputElement).files?.[0];
							if (f) importJson(f);
							(e.target as HTMLInputElement).value = '';
						}}
					/>
				</div>
			</div>
			<div class="sessions-list">
				<header class="sessions-list-head">
					<span>Saved sessions ({sessions.length})</span>
				</header>
				{#if sessions.length === 0}
					<p class="muted small">No saved sessions yet. Mapping a plan creates one automatically.</p>
				{/if}
				{#each sessions as s (s.id)}
					<div class="session-row" class:active={s.id === sessionId}>
						<button type="button" class="session-name" onclick={() => loadSession(s.id)}>
							<span class="name">{s.name}</span>
							<span class="time">{new Date(s.updatedAt).toLocaleString()}</span>
						</button>
						<Button
							variant="ghost"
							size="sm"
							onclick={() => deleteSession(s.id)}
							title="Delete session"
						>
							<Trash2 size={14} />
						</Button>
					</div>
				{/each}
			</div>
		</div>
	{/snippet}
</Modal>

<style>
	.page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 32px 24px 64px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 24px;
	}
	.eyebrow {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-muted-foreground);
		margin: 0 0 4px;
	}
	h1 {
		font-size: 26px;
		line-height: 1.15;
		font-weight: 600;
		letter-spacing: -0.015em;
		margin: 0 0 6px;
	}
	.lede {
		font-size: 14px;
		color: var(--color-muted-foreground);
		max-width: 720px;
		margin: 0;
	}
	.head-aside {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.config {
		display: grid;
		grid-template-columns: minmax(240px, 1fr) minmax(360px, 2fr);
		gap: 16px;
	}
	:global(.title-row) {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
	}
	:global(.input-textarea) {
		min-height: 96px;
		font-family: inherit;
	}
	.run-row {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 12px;
	}
	:global(.result) {
		padding: 0;
		overflow: hidden;
	}
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--color-border);
		background: color-mix(in srgb, var(--color-muted) 40%, transparent);
	}
	.bread {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
	}
	.crumb {
		background: none;
		border: none;
		padding: 2px 4px;
		font-size: inherit;
		color: var(--color-muted-foreground);
		cursor: pointer;
		border-radius: 4px;
	}
	.crumb:hover {
		background: var(--color-muted);
		color: var(--color-foreground);
	}
	.sep {
		color: var(--color-muted-foreground);
	}
	.crumb-current {
		font-weight: 600;
		color: var(--color-foreground);
	}
	.tools {
		display: inline-flex;
		gap: 6px;
	}
	.workspace {
		display: grid;
		grid-template-columns: 1fr;
		height: 640px;
		position: relative;
	}
	.workspace.has-rail {
		grid-template-columns: 1fr 300px;
	}
	.workspace.has-preview {
		grid-template-columns: 1fr minmax(280px, 340px);
	}
	.workspace.has-rail.has-preview {
		grid-template-columns: 1fr 300px minmax(260px, 320px);
	}
	.workspace.locked .canvas {
		box-shadow: inset 0 0 0 3px hsl(35 90% 55% / 0.45);
	}
	.canvas {
		position: relative;
		min-width: 0;
		height: 100%;
		overflow: hidden;
		background:
			radial-gradient(circle at 20% 10%, color-mix(in srgb, var(--color-muted) 60%, transparent) 0%, transparent 60%),
			var(--color-background);
		cursor: grab;
	}
	.preview-pane {
		display: flex;
		flex-direction: column;
		border-left: 1px solid var(--color-border);
		background: var(--color-card);
		overflow: hidden;
	}
	.preview-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		font-size: 12px;
		font-weight: 600;
		color: var(--color-card-foreground);
		border-bottom: 1px solid var(--color-border);
		background: color-mix(in srgb, var(--color-muted) 30%, var(--color-card));
	}
	.preview-pane pre {
		flex: 1;
		margin: 0;
		padding: 12px 14px;
		font-family: 'JetBrains Mono', 'Recursive', ui-monospace, monospace;
		font-size: 12px;
		line-height: 1.55;
		color: var(--color-card-foreground);
		white-space: pre-wrap;
		word-break: break-word;
		overflow-y: auto;
	}
	.rail {
		display: flex;
		flex-direction: column;
		border-left: 1px solid var(--color-border);
		background: var(--color-card);
		overflow: hidden;
	}
	.rail-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		font-size: 12px;
		font-weight: 600;
		color: var(--color-card-foreground);
		border-bottom: 1px solid var(--color-border);
		background: color-mix(in srgb, var(--color-muted) 30%, var(--color-card));
	}
	.lock-indicator {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 6px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: hsl(35 90% 35%);
		background: hsl(35 90% 88%);
		border-radius: 999px;
	}
	.rail-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 14px;
		overflow-y: auto;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.field-label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 11px;
		font-weight: 600;
		color: var(--color-muted-foreground);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.field-label .num {
		font-variant-numeric: tabular-nums;
		text-transform: none;
		letter-spacing: 0;
		color: var(--color-card-foreground);
	}
	.field select {
		padding: 6px 8px;
		font-size: 13px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-input);
		color: var(--color-card-foreground);
	}
	.field input[type='range'] {
		width: 100%;
		accent-color: var(--color-primary);
	}
	:global(.field-textarea) {
		min-height: 80px;
		font-size: 13px;
		font-family: inherit;
	}
	.actions-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.rail-empty {
		display: flex;
		flex-direction: column;
		gap: 12px;
		font-size: 13px;
		color: var(--color-muted-foreground);
	}
	.rail-empty ul {
		margin: 0;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.rail-empty kbd {
		display: inline-block;
		padding: 1px 5px;
		font-size: 11px;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		background: var(--color-muted);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		color: var(--color-card-foreground);
	}
	.small {
		font-size: 12px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.saved-indicator {
		font-size: 11px;
		color: var(--color-muted-foreground);
		font-variant-numeric: tabular-nums;
	}
	.sessions-body {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.sessions-current {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.sessions-list {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--color-border);
		padding-top: 12px;
		gap: 4px;
	}
	.sessions-list-head {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-muted-foreground);
		padding-bottom: 4px;
	}
	.session-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		border-radius: 6px;
	}
	.session-row.active {
		background: color-mix(in srgb, var(--color-primary) 10%, transparent);
	}
	.session-row:hover {
		background: color-mix(in srgb, var(--color-muted) 60%, transparent);
	}
	.session-name {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		background: none;
		border: none;
		padding: 4px 6px;
		text-align: left;
		cursor: pointer;
		color: var(--color-card-foreground);
	}
	.session-name .name {
		font-size: 13px;
		font-weight: 500;
	}
	.session-name .time {
		font-size: 11px;
		color: var(--color-muted-foreground);
	}
	.canvas:active {
		cursor: grabbing;
	}
	.world {
		position: absolute;
		inset: 0;
		transform-origin: 0 0;
		transition: none;
	}
	.empty {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-muted-foreground);
		font-size: 14px;
	}
	.about-body {
		display: flex;
		flex-direction: column;
		gap: 12px;
		font-size: 14px;
		line-height: 1.5;
	}
	.about-body ol {
		margin: 0;
		padding-left: 20px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.muted {
		color: var(--color-muted-foreground);
		font-size: 13px;
	}
	.err {
		font-size: 12.5px;
		color: var(--color-destructive);
	}
	:global(.spin) {
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
