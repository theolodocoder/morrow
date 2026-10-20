CREATE TABLE "billing_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"provider_ref" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"hosted_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_provider_ref_unique" UNIQUE("provider_ref")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_monthly" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"limits" jsonb NOT NULL,
	"features" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"plan_key" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"provider_ref" text,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"granted_by" text,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_key_plans_key_fk" FOREIGN KEY ("plan_key") REFERENCES "public"."plans"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_user_idx" ON "invoices" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
-- Initial plans: PRD FR-033 hypotheses, editable in the admin app. Free stays genuinely usable (FR-034).
INSERT INTO "plans" ("key", "name", "description", "price_monthly", "limits", "features", "sort_order") VALUES
  ('free', 'Free', 'Write, collaborate, publish and be read. No trial clock.', NULL,
   '{"privateWorks": 25, "membersPerWork": 10, "branchesPerWork": 10, "exportFormats": ["markdown"], "aiCreditsPerMonth": 0}', '{}', 0),
  ('writer_plus', 'Writer Plus', 'For writers with many projects: generous limits and advanced history.', 1000,
   '{"privateWorks": null, "membersPerWork": 25, "branchesPerWork": null, "exportFormats": ["markdown"], "aiCreditsPerMonth": 0}', '{advanced_history,analytics}', 1),
  ('studio', 'Studio', 'For teams writing together: larger casts and team tools.', 2400,
   '{"privateWorks": null, "membersPerWork": 100, "branchesPerWork": null, "exportFormats": ["markdown"], "aiCreditsPerMonth": 0}', '{advanced_history,analytics,team_admin}', 2),
  ('organization', 'Organization', 'For schools, publishers and organisations.', 7900,
   '{"privateWorks": null, "membersPerWork": null, "branchesPerWork": null, "exportFormats": ["markdown"], "aiCreditsPerMonth": 0}', '{advanced_history,analytics,team_admin,audit}', 3)
ON CONFLICT ("key") DO NOTHING;
