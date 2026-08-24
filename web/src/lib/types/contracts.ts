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

export type FeedbackResult = {
	schemaVersion: string;
	languageStatus: LanguageStatus;
	decision: FeedbackDecision;
	priorityFeedback: Array<{ title: string; guidance: string }>;
};
