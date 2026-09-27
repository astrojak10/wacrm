-- ============================================================
-- 043_ai_provider_gemini.sql
--
-- Adds 'gemini' (Google Gemini) to the allowed AI providers list:
--   1. ai_configs.provider CHECK constraint
--   2. ai_usage_log.provider CHECK constraint
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'gemini'));

ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'gemini'));

