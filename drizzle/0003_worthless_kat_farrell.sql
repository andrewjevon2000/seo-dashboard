CREATE TYPE "public"."finding_status" AS ENUM('open', 'triaged', 'resolved', 'wont_fix', 'escalated');--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site" text DEFAULT 'verihubs' NOT NULL,
	"source_skill" text NOT NULL,
	"category" text NOT NULL,
	"issue" text NOT NULL,
	"severity" text,
	"url" text NOT NULL,
	"affected_count" numeric,
	"recommended_action" text,
	"owner" text,
	"status" "finding_status" DEFAULT 'open' NOT NULL,
	"first_detected_at" date NOT NULL,
	"last_detected_at" date NOT NULL,
	"provenance" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "findings_identity_unique" ON "findings" USING btree ("site","source_skill","issue","url");--> statement-breakpoint
CREATE INDEX "findings_site_status_idx" ON "findings" USING btree ("site","status");--> statement-breakpoint
CREATE INDEX "findings_site_url_idx" ON "findings" USING btree ("site","url");--> statement-breakpoint
CREATE INDEX "findings_skill_cat_idx" ON "findings" USING btree ("site","source_skill","category");