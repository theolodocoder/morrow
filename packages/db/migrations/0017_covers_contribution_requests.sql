CREATE TABLE "contribution_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"work_id" uuid NOT NULL,
	"requester_id" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "cover" jsonb;--> statement-breakpoint
ALTER TABLE "contribution_requests" ADD CONSTRAINT "contribution_requests_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_requests" ADD CONSTRAINT "contribution_requests_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_requests_one_pending" ON "contribution_requests" USING btree ("work_id","requester_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "contribution_requests_work_idx" ON "contribution_requests" USING btree ("work_id","status","created_at");