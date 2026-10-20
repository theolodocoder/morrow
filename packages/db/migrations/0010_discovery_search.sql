-- Immutable wrapper so tags can feed a generated search column (array_to_string is only STABLE; for text[] it is
-- effectively immutable).
CREATE OR REPLACE FUNCTION morrow_tags_text(text[]) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT coalesce(array_to_string($1, ' '), '') $$;--> statement-breakpoint
CREATE TABLE "featured_works" (
	"work_id" uuid PRIMARY KEY NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"featured_by" text NOT NULL,
	"featured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A') || setweight(to_tsvector('simple'::regconfig, coalesce(description, '')), 'B') || setweight(to_tsvector('simple'::regconfig, morrow_tags_text(tags)), 'C')) STORED;--> statement-breakpoint
ALTER TABLE "featured_works" ADD CONSTRAINT "featured_works_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "works_search_idx" ON "works" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "works_discovery_idx" ON "works" USING btree ("published_at") WHERE "works"."visibility" = 'public' and "works"."published_at" is not null and "works"."deleted_at" is null and "works"."hidden_at" is null;