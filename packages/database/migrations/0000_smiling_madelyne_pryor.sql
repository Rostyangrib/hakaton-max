CREATE TYPE "public"."processing_status" AS ENUM('pending', 'processing', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."summary_mode" AS ENUM('yandexgpt', 'fallback');--> statement-breakpoint
CREATE TABLE "alert_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"sender_user_id" bigint NOT NULL,
	"trigger_type" varchar(32) NOT NULL,
	"trigger_value" varchar(100) NOT NULL,
	"status" "processing_status" DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"max_chat_id" bigint NOT NULL,
	"title" varchar(200) NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Irkutsk' NOT NULL,
	"chat_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homes_max_chat_id_unique" UNIQUE("max_chat_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"home_id" uuid NOT NULL,
	"max_message_id" varchar(255) NOT NULL,
	"sender_user_id" bigint NOT NULL,
	"sender_display_name" varchar(200) NOT NULL,
	"text" text NOT NULL,
	"normalized_text" text NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_max_message_id_unique" UNIQUE("max_message_id")
);
--> statement-breakpoint
CREATE TABLE "resident_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"home_id" uuid NOT NULL,
	"max_user_id" bigint NOT NULL,
	"apartment" integer NOT NULL,
	"entrance" integer NOT NULL,
	"floor" integer,
	"car_plate_raw" varchar(32),
	"car_plate_normalized" varchar(16),
	"car_description" varchar(100),
	"car_keywords" text[] DEFAULT '{}' NOT NULL,
	"alerts_enabled" boolean DEFAULT true NOT NULL,
	"membership_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summary_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"home_id" uuid NOT NULL,
	"requested_by" bigint NOT NULL,
	"period_from" timestamp with time zone NOT NULL,
	"period_to" timestamp with time zone NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"status" "processing_status" DEFAULT 'pending' NOT NULL,
	"mode" "summary_mode",
	"result" jsonb,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"max_user_id" bigint PRIMARY KEY NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"bot_started_at" timestamp with time zone,
	"bot_stopped_at" timestamp with time zone,
	"consent_version" varchar(32),
	"consent_accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" varchar(128) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "processing_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_profile_id_resident_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."resident_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_home_id_homes_id_fk" FOREIGN KEY ("home_id") REFERENCES "public"."homes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_profiles" ADD CONSTRAINT "resident_profiles_home_id_homes_id_fk" FOREIGN KEY ("home_id") REFERENCES "public"."homes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_profiles" ADD CONSTRAINT "resident_profiles_max_user_id_users_max_user_id_fk" FOREIGN KEY ("max_user_id") REFERENCES "public"."users"("max_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_jobs" ADD CONSTRAINT "summary_jobs_home_id_homes_id_fk" FOREIGN KEY ("home_id") REFERENCES "public"."homes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_jobs" ADD CONSTRAINT "summary_jobs_requested_by_users_max_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("max_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_antiflood_idx" ON "alert_deliveries" USING btree ("profile_id","sender_user_id","trigger_type","trigger_value","sent_at");--> statement-breakpoint
CREATE INDEX "messages_home_sent_idx" ON "messages" USING btree ("home_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "resident_profiles_home_user_uidx" ON "resident_profiles" USING btree ("home_id","max_user_id");--> statement-breakpoint
CREATE INDEX "summary_jobs_period_idx" ON "summary_jobs" USING btree ("home_id","period_from","period_to");