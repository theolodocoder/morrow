CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "feedback_status_idx" ON "feedback" USING btree ("status","created_at");