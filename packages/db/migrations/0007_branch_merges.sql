CREATE TABLE "branch_merges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"work_id" uuid NOT NULL,
	"source_branch_id" uuid NOT NULL,
	"target_branch_id" uuid NOT NULL,
	"merged_by" text NOT NULL,
	"status" text NOT NULL,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "merge_base_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "branch_merges" ADD CONSTRAINT "branch_merges_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_merges" ADD CONSTRAINT "branch_merges_source_branch_id_branches_id_fk" FOREIGN KEY ("source_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_merges" ADD CONSTRAINT "branch_merges_target_branch_id_branches_id_fk" FOREIGN KEY ("target_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_merges_source_idx" ON "branch_merges" USING btree ("work_id","source_branch_id","created_at");