-- =============================================================================
-- StockGuard — criação de papéis e bancos (DESENVOLVIMENTO / TESTE)
--
-- Executado por scripts/setup-database.ps1 com um superusuário.
-- Variáveis psql esperadas: mig_pw, app_pw
--
-- Papéis:
--   stockguard_migrator  dono do schema; executa migrações (DDL).
--                        CREATEDB apenas para o shadow database do `prisma migrate dev`.
--                        Em produção, crie este papel SEM CREATEDB.
--   stockguard_app       usado pela API em tempo de execução. Sem DDL, sem
--                        superusuário. Privilégios finos por tabela são
--                        definidos na migração de segurança.
-- =============================================================================
\set ON_ERROR_STOP on

SELECT 'CREATE ROLE stockguard_migrator'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'stockguard_migrator') \gexec
SELECT 'CREATE ROLE stockguard_app'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'stockguard_app') \gexec

ALTER ROLE stockguard_migrator WITH LOGIN NOSUPERUSER NOCREATEROLE CREATEDB NOREPLICATION NOBYPASSRLS PASSWORD :'mig_pw';
ALTER ROLE stockguard_app      WITH LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD :'app_pw';

-- Limita consultas travadas e transações esquecidas abertas.
ALTER ROLE stockguard_app SET statement_timeout = '30s';
ALTER ROLE stockguard_app SET idle_in_transaction_session_timeout = '60s';

SELECT 'CREATE DATABASE stockguard_dev OWNER stockguard_migrator'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'stockguard_dev') \gexec
SELECT 'CREATE DATABASE stockguard_test OWNER stockguard_migrator'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'stockguard_test') \gexec

\c stockguard_dev
\ir setup-database-grants.sql

\c stockguard_test
\ir setup-database-grants.sql
