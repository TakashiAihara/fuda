CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"summary" text NOT NULL,
	"sender" text NOT NULL,
	"attribution" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"origin_item_id" uuid,
	"origin_section_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"reply_form" text,
	"recipient" text,
	"body" jsonb NOT NULL,
	"state" text,
	"unanswered_since" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"reply" jsonb,
	"answered_by" text,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	CONSTRAINT "sections_kind_check" CHECK ("sections"."kind" in ('report', 'notice', 'question', 'request')),
	CONSTRAINT "sections_reply_form_check" CHECK ("sections"."reply_form" is null or "sections"."reply_form" in ('free_text', 'choice', 'approval', 'external_tool', 'pickup')),
	CONSTRAINT "sections_state_check" CHECK ("sections"."state" is null or "sections"."state" in ('unanswered', 'deferred', 'answered', 'not_started', 'in_progress', 'done')),
	CONSTRAINT "sections_state_matches_reply_form_check" CHECK (("sections"."reply_form" is null) = ("sections"."state" is null)),
	CONSTRAINT "sections_unanswered_since_check" CHECK ("sections"."state" <> 'unanswered' or "sections"."unanswered_since" is not null)
);
--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_origin_item_id_items_id_fk" FOREIGN KEY ("origin_item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_attribution_idx" ON "items" USING gin ("attribution");--> statement-breakpoint
CREATE INDEX "items_sender_idx" ON "items" USING btree ("sender");--> statement-breakpoint
CREATE INDEX "sections_item_id_idx" ON "sections" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "sections_unanswered_since_idx" ON "sections" USING btree ("unanswered_since");--> statement-breakpoint
CREATE INDEX "sections_recipient_idx" ON "sections" USING btree ("recipient");--> statement-breakpoint
CREATE VIEW "public"."item_list" AS (
  select
    i.id,
    i.summary,
    i.sender,
    i.attribution,
    i.created_at,
    i.read_at,
    i.closed_at,
    min(s.unanswered_since) filter (where s.state = 'unanswered') as oldest_unanswered_at,
    count(s.id) filter (where s.state = 'unanswered')::int as unanswered_count,
    count(s.id) filter (where s.state = 'deferred')::int as deferred_count,
    count(s.id) filter (where s.state in ('not_started', 'in_progress'))::int as open_request_count,
    count(s.id)::int as section_count
  from items i
  left join sections s on s.item_id = i.id
  group by i.id
);