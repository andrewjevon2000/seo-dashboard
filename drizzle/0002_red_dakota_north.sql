CREATE TABLE "keyword_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site" text DEFAULT 'verihubs' NOT NULL,
	"keyword" text NOT NULL,
	"country" text NOT NULL,
	"date" date NOT NULL,
	"clicks" numeric NOT NULL,
	"impressions" numeric NOT NULL,
	"ctr" numeric NOT NULL,
	"position" numeric NOT NULL,
	"source" text DEFAULT 'gsc' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "keyword_snapshots_unique" ON "keyword_snapshots" USING btree ("site","keyword","country","date");--> statement-breakpoint
CREATE INDEX "keyword_snapshots_trend_idx" ON "keyword_snapshots" USING btree ("site","keyword","date");--> statement-breakpoint
CREATE INDEX "keyword_snapshots_date_idx" ON "keyword_snapshots" USING btree ("date");