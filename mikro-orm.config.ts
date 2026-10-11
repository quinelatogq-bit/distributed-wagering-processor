import { Options, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { Migration20261010000000_initial } from './src/infrastructure/database/migrations/Migration20261010000000_initial';

const config: Options = {
  driver: PostgreSqlDriver,
  dbName: process.env.DB_NAME || 'wagering_db',
  user: process.env.DB_USER || 'jungle_user',
  password: process.env.DB_PASSWORD || 'jungle_password',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5432,
  entities: [],
  discovery: {
    warnWhenNoEntities: false,
    requireEntitiesArray: false,
  },
  extensions: [Migrator],
  migrations: {
    migrationsList: [
      {
        name: 'Migration20261010000000_initial',
        class: Migration20261010000000_initial,
      },
    ],
    transactional: true,
    allOrNothing: true,
  },
};

export default config;
