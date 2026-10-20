CREATE TABLE "alternate_publications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"word_count" integer NOT NULL,
	"after_position" text COLLATE "C" NOT NULL,
	"published_by" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"credits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "alternate_publications" ADD CONSTRAINT "alternate_publications_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alternate_publications" ADD CONSTRAINT "alternate_publications_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alternate_publications" ADD CONSTRAINT "alternate_publications_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alternate_publications" ADD CONSTRAINT "alternate_publications_snapshot_id_document_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."document_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alternate_publications_live_idx" ON "alternate_publications" USING btree ("work_id","branch_id","position") WHERE "alternate_publications"."superseded_at" is null;