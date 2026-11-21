-- EUMBMS 선택 사항: tag_readings 시계열을 TimescaleDB hypertable로 변환
-- 전제: TimescaleDB 확장이 설치된 PostgreSQL (docker: DB_IMAGE=timescale/timescaledb:latest-pg16)
-- 주의: 이 스크립트는 기존 PK/유니크 제약을 조정합니다. 운영 전 백업 필수.
-- 이 빌드의 자동 테스트는 일반 PostgreSQL에서 수행되었으며, hypertable 변환은 검증되지 않았습니다.

CREATE EXTENSION IF NOT EXISTS timescaledb;

ALTER TABLE tag_readings DROP CONSTRAINT IF EXISTS "tag_readings_pkey";
ALTER TABLE tag_readings ADD CONSTRAINT tag_readings_pkey PRIMARY KEY (id, ts);

SELECT create_hypertable('tag_readings', 'ts', if_not_exists => TRUE, migrate_data => TRUE);

-- 보존 정책 예시 (1년)
-- SELECT add_retention_policy('tag_readings', INTERVAL '365 days');

-- 압축 정책 예시 (7일 이후)
-- ALTER TABLE tag_readings SET (timescaledb.compress, timescaledb.compress_segmentby = '"tagId"');
-- SELECT add_compression_policy('tag_readings', INTERVAL '7 days');
