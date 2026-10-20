CREATE TABLE "writing_log" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"words" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "writing_log_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "daily_word_goal" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reader_comments" ADD COLUMN "chapter_id" uuid;--> statement-breakpoint
ALTER TABLE "reader_comments" ADD COLUMN "block_id" text;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "release_day" integer;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "open_roles" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "writing_log" ADD CONSTRAINT "writing_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reader_comments_block_idx" ON "reader_comments" USING btree ("chapter_id","block_id");