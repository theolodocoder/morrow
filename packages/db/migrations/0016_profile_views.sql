CREATE TABLE "profile_views" (
	"user_id" text NOT NULL,
	"viewer" text NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "profile_views_user_id_viewer_day_pk" PRIMARY KEY("user_id","viewer","day")
);
--> statement-breakpoint
ALTER TABLE "profile_views" ADD CONSTRAINT "profile_views_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The dashboard reads activity on a writer's works by time.
CREATE INDEX IF NOT EXISTS "work_likes_work_time_idx" ON "work_likes" USING btree ("work_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_views_work_day_idx" ON "work_views" USING btree ("work_id", "day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follows_target_time_idx" ON "follows" USING btree ("target_type", "target_id", "created_at");
