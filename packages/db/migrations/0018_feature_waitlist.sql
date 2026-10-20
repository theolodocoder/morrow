CREATE TABLE "feature_waitlist" (
	"user_id" text NOT NULL,
	"feature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_waitlist_user_id_feature_pk" PRIMARY KEY("user_id","feature")
);
--> statement-breakpoint
ALTER TABLE "feature_waitlist" ADD CONSTRAINT "feature_waitlist_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;