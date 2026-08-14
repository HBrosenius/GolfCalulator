PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS course_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  search_name TEXT NOT NULL,
  region TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'SE',
  holes INTEGER NOT NULL CHECK (holes IN (9,18)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS course_catalog_published_name
  ON course_catalog (published, search_name);

INSERT OR REPLACE INTO course_catalog (id,name,search_name,region,country,holes,version,updated_at,published,payload) VALUES
('kalmar-gk-gamla-18','Kalmar GK - Gamla banan','kalmar gk - gamla banan','Kalmar län','SE',18,1,1786665600000,1,'{"id":"kalmar-gk-gamla-18","name":"Kalmar GK - Gamla banan","region":"Kalmar län","country":"SE","holes":18,"version":1,"updatedAt":1786665600000,"tees":[{"name":"Gul","slope":140,"cr":72.3,"par":72,"hpar":[3,4,4,4,4,3,5,5,4,4,4,5,3,5,4,3,4,4],"si":[10,6,8,14,2,16,18,4,12,9,17,3,1,13,7,15,5,11]},{"name":"Röd","slope":131,"cr":67.9,"par":72,"hpar":[3,4,4,4,4,3,5,5,4,4,4,5,3,5,4,3,4,4],"si":[10,6,8,14,2,16,18,4,12,9,17,3,1,13,7,15,5,11]}]}'),
('kalmar-gk-nya-18','Kalmar GK - Nya banan','kalmar gk - nya banan','Kalmar län','SE',18,1,1786665600000,1,'{"id":"kalmar-gk-nya-18","name":"Kalmar GK - Nya banan","region":"Kalmar län","country":"SE","holes":18,"version":1,"updatedAt":1786665600000,"tees":[{"name":"Gul","slope":132,"cr":69.3,"par":71,"hpar":[3,5,5,3,4,4,4,3,5,3,5,5,4,4,3,4,4,3],"si":[12,4,16,8,2,14,6,18,10,9,13,5,17,1,7,15,3,11]},{"name":"Röd","slope":124,"cr":65.5,"par":71,"hpar":[3,5,5,3,4,4,4,3,5,3,5,5,4,4,3,4,4,3],"si":[12,4,16,8,2,14,6,18,10,9,13,5,17,1,7,15,3,11]}]}'),
('more-gk-18','Möre GK','möre gk','Kalmar län','SE',18,1,1786665600000,1,'{"id":"more-gk-18","name":"Möre GK","region":"Kalmar län","country":"SE","holes":18,"version":1,"updatedAt":1786665600000,"tees":[{"name":"Gul","slope":131,"cr":71.4,"par":72,"hpar":[3,5,4,3,5,4,3,4,4,4,4,5,5,4,4,4,3,4],"si":[12,2,16,18,4,8,6,14,10,11,13,3,15,5,7,1,17,9]},{"name":"Röd","slope":123,"cr":67.5,"par":72,"hpar":[3,5,4,3,5,4,3,4,4,4,4,5,5,4,4,4,3,4],"si":[12,2,16,18,4,8,6,14,10,11,13,3,15,5,7,1,17,9]}]}'),
('nybro-gk-18','Nybro GK','nybro gk','Kalmar län','SE',18,1,1786665600000,1,'{"id":"nybro-gk-18","name":"Nybro GK","region":"Kalmar län","country":"SE","holes":18,"version":1,"updatedAt":1786665600000,"tees":[{"name":"Gul","slope":135,"cr":70,"par":72,"hpar":[4,5,4,5,4,3,4,4,4,5,4,3,4,4,3,5,3,4],"si":[15,13,3,7,11,17,9,1,5,14,6,16,12,8,4,10,18,2]},{"name":"Röd","slope":126,"cr":66,"par":72,"hpar":[4,5,4,5,4,3,4,4,4,5,4,3,4,4,3,5,3,4],"si":[15,13,3,7,11,17,9,1,5,14,6,16,12,8,4,10,18,2]}]}');
