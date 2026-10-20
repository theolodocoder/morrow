CREATE TABLE "notification_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"categories" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quiet_start" integer,
	"quiet_end" integer,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"type" text NOT NULL,
	"work_id" uuid,
	"actor_id" text,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"url" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"email_state" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_idx" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_email_pending_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."email_state" = 'pending';