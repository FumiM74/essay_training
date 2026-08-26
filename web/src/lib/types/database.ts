export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Relationship = {
	foreignKeyName: string;
	columns: string[];
	isOneToOne: boolean;
	referencedRelation: string;
	referencedColumns: string[];
};

export type Database = {
	public: {
		Tables: {
			problem_history: {
				Row: { learner_id: string; task_key: string; problem_id: string | null; stage_id: number; task_title: string; prompt: string; hint: string; feature_signature: Json; prompt_hash: string; design_version: string; generation_source: string; issued_at: string; submitted_at: string | null };
				Insert: never;
				Update: never;
				Relationships: Relationship[];
			};
			problem_bank: {
				Row: { id: string; task_key: string; stage_id: number; title: string; prompt: string; hint: string; feature_signature: Json; prompt_hash: string; design_version: string; generation_source: string; provider: string | null; model: string | null; prompt_version: string; status: string; input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; created_at: string; approved_at: string | null };
				Insert: never;
				Update: never;
				Relationships: Relationship[];
			};
			skill_results: {
				Row: { submission_id: string; learner_id: string; stage_id: number; skill_key: string; outcome: string; severity: number; evidence: string; created_at: string };
				Insert: never;
				Update: never;
				Relationships: Relationship[];
			};
			learner_skill_stats: {
				Row: { learner_id: string; stage_id: number; skill_key: string; attempts: number; achieved_count: number; partial_count: number; missed_count: number; mastery_score: number; last_outcome: string; last_practiced_at: string; updated_at: string };
				Insert: never;
				Update: never;
				Relationships: Relationship[];
			};
			ai_usage_events: {
				Row: { id: string; learner_id: string | null; problem_id: string | null; submission_id: string | null; operation: string; provider: string; model: string; provider_request_id: string | null; status: string; input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; estimated_cost_microusd: number | null; pricing_version: string | null; created_at: string };
				Insert: never;
				Update: never;
				Relationships: Relationship[];
			};
			ai_budget_policies: {
				Row: { operation: string; enabled: boolean; review_status: 'provisional' | 'approved'; max_input_tokens_per_request: number; max_output_tokens_per_request: number; daily_requests_per_learner: number; daily_input_tokens_per_learner: number; daily_output_tokens_per_learner: number; updated_at: string };
				Insert: never;
				Update: never;
				Relationships: Relationship[];
			};
			drafts: {
				Row: { id: string; learner_id: string; task_key: string; body: string; updated_at: string };
				Insert: { id?: string; learner_id: string; task_key: string; body?: string; updated_at?: string };
				Update: { body?: string; updated_at?: string };
				Relationships: Relationship[];
			};
			submissions: {
				Row: { id: string; learner_id: string; task_key: string; request_id: string; stage_id: number; task_title: string; body: string; rubric_version_id: string | null; instruction_version_id: string | null; submitted_at: string };
				Insert: never;
				Update: never;
				Relationships: Relationship[];
			};
			feedback_results: {
				Row: { id: string; submission_id: string; learner_id: string; schema_version: string; language_status: string; decision: string; result: Json; created_at: string };
				Insert: never;
				Update: never;
				Relationships: Relationship[];
			};
			learning_progress: {
				Row: { learner_id: string; current_stage_id: number; highest_unlocked_stage_id: number; consecutive_passes: number; required_consecutive_passes: number; individual_instruction: string | null; completed_at: string | null; updated_at: string };
				Insert: { learner_id: string; current_stage_id?: number; highest_unlocked_stage_id?: number; consecutive_passes?: number; required_consecutive_passes?: number; individual_instruction?: string | null; completed_at?: string | null; updated_at?: string };
				Update: { required_consecutive_passes?: number };
				Relationships: Relationship[];
			};
		};
		Views: Record<string, never>;
		Functions: {
			issue_problem: {
				Args: { p_task_key: string; p_stage_id: number; p_task_title: string; p_prompt: string; p_hint: string; p_feature_signature: Json; p_prompt_hash: string; p_problem_id?: string | null };
				Returns: undefined;
			};
			select_learning_stage: {
				Args: { p_stage_id: number };
				Returns: Json;
			};
			submit_mock: {
				Args: { p_request_id: string; p_task_key: string; p_stage_id: number; p_task_title: string; p_body: string; p_feedback: Json };
				Returns: Json;
			};
		};
		Enums: { app_role: 'learner' | 'admin' };
		CompositeTypes: Record<string, never>;
	};
};
