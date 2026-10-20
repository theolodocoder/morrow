CREATE TABLE "achievements" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"criteria_version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reader_comments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"work_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"parent_id" uuid,
	"body" text NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" text NOT NULL,
	"achievement_code" text NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "user_achievements_user_id_achievement_code_pk" PRIMARY KEY("user_id","achievement_code")
);
--> statement-breakpoint
CREATE TABLE "work_likes" (
	"work_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_likes_work_id_user_id_pk" PRIMARY KEY("work_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "work_views" (
	"work_id" uuid NOT NULL,
	"viewer" text NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "work_views_work_id_viewer_day_pk" PRIMARY KEY("work_id","viewer","day")
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avatar" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "show_badges" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "like_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "view_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "reader_comment_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reader_comments" ADD CONSTRAINT "reader_comments_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_code_achievements_code_fk" FOREIGN KEY ("achievement_code") REFERENCES "public"."achievements"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_likes" ADD CONSTRAINT "work_likes_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_likes" ADD CONSTRAINT "work_likes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_views" ADD CONSTRAINT "work_views_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reader_comments_work_idx" ON "reader_comments" USING btree ("work_id","created_at");--> statement-breakpoint
CREATE INDEX "reader_comments_author_idx" ON "reader_comments" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "work_likes_user_idx" ON "work_likes" USING btree ("user_id");--> statement-breakpoint
-- PRD FR-025: attainable through normal use, never for volume of trivial activity.
INSERT INTO "achievements" ("code", "name", "description", "sort_order") VALUES
  ('first_chapter', 'First Chapter', 'Published your first piece for readers.', 10),
  ('the_finisher', 'The Finisher', 'Marked a published work as complete.', 20),
  ('the_muse', 'The Muse', 'Had an idea or edit accepted into someone else''s work.', 30),
  ('the_editor', 'The Editor', 'Had five edit proposals accepted.', 40),
  ('bridge_builder', 'The Bridge Builder', 'Wrote alongside three different people.', 50),
  ('plot_twister', 'The Plot Twister', 'A branch you started was merged back in.', 60),
  ('reliable_one', 'The Reliable One', 'Wrote in four different weeks.', 70),
  ('found_readers', 'Found Your Readers', 'Readers liked your published writing ten times.', 80)
ON CONFLICT ("code") DO NOTHING;
