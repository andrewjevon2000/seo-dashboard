CREATE TYPE "public"."metric_source" AS ENUM('gsc', 'ga4');--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"keyword" text,
	"site" text DEFAULT 'verihubs' NOT NULL,
	"publish_date" date,
	"batch" text,
	"content_type" text,
	"topic_cluster" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"date" date NOT NULL,
	"source" "metric_source" NOT NULL,
	"metric_name" text NOT NULL,
	"metric_value" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "performance_snapshots" ADD CONSTRAINT "performance_snapshots_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "articles_site_url_unique" ON "articles" USING btree ("site","url");--> statement-breakpoint
CREATE INDEX "articles_topic_cluster_idx" ON "articles" USING btree ("topic_cluster");--> statement-breakpoint
CREATE INDEX "articles_content_type_idx" ON "articles" USING btree ("content_type");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_unique" ON "performance_snapshots" USING btree ("article_id","source","metric_name","date");--> statement-breakpoint
CREATE INDEX "snapshots_trend_idx" ON "performance_snapshots" USING btree ("article_id","metric_name","date");--> statement-breakpoint
CREATE INDEX "snapshots_date_idx" ON "performance_snapshots" USING btree ("date");