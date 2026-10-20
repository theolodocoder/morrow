CREATE TYPE "public"."document_kind" AS ENUM('chapter', 'proposal');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'editor', 'contributor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."participation" AS ENUM('none', 'propose', 'branch', 'propose_and_branch');--> statement-breakpoint
CREATE TYPE "public"."snapshot_reason" AS ENUM('auto', 'manual', 'publish', 'proposal_base', 'proposal_applied', 'branch_fork', 'pre_restore', 'pre_migration');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('private', 'unlisted', 'public');--> statement-breakpoint
CREATE TYPE "public"."work_form" AS ENUM('novel', 'novella', 'short_story', 'collection', 'essay', 'article', 'other');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"work_id" uuid,
	"actor_id" text,
	"type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"work_id" uuid NOT NULL,
	"parent_branch_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_by" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"visibility" "visibility" DEFAULT 'private' NOT NULL,
	"forked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"origin_chapter_id" uuid,
	"fork_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_projections" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"content_json" jsonb NOT NULL,
	"plain_text" text NOT NULL,
	"word_count" integer NOT NULL,
	"source_revision" bigint NOT NULL,
	"projected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"document_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"state" "bytea" NOT NULL,
	"content_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"word_count" integer NOT NULL,
	"reason" "snapshot_reason" NOT NULL,
	"label" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_states" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"state" "bytea" NOT NULL,
	"state_vector" "bytea" NOT NULL,
	"revision" bigint NOT NULL,
	"byte_size" integer NOT NULL,
	"compacted_size" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"work_id" uuid NOT NULL,
	"kind" "document_kind" NOT NULL,
	"schema_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"route" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" integer NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "work_members" (
	"work_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "member_role" NOT NULL,
	"granted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_members_work_id_user_id_pk" PRIMARY KEY("work_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "works" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"form" "work_form" DEFAULT 'novel' NOT NULL,
	"visibility" "visibility" DEFAULT 'private' NOT NULL,
	"participation" "participation" DEFAULT 'none' NOT NULL,
	"default_branch_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_projections" ADD CONSTRAINT "document_projections_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_snapshots" ADD CONSTRAINT "document_snapshots_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_states" ADD CONSTRAINT "document_states_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_members" ADD CONSTRAINT "work_members_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_members" ADD CONSTRAINT "work_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_work_idx" ON "activity_events" USING btree ("work_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_unprocessed_idx" ON "activity_events" USING btree ("created_at") WHERE "activity_events"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "branches_work_idx" ON "branches" USING btree ("work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_one_default_per_work" ON "branches" USING btree ("work_id") WHERE "branches"."is_default";--> statement-breakpoint
CREATE INDEX "chapters_branch_order_idx" ON "chapters" USING btree ("work_id","branch_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_document_uq" ON "chapters" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "snapshots_document_idx" ON "document_snapshots" USING btree ("work_id","document_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_work_idx" ON "documents" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "work_members_user_idx" ON "work_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "works_owner_idx" ON "works" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");