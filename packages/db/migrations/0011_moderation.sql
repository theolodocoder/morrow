CREATE TABLE "account_restrictions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"action_id" uuid NOT NULL,
	"until" timestamp with time zone,
	"lifted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appeals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"action_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decision" text DEFAULT '' NOT NULL,
	"decided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"blocker_id" text NOT NULL,
	"blocked_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id")
);
--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"moderator_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"subject_user_id" text,
	"report_id" uuid,
	"reason" text NOT NULL,
	"reverses" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reporter_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"work_id" uuid,
	"subject_user_id" text,
	"category" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text DEFAULT '' NOT NULL,
	"reviewer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"granted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_restrictions_user_idx" ON "account_restrictions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appeals_once_idx" ON "appeals" USING btree ("action_id","user_id");--> statement-breakpoint
CREATE INDEX "blocks_blocked_idx" ON "blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE INDEX "moderation_actions_target_idx" ON "moderation_actions" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_actions_subject_idx" ON "moderation_actions" USING btree ("subject_user_id","created_at");--> statement-breakpoint
CREATE INDEX "reports_queue_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_open_once_idx" ON "reports" USING btree ("reporter_id","target_type","target_id") WHERE "reports"."status" in ('open', 'reviewing');