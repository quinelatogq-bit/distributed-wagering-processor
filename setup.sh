#!/usr/bin/env bash
set -e

echo "🚀 Iniciando ambiente de avaliação..."

# 1. Subir containers
echo "📦 Subindo containers Docker..."
docker compose up -d

# 2. Aguardar LocalStack e Postgres estarem prontos
echo "⏳ Aguardando serviços ficarem prontos..."
sleep 5

# 3. Criar filas no LocalStack
echo "📬 Configurando filas SQS FIFO..."
docker exec -i wagering_localstack awslocal sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false || true

docker exec -i wagering_localstack awslocal sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false || true

# 4. Executar migrations
echo "🗄️ Executando migrações do PostgreSQL..."
bun run scripts/migrate.ts

# 5. Executar suíte de testes
echo "🧪 Executando suíte de testes..."
bun test

echo "✅ Ambiente pronto! Para iniciar a API: bun run start"
