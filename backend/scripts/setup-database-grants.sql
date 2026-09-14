-- Privilégios aplicados em cada banco (incluído por setup-database.sql).
-- :"DBNAME" é preenchido pelo psql com o banco conectado.
\set ON_ERROR_STOP on

ALTER DATABASE :"DBNAME" OWNER TO stockguard_migrator;
REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"DBNAME" TO stockguard_app;

ALTER SCHEMA public OWNER TO stockguard_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO stockguard_app;

-- Padrão para tabelas criadas pelo migrator: leitura/inserção/atualização.
-- DELETE não é concedido por padrão; exceções e restrições (ledger, auditoria)
-- ficam na migração de segurança.
ALTER DEFAULT PRIVILEGES FOR ROLE stockguard_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO stockguard_app;
ALTER DEFAULT PRIVILEGES FOR ROLE stockguard_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO stockguard_app;
ALTER DEFAULT PRIVILEGES FOR ROLE stockguard_migrator IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
