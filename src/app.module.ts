import { Module } from '@nestjs/common';
import { MikroORM, EntityManager } from '@mikro-orm/postgresql';
import config from '../mikro-orm.config';
import { WalletController } from './infrastructure/http/controllers/wallet.controller';
import { WageringController } from './infrastructure/http/controllers/wagering.controller';

@Module({
  controllers: [WalletController, WageringController],
  providers: [
    {
      provide: MikroORM,
      useFactory: async () => await MikroORM.init(config),
    },
    {
      provide: EntityManager,
      useFactory: (orm: MikroORM) => orm.em.fork(),
      inject: [MikroORM],
    },
  ],
})
export class AppModule {}
