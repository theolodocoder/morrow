CREATE TABLE "reading_positions" (
	"user_id" text NOT NULL,
	"work_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"block_id" text,
	"percent" smallint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_positions_user_id_work_id_chapter_id_pk" PRIMARY KEY("user_id","work_id","chapter_id")
);
--> statement-breakpoint
ALTER TABLE "reading_positions" ADD CONSTRAINT "reading_positions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_positions" ADD CONSTRAINT "reading_positions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_positions" ADD CONSTRAINT "reading_positions_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;