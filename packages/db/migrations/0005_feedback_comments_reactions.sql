CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"work_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"parent_id" uuid,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"mentions" text[] DEFAULT '{}'::text[] NOT NULL,
	"anchor" jsonb,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"work_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"block_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "reaction_kinds" text[] DEFAULT '{beautiful_line,plot_twist,interesting_idea,needs_clarity,important_detail}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_document_idx" ON "comments" USING btree ("work_id","document_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reactions_unique_idx" ON "reactions" USING btree ("document_id","block_id","user_id","kind");--> statement-breakpoint
CREATE INDEX "reactions_document_idx" ON "reactions" USING btree ("work_id","document_id");