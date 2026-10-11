import { Migration } from '@mikro-orm/migrations';

export class Migration20261010000000_initial extends Migration {
  async up(): Promise<void> {
    // 1. Wallets
    this.addSql(`
      CREATE TABLE IF NOT EXISTS wallets (
        id VARCHAR(36) PRIMARY KEY,
        player_id VARCHAR(64) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        balance NUMERIC(18, 2) NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_wallet_balance_positive CHECK (balance >= 0),
        CONSTRAINT uq_wallet_player_currency UNIQUE (player_id, currency)
      );
    `);

    // 2. Wallet Ledger (Imutável - append-only)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS wallet_ledger (
        id VARCHAR(36) PRIMARY KEY,
        wallet_id VARCHAR(36) NOT NULL REFERENCES wallets(id),
        transaction_id VARCHAR(36) NOT NULL,
        direction VARCHAR(10) NOT NULL,
        amount NUMERIC(18, 2) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        balance_before NUMERIC(18, 2) NOT NULL,
        balance_after NUMERIC(18, 2) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ledger_wallet_created ON wallet_ledger(wallet_id, created_at);
    `);

    // 3. Wager Transactions (Auditoria completa e máquina de estados)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS wager_transactions (
        id VARCHAR(36) PRIMARY KEY,
        provider_id VARCHAR(64) NOT NULL,
        external_transaction_id VARCHAR(128) NOT NULL,
        idempotency_key VARCHAR(256) NOT NULL,
        payload_hash VARCHAR(64) NOT NULL,
        wallet_id VARCHAR(36) NOT NULL REFERENCES wallets(id),
        player_id VARCHAR(64) NOT NULL,
        round_id VARCHAR(64) NOT NULL,
        game_id VARCHAR(64) NOT NULL,
        kind VARCHAR(20) NOT NULL,
        amount NUMERIC(18, 2) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        status VARCHAR(20) NOT NULL,
        reference_external_transaction_id VARCHAR(128),
        reference_transaction_id VARCHAR(36),
        failure_code VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ,
        CONSTRAINT uq_wager_idempotency_key UNIQUE (idempotency_key),
        CONSTRAINT uq_wager_provider_external_tx UNIQUE (provider_id, external_transaction_id)
      );
      CREATE INDEX IF NOT EXISTS idx_wager_wallet ON wager_transactions(wallet_id);
      CREATE INDEX IF NOT EXISTS idx_wager_status ON wager_transactions(status);
    `);

    // 4. Inbox (Deduplicação de Mensagens SQS)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS inbox_messages (
        message_id VARCHAR(128) NOT NULL,
        consumer_name VARCHAR(64) NOT NULL,
        payload_hash VARCHAR(64) NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ,
        PRIMARY KEY (consumer_name, message_id)
      );
    `);

    // 5. Outbox (Transactional Outbox para Mensageria com retry e backoff)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS outbox_messages (
        id VARCHAR(36) PRIMARY KEY,
        aggregate_id VARCHAR(36) NOT NULL,
        event_type VARCHAR(64) NOT NULL,
        payload JSONB NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ,
        published_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_messages(published_at, next_attempt_at);
    `);
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS outbox_messages;');
    this.addSql('DROP TABLE IF EXISTS inbox_messages;');
    this.addSql('DROP TABLE IF EXISTS wager_transactions;');
    this.addSql('DROP TABLE IF EXISTS wallet_ledger;');
    this.addSql('DROP TABLE IF EXISTS wallets;');
  }
}
