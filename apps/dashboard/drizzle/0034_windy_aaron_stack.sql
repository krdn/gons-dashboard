ALTER TABLE "email_settings" ADD CONSTRAINT "email_settings_reply_severity_check" CHECK ("email_settings"."reply_severity_threshold" IN ('high', 'med', 'low'));--> statement-breakpoint
ALTER TABLE "email_settings" ADD CONSTRAINT "email_settings_important_threshold_check" CHECK ("email_settings"."important_threshold" IN ('high', 'med'));--> statement-breakpoint
ALTER TABLE "email_settings" ADD CONSTRAINT "email_settings_reply_language_check" CHECK ("email_settings"."reply_language" IN ('auto', 'ko', 'en', 'ja', 'zh'));--> statement-breakpoint
ALTER TABLE "email_settings" ADD CONSTRAINT "email_settings_reply_model_check" CHECK ("email_settings"."reply_model" IN ('gemini', 'codex', 'claude'));--> statement-breakpoint
ALTER TABLE "important_emails" ADD CONSTRAINT "important_emails_category_check" CHECK ("important_emails"."category" IN ('money', 'security', 'schedule', 'notice'));--> statement-breakpoint
ALTER TABLE "important_emails" ADD CONSTRAINT "important_emails_importance_check" CHECK ("important_emails"."importance" IN ('high', 'med'));--> statement-breakpoint
ALTER TABLE "important_emails" ADD CONSTRAINT "important_emails_classified_by_check" CHECK ("important_emails"."classified_by" IN ('deterministic', 'llm-haiku'));--> statement-breakpoint
ALTER TABLE "reply_needed" ADD CONSTRAINT "reply_needed_severity_check" CHECK ("reply_needed"."severity" IN ('high', 'med', 'low'));--> statement-breakpoint
ALTER TABLE "reply_needed" ADD CONSTRAINT "reply_needed_classified_by_check" CHECK ("reply_needed"."classified_by" IN ('deterministic', 'llm-haiku'));--> statement-breakpoint
ALTER TABLE "reply_needed" ADD CONSTRAINT "reply_needed_user_action_check" CHECK ("reply_needed"."user_action" IN ('replied', 'dismissed', 'none'));