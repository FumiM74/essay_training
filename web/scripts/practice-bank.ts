import type { PracticeTask } from '../src/lib/types/curriculum.ts';
import { essayTopics as topics, type EssayTopic as Topic } from '../src/lib/data/essay-topic-bank.ts';

const stageSevenOrders = [
	['counter', 'claim', 'reason', 'example', 'distractor', 'conclusion'],
	['claim', 'counter', 'reason', 'distractor', 'example', 'conclusion'],
	['example', 'claim', 'counter', 'reason', 'conclusion', 'distractor'],
	['example', 'counter', 'claim', 'reason', 'distractor', 'conclusion'],
	['counter', 'example', 'claim', 'reason', 'distractor', 'conclusion'],
	['reason', 'claim', 'example', 'distractor', 'counter', 'conclusion'],
	['counter', 'claim', 'reason', 'example', 'conclusion', 'distractor'],
	['example', 'claim', 'reason', 'counter', 'distractor', 'conclusion'],
	['claim', 'counter', 'reason', 'example', 'distractor', 'conclusion'],
	['claim', 'counter', 'reason', 'distractor', 'example', 'conclusion'],
] as const satisfies ReadonlyArray<ReadonlyArray<keyof Pick<Topic, 'counter' | 'claim' | 'reason' | 'example' | 'distractor' | 'conclusion'>>>;

const hints: Record<number, string> = {
	1: '5問は、主語と述語、助詞、文末、語順、文の完成を一つずつ確認します。問題文をよく読み、すべてに解答してください。',
	2: '各問題の指示を読み、情報どうしの関係が迷わず伝わる一文を作りましょう。必要な内容を選び、説明する言葉は説明される言葉の近くに置いてください。',
	3: '各問題の指示を読み、文の順序、途中で不足している説明、重複や関係の薄い文を確かめましょう。読み手が考えの流れを追える文章に直してください。',
	4: '一文目に自分の意見、二文目にその理由を書きましょう。理由は意見の言い換えではなく、「なぜそう考えるのか」が分かる内容にしてください。',
	5: '理由によって何が起こり、どのような結果になるのかを順番に書きましょう。「便利だから」「大切だから」だけで終わらせず、理由を具体的に説明してください。',
	6: '一文目に主張、二文目に理由、三文目に具体例を書きましょう。具体例は、二文目の理由が実際に当てはまる場面を選んでください。',
	7: '最初に、主張・理由・具体例・反対意見または課題と、関係のない文を見分けます。次に、反対意見や課題に答える一文を自分で加えます。最後に、結論まで考えがつながる順序へ並べてください。',
	8: '主張、理由、具体例、結論が自然につながる一段落を書きましょう。項目名は書かず、読み手が流れをたどれる文章にしてください。',
	9: '筆者の主張、主な理由、反対の立場や課題を残して短くまとめましょう。細かな具体例や、「私は」などの自分の意見は加えないでください。',
	10: '意見文の理由・具体例・反対意見のどれに注目したかを示し、それと自分の意見がどうつながるかを説明してください。',
	11: '反対の立場を正確に説明し、納得できる点を認めたうえで、それでも自分の意見を選ぶ理由を書いてください。',
	12: '主張、理由、具体例、反対意見とそれへの答え、結論を短い言葉で整理してください。結論は最初の主張と同じ方向にそろえましょう。',
	13: '書き始める前に、主張・理由・具体例・結論の順序を考え、それに沿って複数段落で書いてください。',
	14: '最初に設問への答えを示します。次に、資料のどの内容を使うかを明らかにし、自分の理由・具体例・別の立場への応答を書きましょう。最後は設問への答えに戻ってください。',
};

function passage(topic: Topic): string { return `${topic.claim}。${topic.reason}。${topic.example}。一方、${topic.counter}。`; }

function promptFor(stageId: number, topic: Topic, topicIndex: number): string {
	switch (stageId) {
		case 1: return '文を正しく組み立てるための基礎問題5問に解答してください。';
		case 2: return '情報の関係と読みやすさを考え、一文を組み立てる3問に解答してください。';
		case 3: return '文の順序や説明のつながりを考え、論理の流れを整える3問に解答してください。';
		case 4: return `「${topic.question}」について、二文で書いてください。\n\n一文目：あなたの意見\n二文目：その理由`;
		case 5: return `「${topic.claim}」という意見を支える理由を書いてください。\n\n「何が起こり、その結果どうなるのか」が分かるように説明してください。`;
		case 6: return `「${topic.claim}」という意見について、三文で書いてください。\n\n一文目：意見\n二文目：理由\n三文目：理由を裏付ける具体例`;
		case 7: {
			const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥'];
			const order = stageSevenOrders[topicIndex % stageSevenOrders.length];
			const sentences = order.map((key, index) => `${circledNumbers[index]}${topic[key]}。`).join('\n');
			return `次の6文を読み、三つの作業をしてください。\n1．「主張・理由・具体例・反対意見または課題」に当たる文を、それぞれ番号で答えてください。\n2．話題と関係のない文を一つ選び、番号で答えてください。\n3．反対意見または課題に答える一文を補い、関係のない文を除いた5文と合わせて、自然な順序の段落に直してください。\n\n${sentences}`;
		}
		case 8: return `「${topic.question}」について、一段落を書いてください。\n\n主張 → 理由 → 具体例 → 結論の順に、自然につながる文章にしてください。`;
		case 9: return `次の意見文を要約してください。筆者の主張、主な理由、反対の立場または課題を残してください。細かな具体例と、あなた自身の意見は書かないでください。\n\n${passage(topic)}`;
		case 10: return `次の意見文を読み、文中の「理由・具体例・反対意見」のうち一つ以上に触れて、「${topic.question}」についてあなたの意見を書いてください。筆者の意見に賛成でも反対でも構いません。\n\n${passage(topic)}`;
		case 11: return `「${topic.question}」について、次の順に書いてください。\n\n①あなたの意見\n②反対の立場と、納得できる点\n③それでもあなたの意見を選ぶ理由`;
		case 12: return `「${topic.question}」について、小論文を書く前の構成メモを作ってください。\n\n「主張」\n「理由」\n「具体例」\n「反対意見と、それへの答え」\n「結論」\n\nの五項目に分けて書いてください。`;
		case 13: return `「${topic.question}」について、主張・理由・具体例・結論が一貫する、複数段落の短い小論文を書いてください。`;
		case 14: return `次の意見文を資料として読み、「${topic.question}」について小論文を書いてください。資料中の内容を一つ以上取り上げ、あなた自身の意見・理由・具体例・反対の立場への応答を含めてください。資料の意見に賛成でも反対でも構いません。最後に、設問への答えとなる結論を書いてください。\n\n${passage(topic)}`;
		default: throw new Error(`練習課題を生成できない段階です: ${stageId}`);
	}
}

export function buildPracticeTasks(stageId: number, stageName: string): PracticeTask[] {
	if (stageId < 1 || stageId > 14) return [];
	const stageTopics = stageId <= 3 ? topics.slice(0, 10) : topics;
	return stageTopics.map((topic, index) => ({ id: `stage-${stageId}-practice-${index + 1}`, stageId, topicKey: topic.key, title: `${stageName}：${stageId === 1 ? `基礎問題セット${index + 1}` : topic.label}`, prompt: promptFor(stageId, topic, index), hint: hints[stageId] }));
}
