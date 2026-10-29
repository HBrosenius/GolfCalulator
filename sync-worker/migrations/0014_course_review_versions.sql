CREATE TABLE course_catalog_versions (
  course_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  source_url TEXT,
  source_title TEXT,
  verified_at INTEGER,
  verification_status TEXT NOT NULL,
  archived_at INTEGER NOT NULL,
  PRIMARY KEY(course_id,version)
);
INSERT INTO course_catalog_versions SELECT id,version,payload,source_url,source_title,verified_at,verification_status,updated_at FROM course_catalog;
CREATE TRIGGER course_versions_immutable_insert BEFORE INSERT ON course_catalog_versions WHEN EXISTS(SELECT 1 FROM course_catalog_versions WHERE course_id=NEW.course_id AND version=NEW.version) BEGIN SELECT RAISE(ABORT,'Course versions are immutable'); END;
CREATE TRIGGER course_versions_immutable_update BEFORE UPDATE ON course_catalog_versions BEGIN SELECT RAISE(ABORT,'Course versions are immutable'); END;
CREATE TRIGGER course_versions_immutable_delete BEFORE DELETE ON course_catalog_versions BEGIN SELECT RAISE(ABORT,'Course versions are immutable'); END;
CREATE TRIGGER course_version_insert_guard BEFORE INSERT ON course_catalog
WHEN EXISTS(SELECT 1 FROM course_catalog WHERE id=NEW.id AND (NEW.version<version OR (NEW.version=version AND (NEW.payload<>payload OR NEW.source_url IS NOT source_url OR NEW.source_title IS NOT source_title OR NEW.verified_at IS NOT verified_at OR NEW.verification_status<>verification_status))))
BEGIN SELECT RAISE(ABORT,'Course changes require a new version'); END;
CREATE TRIGGER course_version_update_guard BEFORE UPDATE ON course_catalog
WHEN NEW.id<>OLD.id OR NEW.version<OLD.version OR (NEW.version=OLD.version AND (NEW.payload<>OLD.payload OR NEW.source_url IS NOT OLD.source_url OR NEW.source_title IS NOT OLD.source_title OR NEW.verified_at IS NOT OLD.verified_at OR NEW.verification_status<>OLD.verification_status))
BEGIN SELECT RAISE(ABORT,'Course changes require a new version'); END;
CREATE TRIGGER course_version_archive_insert AFTER INSERT ON course_catalog BEGIN
  INSERT INTO course_catalog_versions SELECT NEW.id,NEW.version,NEW.payload,NEW.source_url,NEW.source_title,NEW.verified_at,NEW.verification_status,NEW.updated_at WHERE NOT EXISTS(SELECT 1 FROM course_catalog_versions WHERE course_id=NEW.id AND version=NEW.version);
END;
CREATE TRIGGER course_version_archive_update AFTER UPDATE ON course_catalog BEGIN
  INSERT INTO course_catalog_versions SELECT NEW.id,NEW.version,NEW.payload,NEW.source_url,NEW.source_title,NEW.verified_at,NEW.verification_status,NEW.updated_at WHERE NOT EXISTS(SELECT 1 FROM course_catalog_versions WHERE course_id=NEW.id AND version=NEW.version);
END;
CREATE TABLE course_correction_reports (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  observed_version INTEGER NOT NULL,
  request_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','accepted','rejected')),
  review_note TEXT,
  reviewed_at INTEGER,
  applied_version INTEGER,
  UNIQUE(user_id,client_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX course_reports_owner ON course_correction_reports(user_id,created_at);
CREATE INDEX course_reports_open ON course_correction_reports(status,created_at);
CREATE TABLE course_review_checks (check_value INTEGER NOT NULL CHECK(check_value=1));
