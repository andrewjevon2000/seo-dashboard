CREATE TYPE "public"."actor_kind" AS ENUM('agent', 'human', 'skill');--> statement-breakpoint
CREATE TYPE "public"."changelog_action" AS ENUM('published', 'refreshed', 'merged', 'redirected', 'pruned', 'meta_updated', 'schema_added', 'internal_link_added', 'pre_publish_sweep', 'other');--> statement-breakpoint
CREATE TYPE "public"."decision_status" AS ENUM('proposed', 'approved', 'rejected', 'executed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."decision_verdict" AS ENUM('create', 'refresh', 'merge', 'redirect', 'prune', 'leave');--> statement-breakpoint
CREATE TABLE "changelog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site" text DEFAULT 'verihubs' NOT NULL,
	"article_id" uuid,
	"url" text NOT NULL,
	"action" "changelog_action" NOT NULL,
	"decision_id" uuid,
	"executed_by" text NOT NULL,
	"executor_kind" "actor_kind" NOT NULL,
	"approved_by" text,
	"action_date" date NOT NULL,
	"hypothesis" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"success_definition" text,
	"active_scope" jsonb,
	"data_tier" text,
	"locale" text,
	"keyword_blacklist" jsonb,
	"publish_path" text,
	"approver" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site" text DEFAULT 'verihubs' NOT NULL,
	"article_id" uuid,
	"url" text NOT NULL,
	"verdict" "decision_verdict" NOT NULL,
	"rationale" text NOT NULL,
	"expected_impact" text,
	"confidence" numeric,
	"status" "decision_status" DEFAULT 'proposed' NOT NULL,
	"source" "actor_kind" NOT NULL,
	"produced_by" text NOT NULL,
	"approved_by" text,
	"decided_at" date NOT NULL,
	"superseded_by_id" uuid,
	"provenance" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "changelog" ADD CONSTRAINT "changelog_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog" ADD CONSTRAINT "changelog_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "changelog_site_url_date_idx" ON "changelog" USING btree ("site","url","action_date");--> statement-breakpoint
CREATE INDEX "changelog_decision_idx" ON "changelog" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "changelog_action_date_idx" ON "changelog" USING btree ("action_date");--> statement-breakpoint
CREATE INDEX "decisions_site_url_idx" ON "decisions" USING btree ("site","url");--> statement-breakpoint
CREATE INDEX "decisions_site_status_idx" ON "decisions" USING btree ("site","status");--> statement-breakpoint
CREATE INDEX "decisions_article_idx" ON "decisions" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "decisions_decided_at_idx" ON "decisions" USING btree ("decided_at");