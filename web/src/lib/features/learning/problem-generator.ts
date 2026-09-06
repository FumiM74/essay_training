import { getPracticeTask, getStage, getStageTasks } from '$lib/data/curriculum';
import { MAX_STAGE_ID, SKILL_KEYS, type BasicQuestion, type PracticeTask, type ProblemFeatureSignature, type ProblemSelectionReason, type ProblemSpecification, type SkillKey, type TopicDomain } from '$lib/types/curriculum';
import type { ProblemHistoryRecord } from '$lib/types/learning';
import { getStageProblemDesign, LOCAL_PROMPT_VERSION, PROBLEM_DESIGN_VERSION, selectFrom, topicDomainFor } from './learning-design';

type GenerationOptions = {
	selectionReason?: ProblemSelectionReason;
	targetSkill?: SkillKey;
};

const surfacePatterns = ['direct', 'reader-check', 'revision-focus', 'explain-clearly'] as const;

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function isStringArray(value: unknown, maximum: number): value is string[] {
	return Array.isArray(value) && value.length > 0 && value.length <= maximum && value.every(isNonEmptyString);
}

function isSkillArray(value: unknown): value is SkillKey[] {
	return isStringArray(value, 8) && value.every((item) => (SKILL_KEYS as readonly string[]).includes(item));
}

export function isProblemFeatureSignature(value: unknown): value is ProblemFeatureSignature {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<ProblemFeatureSignature>;
	const generation = candidate.generation as Partial<ProblemFeatureSignature['generation']> | undefined;
	const optionalFeatures = [candidate.languagePattern, candidate.perspective, candidate.reasoning, candidate.evidenceMode,
		candidate.structurePattern, candidate.sourceStructure, candidate.summaryOperation, candidate.issueConflict,
		candidate.sourceUse, candidate.counterposition, candidate.responseStrategy, candidate.synthesisPattern];
	return candidate.version === 2
		&& isNonEmptyString(candidate.fingerprint)
		&& Number.isSafeInteger(candidate.seed) && Number(candidate.seed) >= 0
		&& ['education', 'technology', 'community', 'public_policy', 'environment', 'ethics'].includes(String(candidate.topicDomain))
		&& isNonEmptyString(candidate.topicKey)
		&& isNonEmptyString(candidate.promptFamily)
		&& isSkillArray(candidate.skillTargets)
		&& ['weakness', 'core', 'exploration'].includes(String(candidate.selectionReason))
		&& isNonEmptyString(candidate.surfacePattern)
		&& optionalFeatures.every((item) => item === undefined || isNonEmptyString(item))
		&& Boolean(generation
			&& ['curated', 'local_variant', 'ai'].includes(String(generation.source))
			&& isNonEmptyString(generation.designVersion)
			&& isNonEmptyString(generation.promptVersion)
			&& (generation.model === undefined || isNonEmptyString(generation.model)));
}

export function createProblemSpecification(
	stageId: number,
	seed: number,
	options: GenerationOptions & { avoidFingerprints?: string[] } = {},
): ProblemSpecification {
	const signature = createProblemFeatures(stageId, seed, options);
	const {
		version: _version,
		fingerprint: _fingerprint,
		seed: _seed,
		surfacePattern: _surfacePattern,
		generation: _generation,
		...features
	} = signature;
	return {
		stageId,
		...features,
		avoidFingerprints: [...new Set(options.avoidFingerprints ?? [])].slice(0, 12),
		maximumPromptCharacters: stageId >= 8 ? 8000 : 1200,
	};
}

function encode(seed: number): string {
	return seed.toString(36);
}

function decode(value: string): number | null {
	if (!/^[0-9a-z]+$/.test(value)) return null;
	const seed = Number.parseInt(value, 36);
	return Number.isSafeInteger(seed) && seed >= 0 ? seed : null;
}

function generatedTaskId(stageId: number, seed: number, features: ProblemFeatureSignature): string {
	return `stage-${stageId}-generated-${encode(seed)}-${features.selectionReason}-${features.skillTargets[0]}`;
}

function parseGeneratedTaskId(taskId: string): { stageId: number; seed: number; options: GenerationOptions } | null {
	const match = /^stage-(\d+)-generated-([0-9a-z]+)(?:-(weakness|core|exploration)-([a-z0-9_]+))?$/.exec(taskId);
	if (!match) return null;
	const stageId = Number(match[1]);
	const seed = decode(match[2]);
	const targetSkill = match[4];
	if (stageId < 1 || stageId > MAX_STAGE_ID || seed === null) return null;
	if (targetSkill && !(SKILL_KEYS as readonly string[]).includes(targetSkill)) return null;
	return {
		stageId,
		seed,
		options: match[3] && targetSkill ? { selectionReason: match[3] as ProblemSelectionReason, targetSkill: targetSkill as SkillKey } : {},
	};
}

function hashText(value: string): string {
	let hash = 2166136261;
	for (const character of value.normalize('NFKC')) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

export function normalizePrompt(value: string): string {
	return value.normalize('NFKC').toLowerCase().replace(/[\s　]+/g, '').replace(/[「」『』（）()、。！？!?]/g, '');
}

const basicQuestionBanks: Array<Omit<BasicQuestion, 'id'>[]> = [
	[
		{ category: 'subject_predicate', instruction: '「地域の図書館は」に合う述語を選んでください。', prompt: '地域の図書館は', choices: ['多くの人の学びを支えている', '多くの人が学びを', '多くの人の学び'], acceptedAnswers: ['多くの人の学びを支えている'], answerLabel: '多くの人の学びを支えている', explanation: '「地域の図書館は」に対して、「どうしているか」を表す述語が必要です。', skillKey: 'subject_predicate' },
		{ category: 'subject_predicate', instruction: '文の主語を選んでください。', prompt: '公園で遊んでいる。', choices: ['子どもたちが', '子どもたちを', '子どもたちに'], acceptedAnswers: ['子どもたちが'], answerLabel: '子どもたちが', explanation: '遊んでいるのは「子どもたち」なので、「が」を使って主語を示します。', skillKey: 'subject_predicate' },
		{ category: 'subject_predicate', instruction: '文を完成させる述語を選んでください。', prompt: '学校の図書館には、多くの本が', choices: ['置かれている', '多くの生徒を', '静かな場所に'], acceptedAnswers: ['置かれている'], answerLabel: '置かれている', explanation: '「多くの本が」に対応して、本がどのような状態かを示す述語を選びます。', skillKey: 'subject_predicate' },
	],
	[
		{ category: 'particle', instruction: '文に合う助詞を選んでください。', prompt: '地域の人（　）祭りに参加した。', choices: ['が', 'を', 'に'], acceptedAnswers: ['が'], answerLabel: 'が', explanation: '参加した人を表すため、「が」を使います。', skillKey: 'particle_accuracy' },
		{ category: 'particle', instruction: '文に合う助詞を選んでください。', prompt: '生徒が資料（　）読んだ。', choices: ['が', 'を', 'で'], acceptedAnswers: ['を'], answerLabel: 'を', explanation: '読んだものを表すため、「を」を使います。', skillKey: 'particle_accuracy' },
		{ category: 'particle', instruction: '文に合う助詞を選んでください。', prompt: '生徒は図書館（　）本を読んだ。', choices: ['に', 'で', 'を'], acceptedAnswers: ['で'], answerLabel: 'で', explanation: '本を読む行動をした場所なので、「で」を使います。', skillKey: 'particle_accuracy' },
		{ category: 'particle', instruction: '文に合う助詞を選んでください。', prompt: '私は放課後、図書館（　）行く。', choices: ['に', 'で', 'を'], acceptedAnswers: ['に'], answerLabel: 'に', explanation: '行き先を表すため、「に」を使います。', skillKey: 'particle_accuracy' },
		{ category: 'particle', instruction: '文に合う助詞を選んでください。', prompt: '私は友達（　）課題について話し合った。', choices: ['と', 'を', 'が'], acceptedAnswers: ['と'], answerLabel: 'と', explanation: '一緒に話し合った相手を表すため、「と」を使います。', skillKey: 'particle_accuracy' },
	],
	[
		{ category: 'auxiliary', instruction: '過去の出来事を表す文にしてください。', prompt: '雨が降る。', acceptedAnswers: ['雨が降った', '雨が降った。'], answerLabel: '雨が降った。', explanation: '過去を表す「た」を使い、「降った」とします。', skillKey: 'auxiliary_accuracy' },
		{ category: 'auxiliary', instruction: '否定を表す文にしてください。', prompt: '今日は図書館へ行く。', acceptedAnswers: ['今日は図書館へ行かない', '今日は図書館へ行かない。'], answerLabel: '今日は図書館へ行かない。', explanation: '否定を表す「ない」を使い、「行かない」とします。', skillKey: 'auxiliary_accuracy' },
		{ category: 'auxiliary', instruction: '希望を表す文にしてください。', prompt: '私は地域の行事に参加する。', acceptedAnswers: ['私は地域の行事に参加したい', '私は地域の行事に参加したい。'], answerLabel: '私は地域の行事に参加したい。', explanation: '希望を表す「たい」を使い、「参加したい」とします。', skillKey: 'auxiliary_accuracy' },
		{ category: 'auxiliary', instruction: '丁寧な文にしてください。', prompt: '私は読書が大切だと思う。', acceptedAnswers: ['私は読書が大切だと思います', '私は読書が大切だと思います。'], answerLabel: '私は読書が大切だと思います。', explanation: '文末を「思います」にすると、丁寧な表現になります。', skillKey: 'auxiliary_accuracy' },
	],
	[
		{ category: 'word_order', instruction: '言葉を並べ替えて、自然な文を作ってください。', prompt: '遊んでいる／公園で／子どもたちが', acceptedAnswers: ['子どもたちが公園で遊んでいる', '子どもたちが公園で遊んでいる。'], answerLabel: '子どもたちが公園で遊んでいる。', explanation: '「誰が」「どこで」「どうする」の順に並べると、意味を読み取りやすくなります。', skillKey: 'modifier_clarity' },
		{ category: 'word_order', instruction: '「小さい」のは鞄だと分かるように直してください。', prompt: '私は小さな妹の鞄を持った。', acceptedAnswers: ['私は妹の小さな鞄を持った', '私は妹の小さな鞄を持った。'], answerLabel: '私は妹の小さな鞄を持った。', explanation: '「小さな」を、説明する「鞄」の近くに置きます。', skillKey: 'modifier_clarity' },
		{ category: 'word_order', instruction: '「昨日借りた」のは本だと分かるように直してください。', prompt: '昨日借りた図書館で本を読んだ。', acceptedAnswers: ['図書館で昨日借りた本を読んだ', '図書館で、昨日借りた本を読んだ', '図書館で昨日借りた本を読んだ。', '図書館で、昨日借りた本を読んだ。'], answerLabel: '図書館で、昨日借りた本を読んだ。', explanation: '「昨日借りた」を、説明する「本」のすぐ前に置きます。', skillKey: 'modifier_clarity' },
	],
	[
		{ category: 'sentence_revision', instruction: '文を最後まで完成させてください。', prompt: '学校に読書の時間が必要だと私は', acceptedAnswers: ['学校に読書の時間が必要だと私は考える', '学校に読書の時間が必要だと私は考える。', '学校に読書の時間が必要だと私は思う', '学校に読書の時間が必要だと私は思う。'], answerLabel: '学校に読書の時間が必要だと私は考える。', explanation: '「私は」に対応する述語を加え、文末まで書きます。', skillKey: 'sentence_completion' },
		{ category: 'sentence_revision', instruction: '助詞の誤りを直してください。', prompt: '私は読書がを続けている。', acceptedAnswers: ['私は読書を続けている', '私は読書を続けている。'], answerLabel: '私は読書を続けている。', explanation: '続けているものは「読書」なので、「を」を使います。', skillKey: 'sentence_completion' },
		{ category: 'sentence_revision', instruction: '不足している述語を加えてください。', prompt: '地域の公園には、多くの子どもたちが', acceptedAnswers: ['地域の公園には多くの子どもたちが集まっている', '地域の公園には、多くの子どもたちが集まっている', '地域の公園には多くの子どもたちが集まっている。', '地域の公園には、多くの子どもたちが集まっている。'], answerLabel: '地域の公園には、多くの子どもたちが集まっている。', explanation: '「子どもたちが」に対応する述語を加えて文を完成させます。', skillKey: 'sentence_completion' },
	],
];

export function basicQuestionSet(seed: number): BasicQuestion[] {
	return basicQuestionBanks.map((bank, slot) => ({ ...bank[(seed + slot * 2) % bank.length], id: `basic-${seed}-${slot + 1}` }));
}

const stageTwoQuestionBanks: Array<Omit<BasicQuestion, 'id'>[]> = [
	[
		{ category: 'relation_sentence', instruction: '二つの内容の関係を考え、読みやすい一文にまとめてください。', prompt: '内容①：学校では読書の時間を設けるべきだ。\n内容②：すべての生徒が文章に触れる機会を持てる。', multiline: true, acceptedAnswers: ['すべての生徒が文章に触れる機会を持てるため、学校では読書の時間を設けるべきだ。'], answerLabel: 'すべての生徒が文章に触れる機会を持てるため、学校では読書の時間を設けるべきだ。', explanation: '「機会を持てる」という理由と「読書の時間を設けるべきだ」という意見の関係が分かる一文にします。', skillKey: 'sentence_relation' },
		{ category: 'relation_sentence', instruction: '条件と結果が分かるように、読みやすい一文にまとめてください。', prompt: '内容①：授業動画を後から見られる。\n内容②：欠席した生徒も学習内容を確認できる。', multiline: true, acceptedAnswers: ['授業動画を後から見られれば、欠席した生徒も学習内容を確認できる。'], answerLabel: '授業動画を後から見られれば、欠席した生徒も学習内容を確認できる。', explanation: '「動画を見られること」が条件で、「内容を確認できること」が結果だと分かる形にします。', skillKey: 'sentence_relation' },
		{ category: 'relation_sentence', instruction: '対比が分かるように、二つの内容を一文にまとめてください。', prompt: '内容①：制服は服装を選ぶ負担を減らせる。\n内容②：自分らしい服装を選びにくくなる。', multiline: true, acceptedAnswers: ['制服は服装を選ぶ負担を減らせる一方で、自分らしい服装を選びにくくなる。'], answerLabel: '制服は服装を選ぶ負担を減らせる一方で、自分らしい服装を選びにくくなる。', explanation: '二つの異なる面を「一方で」などで結び、どちらも同じ主題について述べます。', skillKey: 'sentence_relation' },
	],
	[
		{ category: 'clarity_revision', instruction: '「駅の近くにある」のが図書館だと分かるように、文を直してください。', prompt: '私は駅の近くにある友人と図書館へ行った。', multiline: true, acceptedAnswers: ['私は友人と駅の近くにある図書館へ行った。'], answerLabel: '私は友人と、駅の近くにある図書館へ行った。', explanation: '説明する部分「駅の近くにある」を、説明される「図書館」の近くに置きます。', skillKey: 'modifier_clarity' },
		{ category: 'clarity_revision', instruction: '誰が発表したのか迷わない文に直してください。', prompt: '先生は生徒に昨日調べた結果を発表した。', multiline: true, acceptedAnswers: ['生徒は、昨日調べた結果を先生に発表した。'], answerLabel: '生徒は、昨日調べた結果を先生に発表した。', explanation: '発表した人を主語として最初に示し、調べた結果との関係も明確にします。', skillKey: 'modifier_clarity' },
		{ category: 'clarity_revision', instruction: '同じ言葉の繰り返しを減らし、意味が伝わる一文に直してください。', prompt: '地域の行事への参加は大切で、地域の行事に参加すると地域の人と交流できる。', multiline: true, acceptedAnswers: ['地域の行事に参加すると住民と交流できるため、参加することは大切だ。'], answerLabel: '地域の行事に参加すると住民と交流できるため、参加することは大切だ。', explanation: '同じ語句を必要以上に繰り返さず、理由と意見の関係を一文の中で示します。', skillKey: 'modifier_clarity' },
	],
	[
		{ category: 'information_selection', instruction: '意見を支えるために必要な内容を選び、一文にまとめてください。', prompt: '意見：地域のバスを維持するべきだ。\n情報：①車を持たない人の移動を支えられる。②バスの車体には広告がある。③通院や通学に利用する人がいる。', multiline: true, acceptedAnswers: ['車を持たない人の通院や通学を支えられるため、地域のバスを維持するべきだ。'], answerLabel: '車を持たない人の通院や通学を支えられるため、地域のバスを維持するべきだ。', explanation: '意見を直接支える①と③を使い、関係の薄い②は加えません。', skillKey: 'sentence_completion' },
		{ category: 'information_selection', instruction: '中心となる内容を残し、読みやすい一文にしてください。', prompt: '情報：①食品ロスを減らす必要がある。②食べられる食品にも資源が使われている。③店の営業時間は地域によって異なる。', multiline: true, acceptedAnswers: ['食べられる食品にも資源が使われているため、食品ロスを減らす必要がある。'], answerLabel: '食べられる食品にも資源が使われているため、食品ロスを減らす必要がある。', explanation: '食品ロスを減らす理由になる②を残し、中心から外れる③は使いません。', skillKey: 'sentence_completion' },
		{ category: 'information_selection', instruction: '目的と方法の関係が分かる一文を作ってください。', prompt: '目的：災害時に住民が落ち着いて行動できるようにする。\n方法：地域で避難訓練を定期的に行う。\n補足：訓練は休日に行われることもある。', multiline: true, acceptedAnswers: ['災害時に住民が落ち着いて行動できるよう、地域で避難訓練を定期的に行うべきだ。'], answerLabel: '災害時に住民が落ち着いて行動できるよう、地域で避難訓練を定期的に行うべきだ。', explanation: '目的と方法を中心に一文を作り、なくても意味が成立する補足は無理に加えません。', skillKey: 'sentence_completion' },
	],
];

const stageThreeQuestionBanks: Array<Omit<BasicQuestion, 'id'>[]> = [
	[
		{ category: 'sentence_order', instruction: '主張から理由、具体例へ自然に進む順序を選んでください。', prompt: '①例えば、朝の読書を続けると全員が本に触れられる。\n②学校では読書の時間を設けるべきだ。\n③家庭環境に左右されず、文章を読む機会を持てるからだ。', choices: ['②→③→①', '①→②→③', '③→①→②'], acceptedAnswers: ['②→③→①'], answerLabel: '②→③→①', explanation: '最初に主張を示し、理由、その理由が当てはまる具体例の順に並べます。', skillKey: 'paragraph_coherence' },
		{ category: 'sentence_order', instruction: '問題、原因、対応策の順になる並びを選んでください。', prompt: '①そのため、駅までの乗合交通を導入する。\n②高齢者が通院しにくい地域がある。\n③路線バスの本数が少ないことが原因の一つだ。', choices: ['②→③→①', '③→②→①', '①→②→③'], acceptedAnswers: ['②→③→①'], answerLabel: '②→③→①', explanation: '何が問題かを示し、原因を説明してから対応策を置くと流れが明確になります。', skillKey: 'paragraph_coherence' },
		{ category: 'sentence_order', instruction: '異なる立場を示してから自分の判断へ進む順序を選んでください。', prompt: '①それでも、授業中は利用目的を限定する必要がある。\n②生成AIは学習の疑問を整理する助けになる。\n③一方、答えをそのまま写すおそれもある。', choices: ['②→③→①', '③→①→②', '①→②→③'], acceptedAnswers: ['②→③→①'], answerLabel: '②→③→①', explanation: '利点を示し、対立する懸念を確認してから、自分の判断を述べます。', skillKey: 'paragraph_coherence' },
	],
	[
		{ category: 'missing_link', instruction: '二文の間に、理由から結論へのつながりを補う一文を書いてください。', prompt: '地域の図書館には多様な資料がある。\n［ここに一文を補う］\nしたがって、図書館は学ぶ機会を支える場所として必要だ。', multiline: true, acceptedAnswers: ['それらを利用すれば、年齢にかかわらず知識を得られる。'], answerLabel: 'それらを利用すれば、年齢にかかわらず知識を得られる。', explanation: '資料があることから、学ぶ機会を支えられるという結論までの間を説明します。', skillKey: 'claim_reason_link' },
		{ category: 'missing_link', instruction: '具体例が理由を支えることが分かる一文を補ってください。', prompt: '地域の交流行事は、住民同士が知り合う機会になる。\n例えば、世代の異なる住民が一緒に準備をする。\n［ここに一文を補う］', multiline: true, acceptedAnswers: ['このような共同作業を通して、普段は接点のない人とも関係を築ける。'], answerLabel: 'このような共同作業を通して、普段は接点のない人とも関係を築ける。', explanation: '例で示した共同作業が、住民同士の関係づくりにどうつながるかを説明します。', skillKey: 'claim_reason_link' },
		{ category: 'missing_link', instruction: '問題点から対策へ急に飛ばないよう、一文を補ってください。', prompt: '夜遅くまでスマートフォンを使い、睡眠時間が短くなる生徒がいる。\n［ここに一文を補う］\nそのため、家庭で利用時間を話し合うことが必要だ。', multiline: true, acceptedAnswers: ['睡眠不足が続けば、翌日の学習にも集中しにくくなる。'], answerLabel: '睡眠不足が続けば、翌日の学習にも集中しにくくなる。', explanation: '問題がどのような影響を生むかを示すと、対策が必要な理由を理解できます。', skillKey: 'claim_reason_link' },
	],
	[
		{ category: 'flow_revision', instruction: '関係の薄い一文を除き、残りを自然な順序に並べて書いてください。', prompt: '①学校では協働学習を取り入れるべきだ。\n②校庭の桜は春に咲く。\n③考えを説明し合うと、自分の理解不足に気づける。\n④例えば、解き方を比較すると複数の考え方を学べる。', multiline: true, acceptedAnswers: ['①学校では協働学習を取り入れるべきだ。③考えを説明し合うと、自分の理解不足に気づける。④例えば、解き方を比較すると複数の考え方を学べる。'], answerLabel: '①→③→④（②は除く）', explanation: '主張と理由、具体例に関係しない②を除き、①・③・④の順にします。', skillKey: 'paragraph_analysis' },
		{ category: 'flow_revision', instruction: '同じ内容の繰り返しを一つにまとめ、三文の流れを整えてください。', prompt: '公共交通は必要だ。公共交通は地域に欠かせない。車を持たない人が通院に利用するからだ。だから、地域は路線を維持するべきだ。', multiline: true, acceptedAnswers: ['公共交通は地域に必要だ。車を持たない人が通院に利用するからだ。だから、地域は路線を維持するべきだ。'], answerLabel: '公共交通は地域に必要だ。車を持たない人が通院に利用するからだ。だから、地域は路線を維持するべきだ。', explanation: '最初の二文の重複を一文にまとめ、主張、理由、結論の流れを残します。', skillKey: 'paragraph_analysis' },
		{ category: 'flow_revision', instruction: '対比と結論の関係が分かるように、文章全体を書き直してください。', prompt: 'オンライン学習は繰り返し復習できる。端末を持たない家庭もある。オンライン学習は便利だ。', multiline: true, acceptedAnswers: ['オンライン学習は繰り返し復習できる一方、端末を持たない家庭もあるため、利用環境にも配慮する必要がある。'], answerLabel: 'オンライン学習は繰り返し復習できる一方、端末を持たない家庭もあるため、利用環境にも配慮する必要がある。', explanation: '利点と課題を対比させ、両方を踏まえた結論を最後に示します。', skillKey: 'paragraph_analysis' },
	],
];

function selectQuestionSet(banks: Array<Omit<BasicQuestion, 'id'>[]>, stageId: number, seed: number): BasicQuestion[] {
	return banks.map((bank, slot) => ({ ...bank[Math.floor(seed / (3 ** slot)) % bank.length], id: `stage-${stageId}-${seed}-${slot + 1}` }));
}

export function questionSetForStage(stageId: number, seed: number): BasicQuestion[] | undefined {
	if (stageId === 1) return basicQuestionSet(seed);
	if (stageId === 2) return selectQuestionSet(stageTwoQuestionBanks, stageId, seed);
	if (stageId === 3) return selectQuestionSet(stageThreeQuestionBanks, stageId, seed);
	return undefined;
}

export function promptHash(value: string): string {
	return `fnv1a:${hashText(normalizePrompt(value))}`;
}

export function practiceTaskPromptHash(task: Pick<PracticeTask, 'prompt' | 'questionSet'>): string {
	if (!task.questionSet?.length) return promptHash(task.prompt);
	const questionText = task.questionSet.map((question) => [
		question.category,
		question.instruction,
		question.prompt,
		...(question.choices ?? []),
	].join('\n')).join('\n---\n');
	return promptHash(`${task.prompt}\n${questionText}`);
}

export function promptNgrams(value: string, width = 3): Set<string> {
	const normalized = normalizePrompt(value);
	if (normalized.length <= width) return new Set(normalized ? [normalized] : []);
	return new Set(Array.from({ length: normalized.length - width + 1 }, (_, index) => normalized.slice(index, index + width)));
}

export function promptSimilarity(left: string, right: string): number {
	const a = promptNgrams(left);
	const b = promptNgrams(right);
	if (!a.size && !b.size) return 1;
	let intersection = 0;
	for (const item of a) if (b.has(item)) intersection += 1;
	return intersection / (a.size + b.size - intersection || 1);
}

export function generatedTaskSeed(taskId: string): number | null {
	return parseGeneratedTaskId(taskId)?.seed ?? null;
}

function uniqueSkills(primary: SkillKey | undefined, core: SkillKey[]): SkillKey[] {
	return [...new Set(primary ? [primary, ...core] : core)].slice(0, 8);
}

export function createProblemFeatures(stageId: number, seed: number, options: GenerationOptions = {}): ProblemFeatureSignature {
	const templates = getStageTasks(stageId);
	if (!Number.isSafeInteger(seed) || seed < 0 || !templates.length) throw new Error(`段階${stageId}の問題を生成できません。`);
	const design = getStageProblemDesign(stageId);
	const topic = templates[seed % templates.length];
	const variant = Math.floor(seed / templates.length);
	const skillTargets = uniqueSkills(options.targetSkill, design.coreSkills);
	const signature = {
		version: 2 as const,
		seed,
		topicDomain: topicDomainFor(topic.topicKey),
		topicKey: topic.topicKey,
		promptFamily: design.promptFamily,
		skillTargets,
		selectionReason: options.selectionReason ?? 'exploration',
		surfacePattern: surfacePatterns[variant % surfacePatterns.length],
		languagePattern: selectFrom(design.languagePatterns, variant),
		perspective: selectFrom(design.perspectives, variant),
		reasoning: selectFrom(design.reasoningModes, variant),
		evidenceMode: selectFrom(design.evidenceModes, variant),
		structurePattern: selectFrom(design.structurePatterns, variant),
		sourceStructure: selectFrom(design.sourceStructures, variant),
		summaryOperation: selectFrom(design.summaryOperations, variant),
		issueConflict: selectFrom(design.issueConflicts, variant),
		sourceUse: selectFrom(design.sourceUses, variant),
		counterposition: selectFrom(design.counterpositions, variant),
		responseStrategy: selectFrom(design.responseStrategies, variant),
		synthesisPattern: selectFrom(design.synthesisPatterns, variant),
		generation: {
			source: seed < templates.length ? 'curated' as const : 'local_variant' as const,
			designVersion: PROBLEM_DESIGN_VERSION,
			promptVersion: LOCAL_PROMPT_VERSION,
		},
	};
	const fingerprintSource = JSON.stringify({
		stageId,
		topic: signature.topicKey,
		family: signature.promptFamily,
		skills: signature.skillTargets,
		surface: signature.surfacePattern,
		language: signature.languagePattern,
		perspective: signature.perspective,
		reasoning: signature.reasoning,
		evidence: signature.evidenceMode,
		structure: signature.structurePattern,
		sourceStructure: signature.sourceStructure,
		summary: signature.summaryOperation,
		conflict: signature.issueConflict,
		sourceUse: signature.sourceUse,
		counter: signature.counterposition,
		response: signature.responseStrategy,
		synthesis: signature.synthesisPattern,
	});
	return { ...signature, fingerprint: `pfs2:${hashText(fingerprintSource)}` };
}

function varyTaskWording(prompt: string, surfacePattern: string): string {
	if (surfacePattern === 'direct') return prompt;
	if (surfacePattern === 'reader-check') {
		return prompt
			.replace(/書いてください。$/, '書きましょう。')
			.replace(/説明してください。$/, '説明しましょう。')
			.replace(/要約してください。$/, '要約しましょう。')
			.replace(/検討してください。$/, '検討しましょう。');
	}
	if (surfacePattern === 'revision-focus') {
		return prompt
			.replace(/書いてください。$/, '自分の言葉で書いてください。')
			.replace(/説明してください。$/, '自分の言葉で説明してください。')
			.replace(/要約してください。$/, '自分の言葉で要約してください。');
	}
	return prompt
		.replace(/書いてください。$/, '述べてください。')
		.replace(/説明してください。$/, '述べてください。')
		.replace(/要約してください。$/, 'まとめてください。')
		.replace(/検討してください。$/, '考えてください。');
}

export function generatePracticeTask(stageId: number, seed: number, options: GenerationOptions = {}): PracticeTask {
	const templates = getStageTasks(stageId);
	if (!Number.isSafeInteger(seed) || seed < 0 || !templates.length) throw new Error('問題生成IDが不正です。');
	const features = createProblemFeatures(stageId, seed, options);
	const base = templates[seed % templates.length];
	const prompt = stageId <= 3
		? stageId === 1
			? '文を正しく組み立てるための基礎問題5問に解答してください。'
			: stageId === 2
				? '情報の関係と読みやすさを考え、一文を組み立てる3問に解答してください。'
				: '文の順序や説明のつながりを考え、論理の流れを整える3問に解答してください。'
		: features.generation.source === 'curated' ? base.prompt : varyTaskWording(base.prompt, features.surfacePattern);
	const hint = base.hint;
	return {
		id: generatedTaskId(stageId, seed, features),
		stageId,
		topicKey: base.topicKey,
		title: `${getStage(stageId)?.name ?? `段階${stageId}`}：${features.selectionReason === 'weakness' ? '重点練習' : features.selectionReason === 'core' ? '基本練習' : '発展練習'}`,
		prompt,
		hint,
		questionSet: questionSetForStage(stageId, seed),
		features,
	};
}

export function resolvePracticeTask(taskId: string): PracticeTask | undefined {
	const existing = getPracticeTask(taskId);
	if (existing) {
		const stageTasks = getStageTasks(existing.stageId);
		const seed = Math.max(0, stageTasks.findIndex((task) => task.id === taskId));
		return { ...existing, questionSet: questionSetForStage(existing.stageId, seed), features: createProblemFeatures(existing.stageId, seed) };
	}
	const generated = parseGeneratedTaskId(taskId);
	return generated ? generatePracticeTask(generated.stageId, generated.seed, generated.options) : undefined;
}

export function historyTask(record: ProblemHistoryRecord): PracticeTask {
	const isLegacyLocalVariant = record.features.generation.source === 'local_variant'
		&& record.features.generation.promptVersion === 'adaptive-local-v1';
	const needsCurrentCopy = record.features.generation.promptVersion !== LOCAL_PROMPT_VERSION;
	const separator = record.prompt.lastIndexOf('\n\n');
	const legacyCleanedPrompt = isLegacyLocalVariant && separator >= 0 ? record.prompt.slice(0, separator) : record.prompt;
	const restored = resolvePracticeTask(record.taskId);
	const prompt = record.stageId <= 3
		? (needsCurrentCopy && restored ? restored.prompt : legacyCleanedPrompt).replace(/（セット\d+）$/, '')
		: needsCurrentCopy && restored ? restored.prompt : legacyCleanedPrompt;
	const currentBaseHint = getStageTasks(record.stageId).find((task) => task.topicKey === record.features.topicKey)?.hint;
	const hint = needsCurrentCopy && (restored?.hint || currentBaseHint)
		? restored?.hint ?? currentBaseHint!
		: record.hint;
	return {
		id: record.taskId,
		problemId: record.problemId,
		stageId: record.stageId,
		topicKey: record.features.topicKey,
		title: needsCurrentCopy && restored ? restored.title : record.taskTitle,
		prompt,
		hint,
		questionSet: restored?.questionSet,
		features: needsCurrentCopy && restored ? restored.features : record.features,
	};
}

export function isKnownTopicDomain(value: string): value is TopicDomain {
	return ['education', 'technology', 'community', 'public_policy', 'environment', 'ethics'].includes(value);
}
