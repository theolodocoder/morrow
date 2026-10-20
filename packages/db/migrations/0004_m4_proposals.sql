CREATE TYPE "public"."proposal_kind" AS ENUM('edit', 'outline', 'character', 'research', 'feedback');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('draft', 'submitted', 'under_review', 'changes_requested', 'accepted', 'rejected', 'withdrawn', 'superseded');--> statement-breakpoint
CREATE TABLE "proposal_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"type" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"from_status" "proposal_status",
	"to_status" "proposal_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"work_id" uuid NOT NULL,
	"kind" "proposal_kind" NOT NULL,
	"status" "proposal_status" DEFAULT 'draft' NOT NULL,
	"author_id" text NOT NULL,
	"title" text NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"chapter_id" uuid,
	"workspace_document_id" uuid,
	"base_snapshot_id" uuid,
	"submitted_snapshot_id" uuid,
	"applied_snapshot_id" uuid,
	"reviewer_id" text,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposal_events" ADD CONSTRAINT "proposal_events_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_workspace_document_id_documents_id_fk" FOREIGN KEY ("workspace_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_base_snapshot_id_document_snapshots_id_fk" FOREIGN KEY ("base_snapshot_id") REFERENCES "public"."document_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_submitted_snapshot_id_document_snapshots_id_fk" FOREIGN KEY ("submitted_snapshot_id") REFERENCES "public"."document_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_applied_snapshot_id_document_snapshots_id_fk" FOREIGN KEY ("applied_snapshot_id") REFERENCES "public"."document_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposal_events_proposal_idx" ON "proposal_events" USING btree ("proposal_id","created_at");--> statement-breakpoint
CREATE INDEX "proposals_work_status_idx" ON "proposals" USING btree ("work_id","status","created_at");--> statement-breakpoint
CREATE INDEX "proposals_author_idx" ON "proposals" USING btree ("work_id","author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_workspace_idx" ON "proposals" USING btree ("workspace_document_id");