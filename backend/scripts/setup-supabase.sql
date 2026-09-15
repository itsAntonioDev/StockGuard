-- =============================================================================
-- StockGuard no Supabase: papeis e schemas com privilegio minimo.
--
-- Executado por scripts/setup-supabase.ps1 conectado como "postgres".
-- Variaveis psql: mig_pw, app_pw
--
-- Por que schemas proprios (stockguard e stockguard_test) e nao "public":
-- o Supabase publica o schema public na API REST (PostgREST) para os papeis
-- anon/authenticated. As tabelas do estoque nunca devem ficar acessiveis por ela.
-- =============================================================================
\set ON_ERROR_STOP on

SELECT 'CREATE ROLE stockguard_migrator'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'stockguard_migrator') \gexec
SELECT 'CREATE ROLE stockguard_app'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'stockguard_app') \gexec

ALTER ROLE stockguard_migrator WITH LOGIN NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD :'mig_pw';
ALTER ROLE stockguard_app      WITH LOGIN NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD :'app_pw';

ALTER ROLE stockguard_app SET statement_timeout = '30s';
ALTER ROLE stockguard_app SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE stockguard_app SET search_path = stockguard;
ALTER ROLE stockguard_migrator SET search_path = stockguard;

-- Permite ao postgres criar os schemas em nome do migrator (PostgreSQL 16+).
GRANT stockguard_migrator TO postgres;

\set schema stockguard
\ir setup-supabase-schema.sql

\set schema stockguard_test
\ir setup-supabase-schema.sql
