CREATE TABLE "feedback_reads" (
	"user_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_reads_user_id_document_id_pk" PRIMARY KEY("user_id","document_id")
);
--> statement-breakpoint
ALTER TABLE "feedback_reads" ADD CONSTRAINT "feedback_reads_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;