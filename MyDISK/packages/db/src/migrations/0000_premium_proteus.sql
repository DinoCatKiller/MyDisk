CREATE TYPE "public"."connection_status" AS ENUM('active', 'disabled', 'error');--> statement-breakpoint
CREATE TYPE "public"."connection_sync_status" AS ENUM('synced', 'pending', 'skipped', 'syncing');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'paused', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."node_status" AS ENUM('active', 'uploading', 'failed', 'trashed');--> statement-breakpoint
CREATE TYPE "public"."node_type" AS ENUM('file', 'folder');--> statement-breakpoint
CREATE TYPE "public"."share_status" AS ENUM('active', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."storage_type" AS ENUM('local', 'cos', 'oss', 's3');--> statement-breakpoint
CREATE TYPE "public"."sync_conflict" AS ENUM('keep_both', 'overwrite', 'skip');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('compress', 'extract', 'package_download', 'thumbnail', 'purge');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('pending', 'uploading', 'paused', 'completed', 'aborted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('founder', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
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
	"role" "user_role" DEFAULT 'admin' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp,
	"last_login_ip" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_node" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"parent_id" uuid,
	"owner_id" text NOT NULL,
	"type" "node_type" NOT NULL,
	"name" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text,
	"ext" text,
	"size" bigint DEFAULT 0 NOT NULL,
	"checksum" text,
	"status" "node_status" DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"parent_id" uuid,
	"user_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"original_name" text NOT NULL,
	"relative_path" text,
	"mime" text,
	"size" bigint NOT NULL,
	"chunk_size" integer NOT NULL,
	"total_chunks" integer NOT NULL,
	"uploaded_parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parts_meta" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider_upload_id" text,
	"storage_key" text NOT NULL,
	"sha256" text,
	"status" "upload_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" uuid NOT NULL,
	"action" text NOT NULL,
	"node_id" uuid,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"node_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"password_hash" text,
	"expires_at" timestamp with time zone,
	"max_downloads" integer,
	"download_count" integer DEFAULT 0 NOT NULL,
	"can_preview" boolean DEFAULT true NOT NULL,
	"can_download" boolean DEFAULT true NOT NULL,
	"can_list" boolean DEFAULT true NOT NULL,
	"status" "share_status" DEFAULT 'active' NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_link_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "storage_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "storage_type" NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"bucket" text,
	"region" text,
	"endpoint" text,
	"root_prefix" text DEFAULT '' NOT NULL,
	"config_enc" text,
	"config_masked" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_size" bigint DEFAULT 0 NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"sync_status" "connection_sync_status" DEFAULT 'synced' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_connection_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sync_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_connection_id" uuid NOT NULL,
	"to_connection_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"mode" text DEFAULT 'full' NOT NULL,
	"conflict_strategy" "sync_conflict" DEFAULT 'keep_both' NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"total_files" integer DEFAULT 0 NOT NULL,
	"processed_files" integer DEFAULT 0 NOT NULL,
	"failed_files" integer DEFAULT 0 NOT NULL,
	"total_bytes" bigint DEFAULT 0 NOT NULL,
	"processed_bytes" bigint DEFAULT 0 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"current_path" text,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_job_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"source_node_id" uuid,
	"target_node_id" uuid,
	"path" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"ip" text,
	"user_agent" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"node_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_tag" (
	"node_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_tag_node_id_tag_id_pk" PRIMARY KEY("node_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "smtp_setting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host" text,
	"port" integer,
	"secure" boolean DEFAULT true NOT NULL,
	"user" text,
	"pass_enc" text,
	"from_name" text,
	"from_email" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tag_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "task_type" NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"title" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"user_id" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webdav_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_node" ADD CONSTRAINT "file_node_connection_id_storage_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."storage_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_node" ADD CONSTRAINT "file_node_parent_id_file_node_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."file_node"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_node" ADD CONSTRAINT "file_node_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_session" ADD CONSTRAINT "upload_session_connection_id_storage_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."storage_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_session" ADD CONSTRAINT "upload_session_parent_id_file_node_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."file_node"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_session" ADD CONSTRAINT "upload_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_access_log" ADD CONSTRAINT "share_access_log_share_id_share_link_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."share_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_node_id_file_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."file_node"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_connection" ADD CONSTRAINT "storage_connection_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_job" ADD CONSTRAINT "sync_job_from_connection_id_storage_connection_id_fk" FOREIGN KEY ("from_connection_id") REFERENCES "public"."storage_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_job" ADD CONSTRAINT "sync_job_to_connection_id_storage_connection_id_fk" FOREIGN KEY ("to_connection_id") REFERENCES "public"."storage_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_job" ADD CONSTRAINT "sync_job_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_job_item" ADD CONSTRAINT "sync_job_item_job_id_sync_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."sync_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_node_id_file_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."file_node"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_tag" ADD CONSTRAINT "file_tag_node_id_file_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."file_node"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_tag" ADD CONSTRAINT "file_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webdav_token" ADD CONSTRAINT "webdav_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_providerId_accountId_uidx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_founder_uidx" ON "user" USING btree ("role") WHERE "user"."role" = 'founder';--> statement-breakpoint
CREATE INDEX "user_status_idx" ON "user" USING btree ("status");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "file_node_name_uidx" ON "file_node" USING btree ("connection_id",COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),"name") WHERE "file_node"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "file_node_parent_idx" ON "file_node" USING btree ("connection_id","parent_id","type");--> statement-breakpoint
CREATE INDEX "file_node_owner_idx" ON "file_node" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "file_node_checksum_idx" ON "file_node" USING btree ("checksum");--> statement-breakpoint
CREATE INDEX "file_node_trash_idx" ON "file_node" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_session_user_fingerprint_uidx" ON "upload_session" USING btree ("user_id","fingerprint");--> statement-breakpoint
CREATE INDEX "upload_session_status_idx" ON "upload_session" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "share_access_log_share_idx" ON "share_access_log" USING btree ("share_id","created_at");--> statement-breakpoint
CREATE INDEX "share_link_creator_idx" ON "share_link" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "share_link_node_idx" ON "share_link" USING btree ("node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_default_uidx" ON "storage_connection" USING btree ("is_default") WHERE "storage_connection"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "connection_local_uidx" ON "storage_connection" USING btree ("type") WHERE "storage_connection"."type" = 'local';--> statement-breakpoint
CREATE INDEX "connection_status_idx" ON "storage_connection" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sync_job_status_idx" ON "sync_job" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sync_job_item_job_idx" ON "sync_job_item" USING btree ("job_id","status");--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "favorite_user_node_uidx" ON "favorite" USING btree ("user_id","node_id");--> statement-breakpoint
CREATE INDEX "task_user_idx" ON "task" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "task_status_idx" ON "task" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webdav_token_user_idx" ON "webdav_token" USING btree ("user_id");