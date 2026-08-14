ALTER TABLE course_catalog ADD COLUMN source_url TEXT;
ALTER TABLE course_catalog ADD COLUMN source_title TEXT;
ALTER TABLE course_catalog ADD COLUMN verified_at INTEGER;
ALTER TABLE course_catalog ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'legacy'
  CHECK (verification_status IN ('verified','needs-review','legacy'));

UPDATE course_catalog SET
  source_url = CASE id
    WHEN 'kalmar-gk-gamla-18' THEN 'https://www.kalmargk.se/'
    WHEN 'kalmar-gk-nya-18' THEN 'https://www.kalmargk.se/'
    WHEN 'more-gk-18' THEN 'https://www.moregk.se/'
    WHEN 'nybro-gk-18' THEN 'http://www.nybrogk.se/'
  END,
  source_title = 'Klubbens webbplats',
  verification_status = 'needs-review'
WHERE id IN ('kalmar-gk-gamla-18','kalmar-gk-nya-18','more-gk-18','nybro-gk-18');
