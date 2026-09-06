export type AppRole = 'learner' | 'admin';

export type UserSession = {
	userId: string;
	role: AppRole;
	displayName: string;
};

export type AccessState = {
	canSubmit: boolean;
	plan: 'free' | 'monthly' | 'term';
	expiresAt: string | null;
	remainingSubmissions: number | null;
};

export type LanguageStatus = 'clean' | 'minor_issue' | 'revision_required';
export type FeedbackDecision = 'pass' | 'revise';
export type SkillOutcome = 'achieved' | 'partial' | 'missed';

export type SkillResult = {
	skillKey: import('./curriculum').SkillKey;
	outcome: SkillOutcome;
	severity: 0 | 1 | 2;
	evidence: string;
};

export type FeedbackResult = {
	schemaVersion: string;
	languageStatus: LanguageStatus;
	decision: FeedbackDecision;
	priorityFeedback: Array<{ title: string; guidance: string }>;
	skillResults: SkillResult[];
	basicQuestionResults?: Array<{
		questionId: string;
		instruction: string;
		prompt: string;
		answer: string;
		correct: boolean;
		answerLabel: string;
		explanation: string;
	}>;
};
