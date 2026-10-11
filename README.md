# Distributed Wagering Processor

Processador distribuído de apostas e transações de carteira (iGaming) de alta concorrência construído com **NestJS**, **Bun**, **PostgreSQL** e **LocalStack (AWS SQS FIFO)**.

---

## 🏛 Decisões Arquiteturais

1. **Precisão Monetária Sem Ponto Flutuante**:
   - Encapsulamento estrito via Value Object `Money` utilizando `decimal.js`.
   - Colunas monetárias no PostgreSQL mapeadas como `NUMERIC(18, 2)`.
   - Divisão rejeitada por padrão e validação de casas decimais e moeda uniforme em todas as operações.

2. **Isolamento e Controle de Concorrência**:
   - Bloqueio pessimista de linha via `SELECT ... FOR UPDATE` no agregado `Wallet`.
   - Bloqueio no nível de schema via constraint `CHECK (balance >= 0)`, impossibilitando saldo negativo mesmo sob falhas de aplicação.
   - Versionamento de agregados com controle otimista auxiliar (`version`).

3. **Garantia de Idempotência em Duas Camadas**:
   - Chave canônica persistente `(idempotency_key)` com constraint única no banco de dados.
   - Cálculo de hash SHA-256 do payload normalizado: replays idênticos retornam o resultado original cacheado; payloads divergentes com a mesma chave disparam conflito (`409 Conflict`).

4. **Livro-Razão Contábil Imutável (Ledger)**:
   - Toda alteração de saldo gera uma linha contábil append-only com `balance_before` e `balance_after`.
   - Endpoint de reconciliação matemática valida em tempo real se o saldo materializado é estritamente igual à soma algébrica dos lançamentos contábeis.

5. **Mensageria Assíncrona e Transactional Outbox**:
   - Padrão **Transactional Outbox**: escrita atômica da transação de negócio e do evento de integração na mesma transação SQL.
   - Worker desacoplado consumindo pendências via `SELECT ... FOR UPDATE SKIP LOCKED` para permitir múltiplas instâncias sem disputa de lote.
   - Publicação em filas FIFO do SQS com agrupamento por `walletId` e deduplicação nativa por `eventId`.
   - Backoff exponencial em falhas transitórias.

---

## 🚀 Como Executar

### Pré-requisitos
- [Bun](https://bun.sh/) (v1.4+)
- Docker e Docker Compose

### 1. Subir Infraestrutura (Postgres e LocalStack)
```bash
docker compose up -d
