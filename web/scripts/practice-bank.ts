import type { PracticeTask } from '../src/lib/types/curriculum.ts';

type Topic = {
	key: string;
	label: string;
	subject: string;
	question: string;
	claim: string;
	reason: string;
	example: string;
	counter: string;
};

const topics: Topic[] = [
	{ key: 'accessible-design', label: '公共施設の使いやすさ', subject: '公共施設をだれもが使いやすくすること', question: '公共施設の設計では使いやすさを最優先するべきか', claim: '公共施設には、年齢や障害の有無にかかわらず利用しやすい設計が必要だ', reason: '利用上の障壁が減れば、より多くの人が社会参加できるからだ', example: '段差のない入口や分かりやすい案内は、車いす利用者だけでなく高齢者や子ども連れにも役立つ', counter: '設備の改修には費用がかかるため、優先順位を慎重に決めるべきだという意見もある' },
	{ key: 'school-reading', label: '学校での読書時間', subject: '学校で読書の時間を設けること', question: '学校は毎日読書の時間を設けるべきか', claim: '学校では継続的な読書時間を確保するべきだ', reason: '家庭環境に左右されず、文章に触れる機会を持てるからだ', example: '短時間でも毎日続けることで、長い文章を読むことへの抵抗が小さくなる', counter: '授業時間が限られているため、読書は家庭に任せるべきだという考えもある' },
	{ key: 'smartphone-rules', label: 'スマートフォンの利用規則', subject: '中学生のスマートフォン利用にルールを設けること', question: '中学生のスマートフォン利用には家庭や学校のルールが必要か', claim: '中学生のスマートフォン利用には、話し合って決めたルールが必要だ', reason: '長時間利用による睡眠不足や学習への影響を抑えられるからだ', example: '就寝前は端末を共用スペースに置くと、夜間の利用を減らしやすい', counter: '一律の制限よりも、本人が自己管理を学ぶ機会を重視すべきだという意見もある' },
	{ key: 'community-events', label: '地域行事への若者の参加', subject: '若者が地域の行事に参加すること', question: '学校は生徒の地域行事への参加を促すべきか', claim: '地域の行事には若者が参加しやすい仕組みを作るべきだ', reason: '世代を越えた交流が生まれ、地域の課題を自分事として理解できるからだ', example: '祭りの運営や防災訓練を手伝うことで、地域の人と顔の見える関係ができる', counter: '休日の活動を学校や地域が強く求めると、生徒の負担になるという懸念もある' },
	{ key: 'public-transport', label: '公共交通の利用', subject: '公共交通を利用する人を増やすこと', question: '自治体は自家用車より公共交通の利用を優先して支援するべきか', claim: '地域では公共交通を利用しやすくする取り組みを進めるべきだ', reason: '交通手段を持たない人の移動を支え、渋滞や環境負荷も減らせるからだ', example: '利用者の多い時間帯に便数を増やせば、通学や通院で選びやすくなる', counter: '利用者が少ない地域では、路線維持の費用が大きすぎるという課題もある' },
	{ key: 'learning-from-failure', label: '失敗から学ぶ姿勢', subject: '失敗を振り返って学ぶこと', question: '学校では正解だけでなく失敗の過程も評価するべきか', claim: '学習では失敗の原因を振り返る時間を重視するべきだ', reason: '間違い方を理解すると、次に取るべき方法を具体的に変えられるからだ', example: '計算ミスの原因を記録した生徒は、同じ確認不足を減らしやすい', counter: '失敗の分析に時間をかけすぎると、新しい内容へ進みにくいという意見もある' },
	{ key: 'collaborative-learning', label: '協働学習', subject: '学校で協働学習を行うこと', question: '個人学習より協働学習の時間を増やすべきか', claim: '学校では目的を明確にした協働学習を取り入れるべきだ', reason: '異なる考えを説明し合うことで、自分の理解の不足に気づけるからだ', example: '解き方を比較する活動では、一つの問題にも複数の考え方があると分かる', counter: '役割が偏ると、一部の生徒だけが作業することになるという問題もある' },
	{ key: 'online-learning', label: 'オンライン学習', subject: 'オンライン学習を学校教育に取り入れること', question: '学校教育でオンライン学習を積極的に活用するべきか', claim: '学校は対面授業を補う手段としてオンライン学習を活用するべきだ', reason: '時間や場所の制約を減らし、自分の理解度に合わせて復習できるからだ', example: '欠席した生徒が解説動画を見れば、授業内容を後から確認できる', counter: '端末環境の差や自己管理の難しさが、学習格差を広げるおそれもある' },
	{ key: 'school-uniforms', label: '学校制服', subject: '学校で制服を定めること', question: '学校に制服は必要か', claim: '制服は学校生活の選択肢の一つとして維持する価値がある', reason: '毎日の服装選びの負担や、服装による比較を減らせるからだ', example: '気候や体調に合わせて複数の型から選べれば、統一感と快適さを両立できる', counter: '購入費用や個人の表現を制限する点から、私服を選べるようにすべきだという意見もある' },
	{ key: 'generative-ai', label: '生成AIと学校教育', subject: '生成AIを学校教育で適切に活用すること', question: '学校の学習で生成AIの利用を認めるべきか', claim: '学校では利用目的と確認方法を教えたうえで生成AIを活用するべきだ', reason: '質問や推敲の補助に使える一方、出力を確かめる力も学べるからだ', example: 'AIの回答と教科書を比較する活動なら、誤りや根拠不足を見つける練習になる', counter: '考える前に答えを得る使い方が広がると、自力で考える機会が減るという懸念もある' },
	{ key: 'food-loss', label: '食品ロスの削減', subject: '家庭や店で食品ロスを減らすこと', question: '食品ロスを減らすために販売方法を変えるべきか', claim: '店と消費者の双方が食品ロスを減らす行動を取るべきだ', reason: '食料の生産や廃棄に使われる資源を無駄にせずに済むからだ', example: '期限の近い商品を少量単位で値引きすれば、必要な人が選びやすくなる', counter: '管理方法を複雑にすると、店の作業負担や費用が増えるという課題もある' },
	{ key: 'disaster-preparedness', label: '地域の防災', subject: '地域で日頃から防災訓練を行うこと', question: '地域の防災訓練への参加をもっと促すべきか', claim: '地域では日常的に参加しやすい防災訓練を行うべきだ', reason: '災害時の役割や避難経路を事前に知れば、混乱を減らせるからだ', example: '短時間の安否確認訓練なら、子どもから高齢者まで参加しやすい', counter: '同じ訓練の繰り返しでは緊張感が薄れ、形だけになるという指摘もある' },
	{ key: 'school-rules', label: '学校のルールづくり', subject: '生徒が学校のルールづくりに参加すること', question: '学校のルールは生徒も参加して見直すべきか', claim: '学校のルールは生徒と教職員が定期的に話し合って見直すべきだ', reason: '目的を理解して決めたルールは、守る理由を自分で考えやすいからだ', example: '服装規定の理由と困りごとを調べて話し合えば、必要な基準を具体化できる', counter: 'すべてを話し合いで決めると時間がかかり、安全上必要な判断が遅れるという懸念もある' },
];

const legacyTasks: Record<number, Omit<PracticeTask, 'id' | 'stageId' | 'title'>> = {
	1: { topicKey: 'accessible-design', prompt: '「公共の場で、だれもが使いやすいデザインが必要だと思う理由」を、一文で書いてください。', hint: '「私は〜と思う。」の形から始め、文末まで書き切りましょう。' },
	2: { topicKey: 'school-reading', prompt: '「学校で読書の時間を設ける利点」を、修飾関係と助詞に注意して一文で書いてください。', hint: '長い説明が、どの言葉にかかっているか確認しましょう。' },
	3: { topicKey: 'smartphone-rules', prompt: '「中学生のスマートフォン利用にルールは必要か」について、あなたの立場を一文で書いてください。', hint: '賛成・反対、または何を重視するかを明確にしましょう。' },
	4: { topicKey: 'community-events', prompt: '「地域の行事に若者が参加するべきだ」という主張と、その理由を二文で書いてください。', hint: '二文目が一文目の言い換えだけにならないようにしましょう。' },
	5: { topicKey: 'public-transport', prompt: '「公共交通を利用する人を増やすべきだ」という主張について、理由を具体的な因果まで説明してください。', hint: '「便利だから」で止めず、何がどう良くなるかを書きましょう。' },
	6: { topicKey: 'learning-from-failure', prompt: '「失敗から学ぶことは大切だ」という主張を、理由と具体例を含む三文で書いてください。', hint: '具体例が、どの理由を裏付けるのか確認しましょう。' },
	7: { topicKey: 'collaborative-learning', prompt: '「学校での協働学習の価値」について、主張・理由・具体例・まとめの四文で書いてください。', hint: '最後に新しい論点を出さず、最初の主張へ戻りましょう。' },
	8: { topicKey: 'news-structure', prompt: '身近なニュース記事を一つ想定し、その主張・理由・具体例・結論を区別して説明してください。', hint: '推測ではなく、本文のどの内容を根拠にしたか分かる形で書きましょう。' },
	9: { topicKey: 'online-learning', prompt: '「オンライン学習には時間や場所の制約を減らす利点がある。一方、自己管理が難しい場合もある。」という文章を、私見を入れずに要約してください。', hint: '筆者の主張と根拠を残し、「私は」を入れないようにしましょう。' },
	10: { topicKey: 'online-learning', prompt: 'オンライン学習の利点と課題を踏まえ、学校教育でどう活用するべきか、根拠を示して書いてください。', hint: '課題文の内容と自分の意見の接点を示しましょう。' },
	11: { topicKey: 'school-uniforms', prompt: '制服の必要性について自分の立場を書き、反対の立場も公平に示したうえで検討してください。', hint: '反対意見を弱く言い換えず、自説との関係を説明しましょう。' },
	12: { topicKey: 'intergenerational-community', prompt: '「地域社会で世代間交流を増やすには何が必要か」について、300字程度のミニ小論文を書いてください。', hint: '主張・理由・具体例・結論が同じ中心主張を支えるようにしましょう。' },
	13: { topicKey: 'generative-ai', prompt: '「生成AIを学校教育で活用する際に重視すべきこと」について、600字以内の小論文を書いてください。', hint: '設問に答え、主張・根拠・具体例・結論を一貫させましょう。' },
};

const hints: Record<number, string> = {
	1: '一つの主語と述語を対応させ、文末まで書き切りましょう。',
	2: '助詞を確認し、どの説明がどの言葉にかかるかを明確にしましょう。',
	3: '賛成・反対だけでなく、何を重視する立場かを一文で示しましょう。',
	4: '一文目を主張、二文目をその主張を支える理由にしましょう。',
	5: '理由から結果までのつながりを「なぜ」「その結果」で掘り下げましょう。',
	6: '具体例が直前の理由を本当に裏付けているか確認しましょう。',
	7: '主張・理由・具体例・まとめを一文ずつ置き、中心をそろえましょう。',
	8: '課題文の表現を根拠に、主張・理由・例・留保を分けましょう。',
	9: '自分の意見を加えず、中心主張と重要な理由・課題を残しましょう。',
	10: '課題文を踏まえた自分の立場と、その根拠のつながりを示しましょう。',
	11: '反対意見を公平に扱い、認める点と自説を維持する理由を分けましょう。',
	12: '300字程度で、主張・理由・具体例・結論を一つの中心にまとめましょう。',
	13: '600字以内で設問に正面から答え、根拠・反対視点・結論を一貫させましょう。',
};

function passage(topic: Topic): string {
	return `${topic.claim}。${topic.reason}。${topic.example}。一方、${topic.counter}。`;
}

function generatedPrompt(stageId: number, topic: Topic): string {
	switch (stageId) {
		case 1: return `「${topic.subject}が大切だと思う理由」を、一文で書いてください。`;
		case 2: return `「${topic.subject}の利点」を、修飾関係と助詞に注意して一文で書いてください。`;
		case 3: return `「${topic.question}」について、あなたの立場を一文で書いてください。`;
		case 4: return `「${topic.claim}」という主張と、その理由を二文で書いてください。`;
		case 5: return `「${topic.claim}」という主張について、理由を具体的な因果まで説明してください。`;
		case 6: return `「${topic.claim}」という主張を、理由と具体例を含む三文で書いてください。`;
		case 7: return `「${topic.label}」について、主張・理由・具体例・まとめの四文で書いてください。`;
		case 8: return `次の文章の主張・理由・具体例・反対視点を区別して説明してください。\n\n${passage(topic)}`;
		case 9: return `次の文章を、私見を入れずに要約してください。\n\n${passage(topic)}`;
		case 10: return `次の文章を踏まえ、「${topic.question}」について根拠を示して意見を書いてください。\n\n${passage(topic)}`;
		case 11: return `「${topic.question}」について自分の立場を書き、反対の立場も公平に示したうえで検討してください。`;
		case 12: return `「${topic.question}」について、300字程度のミニ小論文を書いてください。`;
		case 13: return `「${topic.question}」について、600字以内の小論文を書いてください。`;
		default: throw new Error(`練習課題を生成できない段階です: ${stageId}`);
	}
}

export function buildPracticeTasks(stageId: number, stageName: string): PracticeTask[] {
	const legacy = legacyTasks[stageId];
	if (!legacy) return [];
	const variants = topics.filter((topic) => topic.key !== legacy.topicKey).slice(0, 9);
	return [
		{ id: `stage-${stageId}-practice-1`, stageId, title: `${stageName}：基礎問題`, ...legacy },
		...variants.map((topic, index) => ({
			id: `stage-${stageId}-practice-${index + 2}`,
			stageId,
			topicKey: topic.key,
			title: `${stageName}：${topic.label}`,
			prompt: generatedPrompt(stageId, topic),
			hint: hints[stageId],
		})),
	];
}
