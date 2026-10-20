CREATE TABLE "bookmarks" (
	"user_id" text NOT NULL,
	"work_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmarks_user_id_work_id_pk" PRIMARY KEY("user_id","work_id")
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_target_type_target_id_pk" PRIMARY KEY("follower_id","target_type","target_id")
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "show_follows" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "follows_target_idx" ON "follows" USING btree ("target_type","target_id");