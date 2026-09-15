-- Cria e protege um schema do StockGuard (incluido por setup-supabase.sql).
-- Variavel psql: schema
\set ON_ERROR_STOP on

SELECT format('CREATE SCHEMA %I AUTHORIZATION stockguard_migrator', :'schema')
 WHERE NOT EXISTS (SELECT FROM pg_namespace WHERE nspname = :'schema') \gexec

-- Ninguem alem dos papeis do StockGuard acessa o schema (inclui papeis da API REST do Supabase).
SELECT format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', :'schema') \gexec
SELECT format('REVOKE ALL ON SCHEMA %I FROM %I', :'schema', r.rolname)
  FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated') \gexec

SELECT format('GRANT USAGE ON SCHEMA %I TO stockguard_app', :'schema') \gexec

-- Padrao para objetos criados pelo migrator: leitura/insercao/atualizacao.
-- DELETE nao e concedido; restricoes finas ficam na migracao de seguranca.
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE stockguard_migrator IN SCHEMA %I GRANT SELECT, INSERT, UPDATE ON TABLES TO stockguard_app', :'schema') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE stockguard_migrator IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO stockguard_app', :'schema') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE stockguard_migrator IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', :'schema') \gexec
