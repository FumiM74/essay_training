import { questionDesignForGeneration, type ProblemGenerationSpecification } from './problem-generation-contract.ts';

export const CLAUDE_PROBLEM_GENERATION_SYSTEM = 'あなたは、日本語の文章構成力を段階別に育てる教材編集者です。問題文に書かれていない条件で採点される課題を作ってはいけません。出力スキーマを厳守してください。';

export function buildProblemGenerationPrompt(specification: ProblemGenerationSpecification, stageDesign: { focus: string; notRequired: string }): string {
	const questionDesign = questionDesignForGeneration(specification.stageId);
	return [
		'<task>文章構成トレーニングの問題を1件作成してください。</task>',
		'<stage_design>',
		`STEP: ${specification.stageId}`,
		`評価する内容: ${stageDesign.focus}`,
		`この段階では要求しない内容: ${stageDesign.notRequired}`,
		'</stage_design>',
		`<specification>${JSON.stringify(specification)}</specification>`,
		...(specification.customTopic ? [
			`<learner_topic>${specification.customTopic}</learner_topic>`,
			'学習者が自由設定したテーマを問題の中心にしてください。別のテーマへ置き換えたり、テーマを無視したりしないでください。',
		] : []),
		...(questionDesign.length ? [
			'<question_set>',
			`basicQuestionsを次の順序・分類・技能で${questionDesign.length}件作成してください: ${JSON.stringify(questionDesign)}`,
			'各小問題のinstructionとpromptだけで、残す・言い換える・除く情報と、追加する要素が分かるようにしてください。',
			'選択式以外のchoicesは空配列にしてください。トップレベルのsourceUnits、requiredAdditions、acceptedAnswerExamples、gradingCriteriaは空配列にしてください。',
			'</question_set>',
		] : [
			'<single_problem>basicQuestionsは空配列にし、単問の条件と解答例をトップレベルへ記録してください。</single_problem>',
		]),
		'<rules>',
		'- 課題文だけを読んで、何を提出すればよいか判断できる自然な日本語にしてください。',
		'- 元の各文や情報をsourceUnitsへ分け、すべて残す・意味を保って言い換えてよい・取り除く、のいずれかを指定してください。',
		'- sourceUnitsの全文を課題文にも表示してください。',
		'- 同じ扱いの素材が複数ある場合は「三つの内容をすべて使い」のように一度で指示してください。その後に個別の素材を引用して「〜という内容も残します」などと重ねて説明しないでください。',
		'- 問題文は学習者が今行う操作だけを直接示してください。以前の問題や修正経緯を想起させる「前の修正」「以前は」「〜も残します」のような編集者向けの説明を混ぜないでください。',
		'- 結論、理由、具体例などを新しく加える必要がある場合はrequiredAdditionsへ記録し、その役割を課題文にも明記してください。',
		'- 正解例にだけ存在する条件を採点条件にしないでください。hiddenRequirementsは必ず空配列にしてください。',
		'- gradingCriteriaは対象技能ごとに1件とし、課題文で明示した条件だけを合格条件にしてください。',
		'- acceptedAnswerExamplesは唯一の正解ではなく、条件を満たす自然な解答例として作成してください。',
		'- ヒントは答えを示さず、どの部分をどう考えるかを小学校高学年から中学生にも分かる言葉で示してください。',
		'- information_selectionでは、promptに「意見・目的・方針・話題」のいずれかと番号付きの「材料」を表示してください。instructionは「意見と、その理由になる材料だけを使って、一文にしてください。言葉の形や順番は変えて構いません。」のように、何と何を使うかが分かる二文以内の自然な指示にしてください。',
		'- information_selectionの採用する中心内容と材料はmay_rephrase、使わない材料はmust_removeとし、それぞれ1件以上含めてください。冗長な条件の列挙や「補足」のように扱いを推測させる見出しは使わないでください。',
		'- avoidFingerprintsの過去問題と同じ題材・構造・表現へ寄せないでください。',
		'- DBへ安全に保存できるよう、説明と正解例は必要十分な長さにし、同じ説明を繰り返さないでください。',
		'</rules>',
	].join('\n');
}
