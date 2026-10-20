CREATE TYPE "public"."branch_status" AS ENUM('active', 'abandoned', 'selected');--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "status" "branch_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "diverges_at_chapter_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "branches_one_selected_per_work" ON "branches" USING btree ("work_id") WHERE "branches"."status" = 'selected';