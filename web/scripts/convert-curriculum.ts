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

const stageBlueprints = [
	{ id: 1, name: '文を作る基礎', purpose: '文を構成する基本要素を使い分ける', learnerAction: '主語と述語、助詞、文末、語順、文の完成を5問1セットで練習します。', passSummary: '5問すべてに正解すると、1セット合格です。', progression: '全問正解したセットだけを合格数に加える', notes: '不正解後は解説を示し、同じ技能の新しいセットを出す' },
	{ id: 2, name: '情報を整理して一文を作る', purpose: '情報の関係を読み取り、明確で読みやすい一文を作る', learnerAction: '関係を示す、曖昧さを直す、必要な情報を選ぶ、という3問を1セットで練習します。', passSummary: '3問すべてに正解すると、1セット合格です。', progression: '全問正解したセットだけを合格数に加える', notes: '正解例との文字列一致ではなく、意味が等しい自然な表現を認める' },
	{ id: 3, name: '文と文の論理を組み立てる', purpose: '複数の文の順序・不足・重複を見直し、論理の流れを整える', learnerAction: '文を並べる、説明を補う、流れを直す、という3問を1セットで練習します。', passSummary: '3問すべてに正解すると、1セット合格です。', progression: '全問正解したセットだけを合格数に加える', notes: '接続詞を一語補うだけではなく、2〜4文の論理関係を扱う' },
	{ id: 4, name: '意見と理由を書く', purpose: '問いへの答えと理由を結び付ける', learnerAction: '自分の意見と、その理由を二文で書きます。', passSummary: '意見が明確で、理由がその意見を説明していれば合格です。', progression: '意見と理由の二文を完成させること', notes: '' },
	{ id: 5, name: '理由を深める', purpose: '理由の因果関係を説明する', learnerAction: '理由によって何が起こり、どのような結果になるかを書きます。', passSummary: '原因から結果までのつながりが説明されていれば合格です。', progression: '理由を一段深く説明すること', notes: '' },
	{ id: 6, name: '具体例で理由を支える', purpose: '理由に合う具体例を示す', learnerAction: '意見と理由に合う具体例を加えます。', passSummary: '具体例が理由を実際に示す内容なら合格です。', progression: '理由と具体例の対応を示すこと', notes: '' },
	{ id: 7, name: '段落を分析して直す', purpose: '段落の構造と論理上の問題を発見・修正する', learnerAction: '6〜8文の段落から各文の役割を見分け、不要文・順序・論理の飛躍を直します。', passSummary: '役割の判別、不要文の削除、並べ替え、不足説明の補完ができれば合格です。', progression: '分析と修正を一つの課題で行うこと', notes: '単純な役割分類だけでは合格にしない' },
	{ id: 8, name: '段落を組み立てる', purpose: '一段落を自力で構成する', learnerAction: '主張・理由・具体例・結論がつながる段落を書きます。', passSummary: '一段落が同じ主張を支え、結論までつながれば合格です。', progression: '役割名の誘導なしで段落を書くこと', notes: '' },
	{ id: 9, name: '要約する', purpose: '重要な内容を保って短くする', learnerAction: '筆者の主張と重要な理由を残し、自分の意見を加えずにまとめます。', passSummary: '元の主張を変えず、重要点を残していれば合格です。', progression: '客観的に要約すること', notes: '' },
	{ id: 10, name: '資料を使って意見を書く', purpose: '資料と自分の意見を結び付ける', learnerAction: '資料の内容を根拠として、自分の意見を書きます。', passSummary: '資料のどの内容を根拠にしたかが分かれば合格です。', progression: '資料に基づく意見を書くこと', notes: '' },
	{ id: 11, name: '別の立場を扱う', purpose: '反対意見を公平に扱い応答する', learnerAction: '反対の立場を正確に示し、それでも自分の意見を選ぶ理由を書きます。', passSummary: '反対意見を弱めずに示し、応答できていれば合格です。', progression: '複数の立場を扱うこと', notes: '' },
	{ id: 12, name: '構成メモを作る', purpose: '書く前に小論文全体を設計する', learnerAction: '主張・理由・具体例・反対意見への答え・結論を整理します。', passSummary: '各項目が同じ設問への答えを支えていれば合格です。', progression: '文章を書く前の構成を完成させること', notes: '' },
	{ id: 13, name: 'ミニ小論文を書く', purpose: '構成に沿って複数段落を書く', learnerAction: '構成メモを意識し、短い小論文を書きます。', passSummary: '主張、根拠、結論が複数段落で一貫していれば合格です。', progression: '短い小論文を完成させること', notes: '' },
	{ id: 14, name: '本番形式の小論文を書く', purpose: '課題分析から推敲まで統合する', learnerAction: '資料を読み、構成を考え、複数の立場を扱う小論文を書きます。', passSummary: '設問に答え、根拠と別の立場を扱い、結論まで一貫すれば合格です。', progression: '本番形式の課題を完成させること', notes: '' },
] satisfies Array<Omit<CurriculumStage, 'rubric' | 'tasks'>>;

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

	const [stageZeroId, stageZeroName, stageZeroPurpose, stageZeroAction, stageZeroPass, stageZeroProgression, stageZeroNotes] = rowValues(roadmap, 4, 7);
	if (Number(stageZeroId) !== 0) throw new Error('ロードマップの先頭に段階0が必要です。');
	const stageZero: CurriculumStage = { id: 0, name: stageZeroName, purpose: stageZeroPurpose, learnerAction: stageZeroAction, passSummary: stageZeroPass, progression: stageZeroProgression, notes: stageZeroNotes, rubric: rubrics.rows.filter((item) => item.stageId === 0).map(({ stageId: _, ...item }) => item), tasks: [] };
	const stages: CurriculumStage[] = [stageZero, ...stageBlueprints.map((stage) => ({
		...stage,
		rubric: [{ area: '段階別評価', item: stage.name, passCondition: stage.passSummary, requirement: '必須', aiNotes: stage.learnerAction }],
		tasks: buildPracticeTasks(stage.id, stage.name),
	}))];

	const languageChecks: LanguageCheck[] = [];
	for (let row = 4; row <= languageSheet.rowCount; row += 1) {
		const [type, area, check, problemExample, feedbackGuidance] = rowValues(languageSheet, row, 6);
		if (type) languageChecks.push({ type, area, check, problemExample, feedbackGuidance });
	}

	if (stages.length !== 15 || stages.some((stage, index) => stage.id !== index)) {
		throw new Error('段階0〜14が連続していません。');
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
