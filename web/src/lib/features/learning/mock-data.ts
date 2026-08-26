import type { AccessState, FeedbackResult, UserSession } from '$lib/types/contracts';

export const demoSession: UserSession = { userId: 'demo-learner', role: 'learner', displayName: '体験学習者' };
export const demoAccess: AccessState = { canSubmit: true, plan: 'free', expiresAt: null, remainingSubmissions: 3 };
export const demoTask = {
	stage: 1,
	title: '一文を完成させよう',
	prompt: '「公共の場で、だれもが使いやすいデザインが必要だと思う理由」を、一文で書いてください。'
};
export const demoFeedback: FeedbackResult = {
	schemaVersion: '1.0', languageStatus: 'clean', decision: 'pass',
	priorityFeedback: [{ title: '主張をはっきり示せています', guidance: '次は、その理由を一文加えて、二文でつなげてみましょう。' }],
	skillResults: [{ skillKey: 'clear_claim', outcome: 'achieved', severity: 0, evidence: '主張が明確です。' }]
};
