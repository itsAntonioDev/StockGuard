-- Exclusão física de produtos e lotes SEM histórico (cadastro criado por engano).
-- O serviço só apaga depois de confirmar que não há saldo, movimentação, inventário
-- nem divergência ligados ao registro; o histórico do estoque continua imutável.
-- Alertas são derivados do cadastro (ex.: estoque abaixo do mínimo) e saem junto.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stockguard_app') THEN
    GRANT DELETE ON TABLE "products", "lots", "alerts" TO stockguard_app;
  END IF;
END;
$$;
