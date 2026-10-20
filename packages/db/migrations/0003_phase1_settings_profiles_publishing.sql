CREATE TYPE "public"."collaboration_mode" AS ENUM('direct', 'mixed', 'proposal');--> statement-breakpoint
CREATE TYPE "public"."work_license" AS ENUM('all_rights_reserved', 'cc_by', 'cc_by_sa', 'cc_by_nc', 'cc_by_nc_sa', 'cc0');--> statement-breakpoint
ALTER TYPE "public"."member_role" ADD VALUE 'collaborator' BEFORE 'contributor';--> statement-breakpoint
ALTER TYPE "public"."work_form" ADD VALUE 'fiction';--> statement-breakpoint
ALTER TYPE "public"."work_form" ADD VALUE 'poetry';--> statement-breakpoint
ALTER TYPE "public"."work_form" ADD VALUE 'research_paper';--> statement-breakpoint
ALTER TYPE "public"."work_form" ADD VALUE 'educational';--> statement-breakpoint
ALTER TYPE "public"."work_form" ADD VALUE 'general_document';--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"interests" text[] DEFAULT '{}'::text[] NOT NULL,
	"genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"avatar_seed" text DEFAULT substr(md5(random()::text), 1, 8) NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"show_bio" boolean DEFAULT true NOT NULL,
	"show_interests" boolean DEFAULT true NOT NULL,
	"show_links" boolean DEFAULT true NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"word_count" integer NOT NULL,
	"published_by" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "collaboration_mode" "collaboration_mode";--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "collaboration_mode" "collaboration_mode" DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "content_warnings" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "license" "work_license" DEFAULT 'all_rights_reserved' NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "public_id" text DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 10) NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_snapshot_id_document_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."document_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publications_live_idx" ON "publications" USING btree ("work_id","position") WHERE "publications"."superseded_at" is null;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_public_id_unique" UNIQUE("public_id");