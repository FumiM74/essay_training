import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { Curriculum, CurriculumStage, LanguageCheck, RubricItem } from '../src/lib/types/curriculum.ts';
import { buildPracticeTasks } from './practice-bank.ts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, '..');
const sourcePath = path.resolve(webDir, '../curriculum-design/小論文添削サービス_カリキュラム設計.xlsx');
const outputPath = path.resolve(webDir, 'src/lib/data/curriculum.json');

function cellText(value: ExcelJS.CellValue): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'object' && 'text' in value) return String(value.text ?? '').trim();
	if (typeof value === 'object' && 'result' in value) return String(value.result ?? '').trim();
	return String(value).trim();
}

function rowValues(sheet: ExcelJS.Worksheet, row: number, columns: number): string[] {
	return Array.from({ length: columns }, (_, index) => cellText(sheet.getCell(row, index + 1).value));
}

function requireSheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
	const sheet = workbook.getWorksheet(name);
	if (!sheet) throw new Error(`必須シートがありません: ${name}`);
	return sheet;
}

function dedupeExactRows<T>(rows: T[], identity: (row: T) => string): { rows: T[]; removed: number } {
	const seen = new Map<string, string>();
	const result: T[] = [];
	let removed = 0;
	for (const row of rows) {
		const key = identity(row);
		const serialized = JSON.stringify(row);
		const existing = seen.get(key);
		if (existing === serialized) {
			removed += 1;
			continue;
		}
		if (existing && existing !== serialized) throw new Error(`同じ識別子に異なる内容があります: ${key}`);
		seen.set(key, serialized);
		result.push(row);
	}
	return { rows: result, removed };
}

export async function buildCurriculum(): Promise<Curriculum> {
	const sourceBuffer = await fs.readFile(sourcePath);
	const zip = await JSZip.loadAsync(sourceBuffer);
	for (const [name, entry] of Object.entries(zip.files)) {
		if (!entry.dir && name.endsWith('.xml')) {
			const xml = await entry.async('string');
			const normalized = xml
				.replace(/(<\/?)(x):/g, '$1')
				.replace(/xmlns:x=/g, 'xmlns=')
				.replace(/<tableParts[\s\S]*?<\/tableParts>/g, '');
			zip.file(name, normalized);
		}
	}
	const normalizedWorkbook = await zip.generateAsync({ type: 'nodebuffer' });
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.load(normalizedWorkbook);

	const roadmap = requireSheet(workbook, '01_学習ロードマップ');
	const rubricSheet = requireSheet(workbook, '02_段階別ルーブリック');
	const languageSheet = requireSheet(workbook, '03_日本語文成立チェック');
	const instructionSheet = requireSheet(workbook, '04_AI指示設計');

	type RubricRow = RubricItem & { stageId: number };
	const rawRubrics: RubricRow[] = [];
	for (let row = 4; row <= rubricSheet.rowCount; row += 1) {
		const [stageId, , area, item, passCondition, requirement, aiNotes] = rowValues(rubricSheet, row, 8);
		if (!stageId) continue;
		rawRubrics.push({ stageId: Number(stageId), area, item, passCondition, requirement, aiNotes });
	}
	const rubrics = dedupeExactRows(rawRubrics, (row) => `${row.stageId}|${row.area}|${row.item}`);

	const rawInstructions: Array<{ target: string; category: string; instruction: string; reason: string }> = [];
	for (let row = 4; row <= instructionSheet.rowCount; row += 1) {
		const [target, category, instruction, reason] = rowValues(instructionSheet, row, 4);
		if (target) rawInstructions.push({ target, category, instruction, reason });
	}
	const instructions = dedupeExactRows(rawInstructions, (row) => `${row.target}|${row.category}|${row.instruction}`);

	const stages: CurriculumStage[] = [];
	for (let row = 4; row <= roadmap.rowCount; row += 1) {
		const [idValue, name, purpose, learnerAction, passSummary, progression, notes] = rowValues(roadmap, row, 7);
		if (!idValue) continue;
		const id = Number(idValue);
		if (!Number.isInteger(id) || id < 0 || id > 13) throw new Error(`不正な段階IDです: ${idValue}`);
		stages.push({
			id,
			name,
			purpose,
			learnerAction,
			passSummary,
			progression,
			notes,
			rubric: rubrics.rows.filter((item) => item.stageId === id).map(({ stageId: _, ...item }) => item),
			tasks: buildPracticeTasks(id, name)
		});
	}

	const languageChecks: LanguageCheck[] = [];
	for (let row = 4; row <= languageSheet.rowCount; row += 1) {
		const [type, area, check, problemExample, feedbackGuidance] = rowValues(languageSheet, row, 6);
		if (type) languageChecks.push({ type, area, check, problemExample, feedbackGuidance });
	}

	if (stages.length !== 14 || stages.some((stage, index) => stage.id !== index)) {
		throw new Error('段階0〜13が連続していません。');
	}
	if (languageChecks.length === 0) throw new Error('日本語文成立チェックが空です。');

	return {
		schemaVersion: '1.1',
		sourceFile: 'curriculum-design/小論文添削サービス_カリキュラム設計.xlsx',
		duplicateRowsRemoved: rubrics.removed + instructions.removed,
		stages,
		languageChecks
	};
}

const curriculum = await buildCurriculum();
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(curriculum, null, 2)}\n`, 'utf8');
process.stdout.write(`Generated ${path.relative(webDir, outputPath)}: ${curriculum.stages.length} stages, ${curriculum.duplicateRowsRemoved} duplicate rows removed.\n`);
