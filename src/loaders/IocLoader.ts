import { MicroframeworkLoader } from 'microframework-w3tec';
import { useContainer as routingUseContainer } from 'routing-controllers';
import { useContainer as ormUseContainer } from 'typeorm';
import { Container } from 'typedi';

export const iocLoader: MicroframeworkLoader = () => {
  routingUseContainer(Container);
  ormUseContainer(Container);
};
