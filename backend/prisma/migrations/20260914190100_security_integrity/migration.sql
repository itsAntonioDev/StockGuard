-- =============================================================================
-- StockGuard — integridade e segurança no banco (defesa em profundidade)
--
-- Mesmo que a API seja comprometida ou tenha um bug, o banco garante:
--  1. saldo só muda pela função sg_apply_stock_delta, que grava o ledger junto;
--  2. saldo nunca fica negativo;
--  3. o mesmo item de movimentação não é aplicado duas vezes;
--  4. auditoria, ledger e históricos são somente-inserção;
--  5. movimentações e divergências finalizadas não são alteradas nem excluídas.
--
-- Atenção: `prisma migrate dev` não conhece objetos abaixo (CHECK, triggers,
-- funções, índices NULLS NOT DISTINCT). Revise o SQL de migrações futuras para
-- não removê-los. Detalhes em docs/modelo-dados.md.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Unicidade tratando NULL como valor (PostgreSQL 15+)
--    Sem isso, (produto, endereço, lote NULL) poderia ter saldos duplicados.
-- -----------------------------------------------------------------------------
DROP INDEX "stock_balances_product_location_lot_key";
CREATE UNIQUE INDEX "stock_balances_product_location_lot_key"
  ON "stock_balances" ("productId", "locationId", "lotId") NULLS NOT DISTINCT;

DROP INDEX "inventory_count_items_unique_key";
CREATE UNIQUE INDEX "inventory_count_items_unique_key"
  ON "inventory_count_items" ("inventoryCountId", "locationId", "productId", "lotId") NULLS NOT DISTINCT;

-- Um item gera no máximo um lançamento de saída e um de entrada (transferência).
CREATE UNIQUE INDEX "stock_ledger_entries_item_direction_key"
  ON "stock_ledger_entries" ("movementItemId", (sign("delta")));

-- -----------------------------------------------------------------------------
-- 2. Restrições de domínio
-- -----------------------------------------------------------------------------
ALTER TABLE "stock_balances"        ADD CONSTRAINT "stock_balances_quantity_non_negative" CHECK ("quantity" >= 0);
ALTER TABLE "stock_ledger_entries"  ADD CONSTRAINT "stock_ledger_entries_delta_not_zero" CHECK ("delta" <> 0);
ALTER TABLE "stock_ledger_entries"  ADD CONSTRAINT "stock_ledger_entries_balance_non_negative" CHECK ("balanceAfter" >= 0);
ALTER TABLE "stock_movement_items"  ADD CONSTRAINT "stock_movement_items_expected_positive" CHECK ("expectedQuantity" > 0);
ALTER TABLE "stock_movement_items"  ADD CONSTRAINT "stock_movement_items_quantity_non_negative" CHECK ("quantity" IS NULL OR "quantity" >= 0);
ALTER TABLE "stock_movement_items"  ADD CONSTRAINT "stock_movement_items_direction_valid" CHECK ("direction" IN (-1, 1));
ALTER TABLE "stock_movement_items"  ADD CONSTRAINT "stock_movement_items_has_location" CHECK ("fromLocationId" IS NOT NULL OR "toLocationId" IS NOT NULL);
ALTER TABLE "stock_movement_items"  ADD CONSTRAINT "stock_movement_items_distinct_locations" CHECK ("fromLocationId" IS NULL OR "toLocationId" IS NULL OR "fromLocationId" <> "toLocationId");
ALTER TABLE "products"              ADD CONSTRAINT "products_min_stock_non_negative" CHECK ("minStock" >= 0);
ALTER TABLE "products"              ADD CONSTRAINT "products_unit_cost_non_negative" CHECK ("unitCost" IS NULL OR "unitCost" >= 0);
ALTER TABLE "locations"             ADD CONSTRAINT "locations_capacity_positive" CHECK ("capacity" IS NULL OR "capacity" > 0);
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_items_quantities_non_negative"
  CHECK ("systemQuantity" >= 0 AND ("countedQuantity" IS NULL OR "countedQuantity" >= 0) AND ("recountQuantity" IS NULL OR "recountQuantity" >= 0));
ALTER TABLE "discrepancies"         ADD CONSTRAINT "discrepancies_quantities_non_negative"
  CHECK (("expectedQuantity" IS NULL OR "expectedQuantity" >= 0) AND ("foundQuantity" IS NULL OR "foundQuantity" >= 0));
ALTER TABLE "users"                 ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));
ALTER TABLE "alerts"                ADD CONSTRAINT "alerts_open_key_consistent"
  CHECK (("status" = 'RESOLVED' AND "openDedupeKey" IS NULL) OR ("status" <> 'RESOLVED' AND "openDedupeKey" = "dedupeKey"));

-- -----------------------------------------------------------------------------
-- 3. Tabelas somente-inserção
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sg_forbid_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SG_APPEND_ONLY: a tabela % não permite %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER "audit_logs_append_only"            BEFORE UPDATE OR DELETE ON "audit_logs"            FOR EACH ROW EXECUTE FUNCTION sg_forbid_modification();
CREATE TRIGGER "stock_ledger_entries_append_only"  BEFORE UPDATE OR DELETE ON "stock_ledger_entries"  FOR EACH ROW EXECUTE FUNCTION sg_forbid_modification();
CREATE TRIGGER "check_attempts_append_only"        BEFORE UPDATE OR DELETE ON "check_attempts"        FOR EACH ROW EXECUTE FUNCTION sg_forbid_modification();
CREATE TRIGGER "discrepancy_actions_append_only"   BEFORE UPDATE OR DELETE ON "discrepancy_actions"   FOR EACH ROW EXECUTE FUNCTION sg_forbid_modification();
CREATE TRIGGER "discrepancy_evidences_append_only" BEFORE UPDATE OR DELETE ON "discrepancy_evidences" FOR EACH ROW EXECUTE FUNCTION sg_forbid_modification();

-- -----------------------------------------------------------------------------
-- 4. Movimentações: identidade imutável; finalizadas não mudam; nunca excluídas
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sg_guard_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SG_IMMUTABLE_MOVEMENT: movimentações não podem ser excluídas' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" IN ('CONFIRMED', 'CANCELLED', 'REJECTED') THEN
    RAISE EXCEPTION 'SG_IMMUTABLE_MOVEMENT: movimentação finalizada não pode ser alterada' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."type" <> OLD."type" OR NEW."number" <> OLD."number" OR NEW."warehouseId" <> OLD."warehouseId"
     OR NEW."createdById" <> OLD."createdById" OR NEW."idempotencyKey" <> OLD."idempotencyKey"
     OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'SG_IMMUTABLE_MOVEMENT: campos de identidade não podem ser alterados' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "stock_movements_guard" BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION sg_guard_movement();

CREATE OR REPLACE FUNCTION sg_guard_movement_item() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status "MovementStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SG_IMMUTABLE_MOVEMENT: itens de movimentação não podem ser excluídos' USING ERRCODE = 'P0001';
  END IF;
  SELECT "status" INTO v_status FROM "stock_movements" WHERE "id" = OLD."movementId";
  IF v_status IN ('CONFIRMED', 'CANCELLED', 'REJECTED') THEN
    RAISE EXCEPTION 'SG_IMMUTABLE_MOVEMENT: item de movimentação finalizada não pode ser alterado' USING ERRCODE = 'P0001';
  END IF;
  -- Somente a quantidade confirmada pode ser registrada; o que foi solicitado é permanente.
  IF NEW."movementId" <> OLD."movementId" OR NEW."productId" <> OLD."productId"
     OR NEW."lotId" IS DISTINCT FROM OLD."lotId"
     OR NEW."fromLocationId" IS DISTINCT FROM OLD."fromLocationId"
     OR NEW."toLocationId" IS DISTINCT FROM OLD."toLocationId"
     OR NEW."expectedQuantity" <> OLD."expectedQuantity" OR NEW."unit" <> OLD."unit"
     OR NEW."direction" <> OLD."direction" THEN
    RAISE EXCEPTION 'SG_IMMUTABLE_MOVEMENT: apenas a quantidade confirmada pode ser registrada' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "stock_movement_items_guard" BEFORE UPDATE OR DELETE ON "stock_movement_items"
  FOR EACH ROW EXECUTE FUNCTION sg_guard_movement_item();

-- -----------------------------------------------------------------------------
-- 5. Divergências finalizadas são imutáveis e nunca excluídas
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sg_guard_discrepancy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SG_IMMUTABLE_DISCREPANCY: divergências não podem ser excluídas' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" IN ('CORRECTED', 'CONFIRMED', 'DISCARDED') THEN
    RAISE EXCEPTION 'SG_IMMUTABLE_DISCREPANCY: divergência finalizada não pode ser alterada' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "discrepancies_guard" BEFORE UPDATE OR DELETE ON "discrepancies"
  FOR EACH ROW EXECUTE FUNCTION sg_guard_discrepancy();

-- -----------------------------------------------------------------------------
-- 6. Única porta de alteração de saldo
--    SECURITY DEFINER: executa com os privilégios do dono (migrator). O papel da
--    API só tem EXECUTE nesta função e SELECT nas tabelas de saldo/ledger.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sg_apply_stock_delta(
  p_movement_item_id uuid,
  p_location_id      uuid,
  p_delta            numeric,
  p_actor_id         uuid
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item  record;
  v_after numeric;
BEGIN
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'SG_INVALID_DELTA' USING ERRCODE = 'P0001';
  END IF;

  -- Trava a movimentação: aplicações concorrentes da mesma operação ficam em fila.
  SELECT i."id", i."movementId", i."productId", i."lotId", i."fromLocationId", i."toLocationId",
         i."quantity", m."status"
    INTO v_item
    FROM "stock_movement_items" i
    JOIN "stock_movements" m ON m."id" = i."movementId"
   WHERE i."id" = p_movement_item_id
   FOR UPDATE OF m;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SG_ITEM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_item."status" NOT IN ('PENDING_CHECK', 'PENDING_APPROVAL') THEN
    RAISE EXCEPTION 'SG_MOVEMENT_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;
  IF v_item."quantity" IS NULL OR abs(p_delta) <> v_item."quantity" THEN
    RAISE EXCEPTION 'SG_DELTA_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF (p_delta > 0 AND p_location_id IS DISTINCT FROM v_item."toLocationId")
     OR (p_delta < 0 AND p_location_id IS DISTINCT FROM v_item."fromLocationId") THEN
    RAISE EXCEPTION 'SG_LOCATION_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  IF p_delta > 0 THEN
    INSERT INTO "stock_balances" ("id", "productId", "locationId", "lotId", "quantity", "version", "updatedAt")
    VALUES (gen_random_uuid(), v_item."productId", p_location_id, v_item."lotId", p_delta, 1, now())
    ON CONFLICT ("productId", "locationId", "lotId")
    DO UPDATE SET "quantity"  = "stock_balances"."quantity" + EXCLUDED."quantity",
                  "version"   = "stock_balances"."version" + 1,
                  "updatedAt" = now()
    RETURNING "quantity" INTO v_after;
  ELSE
    -- Atualização condicional atômica: nunca deixa o saldo negativo, mesmo sob concorrência.
    UPDATE "stock_balances"
       SET "quantity"  = "quantity" + p_delta,
           "version"   = "version" + 1,
           "updatedAt" = now()
     WHERE "productId" = v_item."productId"
       AND "locationId" = p_location_id
       AND "lotId" IS NOT DISTINCT FROM v_item."lotId"
       AND "quantity" + p_delta >= 0
    RETURNING "quantity" INTO v_after;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SG_INSUFFICIENT_STOCK' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO "stock_ledger_entries"
    ("movementId", "movementItemId", "productId", "locationId", "lotId", "delta", "balanceAfter", "createdById", "createdAt")
  VALUES
    (v_item."movementId", v_item."id", v_item."productId", p_location_id, v_item."lotId", p_delta, v_after, p_actor_id, now());

  RETURN v_after;
END;
$$;

REVOKE ALL ON FUNCTION sg_apply_stock_delta(uuid, uuid, numeric, uuid) FROM PUBLIC;

-- search_path fixo no schema onde a migração roda (public localmente, stockguard no Supabase):
-- impede que objetos de outro schema sejam usados no lugar das tabelas (função SECURITY DEFINER)
-- e mantém o trigger de itens funcionando para qualquer sessão.
DO $$
BEGIN
  EXECUTE format('ALTER FUNCTION sg_apply_stock_delta(uuid, uuid, numeric, uuid) SET search_path = %I, pg_temp', current_schema());
  EXECUTE format('ALTER FUNCTION sg_guard_movement_item() SET search_path = %I, pg_temp', current_schema());
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Privilégios do papel da API (aplicados se o papel existir)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stockguard_app') THEN
    -- Saldo e ledger: somente leitura direta; escrita apenas via função.
    REVOKE ALL ON TABLE "stock_balances", "stock_ledger_entries" FROM stockguard_app;
    GRANT SELECT ON TABLE "stock_balances", "stock_ledger_entries" TO stockguard_app;
    GRANT EXECUTE ON FUNCTION sg_apply_stock_delta(uuid, uuid, numeric, uuid) TO stockguard_app;

    -- Históricos: inserir e ler, nunca alterar/excluir.
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE
      "audit_logs", "check_attempts", "discrepancy_actions", "discrepancy_evidences"
      FROM stockguard_app;

    -- Única exclusão física permitida: vínculos perfil↔permissão (reconfiguração auditada).
    GRANT DELETE ON TABLE "role_permissions" TO stockguard_app;

    -- A API não precisa (nem deve) ver ou alterar o histórico de migrações.
    REVOKE ALL ON TABLE "_prisma_migrations" FROM stockguard_app;
  END IF;
END;
$$;
